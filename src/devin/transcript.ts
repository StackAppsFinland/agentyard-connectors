import type { ContentBlock, PlanEntry, SessionUpdate, ToolCallInfo } from "../acp/messages.js";

export type TranscriptEntryKind = "user" | "agent" | "thought" | "tool_call" | "plan" | "info" | "other";

export interface TranscriptToolCall {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  content?: unknown;
  rawOutput?: unknown;
}

export interface TranscriptEntry {
  kind: TranscriptEntryKind;
  /** Concatenated text for user/agent/thought entries. */
  text?: string;
  toolCall?: TranscriptToolCall;
  plan?: PlanEntry[];
  /** Original update for kinds we don't model ("other", "info"). */
  raw?: SessionUpdate;
}

/** Update kinds that carry no conversation content worth showing in a transcript. */
const NOISE_KINDS = new Set([
  "session_info_update",
  "config_option_update",
  "available_commands_update",
  "current_mode_update",
  "available_modes_update",
]);

/** Extract display text from a content block. */
export function contentBlockText(block: ContentBlock | undefined): string {
  if (!block) return "";
  switch (block.type) {
    case "text":
      return (block as { text: string }).text;
    case "resource_link": {
      const b = block as { uri?: string; name?: string; title?: string };
      return b.title ?? b.name ?? b.uri ?? "[link]";
    }
    case "resource": {
      const r = (block as { resource?: { uri?: string; text?: string } }).resource;
      return r?.text ?? r?.uri ?? "[resource]";
    }
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    default:
      return `[${block.type}]`;
  }
}

const CHUNK_KINDS: Record<string, TranscriptEntryKind> = {
  user_message_chunk: "user",
  agent_message_chunk: "agent",
  agent_thought_chunk: "thought",
};

/**
 * Folds a sequence of `session/update` payloads (as replayed by session/load
 * or streamed during a prompt) into a readable transcript. Consecutive chunks
 * of the same kind merge into one entry; tool calls are tracked by id and
 * patched by tool_call_update messages.
 */
export function buildTranscript(updates: SessionUpdate[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const toolIndex = new Map<string, TranscriptToolCall>();

  const lastMergeable = (kind: TranscriptEntryKind): TranscriptEntry | undefined => {
    const last = entries[entries.length - 1];
    return last && last.kind === kind && last.toolCall === undefined && last.raw === undefined ? last : undefined;
  };

  for (const u of updates) {
    const chunkKind = CHUNK_KINDS[u.sessionUpdate];
    if (chunkKind) {
      const text = contentBlockText(u.content);
      const prev = lastMergeable(chunkKind);
      if (prev) prev.text = (prev.text ?? "") + text;
      else entries.push({ kind: chunkKind, text });
      continue;
    }

    switch (u.sessionUpdate) {
      case "tool_call": {
        const tc: TranscriptToolCall = {
          toolCallId: u.toolCallId ?? "",
          title: u.title,
          kind: u.kind,
          status: u.status,
          content: u.content,
          rawOutput: (u as ToolCallInfo).rawOutput,
        };
        if (tc.toolCallId) toolIndex.set(tc.toolCallId, tc);
        entries.push({ kind: "tool_call", toolCall: tc });
        break;
      }
      case "tool_call_update": {
        const id = u.toolCallId;
        const existing = id ? toolIndex.get(id) : undefined;
        if (existing) {
          if (u.title !== undefined) existing.title = u.title;
          if (u.status !== undefined) existing.status = u.status;
          if (u.content !== undefined) existing.content = u.content;
          const raw = (u as ToolCallInfo).rawOutput;
          if (raw !== undefined) existing.rawOutput = raw;
        } else {
          const tc: TranscriptToolCall = { toolCallId: id ?? "", title: u.title, kind: u.kind, status: u.status };
          if (tc.toolCallId) toolIndex.set(tc.toolCallId, tc);
          entries.push({ kind: "tool_call", toolCall: tc });
        }
        break;
      }
      case "plan":
        entries.push({ kind: "plan", plan: u.entries ?? [] });
        break;
      case "usage_update":
        // token/cost telemetry — skip in transcript view
        break;
      default:
        if (NOISE_KINDS.has(u.sessionUpdate)) break;
        entries.push({ kind: "other", raw: u });
    }
  }
  return entries;
}
