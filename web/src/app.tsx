import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useReducer } from 'preact/hooks';
import { BuildScreen } from './components/BuildScreen';
import { ConstructedBuildScreen } from './components/ConstructedBuildScreen';
import { HandoffScreen } from './components/HandoffScreen';
import { MatchScreen } from './components/MatchScreen';
import { OrderScreen } from './components/OrderScreen';
import { InstallBanner } from '@platform';
import { ResultsScreen } from './components/ResultsScreen';
import { StartScreen } from './components/StartScreen';
import { basicsFromCatalogue } from './catalogue';
import type { Catalogue } from './catalogue';
import { effectiveBanned, loadCustomLists } from './banlists';
import { MODE_RULES, createMatchups, dealPools, emptyDecks, isConstructed } from './game';
import type {
  CardData,
  CardRef,
  CubeData,
  DeckSlots,
  GameConfig,
  GameState,
  MatchResult,
  Phase,
} from './types';

type SetupState = { phase: { t: 'setup' }; lastConfig?: GameConfig };
// GameState.phase is the full Phase union (which itself includes the 'setup'
// variant), so a plain `GameState | SetupState` union does not discriminate
// cleanly on `phase.t === 'setup'`. Narrow GameState's phase to exclude
// 'setup' here so the two branches are mutually exclusive on that tag.
type ActiveState = Omit<GameState, 'phase'> & { phase: Exclude<Phase, { t: 'setup' }>; catalogue?: Catalogue };
type AppState = SetupState | ActiveState;

type Action =
  | { type: 'start'; config: GameConfig; cube: CubeData; catalogue?: Catalogue }
  | { type: 'add-card'; player: 0 | 1; card: CardData; deck: number; slot: number }
  | { type: 'reveal' }
  | { type: 'set-slot'; player: 0 | 1; deck: number; slot: number; ref: CardRef | null }
  | { type: 'submit-decks'; player: 0 | 1 }
  | { type: 'reorder-deck'; player: 0 | 1; from: number; to: number }
  | { type: 'back-to-build'; player: 0 | 1 }
  | { type: 'confirm-order'; player: 0 | 1 }
  | { type: 'record'; result: MatchResult }
  | { type: 'goto-matchup'; index: number }
  | { type: 'new-game' };

const initialState: AppState = { phase: { t: 'setup' } };

// A user-defined type guard is used (rather than `state.phase.t !== 'setup'`
// inline) because TS does not reliably narrow a union on a discriminant
// nested one property deep (`state.phase.t`); an explicit predicate does.
function isActive(state: AppState): state is ActiveState {
  return state.phase.t !== 'setup';
}

/** After a player's decks are final (order locked or single deck confirmed). */
function advanceAfterDecks(state: ActiveState, player: 0 | 1): ActiveState {
  return {
    ...state,
    phase: player === 0 ? { t: 'handoff', player: 1 } : { t: 'match' },
  };
}

