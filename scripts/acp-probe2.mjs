// Probe 2: session/load (read contents), session/new + prompt (create+post), session/delete
import { spawn } from "node:child_process";

const DEVIN = String.raw`C:\Users\matt\AppData\Local\Programs\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe`;
const cwd = "C:\\Code\\Stackapps\\agentyard-connectors"; // scratch workspace for create/delete test
const LOAD_ID = process.argv[2]; // existing session id to read

const child = spawn(DEVIN, ["acp"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", nextId = 1;
const pending = new Map();
let notifCount = 0;

child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === "session/update") {
      notifCount++;
      const u = msg.params?.update;
      const kind = u?.sessionUpdate;
      let preview = "";
      if (u?.content?.type === "text") preview = u.content.text.slice(0, 120);
      else if (u?.content) preview = `[${u.content.type}]`;
      console.log(`  update#${notifCount} ${kind}: ${preview}`);
    } else if (msg.method) {
      console.log("AGENT->CLIENT:", msg.method, JSON.stringify(msg.params).slice(0, 300));
      if (msg.id !== undefined)
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "probe: not implemented" } }) + "\n");
    }
  }
});

const req = (method, params) => new Promise((res, rej) => {
  const id = nextId++;
  pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const init = await req("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }, clientInfo: { name: "probe2", version: "0.0.1" } });
  console.log("INIT ok, loadSession:", init.agentCapabilities?.loadSession);

  console.log("\n=== authenticate devin-browser ===");
  const auth = await req("authenticate", { methodId: "devin-browser" });
  console.log("auth result:", JSON.stringify(auth));

  if (LOAD_ID) {
    console.log(`\n=== session/load ${LOAD_ID} (in ${process.argv[3] || cwd}) ===`);
    const r = await req("session/load", { sessionId: LOAD_ID, cwd: process.argv[3] || cwd, mcpServers: [] });
    console.log("load result:", JSON.stringify(r));
    await sleep(1000);
    console.log(`total updates replayed: ${notifCount}`);
  }

  console.log("\n=== session/new ===");
  let sessionId;
  try {
    const n = await req("session/new", { cwd, mcpServers: [] });
    sessionId = n.sessionId;
    console.log("created:", JSON.stringify(n));
  } catch (e) { console.log("session/new failed:", e.message); }

  if (sessionId) {
    console.log("\n=== session/prompt ===");
    try {
      const p = await req("session/prompt", { sessionId, prompt: [{ type: "text", text: "Reply with exactly one word: hello" }] });
      console.log("prompt result:", JSON.stringify(p));
    } catch (e) { console.log("session/prompt failed:", e.message); }

    await sleep(500);
    console.log("\n=== session/delete ===");
    try {
      const d = await req("session/delete", { sessionId });
      console.log("delete result:", JSON.stringify(d));
    } catch (e) { console.log("session/delete failed:", e.message); }
  }
} catch (e) { console.log("FATAL:", e); }
finally { child.kill(); process.exit(0); }
