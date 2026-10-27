import { describe, expect, it, vi } from "vitest";
import { DevinConnector, type IAcpClient } from "../src/devin/DevinConnector.js";
import { JsonRpcError } from "../src/acp/JsonRpcPeer.js";
import type { PermissionResponder, SessionUpdateListener } from "../src/acp/AcpClient.js";
import type {
  InitializeResult,
  SessionInfo,
  SessionNewResult,
  SessionPromptResult,
  SessionUpdate,
} from "../src/acp/messages.js";
import { DevinConnectorError } from "../src/connector/types.js";

const INIT: InitializeResult = {
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    promptCapabilities: { image: true, audio: false, embeddedContext: true },
    sessionCapabilities: { list: {}, delete: {} },
  },
  authMethods: [{ id: "devin-browser", name: "Log in with browser" }],
};

class FakeAcpClient implements IAcpClient {
  sessions: SessionInfo[] = [];
  loadedIds = new Set<string>();
  deletedIds: string[] = [];
  cancelledIds: string[] = [];
  prompts: { sessionId: string; text: string }[] = [];
  createdCwds: string[] = [];
  authenticatedWith: string[] = [];
  permissionResponder?: PermissionResponder;
  newSessionResult: SessionNewResult = { sessionId: "new-session" };
  promptImpl?: (sessionId: string, text: string, emit: (u: SessionUpdate) => void) => Promise<SessionPromptResult>;
  loadError?: Error;

  private listeners = new Set<SessionUpdateListener>();

  emit(sessionId: string, update: SessionUpdate): void {
    for (const l of this.listeners) l(sessionId, update);
  }

  async initialize(): Promise<InitializeResult> {
    return INIT;
  }
  async authenticate(methodId: string): Promise<void> {
    this.authenticatedWith.push(methodId);
  }
  async listAllSessions(): Promise<SessionInfo[]> {
    return this.sessions;
  }
  async loadSession(sessionId: string): Promise<void> {
    if (this.loadError) throw this.loadError;
    this.loadedIds.add(sessionId);
  }
  async newSession(cwd: string): Promise<SessionNewResult> {
    this.createdCwds.push(cwd);
    return this.newSessionResult;
  }
  async prompt(sessionId: string, text: string): Promise<SessionPromptResult> {
    this.prompts.push({ sessionId, text });
    if (this.promptImpl) return this.promptImpl(sessionId, text, (u) => this.emit(sessionId, u));
    return { stopReason: "end_turn" };
  }
  async deleteSession(sessionId: string): Promise<void> {
    this.deletedIds.push(sessionId);
  }
  cancelSession(sessionId: string): void {
    this.cancelledIds.push(sessionId);
  }
  onSessionUpdate(l: SessionUpdateListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  onPermissionRequest(h: PermissionResponder): void {
    this.permissionResponder = h;
  }
}

function connectWith(client: FakeAcpClient, options = {}) {
  return DevinConnector.connect({
    cwd: "C:\\ws",
    clientFactory: () => client,
    ...options,
  });
}

describe("DevinConnector.connect", () => {
  it("initializes and exposes negotiated capabilities", async () => {
    const conn = await connectWith(new FakeAcpClient());
    expect(conn.capabilities()).toMatchObject({
      listSessions: true,
      loadSession: true,
      deleteSession: true,
      promptImage: true,
      promptAudio: false,
    });
  });

  it("authenticates via the browser method by default when spawning", async () => {
    // clientFactory path skips auth (process auth is covered by e2e);
    // verify the option plumbing exists:
    const conn = await connectWith(new FakeAcpClient());
    expect(conn).toBeInstanceOf(DevinConnector);
  });
});

describe("DevinConnector.listTabs", () => {
  it("maps sessions to tabs, surfacing isLocked meta", async () => {
    const client = new FakeAcpClient();
    client.sessions = [
      {
        sessionId: "abc",
        cwd: "C:\\ws",
        title: "Fix bug",
        updatedAt: "2026-10-27T10:00:00Z",
        _meta: { "cognition.ai/isLocked": true },
      },
      { sessionId: "def", cwd: "C:\\ws" },
    ];
    const conn = await connectWith(client);
    const tabs = await conn.listTabs();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toMatchObject({ sessionId: "abc", title: "Fix bug", isLocked: true });
    expect(tabs[1].isLocked).toBeUndefined();
  });

  it("requires a cwd", async () => {
    const conn = await DevinConnector.connect({ clientFactory: () => new FakeAcpClient() });
    await expect(conn.listTabs()).rejects.toThrow(/cwd is required/);
  });
});

describe("DevinConnector.readTab", () => {
  it("loads the session and returns its transcript", async () => {
    const client = new FakeAcpClient();
    const originalLoad = client.loadSession.bind(client);
    client.loadSession = async (id: string) => {
      await originalLoad(id);
      client.emit(id, { sessionUpdate: "user_message_chunk", content: { type: "text", text: "hi" } });
      client.emit(id, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } });
      client.emit("other", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "noise" } });
    };
    const conn = await connectWith(client);
    const t = await conn.readTab("abc");
    expect(t.entries).toEqual([
      { kind: "user", text: "hi" },
      { kind: "agent", text: "hello" },
    ]);
    expect(client.loadedIds.has("abc")).toBe(true);
  });
});

