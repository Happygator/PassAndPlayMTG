import { useState } from 'preact/hooks';
import { cardImageSrc } from '@platform';
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

  const allComplete = decks.every(deckComplete);

  return (
    <main class={`screen build-screen player-${player + 1}`}>
      <header class="screen-header">
        <h1>{name} -- build {decks.length} {decks.length === 1 ? 'deck' : 'decks'}</h1>
        <p>
          Tap a card to add it to the highlighted deck. Tap it again to remove it.
          Pinch to zoom.
        </p>
      </header>

      <section class="pool-section">
        <h2>Your pool</h2>
        <div class="pool-grid">
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

      {allowBasics && (
        <section class="basics-section">
          <h2>Basic lands</h2>
          <div class="basics-bar">
            {basics.map((card, index) => (
              <CardThumbnail
                key={`${card.scryfallId}-${index}`}
                card={card}
                onSelect={() => assignCard({ kind: 'basic', index })}
              />
            ))}
          </div>
        </section>
      )}

      <section class="deck-list">
        {decks.map((deck, deckIndex) => (
          <div
            class={`deck-row${deckIndex === activeDeck ? ' active-deck' : ''}`}
            key={deckIndex}
            onClick={() => setActiveDeck(deckIndex)}
          >
            <h2>Deck {deckIndex + 1}</h2>
            <div class="deck-slots">
              {deck.map((ref, slotIndex) => {
                if (ref === null) {
                  return <div class="empty-slot" key={slotIndex} />;
                }
                const card = resolveRef(ref, pool, basics);
                return (
                  <CardThumbnail
                    key={slotIndex}
                    card={card}
                    onSelect={() => changeSlot(deckIndex, slotIndex, null)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <div class="sticky-action">
        <button
          type="button"
          class="submit-button"
          aria-disabled={!allComplete}
          onClick={() => {
            if (!allComplete) return;
            if (decks.length > 1) onSubmit();
            else if (confirming) onSubmit();
            else setConfirming(true);
          }}
        >
          {decks.length > 1
            ? 'Next: order decks'
            : confirming
              ? "Really submit? You can't edit after passing the device."
              : 'Submit decks'}
        </button>
      </div>
    </main>
  );
}
