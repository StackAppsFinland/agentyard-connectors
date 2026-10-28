import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  CompanionServer,
  type CompanionConnector,
  type CompanionServerOptions,
} from "../src/server/CompanionServer.js";
import type { ClientMessage, ServerMessage } from "../src/server/protocol.js";
import type { PermissionHandler, PermissionRequest, TabEvent, TabInfo } from "../src/connector/types.js";
import type { ConnectorCapabilities } from "../src/connector/types.js";

const CAPS: ConnectorCapabilities = {
  listSessions: true,
  loadSession: true,
  createSession: true,
  deleteSession: true,
  promptImage: false,
  promptAudio: false,
  promptEmbeddedContext: true,
  raw: {},
};

const TABS: TabInfo[] = [
  { sessionId: "alpha", title: "Alpha tab", cwd: "/ws" },
  { sessionId: "beta", title: "Beta tab", cwd: "/ws", isLocked: true },
];

function fakeConnector(): CompanionConnector {
  return {
    capabilities: () => CAPS,
    listTabs: async () => TABS,
    readTab: async (sessionId) => ({ sessionId, entries: [{ kind: "agent", text: "hi" }] }),
    createTab: async (cwd) => ({ sessionId: "new-tab", cwd }),
    deleteTab: async () => {},
    cancelTab: () => {},
    postToTab: async function* (): AsyncGenerator<TabEvent, void> {
      yield { type: "user", text: "hi" };
      yield { type: "text", text: "hello " };
      yield { type: "text", text: "there" };
      yield { type: "done", stopReason: "end_turn" };
    },
    close: () => {},
  };
}

/** Test-side socket wrapper with a persistent receive queue (no lost frames). */
class TestClient {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: ((m: ServerMessage) => void)[] = [];
  readonly closed: Promise<number>;

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise<number>((r) => ws.once("close", (c) => r(c)));
    ws.on("message", (d) => {
      const msg = JSON.parse(d.toString()) as ServerMessage;
      const w = this.waiters.shift();
      if (w) w(msg);
      else this.queue.push(msg);
    });
  }

  static async dial(rig: Rig): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${rig.port}`);
    rig.clients.push(new TestClient(ws));
    const client = rig.clients[rig.clients.length - 1];
    await new Promise<void>((r) => ws.once("open", r));
    return client;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  next(): Promise<ServerMessage> {
    const m = this.queue.shift();
    if (m) return Promise.resolve(m);
    return new Promise((r) => this.waiters.push(r));
  }

  close(): void {
    this.ws.close();
  }
}

interface Rig {
  server: CompanionServer;
  port: number;
  permissionHandler: () => PermissionHandler;
  clients: TestClient[];
}

async function rig(opts: Partial<CompanionServerOptions> = {}): Promise<Rig> {
  let handler: PermissionHandler | undefined;
  const r: Rig = {
    clients: [],
    port: 0,
    permissionHandler: () => handler!,
    server: new CompanionServer({
      code: "999888",
      workspaces: [{ cwd: "/ws", label: "ws" }],
      connectorFactory: async (h) => {
        handler = h;
        return fakeConnector();
      },
      port: 0,
      heartbeatMs: 0,
      ...opts,
    }),
  };
  r.port = (await r.server.start()).port;
  rigs.push(r);
  return r;
}

async function authed(r: Rig): Promise<TestClient> {
  const c = await TestClient.dial(r);
  c.send({ id: "h", op: "hello", code: "999888" });
  expect(await c.next()).toMatchObject({ type: "ok", id: "h" });
  return c;
}

const rigs: Rig[] = [];
afterEach(async () => {
  while (rigs.length) {
    const r = rigs.pop()!;
    for (const c of r.clients) c.close();
    await r.server.close();
  }
});

describe("CompanionServer", () => {
  it("rejects non-hello ops before auth", async () => {
    const r = await rig();
    const c = await TestClient.dial(r);
    c.send({ id: "1", op: "tabs" });
    expect(await c.next()).toMatchObject({ type: "error", id: "1", message: expect.stringContaining("hello") });
  });

  it("rejects a bad pairing code and closes", async () => {
    const r = await rig();
    const c = await TestClient.dial(r);
    c.send({ id: "h", op: "hello", code: "wrong" });
    expect(await c.next()).toMatchObject({ type: "error", id: "h", fatal: true });
    expect(await c.closed).toBe(4401);
  });

  it("hello returns machine, workspaces and capabilities", async () => {
    const r = await rig();
    const c = await TestClient.dial(r);
    c.send({ id: "h", op: "hello", code: "999888" });
    const reply = (await c.next()) as Extract<ServerMessage, { type: "ok" }>;
    const result = reply.result as { machine: string; workspaces: { cwd: string }[]; capabilities: ConnectorCapabilities };
    expect(result.workspaces).toEqual([{ cwd: "/ws", label: "ws" }]);
    expect(result.capabilities.listSessions).toBe(true);
    expect(result.machine).toBeTruthy();
  });

  it("tabs returns the connector's session list", async () => {
    const r = await rig();
    const c = await authed(r);
    c.send({ id: "t", op: "tabs" });
    const reply = (await c.next()) as Extract<ServerMessage, { type: "ok" }>;
    expect(reply.result).toEqual(TABS);
  });

  it("streams prompt events then a final ok", async () => {
    const r = await rig();
    const c = await authed(r);
    c.send({ id: "p", op: "prompt", sessionId: "alpha", text: "hi" });
    const msgs: ServerMessage[] = [];
    for (let i = 0; i < 5; i++) msgs.push(await c.next());
    const events = msgs.filter((m) => m.type === "prompt_event");
    expect(events.map((m) => (m as { event: TabEvent }).event.type)).toEqual(["user", "text", "text", "done"]);
    expect(msgs[msgs.length - 1]).toMatchObject({ type: "ok", id: "p", result: { stopReason: "end_turn" } });
  });

  it("round-trips a permission request to the phone's answer", async () => {
    const r = await rig();
    const c = await authed(r);
    const outcome = r.permissionHandler()({
      sessionId: "alpha",
      toolCall: { toolCallId: "t1", title: "rm -rf /" } as PermissionRequest["toolCall"],
      options: [{ optionId: "allow", name: "Allow" }],
    } as PermissionRequest);
    const reqMsg = (await c.next()) as Extract<ServerMessage, { type: "permission_request" }>;
    expect(reqMsg.permissionId).toBeTruthy();
    expect(reqMsg.request.sessionId).toBe("alpha");

    c.send({ id: "pr", op: "permission", permissionId: reqMsg.permissionId, optionId: "allow" });
    await c.next(); // ok for the permission op
    await expect(outcome).resolves.toBe("allow");
  });

  it("serves /health over plain HTTP", async () => {
    const r = await rig();
    const res = await fetch(`http://127.0.0.1:${r.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, server: "agentyard-companion" });
  });
});
