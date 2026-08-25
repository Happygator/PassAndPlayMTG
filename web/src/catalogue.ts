import type { CardData } from './types';

/** One catalogue row, in the fixed field order emitted by build-catalogue.mjs. */
type Row = [string, string, string, string, string, number, string, string];

export interface Catalogue {
  /** Every Vintage-legal card, sorted by name. */
  cards: CardData[];
  /** Full oracle text per card, parallel to `cards` (kept out of CardData: only this mode needs it). */
  text: string[];
  /** "2/1" for creatures, "" otherwise; parallel to `cards`. */
  pt: string[];
  /** Folded (lower-cased, accent- and apostrophe-stripped) name per card, parallel to `cards`; used by searchCatalogue. */
  folded: string[];
  /** Canonical names of banned cards. */
  banned: Set<string>;
  /** Banlist provenance for the handoff line and the viewer. */
  banlist: { fetchedAt: string; source: string; count: number };
}

export interface BanlistSummary {
  /** Banned card count. */
  count: number;
  /** ISO date the banlist was scraped. */
  fetchedAt: string;
  source: string;
  /** Vintage-legal cards in the bundled catalogue. */
  legal: number;
}

export const cardImageUrl = (scryfallId: string): string =>
  `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;

/**
 * The back face of a double-faced card. Scryfall serves both faces under the
 * SAME card id, on parallel `front/` and `back/` paths — there is no separate
 * id to look up — so a card's back image is derivable from its front.
 */
export const cardBackImageUrl = (scryfallId: string): string =>
  `https://cards.scryfall.io/normal/back/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;

