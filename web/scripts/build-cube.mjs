// Build-time cube pipeline: syncs cube lists from Moxfield (per cubes/sources.json),
// caching each as a plaintext export in cubes/<id>.txt, resolves every card via
// the Scryfall API, downloads card images into public/cards/, and emits cube
// JSON + an index into public/cubes/. Runtime never touches any API.
//
// Usage: node scripts/build-cube.mjs   (requires Node 18+, network access)
// - A Moxfield fetch failure falls back to the last synced cubes/<id>.txt with
//   a warning, so a Moxfield outage or block can never break the build.
// - Any card that fails to resolve to an image FAILS the build (exit 1) —
//   the app has no text-fallback rendering path, by design (see DESIGN.md §6).

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// Cube source lists live at the REPO root (shared with the future app/ project);
// ROOT here is the web/ project folder.
const CUBES_DIR = join(ROOT, '..', 'cubes');
const OUT_CARDS = join(ROOT, 'public', 'cards');
const OUT_CUBES = join(ROOT, 'public', 'cubes');

const API_DELAY_MS = 120;
const HEADERS = {
  'User-Agent': 'PassAndPlayMTG/0.1 (kitchen-table MTG sealed app)',
  Accept: 'application/json',
};

const BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequest = 0;
async function scryfall(url) {
  const wait = lastRequest + API_DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Scryfall ${res.status} for ${url}`);
  }
  return res.json();
}

/** Fetch a public Moxfield deck and render it as Moxfield-plaintext-export lines. */
async function fetchMoxfieldList(url) {
  const publicId = url.split('/').filter(Boolean).pop();
  const endpoints = [
    `https://api.moxfield.com/v2/decks/all/${publicId}`,
    `https://api2.moxfield.com/v3/decks/all/${publicId}`,
  ];
  let lastError = null;
  for (const api of endpoints) {
    try {
      const res = await fetch(api, { headers: HEADERS });
      if (!res.ok) throw new Error(`Moxfield ${res.status} for ${api}`);
      const deck = await res.json();
      // v2 shape: { mainboard: { [name]: { quantity, card } } }
      // v3 shape: { boards: { mainboard: { cards: { [id]: { quantity, card } } } } }
      const entries = deck.mainboard
        ? Object.values(deck.mainboard)
        : Object.values(deck.boards?.mainboard?.cards ?? {});
      if (entries.length === 0) throw new Error(`Unrecognized or empty deck payload from ${api}`);
      const lines = entries.map((entry) => {
        const card = entry.card ?? {};
        if (!card.name || !card.set || !card.cn) {
          throw new Error(`Card entry missing name/set/cn: ${JSON.stringify(card).slice(0, 120)}`);
        }
        return `${entry.quantity ?? 1} ${card.name} (${card.set.toUpperCase()}) ${card.cn}`;
      });
      lines.sort((a, b) => a.localeCompare(b));
      return lines.join('\n') + '\n';
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Moxfield fetch failed');
}

/** Sync cubes/<id>.txt from Moxfield per cubes/sources.json; returns per-id metadata. */
async function syncSources() {
  const sourcesPath = join(CUBES_DIR, 'sources.json');
  if (!existsSync(sourcesPath)) return {};
  const sources = JSON.parse(readFileSync(sourcesPath, 'utf8'));
  const meta = {};
  for (const source of sources) {
    meta[source.id] = {
      name: source.name ?? source.id,
      description: source.description ?? '',
      modes: Array.isArray(source.modes) && source.modes.length > 0 ? source.modes : ['3cb'],
    };
    if (!source.moxfield) continue;
    const txtPath = join(CUBES_DIR, `${source.id}.txt`);
    try {
      const text = await fetchMoxfieldList(source.moxfield);
      writeFileSync(txtPath, text);
      console.log(`Synced "${source.id}" from Moxfield (${text.trim().split('\n').length} cards)`);
    } catch (err) {
      if (existsSync(txtPath)) {
        console.warn(
          `WARNING: Moxfield sync failed for "${source.id}" (${err.message}); using last synced ${source.id}.txt`
        );
      } else {
        throw new Error(
          `Moxfield sync failed for "${source.id}" and no cached ${source.id}.txt exists: ${err.message}`
        );
      }
    }
  }
  return meta;
}

function pickImages(card) {
  if (card.image_uris && card.image_uris.normal) {
    return { front: card.image_uris.normal, back: null };
  }
  const faces = card.card_faces || [];
  const front = faces[0] && faces[0].image_uris && faces[0].image_uris.normal;
  const back = faces[1] && faces[1].image_uris && faces[1].image_uris.normal;
  if (!front) throw new Error(`No image for ${card.name}`);
  return { front, back: back || null };
}

async function download(url, filePath) {
  if (existsSync(filePath)) return false;
  // Scryfall's image CDN 400s requests without a User-Agent.
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Image download ${res.status} for ${url}`);
  writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function resolveCard(card) {
  const { front, back } = pickImages(card);
  const frontFile = `${card.id}.jpg`;
  await download(front, join(OUT_CARDS, frontFile));
  let backImagePath;
  if (back) {
    const backFile = `${card.id}-back.jpg`;
    await download(back, join(OUT_CARDS, backFile));
    backImagePath = `cards/${backFile}`;
  }
  const faces = card.card_faces || [];
  const entry = {
    scryfallId: card.id,
    name: card.name,
    imagePath: `cards/${frontFile}`,
    manaCost: card.mana_cost ?? faces.map((f) => f.mana_cost).filter(Boolean).join(' // '),
    typeLine: card.type_line ?? faces.map((f) => f.type_line).filter(Boolean).join(' // '),
    cmc: card.cmc ?? 0,
    colorIdentity: card.color_identity ?? [],
  };
  if (backImagePath) entry.backImagePath = backImagePath;
  return entry;
}

function parseLine(line, lineNo, file) {
  const m = line.match(/^(\d+)\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+)\s*$/);
  if (!m) throw new Error(`${file}:${lineNo}: unparseable line: "${line}"`);
  return { count: Number(m[1]), name: m[2], set: m[3].toLowerCase(), number: m[4] };
}

async function main() {
  mkdirSync(OUT_CARDS, { recursive: true });
  mkdirSync(OUT_CUBES, { recursive: true });

  const sourceMeta = await syncSources();

  const cubeFiles = readdirSync(CUBES_DIR).filter((f) => f.endsWith('.txt'));
  if (cubeFiles.length === 0) {
    console.error('No cube lists found in cubes/');
    process.exit(1);
  }

  console.log('Resolving basic lands...');
  const basics = [];
  for (const name of BASIC_NAMES) {
    const card = await scryfall(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
    basics.push(await resolveCard(card));
    console.log(`  ${name} ok`);
  }

  const index = [];
  const failures = [];

  for (const file of cubeFiles) {
    const id = basename(file, '.txt');
    const meta = sourceMeta[id] ?? { name: id, description: '', modes: ['3cb'] };
    const lines = readFileSync(join(CUBES_DIR, file), 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    console.log(`\nCube "${id}": ${lines.length} lines`);
    const cards = [];
    for (let i = 0; i < lines.length; i++) {
      const { count, name, set, number } = parseLine(lines[i], i + 1, file);
      try {
        const card = await scryfall(
          `https://api.scryfall.com/cards/${set}/${encodeURIComponent(number)}`
        );
        const entry = await resolveCard(card);
        for (let c = 0; c < count; c++) cards.push(entry);
        console.log(`  [${i + 1}/${lines.length}] ${card.name}`);
      } catch (err) {
        failures.push(`${file}:${i + 1} ${name} (${set}) ${number} -> ${err.message}`);
        console.error(`  [${i + 1}/${lines.length}] FAILED ${name}: ${err.message}`);
      }
    }

    const cube = {
      id,
      name: meta.name,
      description: meta.description,
      modes: meta.modes,
      basics,
      cards,
    };
    writeFileSync(join(OUT_CUBES, `${id}.json`), JSON.stringify(cube, null, 2));
    index.push({
      id,
      name: meta.name,
      description: meta.description,
      modes: meta.modes,
      cardCount: cards.length,
    });
  }

  writeFileSync(join(OUT_CUBES, 'index.json'), JSON.stringify(index, null, 2));

  if (failures.length > 0) {
    console.error(`\nBUILD FAILED — ${failures.length} unresolved card(s):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`\nDone. ${index.map((c) => `${c.id}: ${c.cardCount} cards`).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
