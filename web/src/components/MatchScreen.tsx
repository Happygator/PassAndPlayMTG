import { useState } from 'preact/hooks';
import { cardImageSrc } from '@platform';
import {
  MODE_RULES,
  resolveRef,
  resultButtonLabel,
  resultLabel,
  resultNote,
  resultSide,
} from '../game';
import type { CardData, DeckSlots, GameState, MatchResult } from '../types';

interface MatchScreenProps {
  state: GameState;
  onRecord: (result: MatchResult) => void;
  onGoto: (index: number) => void;
}

interface DeckCardsProps {
  deck: DeckSlots;
  pool: CardData[];
  basics: CardData[];
}

/** A deck's three cards, face up. Shared by the private view and the results-style rows. */
function DeckCards({ deck, pool, basics }: DeckCardsProps) {
  return (
    <div class="match-card-row">
      {deck.map((ref, index) => {
        if (ref === null) return <div class="empty-slot" key={index} />;
        const card = resolveRef(ref, pool, basics);
        return (
          <div class="card-thumb" key={index}>
            <img src={cardImageSrc(card)} alt={card.name} draggable={false} />
          </div>
        );
      })}
    </div>
  );
}

interface DeckPeekProps {
  name: string;
  player: 0 | 1;
  decks: DeckSlots[];
  pool: CardData[];
  basics: CardData[];
  /** Which deck this matchup is being played with; marked so it is found at a glance. */
  currentDeck: number;
  onClose: () => void;
}

/**
 * A player's own decks, shown privately.
 *
 * Pai Gow submits twelve cards across four decks and then plays them face-down
 * over four matchups, which is more than anyone reliably remembers. This takes
 * the whole screen rather than opening beside the board: the device is being
 * passed, and a panel sharing the screen with the opponent's cards is a panel
 * the opponent can read over your shoulder. Nothing here reveals anything on
 * the shared board — looking at your own cards is not playing them.
 */
function DeckPeek({ name, player, decks, pool, basics, currentDeck, onClose }: DeckPeekProps) {
  return (
    <main class={`screen deck-peek player-${player + 1}`}>
      <header class="screen-header">
        <p class="kicker">For {name} only</p>
        <h1>Your decks</h1>
        <p class="muted">Turn the device away from your opponent.</p>
      </header>

      {decks.map((deck, index) => (
        <section
          class={`match-deck peek-deck${index === currentDeck ? ' peek-deck--current' : ''}`}
          key={index}
        >
          <h3>
            Deck {index + 1}
            {index === currentDeck && <span class="peek-now">playing now</span>}
          </h3>
          <DeckCards deck={deck} pool={pool} basics={basics} />
        </section>
      ))}

      <button type="button" class="primary-button" onClick={onClose}>
        Done
      </button>
    </main>
  );
}

