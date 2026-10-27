/**
 * ACP (Agent Client Protocol) wire types.
 *
 * Subset of https://agentclientprotocol.com that Devin's `devin acp` server
 * implements, verified against devin CLI 3000.10.67 (Devin Desktop 1.126.0).
 * Cognition extensions arrive via `_meta` keys and `session_info_update`.
 */

export const ACP_PROTOCOL_VERSION = 1;

export interface ClientCapabilities {
  fs?: { readTextFile?: boolean; writeTextFile?: boolean };
  terminal?: boolean;
  [key: string]: unknown;
}

export interface ClientInfo {
  name: string;
  version: string;
}

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: ClientCapabilities;
  clientInfo: ClientInfo;
}

export interface AgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  sessionCapabilities?: {
    list?: Record<string, unknown>;
    delete?: Record<string, unknown>;
    additionalDirectories?: Record<string, unknown>;
  };
  auth?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AuthMethod {
  id: string;
  name: string;
  description?: string;
}

export interface InitializeResult {
  protocolVersion: number;
  agentCapabilities: AgentCapabilities;
  authMethods: AuthMethod[];
  agentInfo?: { name: string; title?: string; version?: string };
  _meta?: Record<string, unknown>;
}

export interface AuthenticateParams {
  methodId: string;
  /** e.g. { api_key } — Devin accepts a user API key via _meta.api_key. */
  _meta?: Record<string, unknown>;
}

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  title?: string;
  updatedAt?: string;
  _meta?: {
    "cognition.ai/requestingTabId"?: string;
    "cognition.ai/createdAt"?: string;
    "cognition.ai/isLocked"?: boolean;
    [key: string]: unknown;
  };
}

export interface SessionListParams {
  cwd: string;
  cursor?: string;
}

export interface SessionListResult {
  sessions: SessionInfo[];
  nextCursor?: string | null;
}

export interface SessionNewParams {
  cwd: string;
  mcpServers?: unknown[];
  _meta?: Record<string, unknown>;
}

export interface SessionNewResult {
  sessionId: string;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SessionLoadParams {
  sessionId: string;
  cwd: string;
  mcpServers?: unknown[];
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data?: string; mimeType?: string; uri?: string }
  | { type: "audio"; data?: string; mimeType?: string }
  | { type: "resource_link"; uri: string; name?: string; title?: string; mimeType?: string }
  | { type: "resource"; resource?: { uri?: string; text?: string } }
  | { type: string; [key: string]: unknown };

export interface ToolCallInfo {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  content?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  [key: string]: unknown;
}

export interface PlanEntry {
  content: string;
  priority?: string;
  status?: string;
}

/** A `session/update` notification payload (`params.update`). */
export interface SessionUpdate {
  sessionUpdate: string;
  content?: ContentBlock;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  entries?: PlanEntry[];
  [key: string]: unknown;
}

export interface SessionUpdateParams {
  sessionId: string;
  update: SessionUpdate;
}

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export interface SessionPromptResult {
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" | string;
}

export interface SessionDeleteParams {
  sessionId: string;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | string;
}

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: ToolCallInfo;
  options: PermissionOption[];
}

export interface RequestPermissionResult {
  outcome:
    | { outcome: "selected"; optionId: string }
    | { outcome: "cancelled" };
}
