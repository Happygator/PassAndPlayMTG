// Build-time Real 3CB banlist pipeline: scrapes the official banlist with
// section-aware parsing, resolves every linked printing to a Scryfall oracle
// ID, and materialises category queries into the final banned-card list.
// A page fetch or parse failure falls back to the tracked repo-root cache, but
// an unresolvable card always fails the build.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SOURCE_URL = 'https://www.3cardblind.com/format-info/banlist';
const CACHE_PATH = join(ROOT, '..', 'banlists', '3cb-official.json');
const OUT_PATH = join(ROOT, 'public', 'banlist', '3cb-official.json');

const API_DELAY_MS = 120;
const HEADERS = {
  'User-Agent': 'PassAndPlayMTG/0.1 (kitchen-table MTG sealed app)',
  Accept: 'application/json',
};
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; PassAndPlayMTG/0.1)',
};

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

function unescapeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function textContent(value) {
  return unescapeHtml(value.replace(/<[^>]*>/g, '')).trim();
}

async function fetchSections() {
  const res = await fetch(SOURCE_URL, { headers: PAGE_HEADERS });
  if (!res.ok) throw new Error(`Banlist page ${res.status} for ${SOURCE_URL}`);
  const html = new TextDecoder('utf-8').decode(await res.arrayBuffer());
  const headings = [];
  const headingPattern = /<h([1-4])[^>]*>(.*?)<\/h\1>/gs;
  for (const match of html.matchAll(headingPattern)) {
    const text = textContent(match[2]);
    if (text) headings.push({ text, index: match.index });
  }

  const bannedNames = new Set(['Permanent Banned List', 'Currently Banned']);
  if (!headings.some((heading) => bannedNames.has(heading.text))) {
    throw new Error('Banlist page structure changed: banned headings not found');
  }

  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index ?? html.length;
    const source = html.slice(heading.index, end);
    const cards = [];
    const cardPattern = /href="(https:\/\/scryfall\.com\/card\/[^\"]+)"[^>]*>(.*?)<\/a>/gs;
    for (const match of source.matchAll(cardPattern)) {
      cards.push({ url: unescapeHtml(match[1]), anchor: textContent(match[2]) });
    }
    const searches = [];
    const searchPattern = /href="(https:\/\/scryfall\.com\/search[^\"]+)"/g;
    for (const match of source.matchAll(searchPattern)) {
      searches.push(queryFromUrl(unescapeHtml(match[1])));
    }
    return { ...heading, cards, searches };
  });
}

function parsePrinting(link) {
  const match = new URL(link.url).pathname.match(/^\/card\/([^/]+)\/([^/]+)\//);
  if (!match) throw new Error(`Unparseable Scryfall card URL ${link.url} (${link.anchor})`);
  return { set: match[1], collector: match[2] };
}

async function resolvePrinting(link) {
  const { set, collector } = parsePrinting(link);
  try {
    const card = await scryfall(
      `https://api.scryfall.com/cards/${set}/${encodeURIComponent(collector)}`
    );
    if (!card.name || !card.oracle_id) throw new Error('response missing name or oracle_id');
    return { name: card.name, oracleId: card.oracle_id, scryfallId: card.id, set, collector };
  } catch (err) {
    throw new Error(`Failed to resolve ${link.url} (${link.anchor}): ${err.message}`);
  }
}

function queryFromUrl(url) {
  const match = url.match(/[?&]q=([^&]+)/);
  if (!match) throw new Error(`Scryfall search URL has no q parameter: ${url}`);
  // Query strings encode spaces as '+', which decodeURIComponent leaves alone.
  return decodeURIComponent(match[1].replace(/\+/g, '%20'));
}

async function resolveCategory(query) {
  const cards = [];
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards`;
  while (url) {
    const page = await scryfall(url);
    for (const card of page.data ?? []) {
      if (!card.name || !card.oracle_id) {
        throw new Error(`Scryfall category result missing name or oracle_id for ${query}`);
      }
      cards.push({
        name: card.name,
        oracleId: card.oracle_id,
        scryfallId: card.id,
        set: card.set,
        collector: card.collector_number,
      });
    }
    url = page.has_more ? page.next_page : null;
  }
  return cards;
}

function useCache(err) {
  console.warn(`warn: ${err.message}`);
  if (!existsSync(CACHE_PATH)) {
    process.exitCode = 1;
    return false;
  }
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  copyFileSync(CACHE_PATH, OUT_PATH);
  return true;
}

async function main() {
  let sections;
  try {
    sections = await fetchSections();
  } catch (err) {
    useCache(err);
    return;
  }

  const bannedSections = sections.filter(
    (section) =>
      section.text === 'Permanent Banned List' || section.text === 'Currently Banned'
  );
  const allCards = [];
  const categories = [];
  let permanent = 0;
  let adjustable = 0;
  let categoryCount = 0;

  for (const section of bannedSections) {
    for (const link of section.cards) {
      allCards.push(await resolvePrinting(link));
      if (section.text === 'Permanent Banned List') permanent++;
      if (section.text === 'Currently Banned') adjustable++;
    }
    for (const query of section.searches) {
      categoryCount++;
      if (query === 'banned:vintage') {
        categories.push({
          query,
          resolved: null,
          note: "satisfied by the app's own legal:vintage pool filter \u2014 a vintage-banned card can never appear",
        });
        continue;
      }
      const cards = await resolveCategory(query);
      categories.push({ query, resolved: cards.length, note: '' });
      allCards.push(...cards);
    }
  }

  const cards = [...new Map(allCards.map((card) => [card.oracleId, card])).values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const fetchedAt = new Date().toISOString().slice(0, 10);
  const output = { source: SOURCE_URL, fetchedAt, categories, cards };
  const json = JSON.stringify(output, null, 2) + '\n';
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, json);
  writeFileSync(OUT_PATH, json);
  console.log(
    `banlist: ${cards.length} cards (${permanent} permanent, ${adjustable} adjustable) + ${categoryCount} category, revision ${fetchedAt}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
