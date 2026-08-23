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

const NAMES_LIST_ID = 'cube-card-names';

/** Front-face name, trimmed and lowercased, for case-insensitive matching. */
function frontName(name: string): string {
  return name.split(' // ')[0].trim().toLowerCase();
}

interface MatchDeckProps {
  name: string;
  deckNumber: number;
  deck: DeckSlots;
  pool: CardData[];
  basics: CardData[];
  hidden: boolean;
  player: 0 | 1;
  matchupIndex: number;
  revealed: Set<string>;
  onReveal: (key: string) => void;
  /** Lowercased front-face names of every card in the cube (for auto-reveal on a picked suggestion). */
  cubeNames: Set<string>;
  /** Player 2's label and reveal field sit BELOW the cards, mirroring player 1 across the "vs". */
  labelBelow: boolean;
}

function MatchDeck({
  name,
  deckNumber,
  deck,
  pool,
  basics,
  hidden,
  player,
  matchupIndex,
  revealed,
  onReveal,
  cubeNames,
  labelBelow,
}: MatchDeckProps) {
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState(false);
  const playerClass = player === 0 ? 'p1-text' : 'p2-text';

  // Reveal-by-name: the player says what they are casting instead of guessing
  // a position, so the wrong card can never be flipped by mistake.
  const revealByName = (value: string): boolean => {
    const wanted = frontName(value);
    if (!wanted) return false;
    const slot = deck.findIndex(
      (ref) => ref !== null && frontName(resolveRef(ref, pool, basics).name) === wanted
    );
    if (slot === -1) {
      setMiss(true);
      return false;
    }
    onReveal(`${matchupIndex}:${player}:${slot}`);
    setQuery('');
    setMiss(false);
    return true;
  };

  const header = (
    <div class="match-deck-header">
      <h2>
        <span class={playerClass}>{name}</span>
      </h2>
      {hidden && (
        <form
          class="play-card"
          onSubmit={(event) => {
            event.preventDefault();
            revealByName(query);
          }}
        >
          <input
            type="text"
            list={NAMES_LIST_ID}
            placeholder="Reveal by name..."
            aria-label={`${name}, deck ${deckNumber}: reveal a card by name`}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setMiss(false);
            }}
            onChange={(event) => {
              // Fires when a suggestion is picked: reveal immediately if it is a real cube card.
              const value = event.currentTarget.value;
              if (cubeNames.has(frontName(value))) revealByName(value);
            }}
          />
          <button type="submit">Reveal</button>
        </form>
      )}
    </div>
  );
  const missLine = hidden && miss ? <p class="play-card-miss">Not in this deck.</p> : null;
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
          {missLine}
        </>
      ) : (
        <>
          {header}
          {missLine}
          {cards}
        </>
      )}
    </section>
  );
}

export function MatchScreen({ state, onRecord, onGoto }: MatchScreenProps) {
  const rules = MODE_RULES[state.config.mode];
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const playerOneName = state.config.playerNames[0];
  const playerTwoName = state.config.playerNames[1];

  // Suggestions span the whole cube so the list reveals nothing about either deck.
  const allCards = [...state.cube.cards, ...state.cube.basics];
  const nameOptions = [...new Set(allCards.map((card) => card.name.split(' // ')[0].trim()))].sort();
  const cubeNames = new Set(nameOptions.map((name) => name.toLowerCase()));

  const matchup = state.matchups[state.currentMatchup];
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

      {rules.hiddenCards && (
        <datalist id={NAMES_LIST_ID}>
          {nameOptions.map((name) => (
            <option value={name} key={name} />
          ))}
        </datalist>
      )}

      <MatchDeck
        name={playerOneName}
        deckNumber={matchup.p1Deck + 1}
        deck={state.decks[0][matchup.p1Deck]}
        pool={state.pools[0]}
        basics={state.cube.basics}
        hidden={rules.hiddenCards}
        player={0}
        matchupIndex={state.currentMatchup}
        revealed={revealed}
        onReveal={reveal}
        cubeNames={cubeNames}
        labelBelow={false}
      />
      <div class="versus">vs</div>
      <MatchDeck
        name={playerTwoName}
        deckNumber={matchup.p2Deck + 1}
        deck={state.decks[1][matchup.p2Deck]}
        pool={state.pools[1]}
        basics={state.cube.basics}
        hidden={rules.hiddenCards}
        player={1}
        matchupIndex={state.currentMatchup}
        revealed={revealed}
        onReveal={reveal}
        cubeNames={cubeNames}
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
