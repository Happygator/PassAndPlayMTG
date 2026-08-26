# Mac build runbook

Instructions for an agent picking this repo up on macOS to produce the iOS app and its
iMessage extension. Written on Windows, where everything below step 0 was impossible.

**Read this whole file before running anything.** Steps 1–2 are mechanical; steps 3–5 involve
judgement and a device.

## What state the repo is in

A Vite + Preact app that builds three channels from one source tree:

| Command | Output | Consumer |
|---|---|---|
| `npm run build` | `web/dist/` | the website (GitHub Pages) |
| `npm run build:app` | `web/dist-app/` | the iOS container app |
| `npm run build:imessage` | `web/dist-imsg/` | the Messages extension |

All three build clean. Game logic, all three game modes, game-state resume, the message
codec and the extension's no-handoff flow are **done and verified in a browser**.

What does not exist: `web/ios/` (the Xcode project). Nothing has ever been compiled by a
Swift toolchain.

> **Note on dangling references.** Files here cite `APP-MIGRATION.md` and `DESIGN.md`
> sections. Both are **gitignored and not in your clone.** They are the author's planning
> documents. Where a reference matters, this file restates the content — treat a citation you
> cannot resolve as background, not as a missing dependency.

## 0. Prerequisites

```bash
node --version    # MUST be >= 22
xcodebuild -version
pod --version
```

- **Node 22+ is a hard gate.** The Capacitor 8 CLI exits with
  `[fatal] The Capacitor CLI requires NodeJS >=22.0.0` on anything older. This applies only
  to `cap` commands — Vite, `tsc` and the `scripts/` pipelines run fine on Node 20, and CI
  pins 20 deliberately. **Do not "fix" CI's Node version.**
- **CocoaPods** is required: `cap add ios` runs `pod install` internally.
- The Apple Developer account must be the **paid Program** enrollment. App Groups (used to
  share cached images between the two targets), TestFlight and distribution signing all
  require it. If it is a free Apple ID, stop and tell the user.

## 1. Generate the Xcode project

```bash
cd web && npm ci
```

```bash
npm run build:app
```

The first run downloads cube, catalogue, booster and banlist data and needs network; expect
several minutes. Everything after this is offline.

```bash
npx cap ls
```

Cheap sanity check: `capacitor.config.ts` is type-checked but has **never been executed**.

```bash
npx cap add ios
```

**This step has no decisions in it.** `capacitor.config.ts` already carries the permanent
identifiers, `webDir: 'dist-app'` and `contentInset: 'never'`. There is no `cap init` step.

**Immediately after, before any commit**, add to `.gitignore`:

```
web/ios/App/Pods/
```

Verify: `web/ios/App/App.xcodeproj` exists and opens in Xcode.

From here the rebuild loop is one command:

```bash
npm run sync:ios
```

## 2. Container app plugins

Deliberately not written blind — they need a device to test.

- `@capacitor-community/keep-awake` — stop the screen sleeping mid-game.
- **Image disk cache.** Two of three modes fetch card art from `cards.scryfall.io` at
  runtime. Cache to the App Group container keyed by Scryfall ID. Scryfall's guidelines ask
  for a descriptive User-Agent, ~10 req/s, and local caching rather than hot-linking — a
  browser cannot set a User-Agent but `CapacitorHttp` can. Hook point:
  `cardImageSrc` in `web/src/platform/app/index.ts`, already the single choke point for every
  card image. **No screen changes needed.**
- Verify `contentInset: 'never'` on device. The app pads itself with
  `env(safe-area-inset-*)`, so a wrong value shows as **doubled padding, not a crash**.

## 3. Memory prototype — do this before building on top of it

Extensions are **terminated**, not throttled, when they exceed their memory limit. Measure in
this order:

1. ~20-card cube grid — ordinary play.
2. **Constructed mode: full catalogue loaded, then a results grid.** ← the number that matters
3. 90-card grid — find the ceiling.

The constructed catalogue is 31,742 cards. Estimated from the browser: ~15 MB retained but
**~45 MB peak during parse**. The spike, not the steady state, is what would kill the
extension. If it dies, the mitigations in order of cost are: `content-visibility` (already
applied to card grids), releasing the catalogue when leaving constructed mode, chunking the
parse, then a build-time thumbnail pass.

