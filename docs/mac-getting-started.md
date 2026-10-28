# Mac getting-started runbook — AgentYard phone app

Concrete pickup instructions for the Mac side. The plan lives in
`phone-app-next-steps.md`; this file is the "sit down at the Mac and type
these commands" version.

## What runs where

- **Mac**: the phone app (`agentyard`, Expo/React Native), UI dev, iOS builds.
- **Wherever Devin Desktop lives** (currently the Windows box; Devin Desktop
  also runs on Mac if you install it there): this connector +
  `devin acp`. The phone never talks ACP directly.
- Between them (M3+): a small companion HTTP/WS endpoint wrapping
  `DevinConnector`. For the LAN milestone, plain `http://<devin-box-ip>:PORT`
  on the same Wi-Fi — no hosted service, no certs, no tunnel.

## 1. Prerequisites on the Mac (one-time)

```bash
# Xcode from the App Store, then:
xcode-select --install
sudo xcodebuild -license accept        # first run only

brew install node watchman cocoapods   # node >= 20
node --version                         # expect v20+/v22+/v24+

npm install -g eas-cli                 # optional until TestFlight stage
```

On the iPhone: install **Expo Go** (free, App Store) for the dev loop.

Apple account: open Xcode → Settings → Accounts → sign in the dev Apple ID —
needed once we build on-device (stage 2), not for Expo Go.

## 2. Get the repos

```bash
mkdir -p ~/Code/Stackapps && cd ~/Code/Stackapps
git clone https://github.com/StackAppsFinland/agentyard-connectors.git
mkdir agentyard && cd agentyard        # the phone-app repo, new
```

`agentyard-connectors` is needed on the Mac only for the shared types and the
findings docs — the connector itself only runs where Devin Desktop lives.
If Devin Desktop gets installed on the Mac later, `npm run build` +
`node scripts/e2e-devin.mjs` there should work unchanged (binary locator
already checks the macOS `.app` path).

## 3. Scaffold the app (M1)

```bash
cd ~/Code/Stackapps/agentyard
npx create-expo-app@latest . --template blank-typescript
git init && git add -A && git commit -m "Expo scaffold"
```

Then set in `app.json`:

```json
{ "expo": {
    "name": "AgentYard",
    "slug": "agentyard",
    "ios": { "bundleIdentifier": "com.agentyard.app" },
    "scheme": "agentyard"
} }
```

(Check `com.agentyard.app` + the AgentYard name early — plan flags it as
unverified.)

## 4. Run on the iPhone

Stage 1 — Expo Go (no certs, daily UI loop):

```bash
npx expo start          # in ~/Code/Stackapps/agentyard
# iPhone: same Wi-Fi, open Expo Go, scan the QR code
```

Stage 2 — on-device native build (needed for mic/dictation/push later):

```bash
npx expo install expo-dev-client
npx expo run:ios --device      # picks the connected iPhone, signs via Xcode
```

First `run:ios` asks for the bundle id + Apple team. It compiles ~5-10 min
the first time, installs a real `.app` on the phone — that build persists and
hots-reloads JS from `npx expo start`.

Stage 3 — TestFlight (when sharing beyond the dev phone):

```bash
eas build --platform ios --profile production
eas submit --platform ios
```

`eas credentials` can manage cert/profile automatically using the Apple dev
account; internal TestFlight testers get builds without review.

## 5. Screens to build in the M2 shell

expo-router file layout (`app/` dir):

```
app/index.tsx              contact list -> ["Devin"]
app/devin/index.tsx        session tabs (hide/show, persisted order)
app/devin/[sessionId].tsx  conversation: transcript + composer
app/pair.tsx               pairing code + connection status
```

Fixture-driven first: hardcoded `TabInfo[]`/transcript shaped exactly like
`src/connector/types.ts` in agentyard-connectors. Persist tab order/visibility
with `@react-native-async-storage/async-storage`. Unit tests for the store +
components (project rule: always add unit tests).

## 6. M3 — the LAN round trip (implemented, verified on Mac)

Goal: prompt typed on the phone lands in a real Devin tab; streamed reply
visible on both. **Done**: the companion lives in `src/server/` (WS on
`0.0.0.0:4000` by default, pairing code printed on start) — verified
end-to-end via `node scripts/e2e-companion.mjs` and the app's own
`CompanionClient` (`AGENTYARD_LIVE=… npx vitest run live` in agentyard).

1. On the Devin box: `npm run companion -- --workspace <cwd>` (repeat
   `--workspace` per Devin cwd; prints `ws://<ip>:<port>` + code).
2. iPhone on same Wi-Fi: gear icon → Settings → enter `ws` address + code.
3. Phone app ops: `hello` → `tabs` → `prompt` (streamed). Verify the turn
   appears in Devin Desktop.

Protocol = `src/server/protocol.ts` (WS JSON, not the REST sketch from
`phone-app-next-steps.md` §4 — semantics match, `/workspaces` is inside
`hello`).

Only after this works does the hosted relay (Rust/Axum, plan M5) buy us
cellular/off-LAN control.

## 7. Gotchas

- **Same Wi-Fi** for Expo Go and for M3; corporate/AP-isolation networks
  break both.
- Windows firewall will prompt on the companion's first listen — allow
  private-network access.
- `session/list` is `cwd`-scoped: the companion should expose the Devin
  workspaces it knows (e.g. `C:\Code\Stackapps`) rather than letting the
  phone guess.
- Locked tabs (`isLocked`) are open in the IDE — verified on Mac: `session/load`
  fails with "Session '<id>' is already open in another process (PID …)", so
  reading or prompting them fails. Phone UX should mark them "open in Devin"
  and treat them as unavailable until closed there.
- Devin auth: connector `authenticate(devin-browser)` silently reused the
  login here; on a fresh Devin install expect a browser prompt on first
  connect — fine on a desktop companion, just document it.