function reducer(state: AppState, action: Action): AppState {
  if (action.type === 'start') {
    const pools: [CardData[], CardData[]] = isConstructed(action.config.mode)
      ? [[], []]
      : dealPools(
          action.cube,
          action.config.poolSize,
          action.config.allowRepeats,
          MODE_RULES[action.config.mode].poolSort
        );
    return {
      phase: { t: 'handoff', player: 0 },
      config: action.config,
      cube: action.cube,
      pools,
      decks: [
        emptyDecks(action.config.decksPerPlayer),
        emptyDecks(action.config.decksPerPlayer),
      ],
      matchups: createMatchups(
        action.config.decksPerPlayer,
        MODE_RULES[action.config.mode].randomFirstPlayer
      ),
      currentMatchup: 0,
      catalogue: action.catalogue,
    };
  }

  if (action.type === 'new-game') {
    return {
      phase: { t: 'setup' },
      lastConfig: isActive(state) ? state.config : state.lastConfig,
    };
  }
  if (!isActive(state)) return state;

  switch (action.type) {
    case 'reveal':
      if (state.phase.t !== 'handoff') return state;
      return { ...state, phase: { t: 'build', player: state.phase.player } };
    case 'set-slot': {
      const selectedDeck = state.decks[action.player][action.deck];
      if (!selectedDeck || action.slot < 0 || action.slot > 2) return state;
      const changedDeck: DeckSlots = [...selectedDeck];
      changedDeck[action.slot] = action.ref;
      const changedPlayerDecks = state.decks[action.player].map((deck, index) =>
        index === action.deck ? changedDeck : deck
      );
      const changedDecks: [DeckSlots[], DeckSlots[]] =
        action.player === 0
          ? [changedPlayerDecks, state.decks[1]]
          : [state.decks[0], changedPlayerDecks];
      return { ...state, decks: changedDecks };
    }
    case 'add-card': {
      const newPool = [...state.pools[action.player], action.card];
      const newIndex = newPool.length - 1;
      const pools: [CardData[], CardData[]] =
        action.player === 0 ? [newPool, state.pools[1]] : [state.pools[0], newPool];
      const selectedDeck = state.decks[action.player][action.deck];
      if (!selectedDeck || action.slot < 0 || action.slot > 2) return { ...state, pools };
      const changedDeck: DeckSlots = [...selectedDeck];
      changedDeck[action.slot] = { kind: 'pool', index: newIndex };
      const changedPlayerDecks = state.decks[action.player].map((deck, index) =>
        index === action.deck ? changedDeck : deck
      );
      const decks: [DeckSlots[], DeckSlots[]] =
        action.player === 0 ? [changedPlayerDecks, state.decks[1]] : [state.decks[0], changedPlayerDecks];
      return { ...state, pools, decks };
    }
    case 'submit-decks':
      if (state.config.decksPerPlayer > 1) {
        return { ...state, phase: { t: 'order', player: action.player } };
      }
      return advanceAfterDecks(state, action.player);
    case 'reorder-deck': {
      const list = state.decks[action.player];
      if (
        action.from < 0 ||
        action.from >= list.length ||
        action.to < 0 ||
        action.to >= list.length ||
        action.from === action.to
      ) {
        return state;
      }
      const reordered = list.slice();
      const [moved] = reordered.splice(action.from, 1);
      reordered.splice(action.to, 0, moved);
      const changedDecks: [DeckSlots[], DeckSlots[]] =
        action.player === 0 ? [reordered, state.decks[1]] : [state.decks[0], reordered];
      return { ...state, decks: changedDecks };
    }
    case 'back-to-build':
      return { ...state, phase: { t: 'build', player: action.player } };
    case 'confirm-order':
      return advanceAfterDecks(state, action.player);
    case 'record': {
      if (state.phase.t !== 'match' || state.currentMatchup >= state.matchups.length) {
        return state;
      }
      const matchups = state.matchups.map((matchup, index) =>
        index === state.currentMatchup ? { ...matchup, result: action.result } : matchup
      );
      const next = state.currentMatchup + 1;
      if (next >= matchups.length) {
        return { ...state, matchups, currentMatchup: matchups.length - 1, phase: { t: 'results' } };
      }
      return { ...state, matchups, currentMatchup: next };
    }
    case 'goto-matchup':
      return {
        ...state,
        currentMatchup: Math.max(0, Math.min(action.index, state.matchups.length - 1)),
      };
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeList = useMemo(() => {
    if (!isActive(state) || !state.config.banlistId) return null;
    return loadCustomLists().find((l) => l.id === state.config.banlistId) ?? null;
  }, [isActive(state) ? state.config.banlistId : undefined]);

  const activeCatalogue = useMemo(() => {
    if (!isActive(state)) return undefined;
    if (!state.catalogue) return state.catalogue;
    return activeList
      ? { ...state.catalogue, banned: effectiveBanned(state.catalogue.banned, activeList) }
      : state.catalogue;
  }, [isActive(state) ? state.catalogue : undefined, activeList]);

  const banlist = useMemo(
    () =>
      isActive(state) && isConstructed(state.config.mode) && activeCatalogue
        ? {
            title: activeList ? activeList.name : 'Official 3CB',
            cards: activeCatalogue.cards
              .filter((card) => activeCatalogue.banned.has(card.name))
              .map((card) => ({ name: card.name, scryfallId: card.scryfallId })),
            subtitle: `${activeCatalogue.banned.size} cards`,
            ...(activeList
              ? {
                  deviations: { added: activeList.added, removed: activeList.removed },
                  baseLabel: 'Official 3CB',
                }
              : {}),
          }
        : undefined,
    [activeCatalogue, activeList]
  );

  const phaseTag = isActive(state)
    ? `${state.phase.t}${'player' in state.phase ? `-${state.phase.player}` : ''}`
    : 'setup';
  // Every screen change starts scrolled to the top (e.g. the results screen
  // after a scrolled match, or the second player's build after a handoff).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phaseTag]);

  let screen: ComponentChildren = null;

  if (!isActive(state)) {
    screen = (
      <>
        <InstallBanner />
        <StartScreen
          initial={state.lastConfig}
          onStart={(config, cube, catalogue) => dispatch({ type: 'start', config, cube, catalogue })}
        />
      </>
    );
  } else {
    switch (state.phase.t) {
      case 'handoff': {
        // The handoff is the only screen BOTH players are guaranteed to read,
        // so it has to name the list actually in force. Saying "Official 3CB"
        // while a custom list quietly legalises Black Lotus is worse than
        // saying nothing at all.
        const terms =
          isConstructed(state.config.mode) && activeCatalogue
            ? {
                title: activeList ? activeList.name : 'Official 3CB',
                detail: activeList
                  ? `${activeCatalogue.banned.size} banned - official +${activeList.added.length} -${activeList.removed.length}`
                  : `${activeCatalogue.banlist.count} banned - synced ${activeCatalogue.banlist.fetchedAt}`,
              }
            : undefined;
        screen = (
          <HandoffScreen
            name={state.config.playerNames[state.phase.player]}
            player={state.phase.player}
            poolSize={state.config.poolSize}
            deckCount={state.config.decksPerPlayer}
            terms={terms}
            banlist={banlist}
            onReveal={() => dispatch({ type: 'reveal' })}
          />
        );
        break;
      }
      case 'build': {
        const player = state.phase.player;
        screen = isConstructed(state.config.mode) && activeCatalogue ? (
          <ConstructedBuildScreen
            player={player}
            name={state.config.playerNames[player]}
            catalogue={activeCatalogue}
            basics={basicsFromCatalogue(activeCatalogue)}
            pool={state.pools[player]}
            decks={state.decks[player]}
            onAddCard={(card, deck, slot) => dispatch({ type: 'add-card', player, card, deck, slot })}
            onSetSlot={(deck, slot, ref) =>
              dispatch({ type: 'set-slot', player, deck, slot, ref })
            }
            onSubmit={() => dispatch({ type: 'submit-decks', player })}
          />
        ) : (
          <BuildScreen
            player={player}
            name={state.config.playerNames[player]}
            pool={state.pools[player]}
            basics={state.cube.basics}
            allowBasics={MODE_RULES[state.config.mode].allowBasics}
            decks={state.decks[player]}
            onSetSlot={(deck, slot, ref) =>
              dispatch({ type: 'set-slot', player, deck, slot, ref })
            }
            onSubmit={() => dispatch({ type: 'submit-decks', player })}
          />
        );
        break;
      }
      case 'order': {
        const player = state.phase.player;
        screen = (
          <OrderScreen
            name={state.config.playerNames[player]}
            player={player}
            opponentName={state.config.playerNames[player === 0 ? 1 : 0]}
            decks={state.decks[player]}
            pool={state.pools[player]}
            basics={state.cube.basics}
            onReorder={(from, to) => dispatch({ type: 'reorder-deck', player, from, to })}
            onBack={() => dispatch({ type: 'back-to-build', player })}
            onConfirm={() => dispatch({ type: 'confirm-order', player })}
          />
        );
        break;
      }
      case 'match':
        screen = (
          <MatchScreen
            state={state}
            onRecord={(result) => dispatch({ type: 'record', result })}
            onGoto={(index) => dispatch({ type: 'goto-matchup', index })}
          />
        );
        break;
      case 'results':
        screen = (
          <ResultsScreen
            state={state}
            onNewGame={() => dispatch({ type: 'new-game' })}
          />
        );
        break;
    }
  }

  return <div class="app-shell">{screen}</div>;
}
