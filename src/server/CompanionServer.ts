import { createServer, type Server as HttpServer } from "node:http";
import os from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ConnectorCapabilities,
  PermissionHandler,
  PermissionRequest,
  TabEvent,
  TabInfo,
  TabTranscript,
} from "../connector/types.js";
import {
  encodeMessage,
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type HelloResult,
  type ServerMessage,
  type WorkspaceInfo,
} from "./protocol.js";

/**
 * The slice of DevinConnector the server needs. DevinConnector satisfies this
 * structurally; tests inject a fake.
 */
export interface CompanionConnector {
  capabilities(): ConnectorCapabilities;
  listTabs(cwd?: string): Promise<TabInfo[]>;
  readTab(sessionId: string, cwd?: string): Promise<TabTranscript>;
  createTab(cwd: string): Promise<TabInfo>;
  postToTab(sessionId: string, text: string, opts?: { cwd?: string }): AsyncGenerator<TabEvent, void>;
  deleteTab(sessionId: string): Promise<void>;
  cancelTab(sessionId: string): void;
  close(): void;
}

export interface CompanionServerOptions {
  /** Pairing code the phone must present in `hello`. */
  code: string;
  /** Devin workspaces the companion can list/attach tabs in. */
  workspaces: WorkspaceInfo[];
  /** Connect (or reuse) the provider connector. Called lazily, retried on failure. */
  connectorFactory: (permissionHandler: PermissionHandler) => Promise<CompanionConnector>;
  host?: string; // default 0.0.0.0
  port?: number; // default 4000; pass 0 for an ephemeral port (tests)
  machineName?: string; // default os.hostname()
  /** How long a permission request waits for the phone before cancelling. */
  permissionTimeoutMs?: number; // default 5 min
  /** Ping interval for dead-socket reaping; 0 disables. */
  heartbeatMs?: number; // default 25s
  log?: (message: string) => void;
}

interface PendingPermission {
  request: PermissionRequest;
  resolve: (optionId: string | null) => void;
  timer: NodeJS.Timeout;
}

interface ClientState {
  socket: WebSocket;
  authed: boolean;
  alive: boolean;
}

const ERR_UNAUTHENTICATED = "send hello with the pairing code first";
const ERR_BAD_CODE = "invalid pairing code";

/**
 * LAN companion: exposes a DevinConnector to the phone app over WebSocket.
 *
 * A turn started by the phone belongs to the Devin session itself — if the
 * phone disconnects mid-prompt the work continues in Devin Desktop and the
 * result is visible in the tab on next transcript read.
 */
export class CompanionServer {
  private http?: HttpServer;
  private wss?: WebSocketServer;
  private readonly clients = new Set<ClientState>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private connectorPromise?: Promise<CompanionConnector>;
  private heartbeat?: NodeJS.Timeout;
  private permissionSeq = 0;

  constructor(private readonly options: CompanionServerOptions) {}

  /** Bound once so it can be passed as the connector's PermissionHandler. */
  private readonly permissionHandler: PermissionHandler = (request) => this.dispatchPermission(request);

