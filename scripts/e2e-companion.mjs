// End-to-end check of the AgentYard companion over WebSocket — exercises the
// exact protocol the phone app uses. Prereqs:
//   npm run build
//   node dist/server/run.js --workspace <cwd> --port 4321 --code 424242
// Then: node scripts/e2e-companion.mjs [port] [code]
import WebSocket from "ws";

const PORT = Number(process.argv[2]) || 4321;
const CODE = process.argv[3] || "424242";
const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);

const queue = [];
const waiters = [];
ws.on("message", (d) => {
  const msg = JSON.parse(d.toString());
  const w = waiters.shift();
  if (w) w(msg);
  else queue.push(msg);
});
const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)));

let seq = 0;
function send(op, extra = {}) {
  const id = `e2e-${++seq}`;
  ws.send(JSON.stringify({ id, op, ...extra }));
  return id;
}
async function reply(id) {
  for (;;) {
    const m = await next();
    if (m.type === "ok" && m.id === id) return m.result;
    if (m.type === "error") throw new Error(`${id}: ${m.message}`);
  }
}

await new Promise((r, j) => {
  ws.once("open", r);
  ws.once("error", j);
});

console.log("== hello ==");
send("hello", { code: CODE });
const hello = await reply("e2e-1");
console.log(" ", hello.machine, "protocol v" + hello.protocolVersion);
console.log("  workspaces:", hello.workspaces.map((w) => `${w.label ?? ""}(${w.cwd})`).join(", "));
console.log("  capabilities:", JSON.stringify(hello.capabilities, null, 0).slice(0, 200));

console.log("\n== tabs ==");
const cwd = hello.workspaces[0].cwd;
send("tabs", { cwd });
const tabs = await reply("e2e-2");
for (const t of tabs.slice(0, 15)) console.log(`  ${t.sessionId}  ${t.isLocked ? "[locked]" : ""}  ${t.title ?? ""}`);
if (!tabs.length) console.log("  (none)");

console.log("\n== createTab ==");
send("createTab", { cwd });
const tab = await reply("e2e-3");
console.log("  created:", tab.sessionId);

console.log("\n== prompt (streamed) ==");
const pid = send("prompt", { sessionId: tab.sessionId, text: "Reply with exactly the words: AgentYard phone OK", cwd });
let streamed = "";
for (;;) {
  const m = await next();
  if (m.type === "prompt_event" && m.id === pid) {
    if (m.event.type === "text") {
      streamed += m.event.text;
      process.stdout.write(m.event.text);
    } else if (m.event.type === "thought") {
      process.stdout.write(`\n  [thought] ${m.event.text.slice(0, 90)}`);
    } else if (m.event.type === "tool_call") {
      process.stdout.write(`\n  [tool] ${m.event.toolCall.title ?? m.event.toolCall.toolCallId}`);
    } else if (m.event.type === "done") {
      console.log(`\n  done event: ${m.event.stopReason}`);
    }
    continue;
  }
  if (m.type === "ok" && m.id === pid) {
    console.log("  final:", JSON.stringify(m.result));
    break;
  }
  if (m.type === "error") throw new Error(m.message);
}
console.log("  agent text:", JSON.stringify(streamed.slice(0, 200)));

console.log("\n== transcript ==");
send("transcript", { sessionId: tab.sessionId, cwd });
const transcript = await reply("e2e-5");
for (const e of transcript.entries.slice(0, 8)) {
  console.log(`  [${e.kind}] ${(e.text ?? e.toolCall?.title ?? "").slice(0, 100)}`);
}

console.log("\n== deleteTab ==");
send("deleteTab", { sessionId: tab.sessionId });
await reply("e2e-6");
console.log("  deleted");

ws.close();
console.log("\nCOMPANION E2E PASSED");
process.exit(0);
