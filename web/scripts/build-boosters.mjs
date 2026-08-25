// Build-time booster pipeline: turns MTGJSON per-set booster configurations into
// the compact per-set data the app uses to open a real booster pack at runtime.
//
// Usage:
//   node scripts/build-boosters.mjs                    emit public/boosters/ from the tracked cache (no network)
//   node scripts/build-boosters.mjs --sync             refresh the tracked cache from MTGJSON, then emit
//   node scripts/build-boosters.mjs --sync --refresh   ignore the download cache and re-fetch every set
//
// The tracked cache at <repo>/boosters/ is the source of truth, exactly like
// cubes/*.txt and banlists/3cb-official.json: a set's collation only changes when
// a new set is printed, so a deploy must never depend on MTGJSON being reachable.
// --sync is a manual, occasional command; it downloads ~190 set files into
// web/.mtgjson-cache/, which is gitignored and safe to delete.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// Booster source data lives at the REPO root next to cubes/ and banlists/;
// ROOT here is the web/ project folder.
const BOOSTERS_DIR = join(ROOT, '..', 'boosters');
const CACHE_DIR = join(ROOT, '.mtgjson-cache');
const OUT_DIR = join(ROOT, 'public', 'boosters');

const SYNC = process.argv.includes('--sync');
const REFRESH = process.argv.includes('--refresh');

const API = 'https://mtgjson.com/api/v5';
const HEADERS = {
  'User-Agent': 'PassAndPlayMTG/0.1 (kitchen-table MTG sealed app)',
  Accept: 'application/json',
};

// Booster keys in preference order. `play` is the 14-card Play Booster (Murders
// at Karlov Manor, February 2024, onward); `draft` is the 15-card Draft Booster
// every set from Tempest to March of the Machine sold; `default` is the plain
// booster the earliest sets had, before the booster type split. Every other key
// MTGJSON carries — set, collector, arena, theme-*, prerelease*, jumpstart,
// tournament, starter, fat-pack, six, box-topper — is a different product.
const BOOSTER_KEYS = ['play', 'draft', 'default'];

const SET_TYPES = new Set(['core', 'expansion', 'draft_innovation', 'masters', 'starter']);

// A pack has to fill four 3-card decks. Arabian Nights' 8-card booster cannot,
// so anything smaller is left out of the picker entirely (user ruling 2026-08-24).
const MIN_PACK_SIZE = 12;

// Layouts whose second face has its own image on Scryfall. Split, adventure and
// flip cards print both halves on ONE face, so they are deliberately absent.
const TWO_FACED = new Set(['transform', 'modal_dfc', 'reversible_card']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`MTGJSON ${res.status} for ${url}`);
  return res.json();
}

/**
 * The MTGJSON set file for `code`, from web/.mtgjson-cache/ when it is already
 * there. Cached by set code, so a shared source set (PLST alone is 3.7 MB) is
 * downloaded once however many boosters reference it.
 */
