/**
 * Game-state resume (APP-MIGRATION.md M7).
 *
 * iOS discards a backgrounded WebView, so a game interrupted by a phone call
 * or a switch to Messages must survive being reloaded from scratch. This
 * module owns the saved payload and nothing else: no React, no UI, no policy
 * about WHEN to save -- app.tsx decides that.
 *
 * What is stored is deliberately small. Pools are an ordered list of Scryfall
 * IDs rather than whole cards, because deck slots address the pool by INDEX:
 * keep the order and every existing CardRef stays valid. The cube, the
 * catalogue and the card images are all rebuilt on load from what already
 * ships (or is cached) on the device.
 */
import { basicsFromCatalogue, loadCatalogue } from './catalogue';
import type { Catalogue } from './catalogue';
import { boosterSetCodeOf, cardsFromSet, isBoosterCubeId, loadBoosterSet } from './boosters';
import { isConstructed } from './game';
import type { CardData, CubeData, DeckSlots, GameConfig, Matchup, Phase } from './types';

const STORAGE_KEY = 'sealed:in-progress-game';

/**
 * Payload format version. An app update can ship while someone has a game in
 * flight, so an unknown version is IGNORED rather than migrated or partially
 * read -- the same "fail politely" rule the iMessage state channel uses
 * (APP-MIGRATION.md section 6.4).
 */
export const RESUME_VERSION = 1;

export interface SavedGame {
  v: number;
  /** ISO timestamp, shown to the player so a stale save is recognisable. */
  savedAt: string;
  phase: Phase;
  config: GameConfig;
  /** Pool cards as Scryfall IDs, in pool order. Deck slots index into this. */
  poolIds: [string[], string[]];
  decks: [DeckSlots[], DeckSlots[]];
  matchups: Matchup[];
  currentMatchup: number;
}

/** A save with its cards, cube and catalogue rebuilt: ready for the reducer. */
export interface RestoredGame {
  phase: Phase;
  config: GameConfig;
  cube: CubeData;
  pools: [CardData[], CardData[]];
  decks: [DeckSlots[], DeckSlots[]];
  matchups: Matchup[];
  currentMatchup: number;
  catalogue?: Catalogue;
}

/** The shape app.tsx hands to `saveGame` -- the active state's game fields. */
export interface SavableGame {
  phase: Phase;
  config: GameConfig;
  pools: [CardData[], CardData[]];
  decks: [DeckSlots[], DeckSlots[]];
  matchups: Matchup[];
  currentMatchup: number;
}

/**
 * Where a resumed game is allowed to open.
 *
 * Build and order both put one player's cards on screen, and a resume happens
 * on a device that may now be in the other player's hands -- so both rewind to
 * that player's handoff, which requires a deliberate hold before anything is
 * shown. Only the phase moves: the decks built so far are still in the save,
 * so nothing is lost but a tap.
 */
export function safeResumePhase(phase: Phase): Phase {
  if (phase.t === 'build' || phase.t === 'order') {
    return { t: 'handoff', player: phase.player };
  }
  return phase;
}

function isPhase(value: unknown): value is Phase {
  if (typeof value !== 'object' || value === null) return false;
  const tag = (value as { t?: unknown }).t;
  if (tag === 'setup' || tag === 'match' || tag === 'results') return true;
  if (tag !== 'handoff' && tag !== 'build' && tag !== 'order') return false;
  const player = (value as { player?: unknown }).player;
  return player === 0 || player === 1;
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Structural check on parsed JSON. Deliberately shallow: it guards against a
 * truncated or foreign value in localStorage, not against a hostile one --
 * this is the player's own device and their own save.
 */
function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== 'object' || value === null) return false;
  const save = value as Partial<SavedGame>;
  if (typeof save.v !== 'number' || typeof save.savedAt !== 'string') return false;
  if (!isPhase(save.phase)) return false;
  if (typeof save.config !== 'object' || save.config === null) return false;
  if (typeof (save.config as GameConfig).cubeId !== 'string') return false;
  if (!Array.isArray(save.poolIds) || save.poolIds.length !== 2) return false;
  if (!isIdList(save.poolIds[0]) || !isIdList(save.poolIds[1])) return false;
  if (!Array.isArray(save.decks) || save.decks.length !== 2) return false;
  if (!Array.isArray(save.matchups)) return false;
  return typeof save.currentMatchup === 'number';
}

