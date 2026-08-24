import { useState } from 'preact/hooks';
import type { CardData } from '../types';
import { cardImageUrl, cardLine, searchCatalogue } from '../catalogue';
import type { Catalogue } from '../catalogue';
import { effectiveBanned, newListId } from '../banlists';
import type { CustomBanlist } from '../banlists';

interface BanlistEditorScreenProps {
  catalogue: Catalogue;
  officialCards: { name: string; scryfallId: string }[];
  officialFetchedAt: string;
  list: CustomBanlist;
  onSave: (list: CustomBanlist) => void;
  onDelete: (id: string) => void;
  onExport: (list: CustomBanlist) => void;
  onBack: () => void;
}

type ViewSize = '3' | '2' | '1';
const VIEW_MODE_KEY = 'sealed:banlist-view';

function loadViewMode(): ViewSize {
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    if (stored === '3' || stored === '2' || stored === '1') return stored;
  } catch {
    // Storage disabled (private browsing, embedded webview): use the default.
  }
  return '3';
}

function saveViewMode(value: ViewSize) {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, value);
  } catch {
    // Not worth surfacing: the setting simply does not persist.
  }
}

function listsEqual(a: CustomBanlist, b: CustomBanlist): boolean {
  const sortedA = [...a.added].sort();
  const sortedB = [...b.added].sort();
  const removedA = [...a.removed].sort();
  const removedB = [...b.removed].sort();
  return (
    a.name === b.name &&
    sortedA.length === sortedB.length &&
    sortedA.every((v, i) => v === sortedB[i]) &&
    removedA.length === removedB.length &&
    removedA.every((v, i) => v === removedB[i])
  );
}

