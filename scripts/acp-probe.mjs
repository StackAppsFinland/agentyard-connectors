// Probe devin.exe ACP capabilities: initialize -> session/list -> session/load -> prompt
// Usage: node acp-probe.mjs <cwd-to-scope-sessions> [sessionId-to-load]
import { spawn } from "node:child_process";

const DEVIN = String.raw`C:\Users\matt\AppData\Local\Programs\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe`;
const cwd = process.argv[2] || process.cwd();
const loadId = process.argv[3];

const child = spawn(DEVIN, ["acp"], { stdio: ["pipe", "pipe", "inherit"] });
child.stdin.setDefaultEncoding("utf8");

let buf = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { console.log("NON-JSON:", line); continue; }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      // notification or agent->client request
      if (msg.id !== undefined) {
        // request from agent — respond with a generic error for now, log it
        console.log("AGENT->CLIENT REQUEST:", JSON.stringify(msg).slice(0, 500));
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not implemented by probe" } }) + "\n");
      } else {
        console.log("NOTIFY:", JSON.stringify(msg).slice(0, 800));
      }
    } else {
      console.log("UNMATCHED:", JSON.stringify(msg).slice(0, 500));
    }
  }
});

function req(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}
const note = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const init = await req("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
    clientInfo: { name: "acp-probe", version: "0.0.1" },
  });
  console.log("INIT:", JSON.stringify(init, null, 2));

  // Try session/list
  try {
    const list = await req("session/list", { cwd });
    console.log("SESSION/LIST:", JSON.stringify(list, null, 2));
  } catch (e) {
    console.log("session/list failed:", e.message);
  }

  // Try unstable variant name if needed
  try {
    const list2 = await req("unstable/session/list", { cwd });
    console.log("UNSTABLE SESSION/LIST:", JSON.stringify(list2, null, 2));
  } catch (e) {
    console.log("unstable/session/list failed:", e.message);
  }

  if (loadId) {
    console.log("--- loading session", loadId, "---");
    const loaded = await req("session/load", { sessionId: loadId, cwd, mcpServers: [] });
    console.log("SESSION/LOAD RESULT:", JSON.stringify(loaded));
    await sleep(1500); // collect replay notifications
  }
} catch (e) {
  console.log("FATAL:", e);
} finally {
  child.kill();
  process.exit(0);
}