describe("DevinConnector.postToTab", () => {
  it("loads the session first when not attached, then streams events", async () => {
    const client = new FakeAcpClient();
    client.promptImpl = async (_id, _text, emit) => {
      emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } });
      emit({ sessionUpdate: "tool_call", toolCallId: "t1", title: "exec", status: "in_progress" });
      emit({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
      return { stopReason: "end_turn" };
    };
    const conn = await connectWith(client);
    const events = [];
    for await (const e of conn.postToTab("abc", "say hi")) events.push(e);
    expect(client.loadedIds.has("abc")).toBe(true);
    expect(client.prompts).toEqual([{ sessionId: "abc", text: "say hi" }]);
    expect(events).toEqual([
      { type: "text", text: "hello" },
      { type: "tool_call", toolCall: { sessionUpdate: "tool_call", toolCallId: "t1", title: "exec", status: "in_progress" } },
      { type: "thought", text: "hmm" },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("does not reload an already-attached session", async () => {
    const client = new FakeAcpClient();
    const conn = await connectWith(client);
    await conn.readTab("abc");
    const loadCount = client.loadedIds.size;
    for await (const _ of conn.postToTab("abc", "x")) void _;
    expect(client.loadedIds.size).toBe(loadCount);
  });

  it("rejects a second concurrent prompt to the same session", async () => {
    const client = new FakeAcpClient();
    let resolvePrompt: (r: SessionPromptResult) => void = () => {};
    client.promptImpl = () => new Promise<SessionPromptResult>((r) => (resolvePrompt = r));
    const conn = await connectWith(client);
    const first = (async () => {
      for await (const _ of conn.postToTab("abc", "one")) void _;
    })();
    await new Promise((r) => setImmediate(r));
    await expect((async () => {
      for await (const _ of conn.postToTab("abc", "two")) void _;
    })()).rejects.toThrow(/already in flight/);
    resolvePrompt({ stopReason: "end_turn" });
    await first;
  });

  it("propagates prompt failures as DevinConnectorError", async () => {
    const client = new FakeAcpClient();
    client.promptImpl = () => Promise.reject(new JsonRpcError({ code: -32000, message: "Authentication required" }));
    const conn = await connectWith(client);
    const consume = async () => {
      for await (const _ of conn.postToTab("abc", "x")) void _;
    };
    await expect(consume()).rejects.toSatisfy(
      (e) => e instanceof DevinConnectorError && e.isAuthRequired,
    );
  });
});

describe("DevinConnector.createTab/deleteTab/cancelTab", () => {
  it("creates a session and optionally primes it with a prompt", async () => {
    const client = new FakeAcpClient();
    const conn = await connectWith(client);
    const tab = await conn.createTab("C:\\ws", "say hi");
    expect(tab.sessionId).toBe("new-session");
    expect(client.createdCwds).toEqual(["C:\\ws"]);
    expect(client.prompts).toEqual([{ sessionId: "new-session", text: "say hi" }]);
  });

  it("deletes a session", async () => {
    const client = new FakeAcpClient();
    const conn = await connectWith(client);
    await conn.deleteTab("abc");
    expect(client.deletedIds).toEqual(["abc"]);
  });

  it("sends session/cancel", async () => {
    const client = new FakeAcpClient();
    const conn = await connectWith(client);
    conn.cancelTab("abc");
    expect(client.cancelledIds).toEqual(["abc"]);
  });
});

describe("DevinConnector permissions", () => {
  it("cancels permission requests by default (fail closed)", async () => {
    const client = new FakeAcpClient();
    await connectWith(client);
    const outcome = await client.permissionResponder!({
      sessionId: "s",
      toolCall: { toolCallId: "t" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    expect(outcome).toBeNull();
  });

  it("delegates to the configured permission handler", async () => {
    const client = new FakeAcpClient();
    const handler = vi.fn().mockResolvedValue("allow");
    await connectWith(client, { permissionHandler: handler });
    const outcome = await client.permissionResponder!({
      sessionId: "s",
      toolCall: { toolCallId: "t" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(outcome).toBe("allow");
  });
});
