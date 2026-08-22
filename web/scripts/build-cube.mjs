// Build-time cube pipeline: syncs cube lists from Moxfield (per cubes/sources.json),
// caching each as a plaintext export in cubes/<id>.txt, resolves every card via
// the Scryfall API, downloads card images into public/cards/, and emits cube
// JSON + an index into public/cubes/. Runtime never touches any API.
//
// Usage: node scripts/build-cube.mjs [--refresh]   (requires Node 18+, network access)
// - Card data is cached in cubes/card-cache.json keyed by set/collector number,
//   so an unchanged card costs no API call, and a card whose image is already on
//   disk costs no network at all. --refresh ignores the cache and re-resolves
//   everything (use if Scryfall corrected a card's data).
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
const CACHE_PATH = join(CUBES_DIR, 'card-cache.json');
const REFRESH = process.argv.includes('--refresh');

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

function loadCache() {
  if (REFRESH || !existsSync(CACHE_PATH)) return { version: 1, cards: {}, basics: {} };
  try {
    const parsed = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (parsed && parsed.version === 1 && parsed.cards && parsed.basics) return parsed;
  } catch {
    // fall through to a fresh cache
  }
  console.warn('WARNING: card-cache.json unreadable; rebuilding it from Scryfall.');
  return { version: 1, cards: {}, basics: {} };
}

function saveCache(cache) {
  const sortKeys = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  const out = { version: 1, cards: sortKeys(cache.cards), basics: sortKeys(cache.basics) };
  writeFileSync(CACHE_PATH, JSON.stringify(out, null, 2) + '\n');
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

/** Scryfall card object -> cache entry: everything the app needs, plus the image URLs. */
function toEntry(card) {
  const { front, back } = pickImages(card);
  const faces = card.card_faces || [];
  return {
    scryfallId: card.id,
    name: card.name,
    manaCost: card.mana_cost ?? faces.map((f) => f.mana_cost).filter(Boolean).join(' // '),
    typeLine: card.type_line ?? faces.map((f) => f.type_line).filter(Boolean).join(' // '),
    cmc: card.cmc ?? 0,
    colorIdentity: card.color_identity ?? [],
    frontUrl: front,
    backUrl: back,
  };
}

async function download(url, filePath) {
  if (existsSync(filePath)) return false;
  // Scryfall's image CDN 400s requests without a User-Agent.
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Image download ${res.status} for ${url}`);
  writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
  return true;
}

/** Make sure the entry's image file(s) exist on disk; returns how many were downloaded. */
async function ensureImages(entry) {
  let downloaded = 0;
  if (await download(entry.frontUrl, join(OUT_CARDS, `${entry.scryfallId}.jpg`))) downloaded++;
  if (entry.backUrl && (await download(entry.backUrl, join(OUT_CARDS, `${entry.scryfallId}-back.jpg`)))) {
    downloaded++;
  }
  return downloaded;
}

/** Cache entry -> the card object emitted into the cube JSON. */
function toCardJson(entry) {
  const out = {
    scryfallId: entry.scryfallId,
    name: entry.name,
    imagePath: `cards/${entry.scryfallId}.jpg`,
    manaCost: entry.manaCost,
    typeLine: entry.typeLine,
    cmc: entry.cmc,
    colorIdentity: entry.colorIdentity,
  };
  if (entry.backUrl) out.backImagePath = `cards/${entry.scryfallId}-back.jpg`;
  return out;
}

/**
 * Resolve one card through the cache: no network for a cached card whose image
 * is on disk; an image download only when the file is missing; a Scryfall lookup
 * only for an uncached printing (or when a cached image URL has gone stale).
 * Returns { entry, status } with status 'cached' | 'image' | 'resolved'.
 */
async function resolveCached(bucket, key, fetchCard) {
  let entry = bucket[key];
  let status = 'cached';
  if (!entry) {
    entry = toEntry(await fetchCard());
    bucket[key] = entry;
    status = 'resolved';
  }
  try {
    if ((await ensureImages(entry)) > 0 && status === 'cached') status = 'image';
  } catch (err) {
    if (status === 'resolved') throw err;
    // Stale cached image URL: re-resolve once from Scryfall and retry the download.
    entry = toEntry(await fetchCard());
    bucket[key] = entry;
    await ensureImages(entry);
    status = 'resolved';
  }
  return { entry, status };
}

function parseLine(line, lineNo, file) {
  const m = line.match(/^(\d+)\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+(\S+)\s*$/);
  if (!m) throw new Error(`${file}:${lineNo}: unparseable line: "${line}"`);
  return { count: Number(m[1]), name: m[2], set: m[3].toLowerCase(), number: m[4] };
}

async function main() {
  mkdirSync(OUT_CARDS, { recursive: true });
  mkdirSync(OUT_CUBES, { recursive: true });

  const cache = loadCache();
  const cacheSnapshot = JSON.stringify(cache);
  const sourceMeta = await syncSources();

  const cubeFiles = readdirSync(CUBES_DIR).filter((f) => f.endsWith('.txt'));
  if (cubeFiles.length === 0) {
    console.error('No cube lists found in cubes/');
    process.exit(1);
  }

  console.log('Resolving basic lands...');
  const basics = [];
  for (const name of BASIC_NAMES) {
    const { entry, status } = await resolveCached(cache.basics, name, () =>
      scryfall(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`)
    );
    basics.push(toCardJson(entry));
    if (status !== 'cached') console.log(`  ${name} (${status})`);
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
    const counts = { cached: 0, image: 0, resolved: 0 };
    for (let i = 0; i < lines.length; i++) {
      const { count, name, set, number } = parseLine(lines[i], i + 1, file);
      const key = `${set}/${number}`;
      try {
        const { entry, status } = await resolveCached(cache.cards, key, () =>
          scryfall(`https://api.scryfall.com/cards/${set}/${encodeURIComponent(number)}`)
        );
        counts[status]++;
        if (status !== 'cached') console.log(`  [${i + 1}/${lines.length}] ${entry.name} (${status})`);
        const json = toCardJson(entry);
        for (let c = 0; c < count; c++) cards.push(json);
      } catch (err) {
        failures.push(`${file}:${i + 1} ${name} (${set}) ${number} -> ${err.message}`);
        console.error(`  [${i + 1}/${lines.length}] FAILED ${name}: ${err.message}`);
      }
    }
    console.log(
      `  ${counts.cached} cached, ${counts.image} image download(s), ${counts.resolved} resolved via Scryfall`
    );

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
  if (JSON.stringify(cache) !== cacheSnapshot) saveCache(cache);

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
