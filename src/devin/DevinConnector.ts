import { JsonRpcError, type JsonRpcPeer } from "../acp/JsonRpcPeer.js";
import { AcpProcess, type AcpProcessOptions } from "../acp/AcpProcess.js";
import { AcpClient, type PermissionResponder } from "../acp/AcpClient.js";
import type {
  AgentCapabilities,
  ClientCapabilities,
  InitializeResult,
  RequestPermissionParams,
  SessionInfo,
  SessionNewResult,
  SessionPromptResult,
  SessionUpdate,
  ToolCallInfo,
} from "../acp/messages.js";
import { DevinBinaryLocator } from "./DevinBinaryLocator.js";
import { buildTranscript } from "./transcript.js";
import type {
  ConnectorCapabilities,
  PermissionHandler,
  PermissionRequest,
  TabEvent,
  TabInfo,
  TabTranscript,
} from "../connector/types.js";
import { DevinConnectorError } from "../connector/types.js";

/** Minimal client surface the connector depends on (AcpClient implements it). */
export interface IAcpClient {
  initialize(clientCapabilities: ClientCapabilities, clientInfo: { name: string; version: string }): Promise<InitializeResult>;
  authenticate(methodId: string, meta?: Record<string, unknown>): Promise<void>;
  listAllSessions(cwd: string, pageCap?: number): Promise<SessionInfo[]>;
  loadSession(sessionId: string, cwd: string): Promise<void>;
  newSession(cwd: string, meta?: Record<string, unknown>): Promise<SessionNewResult>;
  prompt(sessionId: string, text: string): Promise<SessionPromptResult>;
  deleteSession(sessionId: string): Promise<void>;
  cancelSession(sessionId: string): void;
  onSessionUpdate(listener: (sessionId: string, update: SessionUpdate) => void): () => void;
  onPermissionRequest(handler: PermissionResponder): void;
}

export interface DevinConnectorOptions {
  /** Explicit path to devin binary; otherwise auto-located. */
  binaryPath?: string;
  /** Working directory sessions are scoped to (ACP requires it for list/load/new). */
  cwd?: string;
  /** Auth method to invoke when the agent requires authentication. Default "devin-browser". */
  authMethodId?: string;
  /** User API key, passed to authenticate via _meta.api_key. */
  apiKey?: string;
  /** Skip the authenticate call entirely (session/list works unauthenticated). */
  skipAuth?: boolean;
  /** Decides provider permission requests. Default: cancel them (fail closed). */
  permissionHandler?: PermissionHandler;
  /** Client capabilities to advertise. Default: none (agent uses its own tools). */
  clientCapabilities?: ClientCapabilities;
  clientInfo?: { name: string; version: string };
  /** Extra ms to drain replayed updates after session/load resolves. */
  loadDrainMs?: number;
  /** Process-spawn plumbing, injectable for tests. */
  process?: Pick<AcpProcessOptions, "spawnImpl" | "env" | "onStderr">;
  /** Factory escape hatch for tests: return a prebuilt client instead of spawning. */
  clientFactory?: (peer: JsonRpcPeer | null) => IAcpClient;
}

const DEFAULT_CLIENT_INFO = { name: "agentyard-connector", version: "0.1.0" };

/**
 * Connector for local Devin Desktop conversations ("tabs").
 *
 * Speaks ACP to a spawned `devin acp` process, which shares the session store
 * Devin Desktop uses — so prompts land in the same conversations the user
 * sees in the IDE.
 *
 * Lifecycle: `await DevinConnector.connect({ cwd })` → tab ops → `close()`.
 */
export class DevinConnector {
  private readonly loaded = new Set<string>();
  private readonly prompting = new Set<string>();
  private readonly caps: ConnectorCapabilities;

