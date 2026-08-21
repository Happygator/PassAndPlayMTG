import { useState } from 'preact/hooks';
import { MODE_RULES, formatPoints, resolveRef, resultButtonLabel, resultSide, tally } from '../game';
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
  label: string;
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
}

function MatchDeck({
  label,
  deck,
  pool,
  basics,
  hidden,
  player,
  matchupIndex,
  revealed,
  onReveal,
  cubeNames,
}: MatchDeckProps) {
  const [query, setQuery] = useState('');
  const [miss, setMiss] = useState(false);

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

  return (
    <section class="match-deck">
      <div class="match-deck-header">
        <h2>{label}</h2>
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
              placeholder="Play a card..."
              aria-label={`${label}: play a card by name`}
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
      {hidden && miss && <p class="play-card-miss">Not in this deck.</p>}
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
              <img src={`./${card.imagePath}`} alt={card.name} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function MatchScreen({ state, onRecord, onGoto }: MatchScreenProps) {
  const rules = MODE_RULES[state.config.mode];
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [playerOnePoints, playerTwoPoints] = tally(state.matchups);
  const playerOneName = state.config.playerNames[0];
  const playerTwoName = state.config.playerNames[1];
  const tallyLine = (
    <p class="running-tally">
      {playerOneName} {formatPoints(playerOnePoints)} - {formatPoints(playerTwoPoints)}{' '}
      {playerTwoName}
    </p>
  );

  // Suggestions span the whole cube so the list reveals nothing about either deck.
  const allCards = [...state.cube.cards, ...state.cube.basics];
  const nameOptions = [...new Set(allCards.map((card) => card.name.split(' // ')[0].trim()))].sort();
  const cubeNames = new Set(nameOptions.map((name) => name.toLowerCase()));

  const matchup = state.matchups[state.currentMatchup];
  const resultChoices = rules.results.map((result) => ({ result, label: resultButtonLabel(result, [playerOneName, playerTwoName] as [string, string]), className: `${resultSide(result)}-result` }));
  const reveal = (key: string) => setRevealed((prev) => new Set(prev).add(key));

  return (
    <main class="screen match-screen">
      <header class="screen-header">
        <h1>Matchup {state.currentMatchup + 1} of {state.matchups.length}</h1>
        {tallyLine}
      </header>

      {rules.hiddenCards && (
        <datalist id={NAMES_LIST_ID}>
          {nameOptions.map((name) => (
            <option value={name} key={name} />
          ))}
        </datalist>
      )}

      <MatchDeck
        label={`${playerOneName} -- Deck ${matchup.p1Deck + 1}`}
        deck={state.decks[0][matchup.p1Deck]}
        pool={state.pools[0]}
        basics={state.cube.basics}
        hidden={rules.hiddenCards}
        player={0}
        matchupIndex={state.currentMatchup}
        revealed={revealed}
        onReveal={reveal}
        cubeNames={cubeNames}
      />
      <div class="versus">vs</div>
      <MatchDeck
        label={`${playerTwoName} -- Deck ${matchup.p2Deck + 1}`}
        deck={state.decks[1][matchup.p2Deck]}
        pool={state.pools[1]}
        basics={state.cube.basics}
        hidden={rules.hiddenCards}
        player={1}
        matchupIndex={state.currentMatchup}
        revealed={revealed}
        onReveal={reveal}
        cubeNames={cubeNames}
      />

      <div class={`result-buttons results-${rules.results.length}`}>
        {resultChoices.map((choice) => (
          <button
            type="button"
            key={choice.result}
            class={`${choice.className}${matchup.result === choice.result ? ' selected-result' : ''}`}
            onClick={() => onRecord(choice.result)}
          >
            {choice.label}
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
        Previous
      </button>
    </main>
  );
}
