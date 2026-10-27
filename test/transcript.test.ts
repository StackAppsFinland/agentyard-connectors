import { describe, expect, it } from "vitest";
import { buildTranscript, contentBlockText } from "../src/devin/transcript.js";
import type { SessionUpdate } from "../src/acp/messages.js";

const chunk = (sessionUpdate: string, text: string): SessionUpdate => ({
  sessionUpdate,
  content: { type: "text", text },
});

describe("contentBlockText", () => {
  it("extracts text blocks", () => {
    expect(contentBlockText({ type: "text", text: "hi" })).toBe("hi");
  });
  it("labels non-text blocks", () => {
    expect(contentBlockText({ type: "image" })).toBe("[image]");
    expect(contentBlockText({ type: "resource_link", uri: "file:///x.ts", name: "x.ts" })).toBe("x.ts");
    expect(contentBlockText(undefined)).toBe("");
  });
});

describe("buildTranscript", () => {
  it("merges consecutive chunks of the same kind", () => {
    const entries = buildTranscript([
      chunk("user_message_chunk", "Hello "),
      chunk("user_message_chunk", "world"),
      chunk("agent_message_chunk", "Hi "),
      chunk("agent_message_chunk", "there"),
    ]);
    expect(entries).toEqual([
      { kind: "user", text: "Hello world" },
      { kind: "agent", text: "Hi there" },
    ]);
  });

  it("separates user, agent and thought", () => {
    const entries = buildTranscript([
      chunk("user_message_chunk", "do it"),
      chunk("agent_thought_chunk", "thinking"),
      chunk("agent_message_chunk", "done"),
    ]);
    expect(entries.map((e) => e.kind)).toEqual(["user", "thought", "agent"]);
  });

  it("tracks tool calls and applies updates by id", () => {
    const entries = buildTranscript([
      { sessionUpdate: "tool_call", toolCallId: "t1", title: "read file", kind: "read", status: "pending" },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "contents" },
      { sessionUpdate: "tool_call", toolCallId: "t2", title: "edit", status: "pending" },
    ]);
    const calls = entries.filter((e) => e.kind === "tool_call").map((e) => e.toolCall);
    expect(calls[0]).toMatchObject({ toolCallId: "t1", status: "completed", rawOutput: "contents" });
    expect(calls[1]).toMatchObject({ toolCallId: "t2", status: "pending" });
  });

  it("keeps plan entries and drops telemetry noise", () => {
    const entries = buildTranscript([
      { sessionUpdate: "plan", entries: [{ content: "step 1", status: "done" }] },
      { sessionUpdate: "usage_update", used: 5 },
      { sessionUpdate: "session_info_update", title: "x" },
      { sessionUpdate: "config_option_update" },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("plan");
    expect(entries[0].plan?.[0].content).toBe("step 1");
  });

  it("preserves unrecognized updates as other/raw", () => {
    const entries = buildTranscript([{ sessionUpdate: "custom_cognition_thing", foo: 1 }]);
    expect(entries[0].kind).toBe("other");
    expect(entries[0].raw?.sessionUpdate).toBe("custom_cognition_thing");
  });
});
