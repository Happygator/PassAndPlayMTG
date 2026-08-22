import type { ComponentChildren } from 'preact';
import { useEffect, useReducer } from 'preact/hooks';
import { BuildScreen } from './components/BuildScreen';
import { HandoffScreen } from './components/HandoffScreen';
import { MatchScreen } from './components/MatchScreen';
import { OrderScreen } from './components/OrderScreen';
import { PwaBanner } from './components/PwaBanner';
import { ResultsScreen } from './components/ResultsScreen';
import { StartScreen } from './components/StartScreen';
import { MODE_RULES, createMatchups, dealPools, emptyDecks } from './game';
import type {
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
type ActiveState = Omit<GameState, 'phase'> & { phase: Exclude<Phase, { t: 'setup' }> };
type AppState = SetupState | ActiveState;

type Action =
  | { type: 'start'; config: GameConfig; cube: CubeData }
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
    const pools = dealPools(
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
        <PwaBanner />
        <StartScreen
          initial={state.lastConfig}
          onStart={(config, cube) => dispatch({ type: 'start', config, cube })}
        />
      </>
    );
  } else {
    switch (state.phase.t) {
      case 'handoff':
        screen = (
          <HandoffScreen
            name={state.config.playerNames[state.phase.player]}
            onReveal={() => dispatch({ type: 'reveal' })}
          />
        );
        break;
      case 'build': {
        const player = state.phase.player;
        screen = (
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
