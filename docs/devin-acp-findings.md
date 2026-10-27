# Devin Desktop session access — feasibility findings

Date: 2026-10-27. Verified on the founder's machine (Windows 11).

This documents the mandatory existing-session feasibility milestone from
`AgentYard-Plan.md`: what interface exists, what was verified live, and the
known gaps.

## Environment under test

- Devin Desktop 1.126.0 (`Exafunction.Windsurf`, Windsurf base `windsurf@3.10.67`, Electron 42.2.0)
- Bundled Devin CLI: `devin 3000.10.67 (0b186d6e)`
- Binary: `%LOCALAPPDATA%\Programs\Devin\resources\app\extensions\windsurf\devin\bin\devin.exe`

## The interface: `devin acp`

Devin Desktop spawns one `devin.exe acp` process per agent tab (observed via
`Win32_Process`: `devin.exe acp` and `devin.exe acp --agent-type summarizer`
running as children of the IDE). The same command is publicly runnable:

```
devin.exe acp   # ACP (Agent Client Protocol) server over stdio, NDJSON JSON-RPC
```

A spawned `acp` process opens the **same session store** the IDE uses
(`session DB inventory` log: ~176 visible rows). Sessions are shared, not
per-process — writes made through our spawned process land in the sessions
Devin Desktop displays. This satisfies "attach to that exact session without
creating or copying it".

Supporting CLI (same session store, useful for ops/debugging):

```
devin list --format json    # sessions for the current directory
devin rm <id|prefix>        # delete a session
devin --resume <id> -p "…"  # print-mode prompt into an existing session
```

## Verified capabilities (protocol v1)

`initialize` response advertises:

| Capability | Verified | Mechanism |
|---|---|---|
| List tabs (sessions) | yes | `session/list` — `{cwd}` scoped, `{sessionId, title, updatedAt, _meta}`; page cap ~50, `nextCursor` paging. Works **unauthenticated**. |
| Read tab contents | yes | `session/load` (requires auth) — replays the entire history as ordered `session/update` notifications: `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`. |
| Post to a tab | yes | `session/load` then `session/prompt` — streams the same update kinds live; resolves `{stopReason: "end_turn"}`. |
| Create a tab | yes | `session/new` `{cwd}` → `{sessionId}`. Title auto-generates from the first prompt. |
| Delete a tab | yes | `session/delete` `{sessionId}` (capability: `sessionCapabilities.delete`). Session disappears from `session/list` / `devin list`. |
| Cancel | capability only | `session/cancel` notification — implemented, not yet exercised live. |
| Permission requests | capability only | agent→client `session/request_permission`; connector defaults to cancel (fail closed), configurable handler. |

Verified session `_meta` keys: `cognition.ai/requestingTabId`,
`cognition.ai/createdAt`, `cognition.ai/isLocked`. Extra advertised `_meta`
capabilities (not yet exercised): `sessionRename`, `sessionShare`,
`additionalDirectories` (session/list beyond one cwd), `multiRootWorkspace`.

### Live evidence (2026-10-27)

- `session/load polydactyl-windflower` → 128 replayed updates reconstructing a
  real past conversation (user text, thoughts, tool calls).
- `session/new` → `gusty-chamomile`; `session/prompt` → streamed thought +
  text, `stopReason: end_turn`; `session/delete` → absent from subsequent
  `session/list` and `devin list`.
- E2E script: `scripts/e2e-devin.mjs`.

## Authentication

The ACP host is the sole credential source — the spawned process refuses local
CLI credentials ("Local CLI credentials are intentionally not used in ACP
mode"). `session/list` works without auth; `session/load`, `session/new` and
`session/prompt` return `-32000 Authentication required` until the host calls:

- `authenticate` `{methodId: "devin-browser"}` — PKCE browser flow. On this
  machine it completed silently (existing login session); on a fresh machine
  expect a browser prompt — natural fit for companion-app pairing.
- `authenticate` `{methodId: "devin-browser", _meta: {api_key}}` — user API
  key path per the error text; exact key format untested.

`authMethods` from `initialize`: `[{id: "devin-browser"}]` only.

## Gaps / semantics to be aware of

- **"Tab" vs "session".** ACP manages *sessions*; a Devin Desktop tab is the
  IDE's view of a session. Creating a session makes it appear in the session
  list; whether the IDE auto-opens a tab for it is untested (probably not —
  the user opens it, or the desktop app may enumerate new sessions).
- **`isLocked`.** Sessions listed as `isLocked: true` are attached to a host.
  Prompting a session simultaneously open in Devin Desktop is untested —
  behaviour (queued / interleaved / rejected) unknown.
- **`session/list` is `cwd`-scoped.** Cross-workspace listing needs one call
  per known directory, or `additionalDirectories` (advertised, untested).
- **Concurrent prompts:** the connector serializes per-session; the agent may
  also reject/reorder prompts for a busy session.
- **`devin.exe` CLI is not logged in** (`devin auth status` → "Not logged
  in") — irrelevant for ACP, which authenticates its own way; only matters if
  we fall back to `devin --resume -p`.

## Documented vs experimental

ACP is an open protocol (agentclientprotocol.com); Devin's implementation is
exercised daily by Devin Desktop itself, so this is the supported host
protocol, not UI automation. Version skew risk: the spawned binary ships with
Devin Desktop — connector should re-probe `agentCapabilities` on every
`initialize` rather than hard-code.