/**
 * Fold a name or query to a comparison key: lower-cased, accents stripped, and
 * apostrophes/dashes removed entirely. iOS smart punctuation types a curly
 * apostrophe where every card name in the data uses an ASCII one, so a phone
 * user searching "Sea's Claim" would otherwise get nothing; dropping the
 * character altogether also lets "seas claim" match.
 */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc']/g, '')
    .replace(/[\u2010-\u2015\u2212-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let cataloguePromise: Promise<Catalogue> | null = null;
let banlistSummaryPromise: Promise<BanlistSummary> | null = null;

interface CatalogueJson {
  version: number;
  rows: Row[];
}

interface BanlistJson {
  source: string;
  fetchedAt: string;
  categories: unknown[];
  cards: { name: string; oracleId: string; scryfallId: string; set: string; collector: string }[];
}

async function fetchCatalogue(): Promise<Catalogue> {
  const [catalogueRes, banlistRes] = await Promise.all([
    fetch('./catalogue/cards.json.gz'),
    fetch('./banlist/3cb-official.json'),
  ]);
  if (!catalogueRes.ok) {
    throw new Error(`Could not load the card catalogue (status ${catalogueRes.status}).`);
  }
  if (!banlistRes.ok) {
    throw new Error(`Could not load the banlist (status ${banlistRes.status}).`);
  }
  // Some hosts (e.g. GitHub Pages) serve the .gz as an opaque binary with no
  // Content-Encoding, so the bytes on the wire are still gzip-compressed.
  // Other hosts (e.g. the Vite dev server) set Content-Encoding: gzip, and
  // the browser already decompresses the body before we see it. There is no
  // reliable header to distinguish the two cases, so sniff the gzip magic
  // number instead.
  const buffer = await catalogueRes.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let catalogueJson: CatalogueJson;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'));
    catalogueJson = (await new Response(stream).json()) as CatalogueJson;
  } else {
    catalogueJson = JSON.parse(new TextDecoder().decode(bytes)) as CatalogueJson;
  }
  const banlistJson = (await banlistRes.json()) as BanlistJson;
  if (catalogueJson.version !== 2) {
    throw new Error('Card catalogue is out of date — run: npm run catalogue');
  }

  const cards: CardData[] = [];
  const text: string[] = [];
  const pt: string[] = [];
  const folded: string[] = [];
  for (const row of catalogueJson.rows) {
    const [name, manaCost, typeLine, oracleText, scryfallId, cmc, colorIdentity, ptValue] = row;
    cards.push({
      scryfallId,
      name,
      imagePath: cardImageUrl(scryfallId),
      manaCost,
      typeLine,
      cmc,
      colorIdentity: colorIdentity.split(''),
    });
    text.push(oracleText);
    pt.push(ptValue);
    folded.push(foldName(name));
  }

  const banned = new Set(banlistJson.cards.map((c) => c.name));

  return {
    cards,
    text,
    pt,
    folded,
    banned,
    banlist: {
      fetchedAt: banlistJson.fetchedAt,
      source: banlistJson.source,
      count: banlistJson.cards.length,
    },
  };
}

/** Memoised: repeated calls share one fetch/decompress. */
export function loadCatalogue(): Promise<Catalogue> {
  if (!cataloguePromise) {
    cataloguePromise = fetchCatalogue().catch((err) => {
      cataloguePromise = null;
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return cataloguePromise;
}

interface CatalogueMetaJson {
  version: number;
  count: number;
  oracleUpdatedAt: string;
  builtAt: string;
  fields: string[];
}

async function fetchBanlistSummary(): Promise<BanlistSummary> {
  const [metaRes, banlistRes] = await Promise.all([
    fetch('./catalogue/meta.json'),
    fetch('./banlist/3cb-official.json'),
  ]);
  if (!metaRes.ok) {
    throw new Error(`Could not load the catalogue metadata (status ${metaRes.status}).`);
  }
  if (!banlistRes.ok) {
    throw new Error(`Could not load the banlist (status ${banlistRes.status}).`);
  }
  const metaJson = (await metaRes.json()) as CatalogueMetaJson;
  const banlistJson = (await banlistRes.json()) as BanlistJson;
  return {
    count: banlistJson.cards.length,
    fetchedAt: banlistJson.fetchedAt,
    source: banlistJson.source,
    legal: metaJson.count,
  };
}

/** Memoised: repeated calls share one fetch. Much cheaper than loadCatalogue - use this for display-only summaries. */
export function loadBanlistSummary(): Promise<BanlistSummary> {
  if (!banlistSummaryPromise) {
    banlistSummaryPromise = fetchBanlistSummary().catch((err) => {
      banlistSummaryPromise = null;
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return banlistSummaryPromise;
}

export interface BannedCard {
  name: string;
  scryfallId: string;
}

export interface BanlistDetail {
  source: string;
  fetchedAt: string;
  cards: BannedCard[];
}

let banlistDetailPromise: Promise<BanlistDetail> | null = null;

async function fetchBanlistDetail(): Promise<BanlistDetail> {
  const res = await fetch('./banlist/3cb-official.json');
  if (!res.ok) {
    throw new Error(`Could not load the banlist (status ${res.status}).`);
  }
  const json = (await res.json()) as BanlistJson;
  return {
    source: json.source,
    fetchedAt: json.fetchedAt,
    cards: json.cards.map((c) => ({ name: c.name, scryfallId: c.scryfallId })),
  };
}

/** Memoised: repeated calls share one fetch. Full banlist detail for the viewer screen — does not touch the card catalogue at all. */
export function loadBanlistDetail(): Promise<BanlistDetail> {
  if (!banlistDetailPromise) {
    banlistDetailPromise = fetchBanlistDetail().catch((err) => {
      banlistDetailPromise = null;
      throw err instanceof Error ? err : new Error(String(err));
    });
  }
  return banlistDetailPromise;
}

/**
 * Returns catalogue indices matching `query` against card name: prefix
 * matches first, then substring matches; within each group sorted by name
 * length ascending then localeCompare. Banned cards ARE included — the UI
 * greys them, it does not filter them out.
 */
export function searchCatalogue(catalogue: Catalogue, query: string, limit = 12): number[] {
  const q = foldName(query);
  if (!q) return [];
  const prefix: number[] = [];
  const substring: number[] = [];
  catalogue.folded.forEach((folded, index) => {
    if (folded.startsWith(q)) prefix.push(index);
    else if (folded.includes(q)) substring.push(index);
  });
  const byNameLength = (a: number, b: number) =>
    catalogue.cards[a].name.length - catalogue.cards[b].name.length ||
    catalogue.cards[a].name.localeCompare(catalogue.cards[b].name);
  prefix.sort(byNameLength);
  substring.sort(byNameLength);
  return [...prefix, ...substring].slice(0, limit);
}

const BASIC_NAMES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const;

/** The five basics in WUBRG order, looked up by exact name. Throws if any is missing. */
export function basicsFromCatalogue(catalogue: Catalogue): CardData[] {
  return BASIC_NAMES.map((basicName) => {
    const card = catalogue.cards.find((c) => c.name === basicName);
    if (!card) throw new Error(`Catalogue is missing basic land "${basicName}".`);
    return card;
  });
}

/**
 * One-string rules summary for a search row: newlines become " · " (abilities
 * read as separate clauses), the text is cut at a word boundary with an
 * ellipsis when it runs past `max`, and a creature's power/toughness is
 * appended last so it survives the truncation.
 */
export function cardLine(text: string, pt = '', max = 220): string {
  let collapsed = text.replace(/\n+/g, ' · ').replace(/\s+/g, ' ').trim();
  const withoutReminders = collapsed.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (withoutReminders) collapsed = withoutReminders;
  let result = collapsed;
  if (result.length > max) {
    const cut = result.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    const base = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?·]+$/, '');
    result = `${base}…`;
  }
  if (pt) {
    result = result ? `${result} · ${pt}` : pt;
  }
  return result;
}

/** @deprecated use cardLine */
export const snippet = cardLine;