  async start(): Promise<{ host: string; port: number }> {
    const host = this.options.host ?? "0.0.0.0";
    const port = this.options.port ?? 4000;

    this.http = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, server: "agentyard-companion", protocolVersion: PROTOCOL_VERSION }));
      } else {
        res.writeHead(404).end();
      }
    });

    this.wss = new WebSocketServer({ server: this.http });
    this.wss.on("connection", (socket) => this.onConnection(socket));

    const heartbeatMs = this.options.heartbeatMs ?? 25_000;
    if (heartbeatMs > 0) {
      this.heartbeat = setInterval(() => {
        for (const c of this.clients) {
          if (!c.alive) {
            c.socket.terminate();
            this.clients.delete(c);
            continue;
          }
          c.alive = false;
          c.socket.ping();
        }
      }, heartbeatMs);
      this.heartbeat.unref();
    }

    await new Promise<void>((resolve, reject) => {
      this.http!.once("error", reject);
      this.http!.listen(port, host, resolve);
    });
    const address = this.http.address();
    const boundPort = typeof address === "object" && address ? address.port : port;
    // Warm the connector in the background so the first op doesn't wait for spawn.
    void this.ensureConnector().catch((err) => this.log(`connector unavailable: ${errMessage(err)}`));
    return { host, port: boundPort };
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const p of this.pendingPermissions.values()) {
      clearTimeout(p.timer);
      p.resolve(null);
    }
    this.pendingPermissions.clear();
    for (const c of this.clients) c.socket.terminate();
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()) ?? resolve());
    await new Promise<void>((resolve) => this.http?.close(() => resolve()) ?? resolve());
    if (this.connectorPromise) {
      const conn = await this.connectorPromise.catch(() => undefined);
      conn?.close();
    }
  }

  private ensureConnector(): Promise<CompanionConnector> {
    this.connectorPromise ??= this.options.connectorFactory(this.permissionHandler);
    // On failure, drop the memo so the next op retries the connect.
    this.connectorPromise.catch(() => {
      this.connectorPromise = undefined;
    });
    return this.connectorPromise;
  }

  private onConnection(socket: WebSocket): void {
    const client: ClientState = { socket, authed: false, alive: true };
    this.clients.add(client);
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("message", (data) => {
      void this.onMessage(client, data.toString());
    });
    socket.on("close", () => {
      this.clients.delete(client);
    });
    socket.on("error", () => {
      this.clients.delete(client);
    });
  }

  private async onMessage(client: ClientState, raw: string): Promise<void> {
    const msg = parseClientMessage(raw);
    if (!msg) {
      this.send(client.socket, { type: "error", message: "malformed message" });
      return;
    }
    if (!client.authed) {
      if (msg.op !== "hello") {
        this.send(client.socket, { type: "error", id: msg.id, message: ERR_UNAUTHENTICATED });
        return;
      }
      if (msg.code !== this.options.code) {
        this.send(client.socket, { type: "error", id: msg.id, message: ERR_BAD_CODE, fatal: true });
        client.socket.close(4401, ERR_BAD_CODE);
        return;
      }
      client.authed = true;
    }
    try {
      await this.dispatch(client, msg);
    } catch (err) {
      this.send(client.socket, { type: "error", id: msg.id, message: errMessage(err) });
    }
  }

  private async dispatch(client: ClientState, msg: ClientMessage): Promise<void> {
    switch (msg.op) {
      case "hello": {
        const conn = await this.ensureConnector();
        const result: HelloResult = {
          server: "agentyard-companion",
          protocolVersion: PROTOCOL_VERSION,
          machine: this.options.machineName ?? os.hostname(),
          workspaces: this.options.workspaces,
          capabilities: conn.capabilities(),
        };
        this.send(client.socket, { type: "ok", id: msg.id, result });
        return;
      }
      case "workspaces":
        this.send(client.socket, { type: "ok", id: msg.id, result: this.options.workspaces });
        return;
      case "tabs": {
        const conn = await this.ensureConnector();
        const tabs = await conn.listTabs(msg.cwd ?? this.defaultCwd());
        this.send(client.socket, { type: "ok", id: msg.id, result: tabs });
        return;
      }
      case "transcript": {
        const conn = await this.ensureConnector();
        const transcript = await conn.readTab(msg.sessionId, msg.cwd ?? this.defaultCwd());
        this.send(client.socket, { type: "ok", id: msg.id, result: transcript });
        return;
      }
      case "createTab": {
        const conn = await this.ensureConnector();
        const tab = await conn.createTab(msg.cwd);
        this.send(client.socket, { type: "ok", id: msg.id, result: tab });
        return;
      }
      case "deleteTab": {
        const conn = await this.ensureConnector();
        await conn.deleteTab(msg.sessionId);
        this.send(client.socket, { type: "ok", id: msg.id });
        return;
      }
      case "cancel": {
        const conn = await this.ensureConnector();
        conn.cancelTab(msg.sessionId);
        this.send(client.socket, { type: "ok", id: msg.id });
        return;
      }
      case "prompt": {
        const conn = await this.ensureConnector();
        const { id, sessionId } = msg;
        let stopReason = "unknown";
        for await (const event of conn.postToTab(sessionId, msg.text, { cwd: msg.cwd ?? this.defaultCwd() })) {
          if (event.type === "done") stopReason = event.stopReason;
          this.send(client.socket, { type: "prompt_event", id, sessionId, event });
        }
        this.send(client.socket, { type: "ok", id, result: { stopReason } });
        return;
      }
      case "permission": {
        const pending = this.pendingPermissions.get(msg.permissionId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingPermissions.delete(msg.permissionId);
          pending.resolve(msg.optionId);
        }
        this.send(client.socket, { type: "ok", id: msg.id });
        return;
      }
    }
  }

  private dispatchPermission(request: PermissionRequest): Promise<string | null> {
    const permissionId = `perm-${++this.permissionSeq}`;
    this.broadcast({ type: "permission_request", permissionId, request });
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(permissionId);
        resolve(null);
      }, this.options.permissionTimeoutMs ?? 5 * 60 * 1000);
      timer.unref();
      this.pendingPermissions.set(permissionId, { request, resolve, timer });
    });
  }

  private defaultCwd(): string | undefined {
    return this.options.workspaces[0]?.cwd;
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(msg));
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients) if (c.authed) this.send(c.socket, msg);
  }

  private log(message: string): void {
    (this.options.log ?? (() => {}))(message);
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
