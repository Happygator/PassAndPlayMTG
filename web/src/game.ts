import type { CardData, CardRef, CubeData, DeckSlots, GameMode, MatchResult, Matchup } from './types';

/** Fisher–Yates shuffle of a copy, using crypto randomness. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  const buf = new Uint32Array(1);
  for (let i = a.length - 1; i > 0; i--) {
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ModeRules {
  label: string;
  /** One-line description shown under the mode selector. */
  blurb: string;
  defaultPoolSize: number;
  defaultDecksPerPlayer: number;
  /** Whether basic lands are offered during deckbuilding. */
  allowBasics: boolean;
  /** Whether match-screen cards start face-down with per-card reveal. */
  hiddenCards: boolean;
  /** Result buttons for one matchup, in display order. */
  results: MatchResult[];
}

export const MODE_RULES: Record<GameMode, ModeRules> = {
  '3cb': {
    label: '3-Card Blind',
    blurb: '20 life and perfect information.',
    defaultPoolSize: 10,
    defaultDecksPerPlayer: 1,
    allowBasics: true,
    hiddenCards: false,
    results: ['p1-sweep', 'p1-play', 'even', 'p2-play', 'p2-sweep'],
  },
  paigow: {
    label: 'Pai Gow MTG',
    blurb: '5 life and unlimited mana of all types.',
    defaultPoolSize: 7,
    defaultDecksPerPlayer: 1,
    allowBasics: false,
    hiddenCards: true,
    results: ['p1-win', 'draw', 'p2-win'],
  },
};

/** Deal two sealed pools from the cube (disjoint by default), each sorted for display. */
export function dealPools(
  cube: CubeData,
  poolSize: number,
  allowRepeats = false
): [CardData[], CardData[]] {
  if (allowRepeats) {
    // Independent draws: seeing a card in your pool says nothing about the opponent's.
    return [
      sortPool(shuffle(cube.cards).slice(0, poolSize)),
      sortPool(shuffle(cube.cards).slice(0, poolSize)),
    ];
  }
  const shuffled = shuffle(cube.cards);
  return [
    sortPool(shuffled.slice(0, poolSize)),
    sortPool(shuffled.slice(poolSize, poolSize * 2)),
  ];
}

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

/** Sort bucket for a color identity: WUBRG mono = 0–4, multicolor = 5, colorless = 6. */
export function colorBucket(colorIdentity: readonly string[]): number {
  if (colorIdentity.length === 0) return 6;
  if (colorIdentity.length > 1) return 5;
  const i = COLOR_ORDER.indexOf(colorIdentity[0]);
  return i === -1 ? 6 : i;
}

/** Sort by mana value, then color bucket, then name. Defensive against pre-cmc cube JSON. */
export function sortPool(cards: readonly CardData[]): CardData[] {
  return cards.slice().sort(
    (a, b) =>
      (a.cmc ?? 0) - (b.cmc ?? 0) ||
      colorBucket(a.colorIdentity ?? []) - colorBucket(b.colorIdentity ?? []) ||
      a.name.localeCompare(b.name)
  );
}

export function emptyDecks(decksPerPlayer: number): DeckSlots[] {
  return Array.from({ length: decksPerPlayer }, () => [null, null, null] as DeckSlots);
}

/** One matchup per deck position: each player's deck k plays only the opponent's deck k. */
export function createMatchups(n: number): Matchup[] {
  return Array.from({ length: n }, (_, i) => ({ p1Deck: i, p2Deck: i, result: null }));
}

/** Game points [p1, p2]: 3CB results span a 2-game match, Pai Gow results a single game; win = 1, draw = ½. */
export function gamePoints(result: MatchResult): [number, number] {
  switch (result) {
    case 'p1-sweep': return [2, 0];
    case 'p1-play': return [1.5, 0.5];
    case 'even': return [1, 1];
    case 'p2-play': return [0.5, 1.5];
    case 'p2-sweep': return [0, 2];
    case 'p1-win': return [1, 0];
    case 'draw': return [0.5, 0.5];
    case 'p2-win': return [0, 1];
  }
}

export function tally(matchups: readonly Matchup[]): [number, number] {
  let p1 = 0;
  let p2 = 0;
  for (const m of matchups) {
    if (m.result === null) continue;
    const [a, b] = gamePoints(m.result);
    p1 += a;
    p2 += b;
  }
  return [p1, p2];
}

/** "1.5" -> "1½", "0.5" -> "½", integers unchanged. */
export function formatPoints(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (half && whole === 0) return '½';
  return half ? `${whole}½` : `${whole}`;
}

/** Compact result notation for grids, e.g. "2–0", "1½–½", "1–1". */
export function resultLabel(result: MatchResult): string {
  const [a, b] = gamePoints(result);
  return `${formatPoints(a)}–${formatPoints(b)}`;
}

/** Button label for a result, e.g. "Alice wins both" (3CB) or "Alice wins" (Pai Gow). */
export function resultButtonLabel(result: MatchResult, names: [string, string]): string {
  switch (result) {
    case 'p1-sweep': return `${names[0]} wins both`;
    case 'p1-play': return `${names[0]} wins on the play`;
    case 'even': return 'Even';
    case 'p2-play': return `${names[1]} wins on the play`;
    case 'p2-sweep': return `${names[1]} wins both`;
    case 'p1-win': return `${names[0]} wins`;
    case 'draw': return 'Draw';
    case 'p2-win': return `${names[1]} wins`;
  }
}

/** Which side a result favors; drives the p1/even/p2 color classes. */
export function resultSide(result: MatchResult): 'p1' | 'even' | 'p2' {
  if (result === 'p1-sweep' || result === 'p1-play' || result === 'p1-win') return 'p1';
  if (result === 'p2-sweep' || result === 'p2-play' || result === 'p2-win') return 'p2';
  return 'even';
}

export function resolveRef(ref: CardRef, pool: readonly CardData[], basics: readonly CardData[]): CardData {
  return ref.kind === 'pool' ? pool[ref.index] : basics[ref.index];
}

/** Comma-separated front-face card names of a deck, e.g. "Black Lotus, Daze, Memnite". */
export function deckNames(
  deck: DeckSlots,
  pool: readonly CardData[],
  basics: readonly CardData[]
): string {
  return deck
    .map((ref) => (ref === null ? '?' : resolveRef(ref, pool, basics).name.split(' // ')[0]))
    .join(', ');
}

export function deckComplete(deck: DeckSlots): boolean {
  return deck.every((s) => s !== null);
}
