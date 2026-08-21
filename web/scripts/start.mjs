// One-command dev startup: sync the cube list from Moxfield and rebuild the
// cube data, then start the Vite dev server. A sync failure must NOT block
// development — the server starts either way, serving the last successful
// build, with a loud warning. (Useful offline: Scryfall/Moxfield are
// unreachable, but public/cubes and public/cards are already on disk.)
//
// Usage: npm start            (sync + dev server)
//        npm start -- --host  (extra args are forwarded to vite)

import { spawn, spawnSync } from 'node:child_process';

const sync = spawnSync(process.execPath, ['scripts/build-cube.mjs'], { stdio: 'inherit' });
if (sync.status !== 0) {
  console.warn(
    '\nWARNING: cube sync/build failed (see above) — starting the dev server with the last successful build.\n'
  );
}

const vite = spawn('npx', ['vite', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
});
vite.on('exit', (code) => process.exit(code ?? 0));
