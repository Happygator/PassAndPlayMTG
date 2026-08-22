# Tutorial — running Pass-And-Play MTG yourself

This covers downloading the project, running it on your own computer, playing it on a phone, adding your own cubes, and publishing your own copy. If you just want to *play*, you don't need any of this — see the [README](README.md) for the one-minute phone install.

---

## 1. What you need

- **Node.js 18 or newer** (20 recommended) and npm — <https://nodejs.org>. Check with `node --version`.
- **Git**, to clone the repository.
- **Internet access the first time you build** (and whenever you change a cube): the build downloads card data and images from Scryfall, and cube lists from Moxfield. The running app itself never touches the network.
- Optional, for phone testing beyond your own Wi-Fi: `cloudflared` (used via `npx`, no install needed).

## 2. Clone and install

```bash
git clone https://github.com/Happygator/PassAndPlayMTG.git
cd PassAndPlayMTG/web
npm install
```

Everything you run lives in the **`web/`** folder — that's the website project. (The `app/` folder is reserved for a future App Store build, and `cubes/` at the root holds the shared cube lists.)

## 3. Build the card data, then start

Card images and cube data are *not* stored in the repository; the pipeline generates them. The one-command startup does both the generation and the dev server:

```bash
npm start
```

You'll see it sync each cube from Moxfield, download any card images it doesn't have yet (about 16 MB for the sample cubes, cached afterwards), and then print a Vite dev-server address:

```
  ➜  Local:   http://localhost:5173/
```

Open that URL in your browser. If the cube sync fails (offline, Moxfield down) the server still starts with the last successful build, with a warning.

Other commands, all from `web/`:

| Command | What it does |
|---|---|
| `npm start` | Sync cubes + build card data, then start the dev server (what you normally want). |
| `npm run dev` | Dev server only, no sync — fastest startup when cubes haven't changed. |
| `npm run cube` | Sync + card data only, no server. |
| `npm run icons` | Regenerate the placeholder app icons (`web/public/icons/`). |
| `npm run build` | Typecheck and produce the deployable static site in `web/dist/`. |
| `npm run preview` | Serve the production build locally. |

## 4. Play it on a phone while developing

The app is designed for a phone, so you'll want to test there. The phone must be able to reach your computer:

**Same Wi-Fi (simplest).** Start the server bound to all network interfaces:

```bash
npm start -- --host
```

Vite prints `Network:` addresses; open the one for your Wi-Fi adapter on the phone, e.g. `http://192.168.1.23:5173`. The first time, Windows Firewall may ask whether to allow Node.js — allow it on *private* networks. If the phone still can't connect, check that both devices are on the same (non-guest) network.

**Different network.** Expose the running server through a temporary public tunnel in a second terminal:

```bash
npx cloudflared tunnel --url http://127.0.0.1:5173
```

It prints a `https://….trycloudflare.com` address; open that on the phone. The tunnel lives until you stop it, and the address changes each run. (The project's Vite config already allows `*.trycloudflare.com` hosts.)

These are for *development*. For everyday play, install the published version as described in the [README](README.md) — the dev server is not a PWA (no offline support).

## 5. Adding your own cubes

Cubes are defined in **`cubes/sources.json`** at the repository root:

```json
{
  "id": "my-cube",
  "name": "My Cube",
  "description": "Shown under the cube selector",
  "modes": ["3cb"],
  "moxfield": "https://moxfield.com/decks/<public deck id>"
}
```

- `id` becomes the file name (`cubes/my-cube.txt`) and must be unique.
- `modes` lists where the cube may be used: `"3cb"`, `"paigow"`, or both. The start screen only offers cubes that support the selected mode.
- `moxfield` is a **public** Moxfield deck URL. Each `npm start` / `npm run cube` re-fetches it, so editing the deck on Moxfield and restarting is the whole update loop. The fetched list is cached as `cubes/<id>.txt` (Moxfield plaintext format, `1 Card Name (SET) 123`) and used as a fallback if Moxfield can't be reached.
- No Moxfield? Omit `moxfield` and write `cubes/<id>.txt` by hand in that same format — one card per line with set code and collector number, which pins the exact printing. To change a card's printing, change its set/number (on Moxfield, use the card's printing selector).

