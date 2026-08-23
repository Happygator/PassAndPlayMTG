import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// One project, three channels (APP-MIGRATION.md §3). `--mode app` and
// `--mode imessage` select the native builds; anything else is the website.
// Each channel gets its own outDir so a `cap sync` or an extension copy step
// can never pick up the wrong bundle.
type Channel = 'web' | 'app' | 'imessage';

const OUT_DIR: Record<Channel, string> = {
  web: 'dist',
  app: 'dist-app',
  imessage: 'dist-imsg',
};

export default defineConfig(({ mode }) => {
  const channel: Channel = mode === 'app' || mode === 'imessage' ? mode : 'web';

  return {
    // VITE_BASE is set by the GitHub Pages workflow to the repository sub-path
    // (e.g. "/PassAndPlayMTG/"); local dev/preview and both native shells serve
    // from "/".
    base: channel === 'web' ? (process.env.VITE_BASE ?? '/') : '/',
    build: { outDir: OUT_DIR[channel] },
    resolve: {
      // Resolved at BUILD time, so the web bundle can never pull in Capacitor
      // and the native bundles never pull in the service-worker registration.
      // Keep in sync with the `paths` entry in tsconfig.json.
      alias: { '@platform': `/src/platform/${channel}` },
    },
    plugins: [
      preact(),
      // PWA machinery is pointless inside a native shell.
      ...(channel === 'web'
        ? [
            VitePWA({
              registerType: 'prompt',
              includeAssets: ['icons/*.png'],
              manifest: {
                name: 'Sealed Pass-and-Play',
                short_name: 'Pass & Play',
                description: 'Pass-and-play Magic: The Gathering sealed micro-formats on one shared device.',
                display: 'standalone',
                orientation: 'portrait',
                background_color: '#161311',
                theme_color: '#161311',
                icons: [
                  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                  { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
              },
              workbox: {
                // Precache EVERYTHING, card images included: the app must be fully
                // offline from the moment install completes (DESIGN.md §4, no partial
                // states, no text fallbacks).
                globPatterns: ['**/*.{js,css,html,json,png,jpg,woff2,webmanifest}'],
                maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
                // The standalone support/privacy pages are real documents, not app
                // routes: without this the SPA navigation fallback would serve
                // index.html in their place once the service worker is active.
                navigateFallbackDenylist: [/\/(support|privacy)\.html$/],
              },
            }),
          ]
        : []),
    ],
    // Allow access through Cloudflare quick tunnels (for phone testing);
    // the leading dot allows any *.trycloudflare.com subdomain.
    server: {
      allowedHosts: ['.trycloudflare.com'],
    },
    preview: {
      allowedHosts: ['.trycloudflare.com'],
    },
  };
});
