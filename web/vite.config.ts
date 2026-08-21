import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_BASE is set by the GitHub Pages workflow to the repository sub-path
// (e.g. "/PassAndPlayMTG/"); local dev/preview serve from "/".
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Sealed Pass-and-Play',
        short_name: 'Pass & Play',
        description: 'Pass-and-play Magic: The Gathering sealed micro-formats on one shared device.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#14181f',
        theme_color: '#14181f',
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
        globPatterns: ['**/*.{js,css,html,json,png,jpg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  // Allow access through Cloudflare quick tunnels (for phone testing);
  // the leading dot allows any *.trycloudflare.com subdomain.
  server: {
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    allowedHosts: ['.trycloudflare.com'],
  },
});