export function BanlistEditorScreen({
  catalogue,
  officialCards,
  officialFetchedAt,
  list,
  onSave,
  onDelete,
  onExport,
  onBack,
}: BanlistEditorScreenProps) {
  const [working, setWorking] = useState<CustomBanlist>(() => ({
    ...list,
    added: [...list.added],
    removed: [...list.removed],
  }));
  const [baseline, setBaseline] = useState<CustomBanlist>(() => ({
    ...list,
    added: [...list.added],
    removed: [...list.removed],
  }));
  const [saved, setSaved] = useState(false);
  const [confirmingUnsaved, setConfirmingUnsaved] = useState(false);
  const [viewTab, setViewTab] = useState<'list' | 'visual'>('list');
  const [query, setQuery] = useState('');
  const [visualQuery, setVisualQuery] = useState('');
  const [viewSize, setViewSize] = useState<ViewSize>(loadViewMode);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Captured once when the editor opens (from `list`, the saved state - not
  // `working`, which changes as the user edits) so a card's tile never
  // disappears mid-session: unbanning something added this session must
  // still show its tile with the UNBANNED overlay, not remove it from the grid.
  // Grows, never shrinks: a card banned during this session joins the tile set
  // too, so unbanning it again leaves the tile in place with the UNBANNED
  // overlay instead of making it vanish out from under the finger that
  // just tapped it.
  const [sessionNames, setSessionNames] = useState(() => new Set([...catalogue.banned, ...list.added]));

  const effective = effectiveBanned(catalogue.banned, working);
  const results = searchCatalogue(catalogue, query, 8);
  const visualResults = searchCatalogue(catalogue, visualQuery, 8);

  const unbanCard = (name: string) => {
    setWorking((current) =>
      current.added.includes(name)
        ? { ...current, added: current.added.filter((entry) => entry !== name) }
        : current.removed.includes(name)
          ? current
          : { ...current, removed: [...current.removed, name] }
    );
  };

  const banCard = (name: string) => {
    setSessionNames((current) => (current.has(name) ? current : new Set([...current, name])));
    setWorking((current) =>
      current.removed.includes(name)
        ? { ...current, removed: current.removed.filter((entry) => entry !== name) }
        : current.added.includes(name)
          ? current
          : { ...current, added: [...current.added, name] }
    );
  };

  const chooseViewSize = (value: ViewSize) => {
    setViewSize(value);
    saveViewMode(value);
  };

  const visualNames = new Set([...sessionNames, ...working.added]);
  // Real names should always resolve; skipping protects against a mismatched catalogue build.
  const visualCards: CardData[] = [...visualNames]
    .map((name) => catalogue.cards.find((card) => card.name === name))
    .filter((card): card is CardData => Boolean(card));

  return (
    <main class="screen banlist-editor-screen">
      <div class="sheet-bar">
        <button
          type="button"
          class="text-button"
          onClick={() => {
            if (listsEqual(working, baseline)) {
              onBack();
            } else {
              setConfirmingUnsaved(true);
            }
          }}
        >
          ← Back
        </button>
        <button
          type="button"
          class="text-button"
          onClick={() => {
            onSave(working);
            setBaseline({ ...working, added: [...working.added], removed: [...working.removed] });
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {confirmingUnsaved && (
        <div class="callout">
          <p>Unsaved changes.</p>
          <div class="row-2">
            <button
              type="button"
              class="secondary-button"
              onClick={() => {
                onSave(working);
                onBack();
              }}
            >
              Save and close
            </button>
            <button type="button" class="secondary-button" onClick={onBack}>
              Discard
            </button>
          </div>
          <button type="button" class="text-button" onClick={() => setConfirmingUnsaved(false)}>
            Keep editing
          </button>
        </div>
      )}

      <header class="screen-header">
        <p class="kicker">Custom banlist</p>
        <h1>
          <input
            class="name-input"
            value={working.name}
            onInput={(event) =>
              setWorking({ ...working, name: (event.currentTarget as HTMLInputElement).value })
            }
          />
        </h1>
      </header>

      <div class="mode-switch">
        <button
          type="button"
          class={`mode-option${viewTab === 'list' ? ' selected' : ''}`}
          onClick={() => setViewTab('list')}
        >
          List
        </button>
        <button
          type="button"
          class={`mode-option${viewTab === 'visual' ? ' selected' : ''}`}
          onClick={() => setViewTab('visual')}
        >
          Visual
        </button>
      </div>

      <div class="base-card">
        <b>Based on: Official 3CB · synced {officialFetchedAt}</b>
        <p class="muted">
          {officialCards.length} cards banned. Each update flows into this list automatically.
        </p>
      </div>

      {viewTab === 'list' ? (
        <>
          <div class="search-field">
            <input
              class="name-input"
              type="search"
              placeholder="Search cards"
              value={query}
              onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
            />
            {query && (
              <button type="button" class="field-clear" aria-label="Clear search" onClick={() => setQuery('')}>
                ✕
              </button>
            )}
          </div>

          <div class="sugg">
            {results.map((index) => {
              const card = catalogue.cards[index];
              const isBanned = effective.has(card.name);
              return (
                // The whole row is the target, as it is on every other search
                // list in the app; the chip labels what the tap will do. A row
                // that looks tappable but only responds on a 60px chip is a
                // miss waiting to happen on a phone.
                <button
                  type="button"
                  class="sugg-row"
                  key={`${card.scryfallId}-${index}`}
                  onClick={() => (isBanned ? unbanCard(card.name) : banCard(card.name))}
                >
                  <span class="sr-top">
                    <span class="sr-name">{card.name}</span>
                    {card.manaCost && <span class="sr-cost">{card.manaCost}</span>}
                  </span>
                  <span class="sr-sub">{cardLine(catalogue.text[index], catalogue.pt[index])}</span>
                  {/* The row carries the action that fits the card's current effective status;
                      there is no separate ban/unban mode to get wrong. */}
                  <span class={`act ${isBanned ? 'act-unban' : 'act-ban'}`}>
                    {isBanned ? 'UNBAN' : 'BAN'}
                  </span>
                </button>
              );
            })}
          </div>

          <div class="field-group diff-group">
            <div class="field-head">
              <span>Also banned</span>
              <small>{working.added.length}</small>
            </div>
            {working.added.length === 0 ? (
              <p class="muted">None yet.</p>
            ) : (
              [...working.added].sort((a, b) => a.localeCompare(b)).map((name) => (
                <div class="ban-row added" key={name}>
                  <span>{name}</span>
                  <button
                    type="button"
                    class="x"
                    onClick={() =>
                      setWorking({
                        ...working,
                        added: working.added.filter((entry) => entry !== name),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div class="field-group diff-group">
            <div class="field-head">
              <span>Unbanned</span>
              <small>{working.removed.length}</small>
            </div>
            {working.removed.length === 0 ? (
              <p class="muted">None yet.</p>
            ) : (
              [...working.removed].sort((a, b) => a.localeCompare(b)).map((name) => (
                <div class="ban-row removed" key={name}>
                  <span>{name}</span>
                  <button
                    type="button"
                    class="x"
                    onClick={() =>
                      setWorking({
                        ...working,
                        removed: working.removed.filter((entry) => entry !== name),
                      })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div class="row-2">
            <button
              type="button"
              class="secondary-button"
              onClick={() =>
                onSave({ ...working, id: newListId(), name: `${working.name} copy` })
              }
            >
              Duplicate
            </button>
            <button type="button" class="secondary-button" onClick={() => onExport(working)}>
              Export text
            </button>
          </div>
          <button
            type="button"
            class="text-button"
            onClick={() => {
              if (confirmingDelete) onDelete(working.id);
              else setConfirmingDelete(true);
            }}
          >
            {confirmingDelete ? 'Really delete?' : 'Delete list'}
          </button>
        </>
      ) : (
        <>
          <div class="search-field">
            <input
              class="name-input"
              type="search"
              placeholder="Name a card to ban"
              value={visualQuery}
              onInput={(event) => setVisualQuery((event.currentTarget as HTMLInputElement).value)}
            />
            {visualQuery && (
              <button
                type="button"
                class="field-clear"
                aria-label="Clear search"
                onClick={() => setVisualQuery('')}
              >
                ✕
              </button>
            )}
          </div>
          <p class="hint-line">Tap a card to unban it. Tap again to put it back.</p>
          <div class="sugg">
            {visualResults.map((index) => {
              const card = catalogue.cards[index];
              return (
                <button
                  type="button"
                  class="sugg-row"
                  key={`${card.scryfallId}-${index}`}
                  onClick={() => {
                    if (!effective.has(card.name)) banCard(card.name);
                    setVisualQuery('');
                  }}
                >
                  <span class="sr-top">
                    <span class="sr-name">{card.name}</span>
                    {card.manaCost && <span class="sr-cost">{card.manaCost}</span>}
                  </span>
                  <span class="sr-sub">{cardLine(catalogue.text[index], catalogue.pt[index])}</span>
                  <span class="act act-ban">BAN</span>
                </button>
              );
            })}
          </div>

          <div class="card-size" role="group" aria-label="View">
            <span class="card-size-label">View</span>
            {(['3', '2', '1'] as ViewSize[]).map((size) => (
              <button
                type="button"
                class={viewSize === size ? 'on' : ''}
                aria-pressed={viewSize === size}
                onClick={() => chooseViewSize(size)}
              >
                {size === '3' ? 'Small' : size === '2' ? 'Medium' : 'Large'}
              </button>
            ))}
          </div>

          <div class={`pool-grid pool-grid--${viewSize}`}>
            {visualCards.map((card) => {
              const isUnbanned = !effective.has(card.name);
              const image = (
                <>
                  <img
                    src={cardImageUrl(card.scryfallId)}
                    loading="lazy"
                    alt={card.name}
                    draggable={false}
                  />
                  {isUnbanned && (
                    <span class="unbanned-mark">
                      <span>UNBANNED</span>
                    </span>
                  )}
                </>
              );
              return (
                <button
                  type="button"
                  class="card-thumb"
                  key={card.name}
                  onClick={() => (isUnbanned ? banCard(card.name) : unbanCard(card.name))}
                >
                  {image}
                </button>
              );
            })}
          </div>
          <p class="progress-line">
            {visualCards.filter((card) => !effective.has(card.name)).length} UNBANNED · {effective.size} BANNED
          </p>
        </>
      )}
    </main>
  );
}