Then run `npm start`. Only new or changed cards are looked up and downloaded — resolved card data is cached in `cubes/card-cache.json` (keyed by set and collector number), so an unchanged cube rebuilds almost instantly and the log lists only what changed. A card that can't be resolved **fails the build** with its name printed, because the app deliberately never shows a card without its image. If Scryfall ever corrects a card's data, `npm run cube -- --refresh` re-resolves everything.

Curation matters more than in normal sealed. For 3-Card Blind, avoid randomness (coin flips, random discard) and hidden-information mechanics, and prefer cards whose matchups can be settled by a short discussion. For Pai Gow, the game is played out for real, so ordinary sealed curation applies.

## 6. Publishing your own copy

The published app is a static site built by GitHub Actions and hosted on GitHub Pages; the workflow is `.github/workflows/deploy.yml`. To publish your own fork:

1. Fork the repository on GitHub and make sure it's **public** (GitHub Pages on a free plan requires that).
2. In the fork's settings → **Pages**, set the source to **GitHub Actions**.
3. If your repository isn't named `PassAndPlayMTG`, edit `VITE_BASE` in `.github/workflows/deploy.yml` to `/<your-repo-name>/` — the app must know the sub-path it's served from.
4. Push to `master`. The workflow installs dependencies, syncs and builds the cubes, generates icons, builds the site, and deploys it to `https://<your-user>.github.io/<your-repo-name>/` in about a minute.

Every later push redeploys automatically. A cube edited only on Moxfield (no code change) doesn't trigger a push, so redeploy manually from the Actions tab ("Run workflow") or with `gh workflow run "Deploy to GitHub Pages"`.

Installed phones pick up a new version the next time the app is opened online — a "new version available" notice appears on the start screen with a Reload button.

## 7. Project layout

```
cubes/            Cube sources (sources.json + synced .txt lists) — shared, tracked
web/              The website: Vite + Preact + TypeScript
  src/            App code (screens in src/components/, rules in src/game.ts)
  scripts/        build-cube.mjs (card pipeline), start.mjs (one-command startup),
                  make-icons.mjs (placeholder icons)
  public/cards/   Generated card images   (ignored by git)
  public/cubes/   Generated cube JSON     (ignored by git)
  public/icons/   Generated app icons     (ignored by git)
app/              Reserved for the future App Store (Capacitor) build
.github/          The GitHub Pages deploy workflow
```

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `npm error ENOENT ... package.json` | You're in the repository root; `cd web` first. |
| Tunnel says "Unable to reach the origin service" | No server is listening on 5173 — start it (from `web/`) and wait for the `Local:` line before starting the tunnel. |
| Phone can't open the `Network:` address | Windows Firewall blocking Node.js, or the phone is on a different/guest network. |
| `Blocked request. This host ... is not allowed` | A tunnel host other than `*.trycloudflare.com`; add it to `server.allowedHosts` in `web/vite.config.ts`. |
| `Port 5173 is in use` | A previous dev server is still running; stop it or let Vite pick the next port. |
| `Image download 400` during the pipeline | Scryfall's image CDN requires a User-Agent header; the pipeline sends one — check it wasn't removed. |
| `WARNING: Moxfield sync failed` | Moxfield unreachable or the deck isn't public; the build continues from the cached `.txt`. |
| The published site shows an old version | The service worker is serving its cache. Go to the start screen and wait for the "new version available" notice, then Reload; if it never appears, close every tab of the site and reopen it. |
| Pushing a workflow change is rejected (`workflow` scope) | Run `gh auth refresh -h github.com -s workflow` once, then push again. |
