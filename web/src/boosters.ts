import { cardBackImageUrl, cardImageUrl } from './catalogue';
import { sortPool } from './game';
import type { PoolSort } from './game';
import type { CardData } from './types';

/**
 * Which product a set's pack data describes. `play` is the 14-card Play Booster
 * (Murders at Karlov Manor, February 2024, onward), `draft` the 15-card Draft
 * Booster of the Tempest-to-March-of-the-Machine era, `default` the plain
 * booster the earliest sets sold before the booster type split.
 */
export type BoosterType = 'play' | 'draft' | 'default';

export interface BoosterSetSummary {
  code: string;
  name: string;
  /** ISO release date, e.g. "2024-02-09"; the picker orders on it. */
  released: string;
  boosterType: BoosterType;
  /** Cards in one pack. Never below 12 — smaller packs cannot fill four decks. */
  packSize: number;
}

export interface BoosterIndex {
  version: number;
  builtAt: string;
  sets: BoosterSetSummary[];
}

/**
 * One print sheet: `c` is [card index, weight] pairs, `t` their summed weight,
 * and `r` the slot this sheet fills when the pack is laid out — 0 commons,
 * 1 uncommons, 2 rares, 3 the land, 4 a mixed guaranteed slot (wildcards),
 * 5 the foil, 6 a bonus card (The List, Special Guests, Masterpieces).
 * build-boosters.mjs derives it from the cards, not from the sheet's name.
 */
interface BoosterSheet {
  t: number;
  r: number;
  c: [number, number][];
}

/** One pack variant: `w` its weight among the variants, `c` cards taken per sheet. */
interface BoosterVariant {
  w: number;
  c: Record<string, number>;
}

/** [name, manaCost, typeLine, cmc, colorIdentity, scryfallId, hasBack] — the field order build-boosters.mjs emits. */
type BoosterCardRow = [string, string, string, number, string, string, number];

export interface BoosterSet extends BoosterSetSummary {
  totalWeight: number;
  boosters: BoosterVariant[];
  sheets: Record<string, BoosterSheet>;
  cards: BoosterCardRow[];
}

/**
 * Cube-selector value marking a booster pack rather than a cube, and the prefix
 * of the synthetic `cubeId` a booster game runs under. A sentinel rather than a
 * separate mode because a booster IS the pool source, exactly like a cube.
 */
export const BOOSTER_CUBE_PREFIX = 'booster:';

export const boosterCubeId = (setCode: string): string => `${BOOSTER_CUBE_PREFIX}${setCode}`;

export const isBoosterCubeId = (cubeId: string): boolean => cubeId.startsWith(BOOSTER_CUBE_PREFIX);

/** The set code inside a `booster:<code>` id, or '' if it is not one. */
export const boosterSetCodeOf = (cubeId: string): string =>
  isBoosterCubeId(cubeId) ? cubeId.slice(BOOSTER_CUBE_PREFIX.length) : '';

/** Human label for a booster era, used to group the set picker. */
export function boosterTypeLabel(type: BoosterType): string {
  if (type === 'play') return 'Play Boosters';
  if (type === 'draft') return 'Draft Boosters';
  return 'Original boosters';
}

let indexPromise: Promise<BoosterIndex> | null = null;
const setPromises = new Map<string, Promise<BoosterSet>>();

/**
 * Read a response that may or may not still be gzipped. Some hosts (GitHub
 * Pages) serve a .gz as an opaque binary with no Content-Encoding, so the bytes
 * on the wire are still compressed; others (the Vite dev server) set
 * Content-Encoding and the browser has already decompressed the body. No header
 * distinguishes the two, so sniff the gzip magic number — the same approach
 * catalogue.ts takes for cards.json.gz.
 */
async function readMaybeGzipped<T>(response: Response): Promise<T> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
    return (await new Response(stream).json()) as T;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function fetchBoosterIndex(): Promise<BoosterIndex> {
  const response = await fetch('./boosters/index.json');
  if (!response.ok) {
    throw new Error(`Could not load the booster set list (status ${response.status}).`);
  }
  const index = (await response.json()) as BoosterIndex;
  if (index.version !== 2) {
    throw new Error('Booster data is out of date — run: npm run boosters');
  }
  return index;
}

