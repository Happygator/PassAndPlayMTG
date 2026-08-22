import { useState } from 'preact/hooks';
import { cardImageSrc, capabilities } from '@platform';
import { deckComplete, resolveRef } from '../game';
import type { CardData, CardRef, DeckSlots } from '../types';

interface BuildScreenProps {
  player: 0 | 1;
  name: string;
  pool: CardData[];
  basics: CardData[];
  allowBasics: boolean;
  decks: DeckSlots[];
  onSetSlot: (deck: number, slot: number, ref: CardRef | null) => void;
  onSubmit: () => void;
}

/**
 * How many cards fill a row at phone width. 3 is recognisable if you already
 * know the card, 2 makes rules text readable, 1 is comfortable reading. The
 * value sets a MINIMUM card width rather than a literal column count, so wider
 * screens simply fit more columns at the same card size.
 */
type CardsPerRow = 1 | 2 | 3;
const CARDS_PER_ROW_KEY = 'sealed:cards-per-row';

function loadCardsPerRow(): CardsPerRow {
  try {
    const stored = Number(window.localStorage.getItem(CARDS_PER_ROW_KEY));
    if (stored === 1 || stored === 2 || stored === 3) return stored;
  } catch {
    // Storage disabled (private browsing, embedded webview): use the default.
  }
  return 3;
}

function saveCardsPerRow(value: CardsPerRow) {
  try {
    window.localStorage.setItem(CARDS_PER_ROW_KEY, String(value));
  } catch {
    // Not worth surfacing: the setting simply does not persist.
  }
}

interface CardThumbnailProps {
  card: CardData;
  onSelect?: () => void;
  className?: string;
  badge?: string;
}

function CardThumbnail({
  card,
  onSelect,
  className = '',
  badge,
}: CardThumbnailProps) {
  return (
    <div
      class={`card-thumb ${className}`}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={
        onSelect
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect();
            }
          : undefined
      }
    >
      <img src={cardImageSrc(card)} alt={card.name} draggable={false} />
      {badge && <span class="deck-badge">{badge}</span>}
    </div>
  );
}

