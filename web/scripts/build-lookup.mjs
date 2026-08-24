// Build-time Real 3CB quick-lookup pipeline: validates every configured card
// name against the built Vintage-legal catalogue and copies the menu into the
// public app assets. This pipeline is fully offline and never fetches the
// network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LOOKUP_PATH = join(ROOT, '..', 'lookup', 'land-cycles.json');
const CATALOGUE_PATH = join(ROOT, 'public', 'catalogue', 'cards.json.gz');
const OUT_PATH = join(ROOT, 'public', 'lookup', 'land-cycles.json');

if (!existsSync(CATALOGUE_PATH)) {
  console.error('lookup: catalogue not found; run npm run catalogue first');
  process.exit(1);
}

const data = JSON.parse(readFileSync(LOOKUP_PATH, 'utf8'));
const catalogue = JSON.parse(gunzipSync(readFileSync(CATALOGUE_PATH)).toString('utf8'));
const catalogueNames = new Set(catalogue.rows.map((row) => row[0]));
const problems = [];
const seenIds = new Set();
const cycles = Array.isArray(data.cycles) ? data.cycles : [];

if (!Array.isArray(data.cycles) || data.cycles.length === 0) {
  problems.push('lookup: file: "cycles" must be a non-empty array');
}

for (const cycle of cycles) {
  const cycleId = typeof cycle?.id === 'string' && cycle.id ? cycle.id : '<unknown>';
  if (typeof cycle?.id !== 'string' || !cycle.id) {
    problems.push(`lookup: ${cycleId}: missing non-empty "id"`);
  } else if (seenIds.has(cycle.id)) {
    problems.push(`lookup: ${cycle.id}: duplicate cycle id`);
  } else {
    seenIds.add(cycle.id);
  }
  if (typeof cycle?.name !== 'string' || !cycle.name) {
    problems.push(`lookup: ${cycleId}: missing non-empty "name"`);
  }
  if (!Array.isArray(cycle?.cards) || cycle.cards.length === 0) {
    problems.push(`lookup: ${cycleId}: missing non-empty "cards" array`);
    continue;
  }
  for (const cardName of cycle.cards) {
    if (!catalogueNames.has(cardName)) {
      problems.push(`lookup: ${cycleId}: "${cardName}" is not a Vintage-legal card name`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(data, null, 2) + '\n');
const cardCount = cycles.reduce((total, cycle) => total + cycle.cards.length, 0);
console.log(`lookup: ${cycles.length} cycles, ${cardCount} cards, all resolved`);
