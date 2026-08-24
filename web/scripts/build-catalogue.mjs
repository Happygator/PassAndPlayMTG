// Build-time Real 3CB catalogue pipeline: downloads Scryfall's Oracle bulk
// file, keeps only Vintage-legal cards and only the fields 3CB needs, and emits
// a gzipped catalogue the app decompresses at runtime with
// DecompressionStream('gzip').

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip, gzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT_CARDS = join(ROOT, 'public', 'catalogue', 'cards.json.gz');
const OUT_META = join(ROOT, 'public', 'catalogue', 'meta.json');

const HEADERS = {
  'User-Agent': 'PassAndPlayMTG/0.1 (kitchen-table MTG sealed app)',
  Accept: 'application/json',
};

class FetchError extends Error {}

async function download(url) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (err) {
    throw new FetchError(`${err.message} for ${url}`);
  }
  if (!res.ok) throw new FetchError(`Scryfall ${res.status} for ${url}`);
  return res;
}

function cardRow(card) {
  const faces = card.card_faces;
  const manaCost = faces
    ? faces.map((face) => face.mana_cost).filter(Boolean).join(' // ')
    : (card.mana_cost ?? '');
  const typeLine = faces
    ? faces.map((face) => face.type_line).filter(Boolean).join(' // ')
    : (card.type_line ?? '');
  const oracleText = faces
    ? faces.map((face) => face.oracle_text).filter(Boolean).join('\n//\n')
    : (card.oracle_text ?? '');
  const pt = faces
    ? faces
        .map((face) => (face.power !== undefined && face.toughness !== undefined ? `${face.power}/${face.toughness}` : undefined))
        .filter((v) => v !== undefined)
        .join(' // ')
    : (card.power !== undefined && card.toughness !== undefined ? `${card.power}/${card.toughness}` : '');
  return [
    card.name,
    manaCost,
    typeLine,
    oracleText,
    card.id,
    card.cmc ?? 0,
    (card.color_identity ?? []).join(''),
    pt,
  ];
}

function useCache(err) {
  if (!(err instanceof FetchError)) return false;
  console.warn(`warn: ${err.message}`);
  if (!existsSync(OUT_CARDS)) {
    process.exitCode = 1;
    return true;
  }
  return true;
}

async function main() {
  let bulk;
  let response;
  try {
    const indexResponse = await download('https://api.scryfall.com/bulk-data');
    let index;
    try {
      index = await indexResponse.json();
    } catch (err) {
      throw new FetchError(`Scryfall bulk-data response failed: ${err.message}`);
    }
    bulk = index.data?.find((entry) => entry.type === 'oracle_cards');
    if (!bulk?.jsonl_download_uri) throw new Error('Scryfall Oracle bulk entry not found');
    response = await download(bulk.jsonl_download_uri);
  } catch (err) {
    if (useCache(err)) return;
    throw err;
  }

  if (!response.body) {
    const err = new FetchError('Scryfall Oracle bulk response has no body');
    if (useCache(err)) return;
    throw err;
  }
  const input = Readable.fromWeb(response.body).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const rows = [];
  try {
    for await (const line of lines) {
      if (!line) continue;
      const card = JSON.parse(line);
      // Scryfall marks Power-9-class cards 'restricted' rather than 'legal' in
      // Vintage; those are still legal to play (capped at one copy), so both
      // statuses belong in a Vintage-legal catalogue.
      const vintageLegality = card.legalities?.vintage;
      if (vintageLegality === 'legal' || vintageLegality === 'restricted') rows.push(cardRow(card));
    }
  } catch (err) {
    if (!(err instanceof SyntaxError)) {
      const fetchError = new FetchError(err.message);
      if (useCache(fetchError)) return;
    }
    if (useCache(err)) return;
    throw err;
  }

  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const fields = [
    'name',
    'manaCost',
    'typeLine',
    'oracleText',
    'scryfallId',
    'cmc',
    'colorIdentity',
    'pt',
  ];
  const compressed = gzipSync(JSON.stringify({ version: 2, rows }), { level: 9 });
  const meta = {
    version: 2,
    count: rows.length,
    oracleUpdatedAt: bulk.updated_at,
    builtAt: new Date().toISOString(),
    fields,
  };
  mkdirSync(dirname(OUT_CARDS), { recursive: true });
  writeFileSync(OUT_CARDS, compressed);
  writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + '\n');
  console.log(
    `catalogue: ${rows.length} vintage-legal cards, ${(compressed.length / 1024 / 1024).toFixed(1)} MB gzipped`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