  private constructor(
    private readonly client: IAcpClient,
    private readonly initResult: InitializeResult,
    private readonly options: DevinConnectorOptions,
    private readonly owned?: { kill(): void },
  ) {
    const ac: AgentCapabilities = initResult.agentCapabilities ?? {};
    this.caps = {
      listSessions: ac.sessionCapabilities?.list !== undefined,
      loadSession: ac.loadSession === true,
      createSession: true,
      deleteSession: ac.sessionCapabilities?.delete !== undefined,
      promptImage: ac.promptCapabilities?.image === true,
      promptAudio: ac.promptCapabilities?.audio === true,
      promptEmbeddedContext: ac.promptCapabilities?.embeddedContext === true,
      raw: ac as Record<string, unknown>,
    };
  }

  /**
   * Spawn `devin acp`, initialize the protocol, and authenticate if required.
   * The browser auth method may open a browser window on first run.
   */
  static async connect(options: DevinConnectorOptions = {}): Promise<DevinConnector> {
    if (options.clientFactory) {
      const client = options.clientFactory(null);
      client.onPermissionRequest(toPermissionResponder(options.permissionHandler));
      const init = await client.initialize(options.clientCapabilities ?? {}, options.clientInfo ?? DEFAULT_CLIENT_INFO);
      return new DevinConnector(client, init, options);
    }

    const binary = options.binaryPath ?? new DevinBinaryLocator({ env: options.process?.env }).locate();
    const proc = AcpProcess.launch(binary, {
      spawnImpl: options.process?.spawnImpl,
      env: options.process?.env,
      onStderr: options.process?.onStderr,
    });
    const client = new AcpClient(proc.peer);
    try {
      const init = await client.initialize(
        options.clientCapabilities ?? { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        options.clientInfo ?? DEFAULT_CLIENT_INFO,
      );
      if (!options.skipAuth && init.authMethods?.length) {
        const methodId = options.authMethodId ?? init.authMethods[0].id;
        await client.authenticate(methodId, options.apiKey ? { api_key: options.apiKey } : undefined);
      }
      client.onPermissionRequest(toPermissionResponder(options.permissionHandler));
      return new DevinConnector(client, init, options, proc);
    } catch (err) {
      proc.kill();
      throw mapError(err);
    }
  }

  capabilities(): ConnectorCapabilities {
    return this.caps;
  }

  /** List Devin sessions ("tabs") scoped to a working directory. */
  async listTabs(cwd?: string): Promise<TabInfo[]> {
    const sessions = await this.guard(() => this.client.listAllSessions(this.dir(cwd)));
    return sessions.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      cwd: s.cwd,
      updatedAt: s.updatedAt,
      isLocked: s._meta?.["cognition.ai/isLocked"],
      meta: s._meta,
    }));
  }

  /**
   * Load a session and return its full transcript.
   * Also attaches the session to this process — required before posting to it.
   */
  async readTab(sessionId: string, cwd?: string): Promise<TabTranscript> {
    const updates: SessionUpdate[] = [];
    const off = this.client.onSessionUpdate((sid, u) => {
      if (sid === sessionId) updates.push(u);
    });
    try {
      await this.guard(() => this.client.loadSession(sessionId, this.dir(cwd)));
      this.loaded.add(sessionId);
      if (this.options.loadDrainMs) await sleep(this.options.loadDrainMs);
    } finally {
      off();
    }
    return { sessionId, entries: buildTranscript(updates) };
  }

  /** Create a new session in `cwd`. Devin titles it from the first prompt. */
  async createTab(cwd: string, initialPrompt?: string): Promise<TabInfo> {
    const res = await this.guard(() => this.client.newSession(cwd));
    this.loaded.add(res.sessionId);
    const tab: TabInfo = { sessionId: res.sessionId, cwd };
    if (initialPrompt) {
      for await (const _ of this.postToTab(res.sessionId, initialPrompt, { cwd })) {
        // drain the turn so the session is usable immediately after return
      }
    }
    return tab;
  }

  /**
   * Post a prompt to an existing tab and stream its response events.
   * Loads the session first if this process hasn't attached it yet.
   */
  async *postToTab(sessionId: string, text: string, opts: { cwd?: string } = {}): AsyncGenerator<TabEvent, void> {
    if (this.prompting.has(sessionId)) {
      throw new DevinConnectorError(`A prompt is already in flight for session "${sessionId}"`);
    }
    if (!this.loaded.has(sessionId)) {
      await this.guard(() => this.client.loadSession(sessionId, this.dir(opts.cwd)));
      this.loaded.add(sessionId);
    }

    const queue: TabEvent[] = [];
    let notify: (() => void) | undefined;
    const off = this.client.onSessionUpdate((sid, u) => {
      if (sid !== sessionId) return;
      queue.push(mapUpdate(u));
      notify?.();
    });

    this.prompting.add(sessionId);
    try {
      let finished = false;
      let stopReason = "unknown";
      let promptError: unknown;
      void this.client
        .prompt(sessionId, text)
        .then((r) => {
          stopReason = r.stopReason;
        })
        .catch((e) => {
          promptError = e;
        })
        .finally(() => {
          finished = true;
          notify?.();
        });

      while (!finished || queue.length) {
        while (queue.length) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((r) => {
          notify = r;
        });
      }
      while (queue.length) yield queue.shift()!;

      if (promptError) throw mapError(promptError);
      yield { type: "done", stopReason };
    } finally {
      this.prompting.delete(sessionId);
      off();
    }
  }

  /** Delete a session. Removes it from the Devin session list entirely. */
  async deleteTab(sessionId: string): Promise<void> {
    await this.guard(() => this.client.deleteSession(sessionId));
    this.loaded.delete(sessionId);
  }

  /** Send `session/cancel` for an in-flight turn. */
  cancelTab(sessionId: string): void {
    this.client.cancelSession(sessionId);
  }

  close(): void {
    this.owned?.kill();
  }

  private dir(cwd?: string): string {
    const dir = cwd ?? this.options.cwd;
    if (!dir) throw new DevinConnectorError("cwd is required (pass it to connect() or per call)");
    return dir;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw mapError(err);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapUpdate(u: SessionUpdate): TabEvent {
  switch (u.sessionUpdate) {
    case "user_message_chunk":
      return { type: "user", text: blockText(u) };
    case "agent_message_chunk":
      return { type: "text", text: blockText(u) };
    case "agent_thought_chunk":
      return { type: "thought", text: blockText(u) };
    case "tool_call":
      return { type: "tool_call", toolCall: u as unknown as ToolCallInfo };
    case "tool_call_update":
      return { type: "tool_call_update", toolCallId: u.toolCallId, update: u as Record<string, unknown> };
    case "plan":
      return { type: "plan", entries: u.entries ?? [] };
    default:
      return { type: "raw", update: u as Record<string, unknown> };
  }
}

function blockText(u: SessionUpdate): string {
  const c = u.content;
  if (!c) return "";
  if (c.type === "text") return (c as { text: string }).text;
  if (c.type === "resource_link") {
    const b = c as { title?: string; name?: string; uri?: string };
    return b.title ?? b.name ?? b.uri ?? "[link]";
  }
  return `[${c.type}]`;
}

function mapError(err: unknown): DevinConnectorError {
  if (err instanceof DevinConnectorError) return err;
  if (err instanceof JsonRpcError) return new DevinConnectorError(err.message, err.code, err.data);
  if (err instanceof Error) return new DevinConnectorError(err.message);
  return new DevinConnectorError(String(err));
}

/** Wire a public PermissionHandler to the ACP-level responder, with event fanout. */
export function toPermissionResponder(
  handler: PermissionHandler | undefined,
  onRequest?: (r: PermissionRequest) => void,
): PermissionResponder {
  return async (params: RequestPermissionParams) => {
    const req: PermissionRequest = { sessionId: params.sessionId, toolCall: params.toolCall, options: params.options };
    onRequest?.(req);
    const optionId = handler ? await handler(req) : null;
    return optionId;
  };
}