interface DeckPeekConfirmProps {
  name: string;
  player: 0 | 1;
  deckCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The step between tapping "Deck reminder" and actually seeing the cards.
 *
 * The button sits inches from the face-down board on a device being passed
 * back and forth, so a mis-tap is easy and its cost is asymmetric: cards seen
 * cannot be unseen, and the opponent may still be holding the device. One
 * deliberate confirmation makes the reveal intentional and gives a mis-tap a
 * way out.
 */
function DeckPeekConfirm({ name, player, deckCount, onConfirm, onCancel }: DeckPeekConfirmProps) {
  return (
    <main class={`screen centered-screen deck-peek-confirm player-${player + 1}`}>
      <div>
        <h1>{name}</h1>
        <p>
          {deckCount === 1
            ? 'The three cards you submitted will be shown.'
            : `Every deck you submitted will be shown — all ${deckCount}, not just the one you are playing this match.`}{' '}
          Make sure your opponent cannot see the screen.
        </p>
      </div>
      <button type="button" class="primary-button" onClick={onConfirm}>
        Show my decks
      </button>
      <button type="button" class="text-button" onClick={onCancel}>
        Back
      </button>
    </main>
  );
}

interface MatchDeckProps {
  name: string;
  deck: DeckSlots;
  pool: CardData[];
  basics: CardData[];
  hidden: boolean;
  player: 0 | 1;
  matchupIndex: number;
  revealed: Set<string>;
  onReveal: (key: string) => void;
  /** Opens this player's private view of their own decks. */
  onPeek: () => void;
  /** Player 2's label and controls sit BELOW the cards, mirroring player 1 across the "vs". */
  labelBelow: boolean;
}

function MatchDeck({
  name,
  deck,
  pool,
  basics,
  hidden,
  player,
  matchupIndex,
  revealed,
  onReveal,
  onPeek,
  labelBelow,
}: MatchDeckProps) {
  const playerClass = player === 0 ? 'p1-text' : 'p2-text';

  const header = (
    <div class="match-deck-header">
      <h2>
        <span class={playerClass}>{name}</span>
      </h2>
      {hidden && (
        <button
          type="button"
          class="peek-button"
          aria-label={`Deck reminder for ${name} — shows their own decks privately`}
          onClick={onPeek}
        >
          Deck reminder
        </button>
      )}
    </div>
  );

  const cards = (
    <div class="match-card-row">
      {deck.map((ref, index) => {
        if (ref === null) return <div class="empty-slot" key={index} />;
        const key = `${matchupIndex}:${player}:${index}`;
        if (hidden && !revealed.has(key)) {
          return (
            <button
              type="button"
              class="card-thumb card-back"
              aria-label={`Reveal card ${index + 1}`}
              onClick={() => onReveal(key)}
            >
              Reveal
            </button>
          );
        }
        const card = resolveRef(ref, pool, basics);
        return (
          <div class="card-thumb" key={index}>
            <img src={cardImageSrc(card)} alt={card.name} draggable={false} />
          </div>
        );
      })}
    </div>
  );

  return (
    <section class="match-deck">
      {labelBelow ? (
        <>
          {cards}
          {header}
        </>
      ) : (
        <>
          {header}
          {cards}
        </>
      )}
    </section>
  );
}

export function MatchScreen({ state, onRecord, onGoto }: MatchScreenProps) {
  const rules = MODE_RULES[state.config.mode];
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  // Two steps, not one: `player` is who asked, `confirmed` is whether they have
  // passed the confirmation screen. Collapsing these into one value would make
  // a mis-tap reveal the cards immediately.
  const [peek, setPeek] = useState<{ player: 0 | 1; confirmed: boolean } | null>(null);
  const playerOneName = state.config.playerNames[0];
  const playerTwoName = state.config.playerNames[1];

  const matchup = state.matchups[state.currentMatchup];

  if (peek !== null && !peek.confirmed) {
    return (
      <DeckPeekConfirm
        name={state.config.playerNames[peek.player]}
        player={peek.player}
        deckCount={state.decks[peek.player].length}
        onConfirm={() => setPeek({ player: peek.player, confirmed: true })}
        onCancel={() => setPeek(null)}
      />
    );
  }

  if (peek !== null) {
    return (
      <DeckPeek
        name={state.config.playerNames[peek.player]}
        player={peek.player}
        decks={state.decks[peek.player]}
        pool={state.pools[peek.player]}
        basics={state.cube.basics}
        currentDeck={peek.player === 0 ? matchup.p1Deck : matchup.p2Deck}
        onClose={() => setPeek(null)}
      />
    );
  }

  const resultChoices = rules.results.map((result) => ({
    result,
    label: resultButtonLabel(result, [playerOneName, playerTwoName] as [string, string]),
    note: resultNote(result),
    // The same notation the results screen uses, so the button teaches the
    // vocabulary the ledger will show rather than introducing a second one.
    score: resultLabel(result),
    className: `${resultSide(result)}-result`,
  }));
  const reveal = (key: string) => setRevealed((prev) => new Set(prev).add(key));

  return (
    <main class="screen match-screen">
      <header class="screen-header match-header">
        <h1>Match {state.currentMatchup + 1} of {state.matchups.length}</h1>
        {matchup.onPlay !== undefined && (
          <p class="first-player">
            <span class={matchup.onPlay === 0 ? 'p1-text' : 'p2-text'}>
              {state.config.playerNames[matchup.onPlay]}
            </span>{' '}
            goes first
          </p>
        )}
      </header>

      <MatchDeck
        name={playerOneName}
        deck={state.decks[0][matchup.p1Deck]}
        pool={state.pools[0]}
        basics={state.cube.basics}
        hidden={rules.hiddenCards}
        player={0}
        matchupIndex={state.currentMatchup}
        revealed={revealed}
        onReveal={reveal}
        onPeek={() => setPeek({ player: 0, confirmed: false })}
        labelBelow={false}
      />
      <div class="versus">vs</div>
      <MatchDeck
        name={playerTwoName}
        deck={state.decks[1][matchup.p2Deck]}
        pool={state.pools[1]}
        basics={state.cube.basics}
        hidden={rules.hiddenCards}
        player={1}
        matchupIndex={state.currentMatchup}
        revealed={revealed}
        onReveal={reveal}
        onPeek={() => setPeek({ player: 1, confirmed: false })}
        labelBelow={true}
      />

      {/* A hairline doing the separation that was previously done by ~85px of
          empty space, which let the cards grow to fill the width instead. */}
      <div class="match-rule" />

      <div class={`result-buttons results-${rules.results.length}`}>
        {resultChoices.map((choice) => (
          <button
            type="button"
            key={choice.result}
            class={`${choice.className}${matchup.result === choice.result ? ' selected-result' : ''}`}
            onClick={() => onRecord(choice.result)}
          >
            <span>{choice.label}</span>
            {choice.note && <span class="res-note">{choice.note}</span>}
            <span class="res-score">{choice.score}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        class="text-button"
        aria-disabled={state.currentMatchup === 0}
        onClick={() => {
          if (state.currentMatchup === 0) return;
          onGoto(state.currentMatchup - 1);
        }}
      >
        Previous match
      </button>
    </main>
  );
}
