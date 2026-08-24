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

/** How a dealt pool is ordered on the deckbuilding screen. */
export type PoolSort = 'cost' | 'type-then-cost';

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
  /** Pool display order: by cost, or grouped by card type first (§3.3). */
  poolSort: PoolSort;
  /** Whether each matchup randomly assigns who goes first (single best-of-one games). */
  randomFirstPlayer: boolean;
}

export const MODE_RULES: Record<GameMode, ModeRules> = {
  '3cb-real': {
    label: '3-Card Blind',
    blurb: '20 life, perfect information, every legal card.',
    defaultPoolSize: 0,
    defaultDecksPerPlayer: 1,
    allowBasics: true,
    hiddenCards: false,
    results: ['p1-sweep', 'p1-play', 'even', 'p2-play', 'p2-sweep'],
    poolSort: 'cost',
    randomFirstPlayer: false,
  },
  '3cb': {
    label: '3CB Sealed',
    blurb: '20 life and perfect information.',
    defaultPoolSize: 10,
    defaultDecksPerPlayer: 1,
    allowBasics: true,
    hiddenCards: false,
    results: ['p1-sweep', 'p1-play', 'even', 'p2-play', 'p2-sweep'],
    poolSort: 'cost',
    randomFirstPlayer: false,
  },
  paigow: {
    label: 'Pai Gow MTG',
    blurb: '5 life and unlimited mana of all types.',
    defaultPoolSize: 7,
    defaultDecksPerPlayer: 1,
    allowBasics: false,
    hiddenCards: true,
    results: ['p1-win', 'draw', 'p2-win'],
    poolSort: 'type-then-cost',
    randomFirstPlayer: true,
  },
};

/** Constructed modes deal no pool — a player's "pool" fills up with the cards they search for. */
export function isConstructed(mode: GameMode): boolean {
  return mode === '3cb-real';
}

/** Deal two sealed pools from the cube (disjoint by default), each sorted for display. */
export function dealPools(
  cube: CubeData,
  poolSize: number,
  allowRepeats = false,
  order: PoolSort = 'cost'
): [CardData[], CardData[]] {
  if (allowRepeats) {
    // Independent draws: seeing a card in your pool says nothing about the opponent's.
    return [
      sortPool(shuffle(cube.cards).slice(0, poolSize), order),
      sortPool(shuffle(cube.cards).slice(0, poolSize), order),
    ];
  }
  const shuffled = shuffle(cube.cards);
  return [
    sortPool(shuffled.slice(0, poolSize), order),
    sortPool(shuffled.slice(poolSize, poolSize * 2), order),
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

const TYPE_ORDER = [
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Battle',
] as const;

/**
 * Sort bucket for a type line: creatures 0 … battles 6, lands 7, anything else 8.
 * The front face decides for multi-faced cards; artifact lands are lands and
 * artifact creatures are creatures (Land is checked first, then the list order).
 */
export function typeBucket(typeLine: string): number {
  const front = (typeLine ?? '').split(' // ')[0];
  if (/\bLand\b/.test(front)) return 7;
  const i = TYPE_ORDER.findIndex((t) => new RegExp(`\\b${t}\\b`).test(front));
  return i === -1 ? 8 : i;
}

/** Sort by (optionally) card type, then mana value, then color bucket, then name. */
export function sortPool(cards: readonly CardData[], order: PoolSort = 'cost'): CardData[] {
  return cards.slice().sort(
    (a, b) =>
      (order === 'type-then-cost' ? typeBucket(a.typeLine) - typeBucket(b.typeLine) : 0) ||
      (a.cmc ?? 0) - (b.cmc ?? 0) ||
      colorBucket(a.colorIdentity ?? []) - colorBucket(b.colorIdentity ?? []) ||
      a.name.localeCompare(b.name)
  );
}

export function emptyDecks(decksPerPlayer: number): DeckSlots[] {
  return Array.from({ length: decksPerPlayer }, () => [null, null, null] as DeckSlots);
}

/** Fair coin flip via crypto randomness: 0 = player 1, 1 = player 2. */
export function coinFlip(): 0 | 1 {
  const buf = new Uint8Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] & 1) as 0 | 1;
}

/**
 * One matchup per deck position: each player's deck k plays only the opponent's
 * deck k. With randomFirstPlayer, each matchup also fixes who is on the play,
 * balanced across the game: each player is on the play in floor(n / 2) games,
 * an odd leftover game goes to a coin flip, and the order is shuffled.
 */
