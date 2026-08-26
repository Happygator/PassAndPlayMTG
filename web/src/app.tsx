import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useReducer, useState } from 'preact/hooks';
import { BuildScreen } from './components/BuildScreen';
import { ConstructedBuildScreen } from './components/ConstructedBuildScreen';
import { HandoffScreen } from './components/HandoffScreen';
import { MatchScreen } from './components/MatchScreen';
import { OrderScreen } from './components/OrderScreen';
import {
  InstallBanner,
  capabilities,
  hasNativeBridge,
  onIncomingState,
  onPresentationChange,
  receiveMessageState,
  requestExpanded,
  sendMessageState,
} from '@platform';
import { ResultsScreen } from './components/ResultsScreen';
import { ResumeGate } from './components/ResumeGate';
import { StartScreen } from './components/StartScreen';
import { buildSavedGame, clearSavedGame, peekSavedGame, restoreGame, saveGame } from './resume';
import { MESSAGE_VERSION, messageStateFromUrl, messageStateToUrl } from './messageState';
import type { MessageState } from './messageState';
import { MessageHarness } from './components/MessageHarness';
import { WaitingScreen } from './components/WaitingScreen';
import { CompactView } from './components/CompactView';
import type { RestoredGame } from './resume';
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
  | {
      type: 'start';
      config: GameConfig;
      cube: CubeData;
      catalogue?: Catalogue;
      /** Already-dealt pools; booster games open their packs on the start screen. */
      pools?: [CardData[], CardData[]];
    }
  | { type: 'add-card'; player: 0 | 1; card: CardData; deck: number; slot: number }
  | { type: 'reveal' }
  | { type: 'set-slot'; player: 0 | 1; deck: number; slot: number; ref: CardRef | null }
  | { type: 'submit-decks'; player: 0 | 1 }
  | { type: 'reorder-deck'; player: 0 | 1; from: number; to: number }
  | { type: 'back-to-build'; player: 0 | 1 }
  | { type: 'confirm-order'; player: 0 | 1 }
  | { type: 'record'; result: MatchResult }
  | { type: 'goto-matchup'; index: number }
  | { type: 'restore'; game: RestoredGame }
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
    // A booster game arrives with its pools already opened: the set's collation
    // decides what is in a pack, so there is nothing here to deal from.
    const pools: [CardData[], CardData[]] =
      action.pools ??
      (isConstructed(action.config.mode)
        ? [[], []]
        : dealPools(
            action.cube,
            action.config.poolSize,
            action.config.allowRepeats,
            MODE_RULES[action.config.mode].poolSort
          ));
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

  // Handled before the isActive guard: restoring is the one action that runs
  // FROM the setup screen and produces a live game.
  if (action.type === 'restore') {
    // safeResumePhase never returns 'setup', so this branch is unreachable in
    // practice; it exists because Phase includes 'setup' structurally and
    // ActiveState excludes it.
    if (action.game.phase.t === 'setup') return state;
    return {
      phase: action.game.phase,
      config: action.game.config,
      cube: action.game.cube,
      pools: action.game.pools,
      decks: action.game.decks,
      matchups: action.game.matchups,
      currentMatchup: action.game.currentMatchup,
      catalogue: action.game.catalogue,
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
  // Read once, during the first render, and BEFORE anything can overwrite it.
  const [saved, setSaved] = useState(peekSavedGame);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Persist after every change to a live game. iOS discards a backgrounded
  // WebView without warning, so there is no "save on exit" moment to hook --
  // the only reliable point is every point. Cheap enough to do unconditionally:
  // pools are stored as ids, so a payload is a few KB (APP-MIGRATION.md M7).
  useEffect(() => {
    if (isActive(state)) saveGame(state);
  }, [state]);

  const resumeSavedGame = () => {
    if (!saved || resuming) return;
    setResuming(true);
    setResumeError(null);
    restoreGame(saved)
      .then((game) => {
        setSaved(null);
        dispatch({ type: 'restore', game });
      })
      .catch((err: unknown) =>
        setResumeError(
          err instanceof Error ? err.message : 'That saved game could not be restored.'
        )
      )
      .finally(() => setResuming(false));
  };

  const discardSavedGame = () => {
    clearSavedGame();
    setSaved(null);
    setResumeError(null);
  };

  // --- Messaging channel -------------------------------------------------
  // All of this is compile-time dead outside the imessage build: capabilities
  // is a const, so the bundler drops the branches and the imports with them.
  const [messageError, setMessageError] = useState<string | null>(null);
  /**
   * Which end of the conversation this device is on. LOCAL state on purpose:
   * it is not a property of the game and must never travel in the payload --
   * both devices decode the same message and would otherwise both believe they
   * were waiting. Set when this device stages a message, cleared when one
   * arrives (APP-MIGRATION.md section 5).
   */
  const [awaitingReply, setAwaitingReply] = useState(false);
  // The extension always opens compact, so that is the honest default -- but
  // only when Swift is actually there to change it. In a browser nothing ever
  // calls __setPresentation, so defaulting to compact would strand the dev
  // server on the tap-to-open screen; the harness toggles it instead.
  const [expanded, setExpanded] = useState(() => !hasNativeBridge());

  const applyIncoming = (incoming: MessageState) => {
    setMessageError(null);
    // A message arrived, so this device is no longer the one waiting.
    setAwaitingReply(false);
    restoreGame(incoming)
      .then((game) => {
        setSaved(null);
        dispatch({ type: 'restore', game });
      })
      .catch((err: unknown) =>
        setMessageError(
          err instanceof Error ? err.message : 'That message could not be opened.'
        )
      );
  };

  useEffect(() => {
    if (!capabilities.messaging) return;
    return onPresentationChange(setExpanded);
  }, []);

  useEffect(() => {
    if (!capabilities.messaging) return;
    // Two sources: the payload the extension opened with, and anything Swift
    // delivers later -- willBecomeActive fires on every presentation, not just
    // the first, so a one-shot read would miss the opponent's reply.
    const opened = receiveMessageState();
    if (opened) applyIncoming(opened);
    return onIncomingState(applyIncoming);
  }, []);

  const buildOutgoing = (): string | null => {
    if (!isActive(state)) return null;
    const payload: MessageState = {
      ...buildSavedGame(state, state.phase),
      // The opposing pool is IN the payload either way -- this only says
      // whether the receiving app may draw it (APP-MIGRATION.md §6.4). Both
      // decks are locked once the match begins, so that is the reveal point.
      revealed: state.phase.t === 'match' || state.phase.t === 'results',
      v: MESSAGE_VERSION,
    };
    const caption = `${state.config.playerNames[0]} vs ${state.config.playerNames[1]}`;
    sendMessageState(payload, caption);
    setAwaitingReply(true);
    return messageStateToUrl(payload);
  };

  const receiveOutgoing = (url: string) => {
    const incoming = messageStateFromUrl(url);
    if (!incoming) {
      setMessageError('That is not a payload this version can open.');
      return;
    }
    applyIncoming(incoming);
  };
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

  /**
   * In a conversation there is nobody to pass the device to, so a handoff phase
   * means this player's own turn and opens straight into building. The one
   * exception is the device that just sent: it waits instead (Edit 3b).
   *
   * `capabilities.messaging` is a compile-time constant, so for the web and app
   * channels this whole effect tree-shakes away and the handoff screen behaves
   * exactly as before.
   */
  useEffect(() => {
    if (!capabilities.messaging || awaitingReply) return;
    if (isActive(state) && state.phase.t === 'handoff') dispatch({ type: 'reveal' });
  }, [phaseTag, awaitingReply]);

  let screen: ComponentChildren = null;

  if (!isActive(state)) {
    // An unfinished game takes the whole screen: the new-game form is not drawn
    // until it has been resumed or discarded, so the start screen never has to
    // compete with it for room on a phone.
    screen = saved ? (
      <ResumeGate
        savedAt={saved.savedAt}
        label={`${saved.config.playerNames[0]} vs ${saved.config.playerNames[1]} — ${
          MODE_RULES[saved.config.mode] ? MODE_RULES[saved.config.mode].label : 'Saved game'
        }`}
        busy={resuming}
        error={resumeError}
        onResume={resumeSavedGame}
        onDiscard={discardSavedGame}
      />
    ) : (
      <>
        <InstallBanner />
        <StartScreen
          initial={state.lastConfig}
          onStart={(config, cube, catalogue, pools) =>
            dispatch({ type: 'start', config, cube, catalogue, pools })
          }
        />
      </>
    );
  } else {
    switch (state.phase.t) {
      case 'handoff': {
        // The messaging channel never shows a handoff: either the effect above
        // has already advanced this device to build, or this is the device that
        // sent and is waiting for a reply.
        if (capabilities.messaging) {
          screen = (
            <WaitingScreen
              opponentName={state.config.playerNames[state.phase.player]}
              staged={awaitingReply}
            />
          );
          break;
        }
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
            onNewGame={() => {
              // The game is over: its save has served its purpose, and leaving
              // it would offer to resume a finished game on the next launch.
              clearSavedGame();
              dispatch({ type: 'new-game' });
            }}
          />
        );
        break;
    }
  }

  // Compact replaces the whole screen rather than wrapping it: the tray cannot
  // show a game, and rendering one behind this would decode card images for a
  // view nobody can see -- the exact cost §6.6 is about.
  const compact = capabilities.messaging && !expanded;
  const compactTitle = isActive(state)
    ? `${state.config.playerNames[0]} vs ${state.config.playerNames[1]}`
    : 'Sealed pass-and-play';
  const compactDetail = isActive(state)
    ? 'Tap to open the game.'
    : 'Tap to start a game in this conversation.';

  return (
    <div class="app-shell">
      {compact ? (
        <CompactView title={compactTitle} detail={compactDetail} onOpen={requestExpanded} />
      ) : (
        screen
      )}
      {capabilities.messaging && import.meta.env.DEV && (
        <MessageHarness
          buildOutgoing={buildOutgoing}
          onReceive={receiveOutgoing}
          error={messageError}
          expanded={expanded}
          onToggleExpanded={() => setExpanded(!expanded)}
        />
      )}
    </div>
  );
}
