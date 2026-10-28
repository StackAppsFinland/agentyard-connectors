# agentyard-connectors

Provider connectors for AgentYard — control local agent sessions from the
desktop companion. First connector: **Devin Desktop** via ACP (Agent Client
Protocol), the same protocol Devin Desktop itself uses for its conversation
tabs.

## What the Devin connector does

| Operation | Method | Backed by |
|---|---|---|
| List tabs | `listTabs(cwd)` | `session/list` |
| Read tab contents | `readTab(sessionId)` | `session/load` replay → transcript |
| Post to a tab | `postToTab(sessionId, text)` | `session/prompt`, streamed events |
| Create a tab | `createTab(cwd)` | `session/new` |
| Delete a tab | `deleteTab(sessionId)` | `session/delete` |
| Cancel a turn | `cancelTab(sessionId)` | `session/cancel` |

Sessions are scoped to a working directory (`cwd`) — the Devin workspace.
Prompting a session writes into the shared session store, so it lands in the
same conversation the user sees in Devin Desktop.

See `docs/devin-acp-findings.md` for the feasibility evidence, auth model, and
known gaps. See `docs/phone-app-next-steps.md` for the iPhone app work plan
and `docs/mac-getting-started.md` for the Mac-side runbook.

## Usage

```ts
import { DevinConnector } from "agentyard-connectors";

const conn = await DevinConnector.connect({
  cwd: "C:\\Code\\Stackapps",          // workspace the tabs live in
  // apiKey: "...",                    // optional; default auth is devin-browser PKCE
  // permissionHandler: async (req) => "optionId" | null,  // default: cancel
});

for (const tab of await conn.listTabs()) console.log(tab.sessionId, tab.title);

for await (const ev of conn.postToTab("truth-almanac", "Summarize today's work")) {
  if (ev.type === "text") process.stdout.write(ev.text);
  if (ev.type === "done") console.log("stop:", ev.stopReason);
}

const transcript = await conn.readTab("truth-almanac");

conn.close();
```

## Auth

The spawned `devin acp` process authenticates through the ACP host (this
connector), not local CLI credentials:

- default: `authenticate` with `devin-browser` (PKCE browser flow; silent if a
  Devin session is already active in the browser)
- `apiKey` option: passed via `authenticate` `_meta.api_key`
- `skipAuth: true`: listing sessions works unauthenticated; load/prompt will
  fail with `Authentication required`

## Companion server (phone app ↔ connector bridge)

`src/server/` wraps the connector in a WebSocket endpoint the AgentYard
phone app talks to over the LAN (the phone never speaks ACP):

```bash
npm run companion -- --workspace "C:\Code\Stackapps" [--workspace label=cwd ...]
# or: node dist/server/run.js -w <cwd> -p 4000 --code 123456
```

It prints a 6-digit pairing code + LAN `ws://` addresses. Protocol v1:
`hello`+code first, then `tabs`/`transcript`/`prompt` (streams
`prompt_event`s)/`createTab`/`deleteTab`/`cancel`/`permission`; every request
gets a matching `ok`/`error` by `id`. Schema: `src/server/protocol.ts`
(mirrored into the app at `agentyard/src/protocol.ts`). Also serves
`GET /health` for probes.

Verify without a phone: `node scripts/e2e-companion.mjs [port] [code]`
(hello → tabs → createTab → streamed prompt → transcript → deleteTab,
against the real Devin install).

## Develop

```bash
npm install
npm run build       # tsc -> dist/
npm test            # vitest (unit tests, no Devin needed)
node scripts/e2e-devin.mjs   # live connector round-trip (adjust CWD inside for your OS)
```

`scripts/acp-probe*.mjs` are raw protocol probes used during the feasibility
spike — kept for debugging.

## Layout

```
src/acp/        NDJSON JSON-RPC peer, typed ACP client, process spawner
src/devin/      binary locator, DevinConnector (tab ops), transcript builder
src/connector/  public types: TabInfo, TabEvent, errors
src/server/     companion WebSocket server + wire protocol + CLI (run.js)
docs/           feasibility findings
scripts/        probes + live e2e (connector + companion)
test/           vitest unit tests
```
