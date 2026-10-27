import type { JsonRpcPeer } from "./JsonRpcPeer.js";
import {
  ACP_PROTOCOL_VERSION,
  type AuthenticateParams,
  type ClientCapabilities,
  type ClientInfo,
  type ContentBlock,
  type InitializeResult,
  type RequestPermissionParams,
  type RequestPermissionResult,
  type SessionInfo,
  type SessionListResult,
  type SessionLoadParams,
  type SessionNewResult,
  type SessionPromptResult,
  type SessionUpdate,
  type SessionUpdateParams,
} from "./messages.js";

export type SessionUpdateListener = (sessionId: string, update: SessionUpdate) => void;

/**
 * Chooses an outcome for an agent `session/request_permission` call.
 * Return an optionId to approve with that option, or null/"cancelled" to
 * leave the request unanswered (agent treats it as cancelled).
 */
export type PermissionResponder = (
  params: RequestPermissionParams,
) => Promise<string | null> | string | null;

/**
 * Typed facade over a {@link JsonRpcPeer} speaking ACP.
 * One client (one `devin acp` process) can manage many sessions.
 */
export class AcpClient {
  private readonly updateListeners = new Set<SessionUpdateListener>();

  constructor(private readonly peer: JsonRpcPeer) {
    peer.onNotification("session/update", (params) => {
      const p = params as SessionUpdateParams;
      for (const l of this.updateListeners) l(p.sessionId, p.update);
    });
    peer.onRequest("session/request_permission", async (params) => {
      const optionId = await this.permissionHandler(params as RequestPermissionParams);
      const result: RequestPermissionResult = {
        outcome: optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" },
      };
      return result;
    });
  }

  /** Default: cancel every permission request. Override via {@link onPermissionRequest}. */
  private permissionHandler: PermissionResponder = () => null;

  onPermissionRequest(handler: PermissionResponder): void {
    this.permissionHandler = handler;
  }

  onSessionUpdate(listener: SessionUpdateListener): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  async initialize(clientCapabilities: ClientCapabilities, clientInfo: ClientInfo): Promise<InitializeResult> {
    return this.peer.request<InitializeResult>("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities,
      clientInfo,
    });
  }

  async authenticate(methodId: string, meta?: Record<string, unknown>): Promise<void> {
    const params: AuthenticateParams = { methodId };
    if (meta) params._meta = meta;
    await this.peer.request("authenticate", params);
  }

  async listSessions(cwd: string, cursor?: string): Promise<SessionListResult> {
    return this.peer.request<SessionListResult>("session/list", { cwd, ...(cursor ? { cursor } : {}) });
  }

  async listAllSessions(cwd: string, pageCap = 40): Promise<SessionInfo[]> {
    const out: SessionInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < pageCap; page++) {
      const res = await this.listSessions(cwd, cursor);
      out.push(...res.sessions);
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return out;
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    const params: SessionLoadParams = { sessionId, cwd, mcpServers: [] };
    await this.peer.request("session/load", params);
  }

  async newSession(cwd: string, meta?: Record<string, unknown>): Promise<SessionNewResult> {
    return this.peer.request<SessionNewResult>("session/new", {
      cwd,
      mcpServers: [],
      ...(meta ? { _meta: meta } : {}),
    });
  }

  async prompt(sessionId: string, text: string | ContentBlock[]): Promise<SessionPromptResult> {
    const prompt: ContentBlock[] = typeof text === "string" ? [{ type: "text", text }] : text;
    return this.peer.request<SessionPromptResult>("session/prompt", { sessionId, prompt });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.peer.request("session/delete", { sessionId });
  }

  /** Fire-and-forget cancellation notification. */
  cancelSession(sessionId: string): void {
    this.peer.notify("session/cancel", { sessionId });
  }
}
