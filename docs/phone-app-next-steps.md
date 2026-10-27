# Phone app — next steps

Status: proposed. Connector milestone done (see `devin-acp-findings.md`).
This is the work plan for the iPhone app per `AgentYard-Plan.md`.

Founder context that shapes the plan: primary dev machine is a **Mac**, so
local iOS builds via Xcode are available — EAS Build is optional, not
required. Apple Developer account, certs, and TestFlight access exist.

## Repo

New repo/package: `agentyard` (dir `C:\Code\Stackapps\agentyard` already
exists, currently empty — intended home). The connector stays here in
`agentyard-connectors`; the phone app consumes it indirectly via the
companion/relay, never via ACP.

## 1. Scaffold

```bash
cd C:\Code\Stackapps\agentyard          # on the Mac: ~/Code/Stackapps/agentyard
npx create-expo-app@latest . --template blank-typescript
```

- TypeScript strict mode, ESLint, unit tests from day one (jest-expo or
  vitest — project rule: always add unit tests).
- Use **expo-router** (file-based routing) — the app is screen-flow shaped:
  contact list → app's sessions → conversation.
- Bundle id `com.agentyard.app` (check availability early; name not verified).
- Keep Android config in the project from the start, build/test iPhone first.

## 2. Dev loop on the Mac

| Stage | Command | Needs |
|---|---|---|
| UI iteration | `npx expo start` → scan QR in **Expo Go** | nothing, no certs |
| Real native build on device | `npx expo install expo-dev-client`, then `npx expo run:ios --device` | Xcode + CocoaPods; Apple ID signed into Xcode; free "personal team" works, paid dev account better |
| Shareable build / TestFlight | `eas build --platform ios` + `eas submit` | EAS account; eas manages certs automatically, or point at existing ones |

Skip Expo Go once native modules enter (mic/dictation, push notifications,
background fetch) — dev-client build from then on.

## 3. Screens (skeleton first, wire real data after)

Per the plan's UX: WhatsApp-style.

1. **Contacts** — installed/connected agent apps. v1: single "Devin" contact.
   Later: distinguish paired machines.
2. **Sessions** — the Devin tabs for a chosen workspace: title, last activity,
   status badge. Hide/show (local visibility only — never closes the session)
   + hidden-list restore. Order persisted locally.
3. **Conversation** — transcript + streamed response + composer.
   Keyboard first; dictation button stubbed.
4. **Pairing/setup** — code entry, connection status, machine label.

State: React hooks + AsyncStorage for tab order/visibility v1; server-side
sync when the hosted service lands.

## 4. Service boundary the app consumes

Phone → hosted relay → desktop companion → `DevinConnector` → `devin acp`.
The connector's public types (`TabInfo`, `TabEvent`, `TabTranscript`) are the
domain wire types — consider extracting a shared `agentyard-protocol` types
package the app, relay, and companion all import.

Proposed endpoints (names can move; semantics shouldn't):

```
POST   /pair                        phone <-> companion short-code pairing
GET    /workspaces                  workspaces the companion can list tabs for
GET    /sessions?cwd=…              -> TabInfo[]        (listTabs)
GET    /sessions/:id/transcript     -> TabTranscript    (readTab)
POST   /sessions/:id/prompt         -> stream TabEvent  (postToTab; SSE or WS)
POST   /sessions                    {cwd, prompt?}      (createTab)
DELETE /sessions/:id                                    (deleteTab)
POST   /sessions/:id/cancel                             (cancelTab)
POST   /sessions/:id/permission     permission-request response relay
```

Streaming transport decision to make: **WebSocket** (one channel, easiest
multiplex of prompts/permissions/notifications) vs SSE+REST. Lean WebSocket
for bidirectional events.

## 5. Milestones (mapped to the plan's delivery order)

1. **M1 — scaffold**: app builds, opens on iPhone via Expo Go.
2. **M2 — shell + fixtures**: all four screens navigable with canned
   `TabInfo`/transcript fixtures; hide/show + ordering persisted.
3. **M3 — LAN round trip (the plan's step 2 proof)**: companion-side dev
   endpoint in this repo (or a small new `agentyard-companion` package)
   exposing the real `DevinConnector` over HTTP+WS on the LAN; phone app
   pairs by typed code/IP — no hosted service yet. Done = a prompt typed on
   the phone lands in a real Devin tab and the streamed reply shows on both
   phone and desktop.
4. **M4 — dev-client build**: `expo run:ios --device`; dictation via
   `expo-speech-recognition`; push notifications spike (APNs via Expo push).
5. **M5 — hosted relay**: Rust/Axum service + account pairing + outbound
   companion connection, per the architecture section of the plan. Only now
   does cellular/off-LAN control work.

## 6. Known follow-ups / open decisions

- Pairing model: short code on desktop → typed on phone (simplest) vs QR.
- How the phone picks the Devin workspace (`cwd`) the tabs belong to —
  companion advertises known workspaces.
- Locked sessions (`isLocked`): test prompting a tab that's open in the IDE —
  may need "open in Devin first" UX.
- Permission requests: surface as phone-side actionable cards; default
  connector policy is cancel — the relay must round-trip the user's choice.
- Push notifications for turn completion — spike in M4, real wiring in M5.
- App Store: name availability, privacy labels, and review are later gates.