/**
 * The wire form of a live game, shared by the local save and the iMessage
 * payload (APP-MIGRATION.md §6.3). `phase` is a parameter rather than read off
 * `game` because the two callers want different phases: a SAVE rewinds to
 * handoff so a resume cannot expose a pool, while a MESSAGE carries the true
 * phase, since the opponent's device is a different device and the handoff
 * screen does not exist there at all.
 */
export function buildSavedGame(game: SavableGame, phase: Phase): SavedGame {
  return {
    v: RESUME_VERSION,
    savedAt: new Date().toISOString(),
    phase,
    config: game.config,
    poolIds: [
      game.pools[0].map((card) => card.scryfallId),
      game.pools[1].map((card) => card.scryfallId),
    ],
    decks: game.decks,
    matchups: game.matchups,
    currentMatchup: game.currentMatchup,
  };
}

/**
 * Write the current game over any previous save. Called on every state change,
 * so it must stay cheap and must never throw: storage can be full or disabled,
 * and a game that cannot be saved still has to be playable.
 */
export function saveGame(game: SavableGame): void {
  const payload: SavedGame = buildSavedGame(game, safeResumePhase(game.phase));
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage disabled or full: the game continues, it simply will not resume.
  }
}

export function clearSavedGame(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: a save that cannot be removed also cannot be read.
  }
}

/**
 * The saved game as stored, WITHOUT loading any cards -- cheap enough to call
 * during the first render so the start screen can offer to resume.
 */
export function peekSavedGame(): SavedGame | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isSavedGame(parsed) || parsed.v !== RESUME_VERSION) return null;
  return parsed;
}

function poolsFrom(
  poolIds: readonly [string[], string[]],
  lookup: (id: string) => CardData | undefined
): [CardData[], CardData[]] {
  const resolve = (ids: readonly string[]): CardData[] =>
    ids.map((id) => {
      const card = lookup(id);
      if (!card) throw new Error(`The saved game refers to a card that is no longer available (${id}).`);
      return card;
    });
  return [resolve(poolIds[0]), resolve(poolIds[1])];
}

function byScryfallId(cards: readonly CardData[]): (id: string) => CardData | undefined {
  const map = new Map<string, CardData>();
  for (const card of cards) if (!map.has(card.scryfallId)) map.set(card.scryfallId, card);
  return (id) => map.get(id);
}

/**
 * Rebuild a save into something the reducer can run.
 *
 * Rejects rather than repairs: a cube that no longer exists, a card dropped
 * from a set, a catalogue that will not load -- all throw, and the caller
 * discards the save. A half-restored game is worse than starting over.
 */
export async function restoreGame(saved: SavedGame): Promise<RestoredGame> {
  const { config } = saved;
  const common = {
    phase: safeResumePhase(saved.phase),
    config,
    decks: saved.decks,
    matchups: saved.matchups,
    currentMatchup: saved.currentMatchup,
  };

  if (isConstructed(config.mode)) {
    const catalogue = await loadCatalogue();
    const cube: CubeData = {
      id: config.cubeId,
      name: '3-Card Blind',
      description: 'Every Vintage-legal card, minus the official banlist.',
      modes: [config.mode],
      basics: basicsFromCatalogue(catalogue),
      cards: [],
    };
    return {
      ...common,
      cube,
      pools: poolsFrom(saved.poolIds, byScryfallId(catalogue.cards)),
      catalogue,
    };
  }

  if (isBoosterCubeId(config.cubeId)) {
    const set = await loadBoosterSet(boosterSetCodeOf(config.cubeId));
    const cube: CubeData = {
      id: config.cubeId,
      name: set.name,
      // Only `basics` is read off the cube downstream, and a booster supplies
      // none; the rest exists to satisfy the type.
      description: '',
      modes: [config.mode],
      basics: [],
      cards: [],
    };
    return {
      ...common,
      cube,
      pools: [cardsFromSet(set, saved.poolIds[0]), cardsFromSet(set, saved.poolIds[1])],
    };
  }

  const response = await fetch(`./cubes/${config.cubeId}.json`);
  if (!response.ok) {
    throw new Error(`The cube this game was played with is no longer available (${config.cubeId}).`);
  }
  const cube = (await response.json()) as CubeData;
  return {
    ...common,
    cube,
    pools: poolsFrom(saved.poolIds, byScryfallId([...cube.cards, ...cube.basics])),
  };
}
