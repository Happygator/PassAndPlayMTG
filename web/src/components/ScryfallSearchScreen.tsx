import { useMemo, useState } from 'preact/hooks';
import type { Catalogue } from '../catalogue';
import { remoteImageSrc } from '@platform';
import type { CardData } from '../types';

interface ScryfallSearchScreenProps {
  catalogue: Catalogue;
  onPick: (card: CardData) => void;
  onBack: () => void;
}

interface ScryfallImageUris {
  normal?: string;
}

interface ScryfallCardFace {
  image_uris?: ScryfallImageUris;
}

interface ScryfallCard {
  name: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
}

interface ScryfallSearchResponse {
  object: string;
  total_cards?: number;
  has_more?: boolean;
  next_page?: string;
  data?: ScryfallCard[];
  details?: string;
}

const PAGE_SIZE = 30;

export function ScryfallSearchScreen({ catalogue, onPick, onBack }: ScryfallSearchScreenProps) {
  const [query, setQuery] = useState('');
  const [showSyntaxHelp, setShowSyntaxHelp] = useState(false);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [totalCards, setTotalCards] = useState(0);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  // Legality and bans are decided locally against the bundled catalogue,
  // never by the Scryfall API, so a card can be "printed" but still not
  // legal/allowed for this mode.
  const catalogueByName = useMemo(() => {
    const map = new Map<string, CardData>();
    for (const card of catalogue.cards) map.set(card.name, card);
    return map;
  }, [catalogue]);

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    setSearched(true);
    try {
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(trimmed)}&unique=cards`);
      if (res.status === 404) {
        setResults([]);
        setTotalCards(0);
        setNextPage(null);
        setHasMore(false);
        setPage(0);
        return;
      }
      const body: ScryfallSearchResponse = await res.json();
      if (!res.ok) {
        throw new Error(body.details || `Scryfall search failed (status ${res.status}).`);
      }
      setResults(body.data ?? []);
      setTotalCards(body.total_cards ?? (body.data?.length ?? 0));
      setNextPage(body.next_page ?? null);
      setHasMore(Boolean(body.has_more));
      setPage(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
      setTotalCards(0);
      setNextPage(null);
      setHasMore(false);
      setPage(0);
    } finally {
      setLoading(false);
    }
  };

  // Search only runs on submit (Enter or the button), never per keystroke:
  // Scryfall asks callers to be considerate of request rate, and a remote
  // query is expensive where the local name lookup (SearchSheet) is free.
  const handleSubmit = (event: Event) => {
    event.preventDefault();
    runSearch(query);
  };

  const loadNextPageIfNeeded = async (targetPage: number) => {
    const haveThrough = (page + 1) * PAGE_SIZE;
    // Already have enough loaded results for targetPage? just move.
    if (targetPage * PAGE_SIZE < results.length || !hasMore || !nextPage) {
      setPage(targetPage);
      return;
    }
    if (targetPage * PAGE_SIZE < haveThrough) {
      setPage(targetPage);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(nextPage);
      const body: ScryfallSearchResponse = await res.json();
      if (!res.ok) {
        throw new Error(body.details || `Scryfall search failed (status ${res.status}).`);
      }
      setResults((prev) => [...prev, ...(body.data ?? [])]);
      setNextPage(body.next_page ?? null);
      setHasMore(Boolean(body.has_more));
      setPage(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const appendFragment = (fragment: string) => {
    setQuery((prev) => (prev.trim() ? `${prev.trim()} ${fragment}` : fragment));
    setShowSyntaxHelp(false);
  };

  const totalPages = Math.max(1, Math.ceil((hasMore ? totalCards : results.length) / PAGE_SIZE || 1));
  const visible = results.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  let bannedCount = 0;
  let illegalCount = 0;
  for (const card of visible) {
    if (!catalogueByName.has(card.name)) illegalCount++;
    else if (catalogue.banned.has(card.name)) bannedCount++;
  }

  const countParts: string[] = [`${totalCards} results`];
  if (bannedCount > 0) countParts.push(`${bannedCount} banned`);
  if (illegalCount > 0) countParts.push(`${illegalCount} not legal`);

  // The syntax-help screen is rendered by returning it here instead of the
  // search markup below, from a boolean in this same component's state —
  // so the query text and any results already fetched are preserved (not
  // unmounted) when the user goes back to the search screen.
  if (showSyntaxHelp) {
    return (
      <main class="screen scryfall-search-screen">
        <div class="sheet-bar">
          <button type="button" class="text-button" onClick={() => setShowSyntaxHelp(false)}>
            ← Back
          </button>
        </div>

        <header class="screen-header">
          <p class="kicker">Scryfall search</p>
          <h1>Syntax</h1>
        </header>

        <p class="muted">
          Combine terms with spaces — every term must match. Results are already limited to cards legal in this
          game.
        </p>

        <div class="name-list">
          <button type="button" class="sugg-row" onClick={() => appendFragment('t:creature')}>
            <span class="sr-name">t:creature</span>
            <span class="sr-sub">Card type. Also t:land, t:instant, t:artifact.</span>
          </button>
          <button type="button" class="sugg-row" onClick={() => appendFragment('c:r')}>
            <span class="sr-name">c:r</span>
            <span class="sr-sub">Colour. c:wu for white-blue, c:c for colourless.</span>
          </button>
          <button type="button" class="sugg-row" onClick={() => appendFragment('mv=1')}>
            <span class="sr-name">mv=1</span>
            <span class="sr-sub">Mana value. Also mv&lt;=2, mv&gt;=5.</span>
          </button>
          <button type="button" class="sugg-row" onClick={() => appendFragment('pow>=4')}>
            <span class="sr-name">pow&gt;=4</span>
            <span class="sr-sub">Power. tou&lt;=2 for toughness.</span>
          </button>
          <button type="button" class="sugg-row" onClick={() => appendFragment('o:"draw a card"')}>
            <span class="sr-name">o:"draw a card"</span>
            <span class="sr-sub">Rules text. Quote anything with spaces.</span>
          </button>
          <button type="button" class="sugg-row" onClick={() => appendFragment('is:land')}>
            <span class="sr-name">is:land</span>
            <span class="sr-sub">Card properties, e.g. is:permanent, is:split.</span>
          </button>
          <button type="button" class="sugg-row" onClick={() => appendFragment('-t:land')}>
            <span class="sr-name">-t:land</span>
            <span class="sr-sub">A leading minus excludes.</span>
          </button>
          <button type="button" class="sugg-row" onClick={() => appendFragment('t:goblin or t:elf')}>
            <span class="sr-name">t:goblin or t:elf</span>
            <span class="sr-sub">or widens; without it, terms are combined.</span>
          </button>
        </div>

        <p class="muted">Scryfall supports far more than this — anything it accepts works here.</p>
      </main>
    );
  }

  return (
    <main class="screen scryfall-search-screen">
      <div class="sheet-bar">
        <button type="button" class="text-button" onClick={onBack}>
          ← Back
        </button>
      </div>

      <header class="screen-header">
        <p class="kicker">Full query syntax</p>
        <h1>Scryfall search</h1>
      </header>

      <form onSubmit={handleSubmit}>
        <section class="search-field">
          <input
            class="name-input query-field"
            type="search"
            placeholder="t:creature mv=1 c<=grw"
            aria-label="Scryfall query"
            value={query}
            onInput={(event) => setQuery((event.currentTarget as HTMLInputElement).value)}
          />
          <button type="submit" class="secondary-button">
            Search
          </button>
          <button type="button" class="secondary-button" onClick={() => setShowSyntaxHelp(true)}>
            Syntax help
          </button>
        </section>
      </form>

      {loading && <p class="muted">Loading…</p>}
      {error && <p class="error-text">{error}</p>}

      {searched && !loading && !error && results.length === 0 ? (
        <p class="muted">No cards match that query.</p>
      ) : null}

      {results.length > 0 && (
        <>
          <span class="ban-count">{countParts.join(' · ')}</span>
          <div class="pool-grid pool-grid--3">
            {visible.map((card) => {
              const image = card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
              if (!image) return null;
              const catalogueCard = catalogueByName.get(card.name);
              const banned = catalogueCard ? catalogue.banned.has(card.name) : false;
              const notLegal = !catalogueCard;
              const blocked = banned || notLegal;
              return (
                <div
                  class={`card-thumb${blocked ? ' banned-card' : ''}`}
                  key={card.name}
                  onClick={() => {
                    if (blocked || !catalogueCard) return;
                    // Picks always come from the bundled catalogue, not the
                    // API response, so every card in a deck carries the same
                    // image URL shape as the rest of the app.
                    onPick(catalogueCard);
                  }}
                  role={blocked ? undefined : 'button'}
                  tabIndex={blocked ? undefined : 0}
                  aria-disabled={blocked}
                >
                  <img src={remoteImageSrc(image)} alt={card.name} loading="lazy" draggable={false} />
                  {blocked && <span class="banned-flag">{notLegal ? 'Not legal' : 'Banned'}</span>}
                </div>
              );
            })}
          </div>
          <div class="pager">
            <button
              type="button"
              class="text-button"
              aria-disabled={page === 0}
              onClick={() => {
                if (page === 0) return;
                setPage(page - 1);
              }}
            >
              ← Prev
            </button>
            <span>
              Page {page + 1} of {totalPages}
            </span>
            <button
              type="button"
              class="text-button"
              aria-disabled={!hasMore && page + 1 >= totalPages}
              onClick={() => {
                if (!hasMore && page + 1 >= totalPages) return;
                loadNextPageIfNeeded(page + 1);
              }}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </main>
  );
}
