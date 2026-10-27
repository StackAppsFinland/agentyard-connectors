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
known gaps.

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

## Develop

```bash
npm install
npm run build       # tsc -> dist/
npm test            # vitest (unit tests, no Devin needed)
node scripts/e2e-devin.mjs   # live round-trip against the local Devin install
```

`scripts/acp-probe*.mjs` are raw protocol probes used during the feasibility
spike — kept for debugging.

## Layout

```
src/acp/        NDJSON JSON-RPC peer, typed ACP client, process spawner
src/devin/      binary locator, DevinConnector (tab ops), transcript builder
src/connector/  public types: TabInfo, TabEvent, errors
docs/           feasibility findings
scripts/        probes + live e2e
test/           vitest unit tests
```
