import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';
import { cardLine, searchCatalogue } from '../catalogue';
import type { Catalogue } from '../catalogue';
import type { CardData } from '../types';

interface SearchSheetProps {
  catalogue: Catalogue;
  /** 1-based deck and slot the chosen card will fill, for the header. */
  deckNumber: number;
  slotNumber: number;
  /** Total decks; when 1, the header omits the deck part. */
  deckCount: number;
  onPick: (card: CardData) => void;
  onCancel: () => void;
  /** Rendered but not in use: hidden and non-interactive, yet still focusable. */
  idle?: boolean;
  /** Lets the parent focus the input synchronously inside a tap handler. */
  inputRef?: RefObject<HTMLInputElement>;
}

export function SearchSheet({
  catalogue,
  deckNumber,
  slotNumber,
  deckCount,
  onPick,
  onCancel,
  idle,
  inputRef: externalInputRef,
}: SearchSheetProps) {
  const [query, setQuery] = useState('');
  const internalInputRef = useRef<HTMLInputElement>(null);

  const setInputRefs = (node: HTMLInputElement | null) => {
    internalInputRef.current = node;
    if (externalInputRef) {
      externalInputRef.current = node;
    }
  };

  useEffect(() => {
    if (idle) {
      setQuery('');
    } else {
      internalInputRef.current?.focus();
    }
  }, [idle]);

  const results = query.trim() ? searchCatalogue(catalogue, query, 12) : [];

  return (
    <main class={`screen search-sheet${idle ? ' search-sheet--idle' : ''}`} aria-hidden={idle ? 'true' : undefined}>
      <div class="sheet-bar">
        <button type="button" class="text-button" onClick={onCancel}>
          ← Cancel
        </button>
        <span class="ban-count">
          {deckCount === 1 ? `Slot ${slotNumber}` : `Deck ${deckNumber} · slot ${slotNumber}`}
        </span>
      </div>

      <section class="search-field">
        <input
          ref={setInputRefs}
          class="name-input"
          type="search"
          placeholder="Name a card"
          aria-label="Name a card"
          value={query}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
        />
      </section>

      {query.trim() ? (
        <div class="sugg">
          {results.map((index) => {
            const card = catalogue.cards[index];
            const banned = catalogue.banned.has(card.name);
            return (
              <button
                type="button"
                key={`${card.scryfallId}-${index}`}
                class={`sugg-row${banned ? ' ban' : ''}`}
                aria-disabled={banned}
                onClick={() => {
                  if (banned) return;
                  onPick(card);
                }}
              >
                <span class="sr-top">
                  <span class="sr-name">{card.name}</span>
                  {card.manaCost && <span class="sr-cost">{card.manaCost}</span>}
                  {banned && <span class="bantag">Banned</span>}
                </span>
                <span class="sr-sub">{cardLine(catalogue.text[index], catalogue.pt[index])}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p class="hint-line">Three cards. Anything Vintage-legal that is not banned.</p>
      )}
    </main>
  );
}