export function createMatchups(n: number, randomFirstPlayer = false): Matchup[] {
  const half = Math.floor(n / 2);
  const firsts: (0 | 1)[] = [...new Array<0 | 1>(half).fill(0), ...new Array<0 | 1>(half).fill(1)];
  if (n % 2 === 1) firsts.push(coinFlip());
  const order = shuffle(firsts);
  return Array.from({ length: n }, (_, i) => ({
    p1Deck: i,
    p2Deck: i,
    result: null,
    ...(randomFirstPlayer ? { onPlay: order[i] } : {}),
  }));
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

/**
 * Button label for a result, e.g. "Alice wins both" (3CB) or "Alice wins"
 * (Pai Gow).
 *
 * A 3CB matchup is TWO games — each player on the play once — so a result is a
 * pair of outcomes, and a label naming only one of them is ambiguous. The old
 * "wins on the play" described a single game and left the other unstated, even
 * though gamePoints scores it [1.5, 0.5], i.e. a win plus a draw.
 */
export function resultButtonLabel(result: MatchResult, names: [string, string]): string {
  switch (result) {
    case 'p1-sweep': return `${names[0]} wins both`;
    case 'p1-play': return `${names[0]} wins one, draws one`;
    case 'even': return 'Even';
    case 'p2-play': return `${names[1]} wins one, draws one`;
    case 'p2-sweep': return `${names[1]} wins both`;
    case 'p1-win': return `${names[0]} wins`;
    case 'draw': return 'Draw';
    case 'p2-win': return `${names[1]} wins`;
  }
}

/**
 * Secondary line for results whose name does not fully describe them. Only
 * 'even' needs one: gamePoints scores it [1, 1], which covers BOTH one game
 * each and both games drawn — two different things the word "Even" hides.
 */
export function resultNote(result: MatchResult): string | null {
  return result === 'even' ? 'one each, or both drawn' : null;
}

/** Which side a result favors; drives the p1/even/p2 color classes. */
export function resultSide(result: MatchResult): 'p1' | 'even' | 'p2' {
  if (result === 'p1-sweep' || result === 'p1-play' || result === 'p1-win') return 'p1';
  if (result === 'p2-sweep' || result === 'p2-play' || result === 'p2-win') return 'p2';
  return 'even';
}

/**
 * Ledger label: the favoured player's name plus the score from THEIR side, so
 * a win always shows the larger figure first.
 *
 * The name alone is not enough once a mode has five results — "Alice" means
 * 2–0 in one match and 1½–½ in another — so the figure is part of the label
 * rather than decoration.
 */
export function resultPillLabel(result: MatchResult, names: [string, string]): string {
  const [first, second] = gamePoints(result);
  const side = resultSide(result);
  if (side === 'even') return `${resultButtonLabel(result, names)} ${resultLabel(result)}`;
  if (side === 'p1') return `${names[0]} ${formatPoints(first)}–${formatPoints(second)}`;
  return `${names[1]} ${formatPoints(second)}–${formatPoints(first)}`;
}

/**
 * Whether a result was won outright rather than edged. This is the SECOND
 * channel the ledger encodes: hue still means player, and fill weight means
 * how decisively — solid for a sweep, outlined for one win and one draw. That
 * distinguishes all five 3CB results using three hues, and survives red-green
 * colour blindness and greyscale, because fill is not a colour cue.
 */
export function isDecisive(result: MatchResult): boolean {
  return (
    result === 'p1-sweep' ||
    result === 'p2-sweep' ||
    result === 'p1-win' ||
    result === 'p2-win'
  );
}

export function resolveRef(ref: CardRef, pool: readonly CardData[], basics: readonly CardData[]): CardData {
  return ref.kind === 'pool' ? pool[ref.index] : basics[ref.index];
}

/** Pipe-separated front-face card names of a deck, e.g. "Black Lotus, Daze, Memnite". */
export function deckNames(
  deck: DeckSlots,
  pool: readonly CardData[],
  basics: readonly CardData[]
): string {
  return deck
    .map((ref) => (ref === null ? '?' : resolveRef(ref, pool, basics).name.split(' // ')[0]))
    // A comma cannot separate these: six cards in the 3CB cube have one in
    // their own name ("Boseiju, Who Endures"), so ", " produced a list you
    // could not parse. The bar is also heavy enough to survive next to the
    // "//" already present in split-card names.
    .join(' | ');
}

export function deckComplete(deck: DeckSlots): boolean {
  return deck.every((s) => s !== null);
}
