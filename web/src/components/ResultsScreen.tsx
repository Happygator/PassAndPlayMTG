import { useState } from 'preact/hooks';
import { cardImageSrc } from '@platform';
import {
  deckNames,
  formatPoints,
  isConstructed,
  isDecisive,
  resolveRef,
  resultPillLabel,
  resultSide,
  tally,
} from '../game';
import type { CardData, DeckSlots, GameState, MatchResult } from '../types';

interface ResultsScreenProps {
  state: GameState;
  onNewGame: () => void;
}

interface Pairing {
  p1Deck: number;
  p2Deck: number;
}

interface ReadOnlyDeckProps {
  label: string;
  deck: DeckSlots;
  pool: CardData[];
  basics: CardData[];
}

function ReadOnlyDeck({ label, deck, pool, basics }: ReadOnlyDeckProps) {
  return (
    <section class="match-deck">
      <h3>{label}</h3>
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
    </section>
  );
}

function outcomeClass(result: MatchResult | null): string {
  return `${resultSide(result ?? 'even')}-favored`;
}

function collectPoolUsage(decks: DeckSlots[]): Map<number, number> {
  const usage = new Map<number, number>();
  decks.forEach((deck, deckIndex) => {
    deck.forEach((ref) => {
      if (ref?.kind === 'pool') usage.set(ref.index, deckIndex);
    });
  });
  return usage;
}

export function ResultsScreen({ state, onNewGame }: ResultsScreenProps) {
  const [selectedPairing, setSelectedPairing] = useState<Pairing | null>(null);
  const [showPools, setShowPools] = useState(false);
  // In constructed mode, "pools[player]" is just the cards the player pulled
  // in while building, plus orphaned entries from cards added then removed.
  // A "full pool" reveal there would show rejected search results as if they
  // were a dealt sealed pool, so skip the reveal entirely in that mode.
  const poolsWorthShowing = !isConstructed(state.config.mode);
  const [playerOnePoints, playerTwoPoints] = tally(state.matchups);
  const playerOneName = state.config.playerNames[0];
  const playerTwoName = state.config.playerNames[1];
  const formattedOne = formatPoints(playerOnePoints);
  const formattedTwo = formatPoints(playerTwoPoints);
  const winnerText =
    playerOnePoints === playerTwoPoints
      ? `Tied ${formattedOne}-${formattedTwo}`
      : playerOnePoints > playerTwoPoints
        ? `${playerOneName} wins ${formattedOne}-${formattedTwo}!`
        : `${playerTwoName} wins ${formattedTwo}-${formattedOne}!`;
  const selectedMatchup = selectedPairing
    ? state.matchups.find(
        (matchup) =>
          matchup.p1Deck === selectedPairing.p1Deck &&
          matchup.p2Deck === selectedPairing.p2Deck
      )
    : undefined;
  const playerOneUsage = collectPoolUsage(state.decks[0]);
  const playerTwoUsage = collectPoolUsage(state.decks[1]);

  return (
    <main class="screen results-screen">
      <div class="winner-banner">
        <h1>{winnerText}</h1>
      </div>

      <button type="button" class="primary-button play-again" onClick={onNewGame}>
        Play again
      </button>

      <section class="results-section">
        {/* One ruled block per match rather than a bordered card each: the
            number is a centred band, which stops it competing with the first
            card name for the start of the line, and gives the first-player
            note somewhere to live at no extra height. */}
        <table class="ledger">
          <tbody>
            {state.matchups.flatMap((matchup, i) => {
              const result = matchup.result!;
              return [
                <tr class="mrow" key={`band-${i}`}>
                  <td colSpan={2}>
                    Match {i + 1}
                    {matchup.onPlay !== undefined && (
                      <>
                        {' · '}
                        <span class={matchup.onPlay === 0 ? 'p1-text' : 'p2-text'}>
                          {state.config.playerNames[matchup.onPlay]}
                        </span>
                        {' went first'}
                      </>
                    )}
                  </td>
                </tr>,
                <tr class="grouped" key={`row-${i}`}>
                  <td class="decks">
                    {/* The winning deck takes the ink and a left edge in its
                        owner's colour; the loser stays muted with a
                        transparent edge. A draw leaves both muted rather than
                        picking an arbitrary winner, so neither edge lights up.
                        The p1/p2 class is positional and always present — it
                        only says which colour the edge WOULD be, and
                        .deck-won is what turns it on. */}
                    <div class={`deck-line deck-line--p1${resultSide(result) === 'p1' ? ' deck-won' : ''}`}>
                      {deckNames(state.decks[0][matchup.p1Deck], state.pools[0], state.cube.basics)}
                    </div>
                    <div class={`deck-line deck-line--p2${resultSide(result) === 'p2' ? ' deck-won' : ''}`}>
                      {deckNames(state.decks[1][matchup.p2Deck], state.pools[1], state.cube.basics)}
                    </div>
                  </td>
                  <td class="ledger-result">
                    <button
                      type="button"
                      class={`pairing-outcome ${outcomeClass(result)}${isDecisive(result) ? '' : ' outcome-edge'}`}
                      onClick={() => setSelectedPairing({ p1Deck: i, p2Deck: i })}
                    >
                      {resultPillLabel(result, state.config.playerNames)}
                    </button>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </section>

      {selectedPairing && selectedMatchup && (
        <section class="panel pairing-detail">
          <h2>
            Deck {selectedPairing.p1Deck + 1} vs Deck {selectedPairing.p2Deck + 1}
          </h2>
          <ReadOnlyDeck
            label={`${playerOneName} -- Deck ${selectedPairing.p1Deck + 1}`}
            deck={state.decks[0][selectedPairing.p1Deck]}
            pool={state.pools[0]}
            basics={state.cube.basics}
          />
          <ReadOnlyDeck
            label={`${playerTwoName} -- Deck ${selectedPairing.p2Deck + 1}`}
            deck={state.decks[1][selectedPairing.p2Deck]}
            pool={state.pools[1]}
            basics={state.cube.basics}
          />
        </section>
      )}

      {poolsWorthShowing && (showPools ? (
        <section class="full-pools">
          <h2>Full pools</h2>
          <div class="pool-reveal">
            <h3>{playerOneName}</h3>
            <div class="pool-grid">
              {state.pools[0].map((card, index) => {
                const deckIndex = playerOneUsage.get(index);
                return (
                  <div class="card-thumb" key={`${card.scryfallId}-${index}`}>
                    <img src={cardImageSrc(card)} alt={card.name} draggable={false} />
                    {deckIndex !== undefined && (
                      <span class="deck-badge">Deck {deckIndex + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div class="pool-reveal">
            <h3>{playerTwoName}</h3>
            <div class="pool-grid">
              {state.pools[1].map((card, index) => {
                const deckIndex = playerTwoUsage.get(index);
                return (
                  <div class="card-thumb" key={`${card.scryfallId}-${index}`}>
                    <img src={cardImageSrc(card)} alt={card.name} draggable={false} />
                    {deckIndex !== undefined && (
                      <span class="deck-badge">Deck {deckIndex + 1}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <button
          type="button"
          class="secondary-button show-pools"
          onClick={() => setShowPools(true)}
        >
          See full pools
        </button>
      ))}

    </main>
  );
}
