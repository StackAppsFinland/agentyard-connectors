// Probe authenticate method shapes: bad methodId, then devin-browser to observe the flow.
import { spawn } from "node:child_process";

const DEVIN = String.raw`C:\Users\matt\AppData\Local\Programs\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe`;
const child = spawn(DEVIN, ["acp"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", nextId = 1;
const pending = new Map();

child.stdout.on("data", (d) => {
  buf += d.toString("utf8");
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else console.log("NOTIFY/REQ:", JSON.stringify(msg).slice(0, 600));
  }
});

const req = (method, params, timeoutMs = 20000) => new Promise((res, rej) => {
  const id = nextId++;
  const t = setTimeout(() => { pending.delete(id); rej(new Error("timeout")); }, timeoutMs);
  pending.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
});

try {
  await req("initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "authprobe", version: "0" } });
  console.log("INIT ok");

  // 1) bogus method
  try { await req("authenticate", { methodId: "nope" }); } catch (e) { console.log("bogus methodId ->", e.message); }

  // 2) api_key via _meta with dummy key — see validation behavior
  try {
    const r = await req("authenticate", { methodId: "devin-api-key", _meta: { api_key: "dummy" } });
    console.log("api_key auth ->", JSON.stringify(r));
  } catch (e) { console.log("api_key auth ->", e.message.slice(0, 400)); }

  // 3) browser method — expect a URL back or a launched browser
  try {
    const r = await req("authenticate", { methodId: "devin-browser" }, 15000);
    console.log("browser auth ->", JSON.stringify(r));
  } catch (e) { console.log("browser auth ->", e.message.slice(0, 500)); }
} catch (e) { console.log("FATAL:", e); }
finally { child.kill(); process.exit(0); }
