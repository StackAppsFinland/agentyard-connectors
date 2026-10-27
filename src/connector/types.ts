import type { TranscriptEntry } from "../devin/transcript.js";
import type { PermissionOption, ToolCallInfo } from "../acp/messages.js";

/** A Devin Desktop conversation tab — backed by an ACP session. */
export interface TabInfo {
  /** Stable provider session id, e.g. "truth-almanac". Never a list position. */
  sessionId: string;
  title?: string;
  cwd: string;
  updatedAt?: string;
  /** Session is attached to a live host (e.g. open in Devin Desktop). */
  isLocked?: boolean;
  meta?: Record<string, unknown>;
}

export interface TabTranscript {
  sessionId: string;
  entries: TranscriptEntry[];
}

export interface ConnectorCapabilities {
  listSessions: boolean;
  loadSession: boolean;
  createSession: boolean;
  deleteSession: boolean;
  promptImage: boolean;
  promptAudio: boolean;
  promptEmbeddedContext: boolean;
  raw: Record<string, unknown>;
}

/** Events streamed from a tab while a prompt turn runs. */
export type TabEvent =
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | { type: "user"; text: string }
  | { type: "tool_call"; toolCall: ToolCallInfo }
  | { type: "tool_call_update"; toolCallId?: string; update: Record<string, unknown> }
  | { type: "plan"; entries: { content: string; status?: string; priority?: string }[] }
  | { type: "permission_request"; request: PermissionRequest }
  | { type: "raw"; update: Record<string, unknown> }
  | { type: "done"; stopReason: string };

export interface PermissionRequest {
  sessionId: string;
  toolCall: ToolCallInfo;
  options: PermissionOption[];
}

/**
 * Decides the outcome of a provider permission request.
 * Return an optionId to select it, or null to leave it cancelled.
 */
export type PermissionHandler = (request: PermissionRequest) => Promise<string | null> | string | null;

export class DevinConnectorError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "DevinConnectorError";
  }

  get isAuthRequired(): boolean {
    return this.code === -32000 && /authenticat/i.test(this.message);
  }

  get isNotFound(): boolean {
    return /not found/i.test(this.message);
  }
}
