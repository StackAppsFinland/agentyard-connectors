import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { JsonRpcError, JsonRpcPeer } from "../src/acp/JsonRpcPeer.js";

function peerPair(options = {}) {
  const aToB = new PassThrough();
  const bToA = new PassThrough();
  const client = new JsonRpcPeer(bToA, aToB, options);
  const agent = new JsonRpcPeer(aToB, bToA);
  return { client, agent };
}

const tick = () => new Promise((r) => setImmediate(r));

describe("JsonRpcPeer", () => {
  it("round-trips a request/response", async () => {
    const { client, agent } = peerPair();
    agent.onRequest("session/list", (params) => ({ sessions: [], echo: params }));
    const res = await client.request<{ sessions: unknown[]; echo: unknown }>("session/list", { cwd: "/x" });
    expect(res.sessions).toEqual([]);
    expect(res.echo).toEqual({ cwd: "/x" });
  });

  it("routes notifications to registered handlers", async () => {
    const { client, agent } = peerPair();
    const seen: unknown[] = [];
    client.onNotification("session/update", (p) => seen.push(p));
    agent.notify("session/update", { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk" } });
    await tick();
    expect(seen).toHaveLength(1);
  });

  it("calls fallbackNotificationHandler for unregistered notifications", async () => {
    const fallback = vi.fn();
    const { client, agent } = peerPair({ fallbackNotificationHandler: fallback });
    agent.notify("some/other", { a: 1 });
    await tick();
    expect(fallback).toHaveBeenCalledWith("some/other", { a: 1 });
  });

  it("responds -32601 for unknown incoming methods", async () => {
    const { client, agent } = peerPair();
    await expect(agent.request("does/not_exist")).rejects.toMatchObject({ code: -32601 });
    void client;
  });

  it("uses fallbackRequestHandler when registered", async () => {
    const { client, agent } = peerPair({ fallbackRequestHandler: () => ({ ok: true }) });
    const res = await agent.request("anything/goes", { x: 1 });
    expect(res).toEqual({ ok: true });
    void client;
  });

  it("surfaces remote errors as JsonRpcError with code/data", async () => {
    const { client, agent } = peerPair();
    agent.onRequest("fail", () => {
      throw new JsonRpcError({ code: -32000, message: "Authentication required", data: { x: 1 } });
    });
    try {
      await client.request("fail");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(JsonRpcError);
      expect((e as JsonRpcError).code).toBe(-32000);
      expect((e as JsonRpcError).message).toMatch(/Authentication required/);
      expect((e as JsonRpcError).data).toEqual({ x: 1 });
    }
  });

  it("maps handler exceptions to -32603", async () => {
    const { client, agent } = peerPair();
    agent.onRequest("boom", () => {
      throw new Error("kaboom");
    });
    await expect(client.request("boom")).rejects.toMatchObject({ code: -32603, message: "kaboom" });
  });

  it("reports malformed lines via onParseError and keeps working", async () => {
    const onParseError = vi.fn();
    const aToB = new PassThrough();
    const bToA = new PassThrough();
    const client = new JsonRpcPeer(bToA, aToB, { onParseError });
    new JsonRpcPeer(aToB, bToA).onRequest("ping", () => "pong");
    bToA.write("this is not json\n");
    const res = await client.request("ping");
    expect(res).toBe("pong");
    expect(onParseError).toHaveBeenCalledOnce();
  });

  it("rejects pending requests on close", async () => {
    // Remote end never responds: input stays silent.
    const silent = new PassThrough();
    const out = new PassThrough();
    const client = new JsonRpcPeer(silent, out);
    const p = client.request("never/answered");
    const assertion = expect(p).rejects.toThrow(/closed/);
    client.close(new Error("closed"));
    await assertion;
  });
});
