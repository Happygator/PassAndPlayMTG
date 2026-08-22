import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { cardImageSrc } from '@platform';
import { deckNames, resolveRef } from '../game';
import type { CardData, DeckSlots } from '../types';

interface OrderScreenProps {
  name: string;
  /** Whose screen this is: drives the player tint (0 = player 1). */
  player: 0 | 1;
  opponentName: string;
  decks: DeckSlots[];
  pool: CardData[];
  basics: CardData[];
  onReorder: (from: number, to: number) => void;
  onBack: () => void;
  onConfirm: () => void;
}

interface DragState {
  from: number;
  to: number;
  startY: number;
  offsetY: number;
  rowStride: number;
  settling: boolean;
}

export function OrderScreen({ name, player, opponentName, decks, pool, basics, onReorder, onBack, onConfirm }: OrderScreenProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);

  const startDrag = (index: number, event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (drag) return;
    // Taps on the arrow buttons are not drag starts.
    if ((event.target as HTMLElement).closest('.order-arrows')) return;
    const list = listRef.current;
    if (!list || decks.length < 2) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.order-row'));
    const rowStride = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
    setDrag({ from: index, to: index, startY: event.clientY, offsetY: 0, rowStride, settling: false });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // pointer already released (fast tap) — drag state is engaged anyway
    }
  };

  const moveDrag = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    const clientY = event.clientY;
    setDrag((current) => {
      if (!current || current.settling) return current;
      const offsetY = clientY - current.startY;
      const to = Math.max(
        0,
        Math.min(decks.length - 1, current.from + Math.round(offsetY / current.rowStride))
      );
      return { ...current, to, offsetY };
    });
  };

  const endDrag = () => {
    if (!drag || drag.settling) return;
    // No movement at all: nothing to settle or commit.
    if (drag.to === drag.from && drag.offsetY === 0) {
      setDrag(null);
      return;
    }
    // Settle phase: the dragged row glides from its pointer offset into its
    // target slot; the shifted rows are already in place and do not move.
    // The reorder itself commits only after the glide, in a transition-free
    // render that is pixel-identical, so nothing visibly jumps at commit.
    const { from, to } = drag;
    setDrag({ ...drag, settling: true });
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      if (to !== from) onReorder(from, to);
      setDrag(null);
    }, 150);
  };

  // The dragged row follows the pointer; rows between the origin and the
  // target slot shift one stride toward the origin to open the target slot.
  const rowStyle = (index: number): string => {
    if (!drag) return '';
    if (index === drag.from) {
      const y = drag.settling ? (drag.to - drag.from) * drag.rowStride : drag.offsetY;
      return `transform: translateY(${y}px)`;
    }
    if (drag.from < drag.to && index > drag.from && index <= drag.to) {
      return `transform: translateY(${-drag.rowStride}px)`;
    }
    if (drag.from > drag.to && index >= drag.to && index < drag.from) {
      return `transform: translateY(${drag.rowStride}px)`;
    }
    return '';
  };

  return (
    <div class={`order-screen player-${player + 1}`}>
      <p class="kicker">Set your deck order</p>
      <h2>{name}</h2>
      <p class="hint">
        Your deck in position 1 plays {opponentName}’s deck 1, position 2 plays their deck 2,
        and so on. Drag a deck (or use the arrows) to reorder. {opponentName} won’t see this
        order until the match.
      </p>
      <div class={`order-list${drag ? ' drag-active' : ''}`} ref={listRef}>
        {decks.map((deck, index) => (
          <div
            class={`order-row${drag && drag.from === index ? (drag.settling ? ' settling' : ' dragging') : ''}`}
            style={rowStyle(index)}
            key={index}
            onPointerDown={(event) => startDrag(index, event)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <span class="order-position">
              Plays
              <b>{index + 1}</b>
            </span>
            <div class="order-main">
              <div class="order-cards">
                {deck.map((ref, slot) => {
                  if (ref === null) return null;
                  const card = resolveRef(ref, pool, basics);
                  return (
                    <div class="card-thumb" key={slot}>
                      <img src={cardImageSrc(card)} alt={card.name} draggable={false} />
                    </div>
                  );
                })}
              </div>
              <p class="order-deck-names">{deckNames(deck, pool, basics)}</p>
            </div>
            <div class="order-arrows">
              <button
                type="button"
                aria-label={`Move deck in position ${index + 1} up`}
                aria-disabled={index === 0}
                onClick={() => {
                  if (index === 0) return;
                  onReorder(index, index - 1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move deck in position ${index + 1} down`}
                aria-disabled={index === decks.length - 1}
                onClick={() => {
                  if (index === decks.length - 1) return;
                  onReorder(index, index + 1);
                }}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>
      <div class="order-actions">
        <button type="button" class="secondary-button" onClick={onBack}>
          Back
        </button>
        <button type="button" class="primary-button" onClick={onConfirm}>
          Submit order
        </button>
      </div>
    </div>
  );
}