export function BuildScreen({
  player,
  name,
  pool,
  basics,
  allowBasics,
  decks,
  onSetSlot,
  onSubmit,
}: BuildScreenProps) {
  const [activeDeck, setActiveDeck] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [cardsPerRow, setCardsPerRow] = useState<CardsPerRow>(loadCardsPerRow);
  const [basicsOpen, setBasicsOpen] = useState(false);
  const usedPoolCards = new Map<number, { deckIndex: number; slotIndex: number }>();

  decks.forEach((deck, deckIndex) => {
    deck.forEach((ref, slotIndex) => {
      if (ref?.kind === 'pool') usedPoolCards.set(ref.index, { deckIndex, slotIndex });
    });
  });

  const changeSlot = (deckIndex: number, slotIndex: number, ref: CardRef | null) => {
    setConfirming(false);
    onSetSlot(deckIndex, slotIndex, ref);
  };

  const assignCard = (ref: CardRef) => {
    const emptySlot = decks[activeDeck].findIndex((slot) => slot === null);
    if (emptySlot < 0) return;
    changeSlot(activeDeck, emptySlot, ref);
    // If this fill completed the deck, jump to the next deck that still has room
    // so multi-deck building is pure card-tapping. `decks` is the pre-assignment
    // prop, so count the new card explicitly and skip the active deck in the scan.
    const filledAfter = decks[activeDeck].filter((slot) => slot !== null).length + 1;
    if (filledAfter >= 3) {
      for (let step = 1; step < decks.length; step++) {
        const candidate = (activeDeck + step) % decks.length;
        if (decks[candidate].some((slot) => slot === null)) {
          setActiveDeck(candidate);
          break;
        }
      }
    }
  };

  const chooseCardsPerRow = (value: CardsPerRow) => {
    setCardsPerRow(value);
    saveCardsPerRow(value);
  };

  const completeCount = decks.filter(deckComplete).length;
  const allComplete = completeCount === decks.length;
  const multiDeck = decks.length > 1;
  const submitLabel = multiDeck
    ? 'Next: order decks'
    : confirming
      ? 'Really submit? You can’t edit after passing the device.'
      : 'Submit decks';

  return (
    <main class={`screen build-screen player-${player + 1}`}>
      <header class="screen-header">
        <p class="kicker">
          Build {decks.length} {decks.length === 1 ? 'deck' : 'decks'}
        </p>
        <h1>{name}</h1>
      </header>

      {/* Pinned above the pool: with a 45-card pool the old layout put the deck
          rows below everything, so you could not see what you had built while
          tapping. */}
      <section class="deck-strip">
        {multiDeck && (
          <div class="deck-tabs" role="tablist" aria-label="Decks">
            {decks.map((deck, deckIndex) => (
              <button
                type="button"
                role="tab"
                key={deckIndex}
                class={`dtab${deckIndex === activeDeck ? ' on' : ''}`}
                aria-selected={deckIndex === activeDeck}
                aria-label={`Deck ${deckIndex + 1}, ${deck.filter((slot) => slot !== null).length} of 3 cards`}
                onClick={() => setActiveDeck(deckIndex)}
              >
                <b>{deckIndex + 1}</b>
                <span class="pips" aria-hidden="true">
                  {deck.map((slot, slotIndex) => (
                    <i class={slot === null ? '' : 'f'} key={slotIndex} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        )}
        <div class={`deck-pane${multiDeck ? '' : ' deck-pane--solo'}`}>
          <div class="deck-slots deck-slots--pinned">
            {decks[activeDeck].map((ref, slotIndex) => {
              if (ref === null) {
                return <div class="empty-slot" key={slotIndex} />;
              }
              const card = resolveRef(ref, pool, basics);
              return (
                <CardThumbnail
                  key={slotIndex}
                  card={card}
                  onSelect={() => changeSlot(activeDeck, slotIndex, null)}
                />
              );
            })}
          </div>
        </div>
      </section>

      <section class="pool-section">
        <div class="pool-head">
          <h2>Your pool · {pool.length}</h2>
          {capabilities.cardSizeControl && (
            <div class="card-size" role="group" aria-label="Card size">
              <span class="card-size-label">Card size</span>
              {([3, 2, 1] as CardsPerRow[]).map((value) => (
                <button
                  type="button"
                  key={value}
                  class={cardsPerRow === value ? 'on' : ''}
                  aria-pressed={cardsPerRow === value}
                  aria-label={`${value} per row`}
                  onClick={() => chooseCardsPerRow(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>
        <div class={`pool-grid pool-grid--${cardsPerRow}`}>
          {pool.map((card, index) => {
            const used = usedPoolCards.get(index);
            return (
              <CardThumbnail
                key={`${card.scryfallId}-${index}`}
                card={card}
                className={used === undefined ? '' : 'used-card'}
                badge={used === undefined ? undefined : `Deck ${used.deckIndex + 1}`}
                onSelect={
                  used === undefined
                    ? () => assignCard({ kind: 'pool', index })
                    : () => {
                        changeSlot(used.deckIndex, used.slotIndex, null);
                        setActiveDeck(used.deckIndex);
                      }
                }
              />
            );
          })}
        </div>
      </section>

      {/* Collapsed by default. An always-open five-card bar costs ~120px of
          permanent height on every scroll through the pool, to serve a choice
          a 3-card deck makes at most once. */}
      {allowBasics && (
        <section class="basics-section">
          {basicsOpen ? (
            <div class="basics-open">
              <div class="basics-bar">
                {basics.map((card, index) => (
                  <CardThumbnail
                    key={`${card.scryfallId}-${index}`}
                    card={card}
                    onSelect={() => {
                      assignCard({ kind: 'basic', index });
                      setBasicsOpen(false);
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                class="basics-toggle"
                aria-expanded="true"
                onClick={() => setBasicsOpen(false)}
              >
                <span>Close</span>
                <span class="chev" aria-hidden="true">−</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              class="basics-toggle"
              aria-expanded="false"
              onClick={() => setBasicsOpen(true)}
            >
              <span>Add a basic land</span>
              <span class="chev" aria-hidden="true">+</span>
            </button>
          )}
        </section>
      )}

      {/* The bar appears only once it works. A pinned disabled button costs ~76px
          of a phone screen for the whole session to advertise something you
          cannot do yet; the count answers the only question it was answering. */}
      {allComplete ? (
        <div class="sticky-action">
          <button
            type="button"
            class="submit-button"
            onClick={() => {
              if (multiDeck) onSubmit();
              else if (confirming) onSubmit();
              else setConfirming(true);
            }}
          >
            {submitLabel}
          </button>
        </div>
      ) : (
        <p class="progress-line" role="status">
          {completeCount} of {decks.length} {decks.length === 1 ? 'deck' : 'decks'} complete
        </p>
      )}
    </main>
  );
}
