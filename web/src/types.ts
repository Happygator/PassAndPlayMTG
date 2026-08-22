export type GameMode = '3cb' | 'paigow';

export interface CardData {
  scryfallId: string;
  name: string;
  imagePath: string;
  backImagePath?: string;
  manaCost: string;
  typeLine: string;
  /** Mana value (Scryfall `cmc`). */
  cmc: number;
  /** Color identity letters, e.g. ["W"] or ["U","R"]; [] = colorless. */
  colorIdentity: string[];
}

/** Start-screen starting values a cube can specify for one mode. */
export interface CubeModeDefaults {
  poolSize: number;
  decksPerPlayer: number;
  allowRepeats: boolean;
}

/**
 * Optional per-cube start-screen defaults, overriding the mode-wide values in
 * MODE_RULES. Keyed by mode because a cube playable in several modes wants
 * different numbers in each; any mode left out falls back to MODE_RULES.
 * Always clamped by the cube's own size at the point of use.
 */
export type CubeDefaults = Partial<Record<GameMode, CubeModeDefaults>>;

export interface CubeIndexEntry {
  id: string;
  name: string;
  description: string;
  cardCount: number;
  /** Game modes this cube may be played in (at least one). */
  modes: GameMode[];
  defaults?: CubeDefaults;
}

export interface CubeData {
  id: string;
  name: string;
  description: string;
  /** Game modes this cube may be played in (at least one). */
  modes: GameMode[];
  defaults?: CubeDefaults;
  basics: CardData[];
  cards: CardData[];
}

export interface GameConfig {
  mode: GameMode;
  cubeId: string;
  poolSize: number;
  decksPerPlayer: number;
  /** Draw each pool independently from the whole cube (a card may be in both pools). Default false = disjoint pools. */
  allowRepeats: boolean;
  /** Resolved display names ("Player 1"/"Player 2" when left blank). */
  playerNames: [string, string];
  /** Name-field text exactly as typed (may be empty) — refills the start screen. */
  enteredNames: [string, string];
}

/** Reference to a card in a deck slot: either an index into the owner's pool, or an index into the cube's basics. */
export type CardRef = { kind: 'pool'; index: number } | { kind: 'basic'; index: number };

/** A deck under construction: exactly 3 slots, each empty (null) or a CardRef. */
export type DeckSlots = [CardRef | null, CardRef | null, CardRef | null];

/** 3CB outcomes describe a 2-game match; Pai Gow outcomes describe a single best-of-one game. */
export type MatchResult =
  | 'p1-sweep'
  | 'p1-play'
  | 'even'
  | 'p2-play'
  | 'p2-sweep'
  | 'p1-win'
  | 'draw'
  | 'p2-win';

/** 1:1 pairing: deck k plays only the opponent's deck k, so p1Deck === p2Deck === pairing index. */
export interface Matchup {
  p1Deck: number;
  p2Deck: number;
  /** Who is on the play (0 = player 1, 1 = player 2). Only set by modes with randomFirstPlayer. */
  onPlay?: 0 | 1;
  result: MatchResult | null;
}

export type Phase =
  | { t: 'setup' }
  | { t: 'handoff'; player: 0 | 1 }
  | { t: 'build'; player: 0 | 1 }
  | { t: 'order'; player: 0 | 1 }
  | { t: 'match' }
  | { t: 'results' };

export interface GameState {
  phase: Phase;
  config: GameConfig;
  cube: CubeData;
  pools: [CardData[], CardData[]];
  decks: [DeckSlots[], DeckSlots[]];
  matchups: Matchup[];
  /** Index of the matchup being shown; always < matchups.length while in the match phase. */
  currentMatchup: number;
}
