import type {
  ConnectorCapabilities,
  PermissionRequest,
  TabEvent,
  TabInfo,
  TabTranscript,
} from "../connector/types.js";

/**
 * AgentYard companion wire protocol, v1.
 *
 * One JSON message per WebSocket frame. Client requests carry a caller-chosen
 * `id`; the server answers each with exactly one `ok` or `error` message
 * bearing the same `id`. Long-running ops (`prompt`) additionally stream
 * `prompt_event` messages tagged with the request `id` before the final
 * `ok`/`error`. `permission_request` is unsolicited: it carries a
 * `permissionId` the client answers with a `permission` op.
 *
 * This file is the canonical schema. The phone app keeps a mirror copy
 * (agentyard/src/protocol.ts) until a shared types package exists.
 */

export const PROTOCOL_VERSION = 1;

export interface WorkspaceInfo {
  cwd: string;
  label?: string;
}

export interface HelloResult {
  server: "agentyard-companion";
  protocolVersion: number;
  machine: string;
  workspaces: WorkspaceInfo[];
  capabilities: ConnectorCapabilities;
}

export type ClientMessage =
  | { id: string; op: "hello"; code: string; client?: { name?: string; version?: string } }
  | { id: string; op: "workspaces" }
  | { id: string; op: "tabs"; cwd?: string }
  | { id: string; op: "transcript"; sessionId: string; cwd?: string }
  | { id: string; op: "prompt"; sessionId: string; text: string; cwd?: string }
  | { id: string; op: "createTab"; cwd: string }
  | { id: string; op: "deleteTab"; sessionId: string }
  | { id: string; op: "cancel"; sessionId: string }
  | { id: string; op: "permission"; permissionId: string; optionId: string | null };

export type ServerMessage =
  | { type: "ok"; id: string; result?: unknown }
  | { type: "error"; id?: string; message: string; code?: number; fatal?: boolean }
  | { type: "prompt_event"; id: string; sessionId: string; event: TabEvent }
  | { type: "permission_request"; permissionId: string; request: PermissionRequest };

export function encodeMessage(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

const OPS = new Set([
  "hello",
  "workspaces",
  "tabs",
  "transcript",
  "prompt",
  "createTab",
  "deleteTab",
  "cancel",
  "permission",
]);

/** Parse and lightly validate an incoming frame. Returns null on malformed input. */
export function parseClientMessage(data: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.op !== "string" || !OPS.has(m.op)) return null;
  switch (m.op) {
    case "hello":
      if (typeof m.code !== "string") return null;
      break;
    case "transcript":
    case "deleteTab":
    case "cancel":
      if (typeof m.sessionId !== "string") return null;
      break;
    case "prompt":
      if (typeof m.sessionId !== "string" || typeof m.text !== "string") return null;
      break;
    case "createTab":
      if (typeof m.cwd !== "string") return null;
      break;
    case "permission":
      if (typeof m.permissionId !== "string") return null;
      if (m.optionId !== null && typeof m.optionId !== "string") return null;
      break;
  }
  return m as unknown as ClientMessage;
}

// Re-export the domain types the protocol carries so clients import one file.
export type {
  ConnectorCapabilities,
  PermissionRequest,
  TabEvent,
  TabInfo,
  TabTranscript,
};
export type { TranscriptEntry, TranscriptEntryKind, TranscriptToolCall } from "../devin/transcript.js";