If constructed mode cannot survive in the extension, gating it out is a **one-line change** —
set `messaging`-channel capability flags in `web/src/platform/imessage/index.ts`. That is the
designed fallback, not a failure.

## 4. Messages extension

Follow **`web/ios-src/README.md`** — it has the exact Xcode steps and travels with the repo.
Summary:

1. New Target → iMessage Extension. Bundle ID **must** be
   `com.happygator.passandplay.MessagesExtension` (a child of the container app's ID).
2. Enable App Group `group.com.happygator.passandplay` on **both** targets.
3. Replace Xcode's stub with the two files in `web/ios-src/`.
4. Add `web/dist-imsg/` to the extension bundle as a **folder reference (blue, not yellow)**.

**Expect to fix the Swift at first compile.** It was authored without a toolchain — API
details, optionals and access control are unverified. The *shapes* are worth keeping. The
TypeScript it talks to (`web/src/messageState.ts`) is tested, and the two sides' constants
were cross-checked: handler name `game`, `{type:'state'|'expand'}` bodies,
`window.__onMessageState` / `window.__setPresentation` inbound, `?s=` for the payload.

**Do not switch the WebView to `file://`.** The bundle is served through a custom URL scheme
because under a file origin every `fetch('./cubes/index.json')` fails — that is most of the
app — and the built `index.html` references `/assets/` absolutely. This is load-bearing.

### Still unwritten here, on purpose

**Seat identity** (`MSConversation.localParticipantIdentifier`) and the **vote sequence**.
Both depend on the lifecycle you can only observe once the extension runs. The transport
underneath them works.

Design constraints when you write them:
- Both players' full pools travel in the payload; the app simply does not display the
  opponent's until `revealed`. This is deliberate — there is no server, and the pass-and-play
  handoff screen was never a security boundary either.
- `awaitingReply` in `app.tsx` is **local UI state and must never enter the payload** — both
  devices decode the same message and would both believe they were waiting.
- Vote disagreement default: *contested, both re-enter*. Confirm it feels right in practice.

### Capture this

The first time the extension runs, screenshot the `.compact` tray and the `.expanded` sheet.
Nobody has seen this surface. Compact was measured in a browser at 390x270 and the start
screen was **non-functional** there — its only action sat 414px below the fold — which is why
`CompactView` is a tap-to-open affordance rather than a small start screen.

## 5. Feasibility round, then submission

Play a full game in **each of the three modes** inside the real extension, on real hardware,
on cellular, watching for termination and cold-cache behaviour.

**A true send/receive test needs two physical devices.** The Simulator cannot exchange real
iMessages with a phone.

Then archive and choose:

- **App Store** — needs two icons (app + iMessage, both already generated in
  `web/public/icons/`), both screenshot sets, privacy nutrition label (nothing collected, but
  the app does make network requests — see `web/public/privacy.html`), age rating.
- **TestFlight only** — skips review entirely and is a legitimate permanent home at this
  scale (~5 players). Builds expire after 90 days. External testing with a public link needs
  one light review; internal needs none.

Everything up to this point is identical either way, so this choice can wait.

## Hard constraints — do not change without asking

| Thing | Why |
|---|---|
| `com.happygator.passandplay` | Permanent. Cannot change after first upload without a new App Store record. |
| `com.happygator.passandplay.MessagesExtension` | Must remain a child of the above. |
| `group.com.happygator.passandplay` | Both targets read shared assets through it. |
| Free, no IAP | Keeps the app inside Wizards' Fan Content Policy. |
| The fan-content notice | Required in the binary and the listing. Already on the start screen. |
| CI's Node 20 pin | Unrelated to the `cap` requirement. |

## If something looks broken but isn't

- **The extension shows no handoff screen.** Correct — each player has their own phone. A
  `handoff` phase auto-advances to building.
- **`web/public/catalogue/`, `cards/`, `boosters/` are missing after a clone.** Generated.
  `npm run build:app` rebuilds them.
- **The start screen scrolls ~55px on a phone.** Known and accepted. Only the legal notice is
  below the fold; the Start button is always in reach.