/** Memoised: repeated calls share one fetch. Small enough to precache, so the picker works offline. */
export function loadBoosterIndex(): Promise<BoosterIndex> {
  if (!indexPromise) {
    indexPromise = fetchBoosterIndex().catch((err) => {
      indexPromise = null;
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return indexPromise;
}

async function fetchBoosterSet(setCode: string): Promise<BoosterSet> {
  const response = await fetch(`./boosters/${setCode}.json.gz`);
  if (!response.ok) {
    throw new Error(`Could not load the ${setCode} booster data (status ${response.status}).`);
  }
  return readMaybeGzipped<BoosterSet>(response);
}

/** Memoised per set: opening a second pack from the same set costs no second fetch. */
export function loadBoosterSet(setCode: string): Promise<BoosterSet> {
  const existing = setPromises.get(setCode);
  if (existing) return existing;
  const promise = fetchBoosterSet(setCode).catch((err) => {
    setPromises.delete(setCode);
    throw err instanceof Error ? err : new Error(String(err));
  });
  setPromises.set(setCode, promise);
  return promise;
}

/**
 * Uniform integer in [0, max), from crypto randomness — opening a pack is the
 * one moment the app decides what a player gets, so it uses the same randomness
 * the shuffle does.
 *
 * Two paths, because MTGJSON sheet weights are not small numbers: six sets sum
 * past 2³² (Final Fantasy's wildcard sheet reaches 1.8 × 10¹⁴), and there a
 * single 32-bit draw cannot reach every value at all — the rejection window
 * would be empty and the loop would never end. Below 2³², reject out-of-range
 * draws so the result is exactly uniform; at or above it, take 53 bits and
 * scale, which is uniform to within a rounding error far below one weight unit.
 */
function randomBelow(max: number): number {
  if (!Number.isFinite(max) || max <= 1) return 0;
  const buffer = new Uint32Array(2);
  if (max >= 0x100000000) {
    crypto.getRandomValues(buffer);
    const unit = ((buffer[0] >>> 5) * 0x4000000 + (buffer[1] >>> 6)) / 0x20000000000000;
    return Math.min(max - 1, Math.floor(unit * max));
  }
  const limit = Math.floor(0xffffffff / max) * max;
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  }
  return value % max;
}

/** Weighted pick over [index, weight] pairs summing to `totalWeight`. */
function pickWeighted(entries: readonly [number, number][], totalWeight: number): number {
  let roll = randomBelow(totalWeight);
  for (const [index, weight] of entries) {
    roll -= weight;
    if (roll < 0) return index;
  }
  return entries[entries.length - 1][0];
}

/**
 * `count` DISTINCT cards from one sheet, weighted. Distinct because a real pack
 * never contains the same common twice from the same sheet; cards repeated
 * across DIFFERENT sheets are left alone, since a pack's foil genuinely can
 * duplicate one of its own non-foils.
 */
function drawFromSheet(sheet: BoosterSheet, count: number): number[] {
  const wanted = Math.min(count, sheet.c.length);
  const taken = new Set<number>();
  const picked: number[] = [];
  // Bounded: a sheet whose weight is concentrated in a few cards would
  // otherwise reject for a long time before finding the rare ones.
  const attempts = wanted * 64 + 64;
  for (let i = 0; i < attempts && picked.length < wanted; i++) {
    const index = pickWeighted(sheet.c, sheet.t);
    if (taken.has(index)) continue;
    taken.add(index);
    picked.push(index);
  }
  // Fill any shortfall in sheet order, so a pack is never short a card.
  for (const [index] of sheet.c) {
    if (picked.length >= wanted) break;
    if (taken.has(index)) continue;
    taken.add(index);
    picked.push(index);
  }
  return picked;
}

function pickVariant(set: BoosterSet): BoosterVariant | null {
  if (set.boosters.length === 0) return null;
  const total = set.totalWeight > 0
    ? set.totalWeight
    : set.boosters.reduce((sum, variant) => sum + variant.w, 0);
  let roll = randomBelow(total);
  for (const variant of set.boosters) {
    roll -= variant.w;
    if (roll < 0) return variant;
  }
  return set.boosters[set.boosters.length - 1];
}

function toCardData(row: BoosterCardRow): CardData {
  const [name, manaCost, typeLine, cmc, colorIdentity, scryfallId, hasBack] = row;
  const card: CardData = {
    scryfallId,
    name,
    imagePath: cardImageUrl(scryfallId),
    manaCost,
    typeLine,
    cmc,
    colorIdentity: colorIdentity ? colorIdentity.split('') : [],
  };
  if (hasBack) card.backImagePath = cardBackImageUrl(scryfallId);
  return card;
}

/**
 * One pack: a weighted choice of pack variant, then a weighted draw per sheet.
 *
 * Returned in SLOT order — commons, uncommons, the rare, the land, any mixed
 * guaranteed slot, the foil, then a bonus card — so the pool reads the way the
 * pack does when you fan it out, rather than as an undifferentiated heap.
 * `order` sorts within each slot, so a run of seven commons is still tidy.
 */
export function openBooster(set: BoosterSet, order: PoolSort = 'type-then-cost'): CardData[] {
  const variant = pickVariant(set);
  if (!variant) return [];
  const bySlot = new Map<number, CardData[]>();
  for (const [sheetName, count] of Object.entries(variant.c)) {
    const sheet = set.sheets[sheetName];
    if (!sheet || sheet.c.length === 0 || sheet.t <= 0) continue;
    const drawn = drawFromSheet(sheet, count).map((index) => toCardData(set.cards[index]));
    const slot = bySlot.get(sheet.r);
    if (slot) slot.push(...drawn);
    else bySlot.set(sheet.r, drawn);
  }
  return [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, cards]) => sortPool(cards, order));
}
