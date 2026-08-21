import { useState } from 'preact/hooks';
import { MODE_RULES, formatPoints, resolveRef, resultButtonLabel, resultSide, tally } from '../game';
import type { CardData, DeckSlots, GameState, MatchResult } from '../types';

interface MatchScreenProps {
  state: GameState;
  onRecord: (result: MatchResult) => void;
  onGoto: (index: number) => void;
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
}: MatchDeckProps) {
  return (
    <section class="match-deck">
      <h2>{label}</h2>
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

  const matchup = state.matchups[state.currentMatchup];
  const resultChoices = rules.results.map((result) => ({ result, label: resultButtonLabel(result, [playerOneName, playerTwoName] as [string, string]), className: `${resultSide(result)}-result` }));

  return (
    <main class="screen match-screen">
      <header class="screen-header">
        <h1>Matchup {state.currentMatchup + 1} of {state.matchups.length}</h1>
        {tallyLine}
      </header>

      <MatchDeck
        label={`${playerOneName} -- Deck ${matchup.p1Deck + 1}`}
        deck={state.decks[0][matchup.p1Deck]}
        pool={state.pools[0]}
        basics={state.cube.basics}
        hidden={rules.hiddenCards}
        player={0}
        matchupIndex={state.currentMatchup}
        revealed={revealed}
        onReveal={(key: string) => setRevealed((prev) => new Set(prev).add(key))}
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
        onReveal={(key: string) => setRevealed((prev) => new Set(prev).add(key))}
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