async function loadSetFile(code) {
  const path = join(CACHE_DIR, `${code}.json.gz`);
  if (REFRESH && existsSync(path)) rmSync(path);
  if (!existsSync(path)) {
    const res = await fetch(`${API}/${code}.json.gz`, { headers: HEADERS });
    if (!res.ok) throw new Error(`MTGJSON ${res.status} for ${code}.json.gz`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
    await sleep(80);
  }
  try {
    return JSON.parse(gunzipSync(readFileSync(path))).data;
  } catch (err) {
    // A truncated download poisons the cache for every later run; drop it so
    // re-running the command is enough to recover.
    rmSync(path, { force: true });
    throw new Error(`Unreadable cache file for ${code} (removed, re-run to retry): ${err.message}`);
  }
}

/**
 * One card as the fields CardData needs plus a back-face flag, in a fixed tuple:
 * [name, manaCost, typeLine, cmc, colorIdentity, scryfallId, hasBack].
 *
 * MTGJSON stores each face of a double-faced card as its own entry sharing one
 * Scryfall id, and booster sheets only ever reference the front. `card.name` is
 * already "Front // Back", so only the cost and type line have to be rejoined
 * from the other face to match the shape build-cube.mjs emits.
 */
function compactCard(card, byUuid) {
  const faces = [card];
  if (card.side === 'a' && TWO_FACED.has(card.layout)) {
    for (const otherId of card.otherFaceIds ?? []) {
      const face = byUuid.get(otherId);
      if (face) faces.push(face);
    }
  }
  return [
    card.name,
    faces.map((f) => f.manaCost).filter(Boolean).join(' // '),
    faces.map((f) => f.type).filter(Boolean).join(' // '),
    card.manaValue ?? 0,
    (card.colorIdentity ?? []).join(''),
    card.identifiers.scryfallId,
    faces.length > 1 ? 1 : 0,
  ];
}

/**
 * Where a sheet's cards sit when a pack is laid out on the table: commons
 * first, then uncommons, rares, the land slot, any mixed guaranteed slot
 * (wildcards), the foil, and last the bonus slot a set may add.
 *
 * Derived from the CARDS, never from the sheet's name. MTGJSON uses 172
 * distinct sheet names across these sets and many of them — "black",
 * "legendaryTurtle", "sourceMaterial", "tsts" — carry no rarity signal at all,
 * so a name-matching classifier would be guesswork that fails silently.
 */
const SLOT = {
  common: 0,
  uncommon: 1,
  rare: 2,
  land: 3,
  mixed: 4,
  foil: 5,
  bonus: 6,
};

/** A rarity has to hold this share of a sheet for the sheet to count as that slot. */
const SLOT_MAJORITY = 0.6;

function sheetRank(sheet, byUuid, ownSetCode) {
  const cards = Object.keys(sheet.cards)
    .map((uuid) => byUuid.get(uuid))
    .filter(Boolean);
  if (cards.length === 0) return SLOT.mixed;
  // Drawn wholly from another set: The List, Special Guests, Masterpieces,
  // Expeditions, Multiverse Legends, Mystical Archive — the bonus slot.
  if (cards.every((card) => card.setCode !== ownSetCode)) return SLOT.bonus;
  // Checked before foil so a set whose land slot comes foil (foilBasic,
  // foilLand) still reads as the land, which is what it is.
  if (cards.every((card) => (card.types ?? []).includes('Land'))) return SLOT.land;
  if (sheet.foil) return SLOT.foil;
  const counts = {};
  for (const card of cards) counts[card.rarity] = (counts[card.rarity] ?? 0) + 1;
  const threshold = cards.length * SLOT_MAJORITY;
  if ((counts.common ?? 0) >= threshold) return SLOT.common;
  if ((counts.uncommon ?? 0) >= threshold) return SLOT.uncommon;
  if ((counts.rare ?? 0) + (counts.mythic ?? 0) >= threshold) return SLOT.rare;
  return SLOT.mixed;
}

/**
 * MTGJSON's booster config, rewritten so every sheet references cards by index
 * into one deduplicated card list. Throws if a sheet names a card no loaded set
 * supplies — silently dropping it would quietly change the pack's odds.
 */
function compactSet(meta, data, key, config, byUuid, packSize) {
  const used = [...new Set(Object.values(config.sheets).flatMap((sheet) => Object.keys(sheet.cards)))];
  const cardIndex = new Map();
  const cards = [];
  const missing = [];
  for (const uuid of used) {
    const card = byUuid.get(uuid);
    if (!card || !card.identifiers || !card.identifiers.scryfallId) {
      missing.push(uuid);
      continue;
    }
    cardIndex.set(uuid, cards.length);
    cards.push(compactCard(card, byUuid));
  }
  if (missing.length > 0) {
    const sources = [data.code, ...(config.sourceSetCodes ?? []).filter((c) => c !== data.code)];
    throw new Error(`${missing.length} sheet card(s) unresolved across ${sources.join(', ')}`);
  }
  const sheets = {};
  for (const [name, sheet] of Object.entries(config.sheets)) {
    const entries = Object.entries(sheet.cards).map(([uuid, weight]) => [cardIndex.get(uuid), weight]);
    sheets[name] = {
      t: entries.reduce((sum, [, weight]) => sum + weight, 0),
      r: sheetRank(sheet, byUuid, data.code),
      c: entries,
    };
  }
  return {
    code: data.code,
    name: data.name ?? meta.name,
    released: data.releaseDate ?? meta.releaseDate,
    boosterType: key,
    packSize,
    totalWeight: config.boostersTotalWeight,
    boosters: config.boosters.map((b) => ({ w: b.weight, c: b.contents })),
    sheets,
    cards,
  };
}

async function sync() {
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(BOOSTERS_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const setList = (await fetchJson(`${API}/SetList.json`)).data;
  const candidates = setList
    .filter(
      (set) =>
        !set.isOnlineOnly &&
        SET_TYPES.has(set.type) &&
        typeof set.releaseDate === 'string' &&
        set.releaseDate <= today
    )
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.code.localeCompare(b.code));
  console.log(`${candidates.length} candidate set(s) from SetList.json`);

  const sets = [];
  const skipped = [];
  const failures = [];
  for (let i = 0; i < candidates.length; i++) {
    const meta = candidates[i];
    try {
      const data = await loadSetFile(meta.code);
      const key = BOOSTER_KEYS.find((k) => data.booster && data.booster[k]);
      if (!key) {
        skipped.push(`${meta.code}: no play/draft/default booster`);
        continue;
      }
      const config = data.booster[key];
      const sizes = [
        ...new Set(
          config.boosters.map((booster) =>
            Object.values(booster.contents).reduce((sum, count) => sum + count, 0)
          )
        ),
      ];
      const packSize = Math.min(...sizes);
      if (packSize < MIN_PACK_SIZE) {
        skipped.push(`${meta.code}: ${key} pack is ${sizes.join('/')} cards`);
        continue;
      }
      // A real booster never takes more cards from a sheet than that sheet has
      // distinct cards — commons, rares and lands all come off sheets far deeper
      // than their slot count. A product that does is a preconstructed deck
      // wearing a booster's clothes: Ravnica: Clue Edition's is one guild's 16
      // cards drawn 20 times, and MTGJSON has nowhere else to file it.
      const tooThin = config.boosters.some((booster) =>
        Object.entries(booster.contents).some(
          ([sheetName, count]) =>
            Object.keys(config.sheets[sheetName]?.cards ?? {}).length < count
        )
      );
      if (tooThin) {
        skipped.push(`${meta.code}: ${key} draws more cards from a sheet than the sheet holds`);
        continue;
      }
      // Sheets can reference cards printed in OTHER sets — The List and Special
      // Guests in a Play Booster, Masterpieces and Expeditions in older Draft
      // Boosters — so every set named in sourceSetCodes has to be loaded too.
      const byUuid = new Map(data.cards.map((card) => [card.uuid, card]));
      for (const source of config.sourceSetCodes ?? []) {
        if (source === data.code) continue;
        const extra = await loadSetFile(source);
        for (const card of extra.cards) if (!byUuid.has(card.uuid)) byUuid.set(card.uuid, card);
      }
      const compact = compactSet(meta, data, key, config, byUuid, packSize);
      writeFileSync(join(BOOSTERS_DIR, `${compact.code}.json`), JSON.stringify(compact) + '\n');
      sets.push({
        code: compact.code,
        name: compact.name,
        released: compact.released,
        boosterType: compact.boosterType,
        packSize: compact.packSize,
      });
      console.log(
        `  [${i + 1}/${candidates.length}] ${compact.code} ${compact.boosterType} ${compact.packSize} cards, ${compact.cards.length} distinct`
      );
    } catch (err) {
      failures.push(`${meta.code}: ${err.message}`);
      console.error(`  [${i + 1}/${candidates.length}] FAILED ${meta.code}: ${err.message}`);
    }
  }

  const index = {
    version: 2,
    builtAt: new Date().toISOString().slice(0, 10),
    sets,
  };
  writeFileSync(join(BOOSTERS_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');

  // Drop per-set files for sets that are no longer in the index, so a set that
  // loses its booster config does not linger as an unreferenced 35 KB file.
  const keep = new Set(sets.map((set) => `${set.code}.json`));
  for (const file of readdirSync(BOOSTERS_DIR)) {
    if (file === 'index.json' || !file.endsWith('.json') || keep.has(file)) continue;
    rmSync(join(BOOSTERS_DIR, file));
    console.log(`  removed stale ${file}`);
  }

  console.log(`\nSynced ${sets.length} booster set(s); ${skipped.length} skipped.`);
  for (const line of skipped) console.log(`  skipped ${line}`);
  if (failures.length > 0) {
    console.error(`\nSYNC FAILED — ${failures.length} set(s) could not be built:`);
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
}

/**
 * Copy the tracked cache into public/boosters/, gzipping each set.
 *
 * The `.json.gz` extension is load-bearing: the Workbox precache glob in
 * vite.config.ts lists `json` but not `gz`, so these stay OUT of the precache
 * and are fetched only when a booster game actually starts — the same trick
 * public/catalogue/cards.json.gz uses. index.json is plain, so the picker still
 * lists every set offline.
 */
function emit() {
  const indexPath = join(BOOSTERS_DIR, 'index.json');
  if (!existsSync(indexPath)) {
    console.error('No booster data in boosters/ — run: npm run boosters:sync');
    process.exit(1);
  }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  let bytes = 0;
  for (const set of index.sets) {
    const source = join(BOOSTERS_DIR, `${set.code}.json`);
    if (!existsSync(source)) {
      console.error(`boosters/index.json lists ${set.code}, but boosters/${set.code}.json is missing — run: npm run boosters:sync`);
      process.exit(1);
    }
    const gz = gzipSync(readFileSync(source), { level: 9 });
    writeFileSync(join(OUT_DIR, `${set.code}.json.gz`), gz);
    bytes += gz.length;
  }
  writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(index) + '\n');
  console.log(
    `Emitted ${index.sets.length} booster set(s) (${(bytes / 1024 / 1024).toFixed(2)} MB gzipped) to public/boosters/`
  );
}

async function main() {
  if (SYNC) await sync();
  emit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
