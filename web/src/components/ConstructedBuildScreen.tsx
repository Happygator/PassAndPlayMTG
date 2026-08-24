import { useRef, useState } from 'preact/hooks';
import { cardImageSrc } from '@platform';
import { deckComplete, resolveRef } from '../game';
import type { Catalogue } from '../catalogue';
import type { CardData, CardRef, DeckSlots } from '../types';
import { BanlistScreen } from './BanlistScreen';
import { SearchSheet } from './SearchSheet';
import { ScryfallSearchScreen } from './ScryfallSearchScreen';

interface ConstructedBuildScreenProps {
  player: 0 | 1;
  name: string;
  catalogue: Catalogue;
  basics: CardData[];
  pool: CardData[];
  decks: DeckSlots[];
  onAddCard: (card: CardData, deck: number, slot: number) => void;
  onSetSlot: (deck: number, slot: number, ref: CardRef | null) => void;
  onSubmit: () => void;
}

interface CardThumbnailProps {
  card: CardData;
  onSelect?: () => void;
}

function CardThumbnail({ card, onSelect }: CardThumbnailProps) {
  return (
    <div
      class="card-thumb"
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
    </div>
  );
}

interface LandCycle {
  id: string;
  name: string;
  note: string;
  cards: string[];
}

interface LandCyclesFile {
  note: string;
  cycles: LandCycle[];
}

const LOOKUP_VIEW_KEY = 'sealed:lookup-view';

function loadLookupViewSize(): '3' | '2' | '1' {
  try {
    const stored = window.localStorage.getItem(LOOKUP_VIEW_KEY);
    if (stored === '3' || stored === '2' || stored === '1') return stored;
  } catch {
    // Storage disabled (private browsing, embedded webview): use the default.
  }
  return '3';
}

function saveLookupViewSize(value: '3' | '2' | '1') {
  try {
    window.localStorage.setItem(LOOKUP_VIEW_KEY, value);
  } catch {
    // Not worth surfacing: the setting simply does not persist.
  }
}

