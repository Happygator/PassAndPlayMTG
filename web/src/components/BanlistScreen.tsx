import { useEffect, useState } from 'preact/hooks';
import { cardImageUrl, loadBanlistDetail } from '../catalogue';
import type { BannedCard, BanlistDetail } from '../catalogue';

interface BanlistScreenProps {
  /** Heading under the title, e.g. "Official 3CB". */
  title: string;
  cards?: { name: string; scryfallId: string }[];
  subtitle?: string;
  deviations?: { added: string[]; removed: string[] };
  baseLabel?: string;
  onBack: () => void;
}

type ViewMode = 'deviations' | '3' | '2' | '1' | 'text';
const VIEW_MODE_KEY = 'sealed:banlist-view';

// Text is the first-run default. 186 card images at ~100KB each is roughly
// 19MB, so an image-first default would spend that on a metered connection
// before the user has asked to see pictures. loading="lazy" on the image
// grids is the other half of that: even once a size is chosen, only the
// thumbnails actually scrolled into view are fetched.
function loadViewMode(): ViewMode {
  try {
    const stored = window.localStorage.getItem(VIEW_MODE_KEY);
    if (stored === '3' || stored === '2' || stored === '1' || stored === 'text') return stored;
  } catch {
    // Storage disabled (private browsing, embedded webview): use the default.
  }
  return 'text';
}

function saveViewMode(value: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, value);
  } catch {
    // Not worth surfacing: the setting simply does not persist.
  }
}

export function BanlistScreen({ title, cards, subtitle, deviations, baseLabel, onBack }: BanlistScreenProps) {
  const [detail, setDetail] = useState<BanlistDetail | null>(null);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => (deviations ? 'deviations' : loadViewMode()));
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (cards) return;
    let active = true;
    loadBanlistDetail()
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, []);

  const chooseViewMode = (value: ViewMode) => {
    setViewMode(value);
    saveViewMode(value);
  };

  const shownDetail: BanlistDetail | null = cards
    ? { cards, fetchedAt: subtitle ?? '', source: '' }
    : detail;

  if (error) {
    return (
      <main class="screen banlist-screen">
        <div class="banlist-head">
          <button type="button" class="text-button" onClick={onBack}>
            ← Back
          </button>
        </div>
        <p class="error-text">{error}</p>
      </main>
    );
  }

  if (!shownDetail) {
    return (
      <main class="screen banlist-screen">
        <div class="banlist-head">
          <button type="button" class="text-button" onClick={onBack}>
            ← Back
          </button>
        </div>
        <p class="muted">Loading banlist…</p>
      </main>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered: BannedCard[] = q
    ? shownDetail.cards.filter((card) => card.name.toLowerCase().includes(q))
    : shownDetail.cards;

  return (
    <main class="screen banlist-screen">
      <div class="banlist-head">
        <button type="button" class="text-button" onClick={onBack}>
          ← Back
        </button>
        <span class="ban-count">
          {q ? `${filtered.length} of ${shownDetail.cards.length} cards` : `${shownDetail.cards.length} cards`}
        </span>
      </div>

      <header class="screen-header">
        <p class="kicker">
          {title} · {cards ? subtitle ?? '' : subtitle ?? shownDetail.fetchedAt}
        </p>
        <h1>Banlist</h1>
      </header>

      <div class="card-size" role="group" aria-label="View">
        <span class="card-size-label">View</span>
        {deviations && (
          <button
            type="button"
            class={viewMode === 'deviations' ? 'on' : ''}
            aria-pressed={viewMode === 'deviations'}
            onClick={() => setViewMode('deviations')}
          >
            Deviations
          </button>
        )}
        <button
          type="button"
          class={viewMode === 'text' ? 'on' : ''}
          aria-pressed={viewMode === 'text'}
          onClick={() => chooseViewMode('text')}
        >
          Text
        </button>
        <button
          type="button"
          class={viewMode === '3' ? 'on' : ''}
          aria-pressed={viewMode === '3'}
          onClick={() => chooseViewMode('3')}
        >
          Small
        </button>
        <button
          type="button"
          class={viewMode === '2' ? 'on' : ''}
          aria-pressed={viewMode === '2'}
          onClick={() => chooseViewMode('2')}
        >
          Medium
        </button>
        <button
          type="button"
          class={viewMode === '1' ? 'on' : ''}
          aria-pressed={viewMode === '1'}
          onClick={() => chooseViewMode('1')}
        >
          Large
        </button>
      </div>

      {viewMode !== 'deviations' && (
        <input
          type="search"
          class="name-input"
          placeholder="Filter"
          aria-label="Filter the banlist"
          value={query}
          onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
        />
      )}

      {viewMode === 'deviations' && deviations ? (
        <>
          <p class="muted deviations-intro">Everything else matches {baseLabel ?? 'the base list'}.</p>
          <div class="field-group diff-group">
            <div class="field-head">
              <span>Additional bans</span>
              <small>{deviations.added.length}</small>
            </div>
            {deviations.added.length === 0 ? (
              <p class="muted">None.</p>
            ) : (
              <div class="name-list">
                {deviations.added.map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </div>
            )}
          </div>
          <div class="field-group diff-group">
            <div class="field-head">
              <span>Unbans</span>
              <small>{deviations.removed.length}</small>
            </div>
            {deviations.removed.length === 0 ? (
              <p class="muted">None.</p>
            ) : (
              <div class="name-list">
                {deviations.removed.map((name) => (
                  <div key={name}>{name}</div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : viewMode === 'text' ? (
        <div class="name-list">
          {filtered.map((card) => (
            <div key={card.scryfallId}>{card.name}</div>
          ))}
        </div>
      ) : viewMode !== 'deviations' ? (
        <div class={`pool-grid pool-grid--${viewMode}`}>
          {filtered.map((card) => (
            <div class="card-thumb" key={card.scryfallId}>
              <img src={cardImageUrl(card.scryfallId)} alt={card.name} loading="lazy" draggable={false} />
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