export function ConstructedBuildScreen({
  player,
  name,
  catalogue,
  basics,
  pool,
  decks,
  onAddCard,
  onSetSlot,
  onSubmit,
}: ConstructedBuildScreenProps) {
  const [activeDeck, setActiveDeck] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [viewingBanlist, setViewingBanlist] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scryfalling, setScryfalling] = useState(false);
  // '' = the cycle menu is open, a cycle id = that cycle's detail list, null = closed.
  const [lookupCycle, setLookupCycle] = useState<string | null>(null);
  const [lookupData, setLookupData] = useState<LandCyclesFile | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [lookupViewSize, setLookupViewSize] = useState<'3' | '2' | '1'>(loadLookupViewSize);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Deck state lives in the parent reducer, not here, so nothing in
  // progress is lost when the banlist viewer (or any of the search
  // surfaces below) opens or closes. Same pattern as the banlist viewer,
  // verified working there.
  if (viewingBanlist) {
    return <BanlistScreen title="Official 3CB" onBack={() => setViewingBanlist(false)} />;
  }

  const deckFull = decks[activeDeck].every((slot) => slot !== null);
  const firstEmptySlot = () => decks[activeDeck].findIndex((slot) => slot === null);

  const changeSlot = (deckIndex: number, slotIndex: number, ref: CardRef | null) => {
    setConfirming(false);
    onSetSlot(deckIndex, slotIndex, ref);
  };

  const placeBasic = (index: number) => {
    const emptySlot = firstEmptySlot();
    if (emptySlot < 0) return;
    changeSlot(activeDeck, emptySlot, { kind: 'basic', index });
  };

  // Shared by SearchSheet, the quick-lookup cycle list, and the Scryfall
  // screen: places the card and closes whichever search surface was open.
  // Deliberately does NOT jump to the next deck when this fills the active
  // one -- completing a deck is exactly when you want to look at all three
  // cards together. The player moves on by tapping a deck tab. (The sealed
  // BuildScreen still auto-advances; there, tapping through a dealt pool is
  // the whole interaction.)
  const placeCard = (card: CardData) => {
    const emptySlot = firstEmptySlot();
    if (emptySlot < 0) return;
    setConfirming(false);
    onAddCard(card, activeDeck, emptySlot);
    setSearching(false);
    setScryfalling(false);
    setLookupCycle(null);
  };

  const openLookup = () => {
    setLookupCycle('');
    if (!lookupData && !lookupError) {
      fetch('./lookup/land-cycles.json')
        .then((res) => {
          if (!res.ok) throw new Error(`Could not load the lookup menu (status ${res.status}).`);
          return res.json();
        })
        .then((data: LandCyclesFile) => setLookupData(data))
        .catch((err) => setLookupError(err instanceof Error ? err.message : String(err)));
    }
  };

  const searchSheet = (
    <SearchSheet
      catalogue={catalogue}
      deckNumber={activeDeck + 1}
      slotNumber={firstEmptySlot() + 1}
      deckCount={decks.length}
      onPick={placeCard}
      onCancel={() => setSearching(false)}
      idle={!searching}
      inputRef={searchInputRef}
    />
  );

  if (scryfalling) {
    return <ScryfallSearchScreen catalogue={catalogue} onPick={placeCard} onBack={() => setScryfalling(false)} />;
  }

  if (lookupCycle !== null) {
    if (lookupError) {
      return (
        <main class="screen">
          <div class="cycle-head">
            <button type="button" class="text-button back" onClick={() => setLookupCycle(null)}>
              ← Back
            </button>
            <h2>Quick lookup</h2>
          </div>
          <p class="error-text">{lookupError}</p>
        </main>
      );
    }
    if (!lookupData) {
      return (
        <main class="screen">
          <div class="cycle-head">
            <button type="button" class="text-button back" onClick={() => setLookupCycle(null)}>
              ← Back
            </button>
            <h2>Quick lookup</h2>
          </div>
          <p class="muted">Loading…</p>
        </main>
      );
    }
    if (lookupCycle === '') {
      return (
        <main class="screen">
          <div class="cycle-head">
            <button type="button" class="text-button back" onClick={() => setLookupCycle(null)}>
              ← Back
            </button>
            <h2>Quick lookup</h2>
          </div>
          <div class="browse">
            {lookupData.cycles.map((cycle) => (
              <button
                type="button"
                class="browse-row"
                key={cycle.id}
                onClick={() => setLookupCycle(cycle.id)}
              >
                {cycle.name}
                <span class="n">{cycle.cards.length}</span>
              </button>
            ))}
          </div>
        </main>
      );
    }
    const cycle = lookupData.cycles.find((c) => c.id === lookupCycle);
    if (!cycle) {
      return (
        <main class="screen">
          <div class="cycle-head">
            <button type="button" class="text-button back" onClick={() => setLookupCycle('')}>
              ← Back
            </button>
            <h2>Quick lookup</h2>
          </div>
          <p class="error-text">Cycle not found.</p>
        </main>
      );
    }
    return (
      <main class="screen">
        <div class="cycle-head">
          <button type="button" class="text-button back" onClick={() => setLookupCycle('')}>
            ← Back
          </button>
          <h2>{cycle.name}</h2>
        </div>
        <p class="cycle-note">{cycle.note}</p>
        <div class="card-size" role="group" aria-label="Card size">
          <span class="card-size-label">Card size</span>
          {(['3', '2', '1'] as const).map((size) => (
            <button
              type="button"
              key={size}
              class={lookupViewSize === size ? 'on' : ''}
              aria-pressed={lookupViewSize === size}
              onClick={() => {
                setLookupViewSize(size);
                saveLookupViewSize(size);
              }}
            >
              {size === '3' ? 'Small' : size === '2' ? 'Medium' : 'Large'}
            </button>
          ))}
        </div>
        <div class={`pool-grid pool-grid--${lookupViewSize}`}>
          {cycle.cards.map((cardName) => {
            const index = catalogue.cards.findIndex((c) => c.name === cardName);
            if (index < 0) {
              return (
                <div class="card-thumb" key={cardName}>
                  <span class="tc-name">{cardName}</span>
                  <span class="banned-flag">Not found</span>
                </div>
              );
            }
            const card = catalogue.cards[index];
            const banned = catalogue.banned.has(card.name);
            return (
              <div
                class={`card-thumb${banned ? ' banned-card' : ''}`}
                key={`${card.scryfallId}-${index}`}
                onClick={() => {
                  if (banned) return;
                  placeCard(card);
                }}
                role={banned ? undefined : 'button'}
                tabIndex={banned ? undefined : 0}
                aria-disabled={banned}
              >
                <img src={cardImageSrc(card)} alt={card.name} loading="lazy" draggable={false} />
                {banned && <span class="banned-flag">Banned</span>}
              </div>
            );
          })}
        </div>
      </main>
    );
  }

  const completeCount = decks.filter(deckComplete).length;
  const allComplete = completeCount === decks.length;
  const multiDeck = decks.length > 1;
  const submitLabel = multiDeck
    ? 'Next: order decks'
    : confirming
      ? 'Really submit? You can’t edit after passing the device.'
      : 'Submit deck';

  return (
    <>
      {searchSheet}
      {!searching && (
    <main class={`screen build-screen player-${player + 1}`}>
      <header class="screen-header">
        <p class="kicker">
          Build {decks.length} {decks.length === 1 ? 'deck' : 'decks'}
        </p>
        <h1>{name}</h1>
      </header>

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

      <button
        type="button"
        class="search-field search-field--button"
        aria-disabled={deckFull}
        onClick={() => {
          if (deckFull) return;
          // Focus BEFORE the state change and synchronously inside the tap: iOS only
          // raises the keyboard for a focus that happens inside a user gesture, so a
          // focus from an effect after the re-render leaves the keyboard down and
          // costs the player a second tap.
          searchInputRef.current?.focus();
          setSearching(true);
        }}
      >
        <span class="placeholder">
          {deckFull ? `Deck ${activeDeck + 1} full - tap a card to replace it` : 'Name a card'}
        </span>
      </button>

      <div class="row-2">
        <button type="button" class="secondary-button" onClick={openLookup}>
          Quick lookup
        </button>
        <button type="button" class="secondary-button" onClick={() => setScryfalling(true)}>
          Scryfall search
        </button>
      </div>

      <button type="button" class="secondary-button" onClick={() => setViewingBanlist(true)}>
        View banlist
      </button>

      <section class="basics-section">
        <h2>Basic lands</h2>
        <div class="basics-bar">
          {basics.map((card, index) => (
            <CardThumbnail
              key={`${card.scryfallId}-${index}`}
              card={card}
              onSelect={() => placeBasic(index)}
            />
          ))}
        </div>
      </section>

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
      )}
    </>
  );
}
