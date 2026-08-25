import { useEffect, useState } from 'preact/hooks';
import { basicsFromCatalogue, loadBanlistDetail, loadBanlistSummary, loadCatalogue } from '../catalogue';
import type { BanlistDetail, BanlistSummary, Catalogue } from '../catalogue';
import {
  deleteCustomList,
  diffOfficial,
  effectiveBanned,
  formatExport,
  loadCustomLists,
  newListId,
  readLastSeenOfficial,
  saveCustomList,
  writeLastSeenOfficial,
} from '../banlists';
import type { CustomBanlist } from '../banlists';
import {
  boosterCubeId,
  boosterTypeLabel,
  isBoosterCubeId,
  loadBoosterIndex,
  loadBoosterSet,
  openBooster,
} from '../boosters';
import type { BoosterIndex, BoosterSetSummary, BoosterType } from '../boosters';
import { MODE_RULES } from '../game';
import type { CardData, CubeData, CubeIndexEntry, GameConfig, GameMode } from '../types';
import { BanlistDigestScreen } from './BanlistDigestScreen';
import { BanlistEditorScreen } from './BanlistEditorScreen';
import { BanlistScreen } from './BanlistScreen';
import { ImportBanlistScreen } from './ImportBanlistScreen';

interface StartScreenProps {
  onStart: (
    config: GameConfig,
    cube: CubeData,
    catalogue?: Catalogue,
    /** Pre-opened pools; booster games deal here rather than in the reducer. */
    pools?: [CardData[], CardData[]]
  ) => void;
  initial?: GameConfig;
}

/** Cube-select value standing for "open a booster pack" instead of picking a cube. */
const BOOSTER_OPTION = '__booster__';

/**
 * Pai Gow as originally designed: one pack each, four 3-card decks out of it.
 * A 15-card Draft Booster leaves three cards spare, a 14-card Play Booster two.
 */
const BOOSTER_DECKS = 4;

/** Newest era first, matching the picker's newest-set-first ordering. */
const BOOSTER_ERAS: BoosterType[] = ['play', 'draft', 'default'];

export function StartScreen({ onStart, initial }: StartScreenProps) {
  const [cubes, setCubes] = useState<CubeIndexEntry[]>([]);
  const [cubeId, setCubeId] = useState(initial?.cubeId ?? '');
  const [mode, setMode] = useState<GameMode>(initial?.mode ?? '3cb-real');
  const [poolSize, setPoolSize] = useState(initial?.poolSize ?? 10);
  const [decksPerPlayer, setDecksPerPlayer] = useState(initial?.decksPerPlayer ?? 1);
  const [allowRepeats, setAllowRepeats] = useState(initial?.allowRepeats ?? false);
  const [playerOne, setPlayerOne] = useState(initial?.enteredNames[0] ?? '');
  const [playerTwo, setPlayerTwo] = useState(initial?.enteredNames[1] ?? '');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [indexError, setIndexError] = useState(false);
  const [startError, setStartError] = useState('');
  const [catalogueInfo, setCatalogueInfo] = useState<BanlistSummary | null>(null);
  const [catalogueLoadError, setCatalogueLoadError] = useState(false);
  const [viewingBanlist, setViewingBanlist] = useState(false);
  const [banlistMode, setBanlistMode] = useState<'official' | 'custom'>('official');
  const [customLists, setCustomLists] = useState<CustomBanlist[]>(() => loadCustomLists());
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [editingList, setEditingList] = useState<CustomBanlist | null>(null);
  const [importing, setImporting] = useState(false);
  const [loadedCatalogue, setLoadedCatalogue] = useState<Catalogue | null>(null);
  const [busyLoadingCatalogue, setBusyLoadingCatalogue] = useState(false);
  const [boosterIndex, setBoosterIndex] = useState<BoosterIndex | null>(null);
  const [usingBooster, setUsingBooster] = useState(
    initial ? isBoosterCubeId(initial.cubeId) : false
  );
  const [boosterSetCode, setBoosterSetCode] = useState(initial?.boosterSetCode ?? '');
  const [officialDetail, setOfficialDetail] = useState<BanlistDetail | null>(null);
  const [digest, setDigest] = useState<{
    fetchedAt: string;
    added: string[];
    removed: string[];
  } | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);

  const selectedCustomList = banlistMode === 'custom'
    ? customLists.find((list) => list.id === (selectedListId || customLists[0]?.id)) ?? null
    : null;

  const handleExportList = (list: CustomBanlist) => {
    const text = formatExport(list);
    if (!navigator.clipboard) {
      setExportText(text);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {}).catch(() => setExportText(text));
  };

  const ensureCatalogueLoaded = (after: (catalogue: Catalogue) => void) => {
    if (loadedCatalogue) {
      after(loadedCatalogue);
      return;
    }
    setBusyLoadingCatalogue(true);
    loadCatalogue()
      .then((catalogue) => {
        setLoadedCatalogue(catalogue);
        after(catalogue);
      })
      .catch(() => setCatalogueLoadError(true))
      .finally(() => setBusyLoadingCatalogue(false));
  };

  const cubesFor = (forMode: GameMode) => cubes.filter((cube) => cube.modes.includes(forMode));

  const poolCap = (cube: CubeIndexEntry, repeats: boolean) =>
    repeats ? cube.cardCount : Math.floor(cube.cardCount / 2);

  const applyMode = (nextMode: GameMode, cube: CubeIndexEntry) => {
    // A cube may carry its own starting numbers for this mode (imported cubes
    // always will); anything it leaves out falls back to the mode-wide value.
    const rules = MODE_RULES[nextMode];
    const cubeDefaults = cube.defaults?.[nextMode];
    const nextRepeats = cubeDefaults?.allowRepeats ?? allowRepeats;
    const maximumPool = poolCap(cube, nextRepeats);
    const supportedDecks = Math.max(1, Math.floor(maximumPool / 3));
    const wantedDecks = cubeDefaults?.decksPerPlayer ?? rules.defaultDecksPerPlayer;
    const wantedPool = cubeDefaults?.poolSize ?? rules.defaultPoolSize;
    const nextDeckCount = Math.max(1, Math.min(wantedDecks, supportedDecks));
    setMode(nextMode);
    setAllowRepeats(nextRepeats);
    setDecksPerPlayer(nextDeckCount);
    setPoolSize(Math.max(3 * nextDeckCount, Math.min(wantedPool, maximumPool)));
    setStartError('');
  };

  const switchMode = (nextMode: GameMode) => {
    // Booster packs are a Pai Gow pool source; every other mode falls back to a
    // cube. Re-tapping the mode you are already in leaves the choice alone.
    if (nextMode !== mode) setUsingBooster(false);
    if (nextMode === '3cb-real') {
      setMode('3cb-real');
      setDecksPerPlayer((current) => Math.max(1, Math.min(current, 8)));
      setStartError('');
      return;
    }
    const compatible = cubesFor(nextMode);
    if (compatible.length === 0) return;
    const cube = compatible.find((entry) => entry.id === selectedCube?.id) ?? compatible[0];
    setCubeId(cube.id);
    applyMode(nextMode, cube);
  };

  useEffect(() => {
    let active = true;
    fetch('./cubes/index.json')
      .then((response) => {
        if (!response.ok) throw new Error('Cube index request failed');
        return response.json() as Promise<CubeIndexEntry[]>;
      })
      .then((loadedCubes) => {
        if (!active) return;
        if (loadedCubes.length === 0) {
          setIndexError(true);
          return;
        }
        const normalized = loadedCubes.map((cube) => ({
          ...cube,
          modes: cube.modes && cube.modes.length > 0 ? cube.modes : (['3cb'] as GameMode[]),
        }));
        setCubes(normalized);
        if (!cubeId) {
          const startMode = mode;
          const firstCube =
            normalized.find((cube) => cube.modes.includes(startMode)) ?? normalized[0];
          const firstMode = firstCube.modes.includes(startMode) ? startMode : firstCube.modes[0];
          if (mode !== '3cb-real') {
            setCubeId(firstCube.id);
            if (!initial) applyMode(firstMode, firstCube);
          }
        }
      })
      .catch(() => {
        if (active) setIndexError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // The set list is a small precached file, so the booster option can appear
  // (and name a set) before anything the size of a pack is fetched. A failure
  // is silent: the option simply stays out of the cube menu.
  useEffect(() => {
    let active = true;
    loadBoosterIndex()
      .then((index) => {
        if (!active || index.sets.length === 0) return;
        setBoosterIndex(index);
        setBoosterSetCode((current) =>
          current && index.sets.some((set) => set.code === current) ? current : index.sets[0].code
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadBanlistSummary()
      .then((summary) => {
        if (!active) return;
        setCatalogueInfo(summary);
      })
      .catch(() => {
        if (active) setCatalogueLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadBanlistDetail()
      .then((detail) => {
        if (!active) return;
        setOfficialDetail(detail);
        const names = detail.cards.map((card) => card.name);
        const previous = readLastSeenOfficial();
        if (previous && previous.fetchedAt !== detail.fetchedAt) {
          const diff = diffOfficial(previous.names, names);
          if (diff.added.length || diff.removed.length) {
            setDigest({
              fetchedAt: detail.fetchedAt,
              added: diff.added,
              removed: diff.removed,
            });
          } else {
            writeLastSeenOfficial(detail.fetchedAt, names);
          }
        } else if (!previous) {
          writeLastSeenOfficial(detail.fetchedAt, names);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (digest) {
    return (
      <BanlistDigestScreen
        fetchedAt={digest.fetchedAt}
        added={digest.added}
        removed={digest.removed}
        affected={customLists}
        onKeep={() => {}}
        onDismiss={() => {
          writeLastSeenOfficial(
            digest.fetchedAt,
            officialDetail?.cards.map((card) => card.name) ?? []
          );
          setDigest(null);
        }}
      />
    );
  }

  if (editingList && loadedCatalogue) {
    return (
      <BanlistEditorScreen
        catalogue={loadedCatalogue}
        officialCards={officialDetail?.cards ?? []}
        officialFetchedAt={officialDetail?.fetchedAt ?? ''}
        list={editingList}
        onSave={(list) => {
          const next = saveCustomList(list);
          setCustomLists(next);
          setSelectedListId(list.id);
        }}
        onDelete={(id) => {
          const next = deleteCustomList(id);
          setCustomLists(next);
          setSelectedListId('');
          setEditingList(null);
        }}
        onExport={(list) => {
          setEditingList(null);
          handleExportList(list);
        }}
        onBack={() => setEditingList(null)}
      />
    );
  }

  if (importing && loadedCatalogue) {
    return (
      <ImportBanlistScreen
        catalogue={loadedCatalogue}
        official={loadedCatalogue.banned}
        officialFetchedAt={officialDetail?.fetchedAt ?? ''}
        onCreate={(list) => {
          const next = saveCustomList(list);
          setCustomLists(next);
          setSelectedListId(list.id);
          setImporting(false);
        }}
        onBack={() => setImporting(false)}
      />
    );
  }

  if (viewingBanlist) {
    if (banlistMode === 'custom' && selectedCustomList && loadedCatalogue) {
      const effective = effectiveBanned(loadedCatalogue.banned, selectedCustomList);
      const cards = loadedCatalogue.cards
        .filter((card) => effective.has(card.name))
        .map((card) => ({ name: card.name, scryfallId: card.scryfallId }));
      return (
        <BanlistScreen
          title={selectedCustomList.name}
          cards={cards}
          subtitle={`${cards.length} cards`}
          deviations={{ added: selectedCustomList.added, removed: selectedCustomList.removed }}
          baseLabel="Official 3CB"
          onBack={() => setViewingBanlist(false)}
        />
      );
    }
    return <BanlistScreen title="Official 3CB" onBack={() => setViewingBanlist(false)} />;
  }

  if (loading) {
    return <main class="screen centered-screen">Loading cubes…</main>;
  }

  // The real mode needs no cube, so a broken/missing cube index only blocks
  // the screen when the SELECTED mode actually needs one.
  if ((indexError || cubes.length === 0) && mode !== '3cb-real') {
    return (
      <main class="screen centered-screen">
        <div class="panel error-card">
          {'No cube data found — run `npm run cube` and rebuild.'}
        </div>
      </main>
    );
  }

  const selectedCube =
    mode === '3cb-real'
      ? cubesFor(mode)[0]
      : cubes.find((cube) => cube.id === cubeId) ?? cubesFor(mode)[0] ?? cubes[0];
  // Boosters are offered inside Pai Gow only — the format they belong to — and
  // only once the set list has actually loaded.
  const boosterOffered = mode === 'paigow' && (boosterIndex?.sets.length ?? 0) > 0;
  const dealingBooster = boosterOffered && usingBooster;
  const boosterSet: BoosterSetSummary | null =
    boosterIndex?.sets.find((set) => set.code === boosterSetCode) ?? boosterIndex?.sets[0] ?? null;
  // Sets are already newest-first out of the build, so grouping by era preserves
  // that order inside each group.
  const boosterGroups = BOOSTER_ERAS.map(
    (era) =>
      [era, boosterIndex?.sets.filter((set) => set.boosterType === era) ?? []] as const
  ).filter(([, sets]) => sets.length > 0);

  const maximumPool = selectedCube ? poolCap(selectedCube, allowRepeats) : 0;
  const minimumPool = 3 * decksPerPlayer;
  // Decks are capped by what the CUBE can supply (the pool auto-grows to fit),
  // not by the current pool size: floor(cubeSize / 2) cards per pool at 3 cards
  // per deck, i.e. floor(cubeSize / 6) decks. No other hard cap.
  const maximumDecks = dealingBooster
    ? BOOSTER_DECKS
    : mode === '3cb-real'
      ? 8
      : Math.max(1, Math.floor(maximumPool / 3));
  const validConfig = dealingBooster
    ? boosterSet !== null && decksPerPlayer >= 1 && decksPerPlayer <= BOOSTER_DECKS
    : mode === '3cb-real'
      ? decksPerPlayer >= 1 && decksPerPlayer <= 8
      : poolSize >= minimumPool &&
        poolSize <= maximumPool &&
        decksPerPlayer >= 1 &&
        decksPerPlayer <= maximumDecks;

  const chooseCube = (nextId: string) => {
    const nextCube = cubes.find((cube) => cube.id === nextId) ?? cubes[0];
    setCubeId(nextCube.id);
    applyMode(nextCube.modes.includes(mode) ? mode : nextCube.modes[0], nextCube);
  };

  const toggleRepeats = (next: boolean) => {
    if (!selectedCube) return;
    setAllowRepeats(next);
    // The cap may shrink when turning repeats off: clamp decks, then the pool.
    const cap = poolCap(selectedCube, next);
    const decks = Math.min(decksPerPlayer, Math.max(1, Math.floor(cap / 3)));
    setDecksPerPlayer(decks);
    setPoolSize(Math.max(3 * decks, Math.min(poolSize, cap)));
    setStartError('');
  };

  const startGame = () => {
    if (!validConfig || starting) return;
    setStarting(true);
    setStartError('');

    if (mode === '3cb-real') {
      loadCatalogue()
        .then((catalogue) => {
          const cube: CubeData = {
            id: 'real-3cb',
            name: '3-Card Blind',
            description: 'Every Vintage-legal card, minus the official banlist.',
            modes: ['3cb-real'],
            basics: basicsFromCatalogue(catalogue),
            cards: [],
          };
          const config: GameConfig = {
            mode,
            banlistId: selectedCustomList ? selectedCustomList.id : 'official',
            cubeId: cube.id,
            poolSize: 0,
            decksPerPlayer,
            allowRepeats: false,
            playerNames: [
              playerOne.trim() || 'Player 1',
              playerTwo.trim() || 'Player 2',
            ],
            enteredNames: [playerOne, playerTwo],
          };
          onStart(config, cube, catalogue);
        })
        .catch((err: unknown) =>
          setStartError(err instanceof Error ? err.message : 'Could not load the card catalogue. Please try again.')
        )
        .finally(() => setStarting(false));
      return;
    }

    // Two packs opened from the same set, one each — the pools ride along to the
    // reducer rather than being dealt there, because a booster is not a cube to
    // deal from: the collation decides what each pack holds.
    if (dealingBooster && boosterSet) {
      loadBoosterSet(boosterSet.code)
        .then((set) => {
          // openBooster already returns the pack in slot order — commons,
          // uncommons, rare, land, wildcard, foil, bonus — with the mode's own
          // sort applied inside each slot, so re-sorting here would flatten the
          // pack's shape back into an undifferentiated heap.
          const order = MODE_RULES[mode].poolSort;
          const pools: [CardData[], CardData[]] = [
            openBooster(set, order),
            openBooster(set, order),
          ];
          const packLabel = boosterTypeLabel(set.boosterType).replace(/s$/, '');
          const cube: CubeData = {
            id: boosterCubeId(set.code),
            name: set.name,
            description: `One ${set.packSize}-card ${packLabel} each.`,
            modes: [mode],
            // A booster supplies no basics, and Pai Gow offers none anyway.
            basics: [],
            cards: [],
          };
          const config: GameConfig = {
            mode,
            boosterSetCode: set.code,
            cubeId: cube.id,
            poolSize: set.packSize,
            decksPerPlayer,
            // The packs are opened independently, so a card can be in both.
            allowRepeats: true,
            playerNames: [playerOne.trim() || 'Player 1', playerTwo.trim() || 'Player 2'],
            enteredNames: [playerOne, playerTwo],
          };
          onStart(config, cube, undefined, pools);
        })
        .catch(() =>
          setStartError(
            `Could not open ${boosterSet.name} packs. Booster packs need a connection the first time a set is used.`
          )
        )
        .finally(() => setStarting(false));
      return;
    }

    if (!selectedCube) {
      setStarting(false);
      return;
    }
    fetch(`./cubes/${selectedCube.id}.json`)
      .then((response) => {
        if (!response.ok) throw new Error('Cube request failed');
        return response.json() as Promise<CubeData>;
      })
      .then((cube) => {
        const config: GameConfig = {
          mode,
          cubeId: selectedCube.id,
          poolSize,
          decksPerPlayer,
          allowRepeats,
          playerNames: [
            playerOne.trim() || 'Player 1',
            playerTwo.trim() || 'Player 2',
          ],
          enteredNames: [playerOne, playerTwo],
        };
        onStart(config, cube);
      })
      .catch(() => setStartError('Could not load the selected cube. Please try again.'))
      .finally(() => setStarting(false));
  };

  const isReal = mode === '3cb-real';

  return (
    <main class="screen start-screen">
      <header class="title-block">
        <p class="kicker">Sealed Pass-and-Play</p>
        <h1>New game</h1>
      </header>

      <section class="panel setup-form">
        <div class="field-group">
          <span>Mode</span>
          <div class="mode-switch">
            {(Object.entries(MODE_RULES) as [GameMode, (typeof MODE_RULES)[GameMode]][]).map(
              ([entryMode, rules]) => {
                const disabled = entryMode !== '3cb-real' && cubesFor(entryMode).length === 0;
                return (
                  <button
                    type="button"
                    class={`mode-option${entryMode === mode ? ' selected' : ''}`}
                    aria-disabled={disabled}
                    onClick={() => {
                      if (disabled) return;
                      switchMode(entryMode);
                    }}
                  >
                    {rules.label}
                  </button>
                );
              }
            )}
          </div>
          <p class="muted">{MODE_RULES[mode].blurb}</p>
        </div>

        {isReal ? (
          <div class="field-group">
            <div class="field-head">
              <span>Banlist</span>
              <small>{catalogueInfo ? `${catalogueInfo.legal} legal` : catalogueLoadError ? 'unavailable' : 'loading…'}</small>
            </div>
            <div class="mode-switch">
              <button
                type="button"
                class={`mode-option${banlistMode === 'official' ? ' selected' : ''}`}
                onClick={() => setBanlistMode('official')}
              >
                Official 3CB
              </button>
              <button
                type="button"
                class={`mode-option${banlistMode === 'custom' ? ' selected' : ''}`}
                aria-disabled={customLists.length === 0 && !loadedCatalogue}
                onClick={() => setBanlistMode('custom')}
              >
                Custom
              </button>
            </div>
            {banlistMode === 'official' ? (
              <>
                <p class="muted">
                  {catalogueInfo
                    ? `Official 3CB - ${catalogueInfo.count} cards, synced ${catalogueInfo.fetchedAt}.`
                    : catalogueLoadError
                      ? 'Could not load the banlist.'
                      : 'Loading banlist…'}
                </p>
                <button
                  type="button"
                  class="secondary-button"
                  onClick={() => setViewingBanlist(true)}
                >
                  View banlist
                </button>
              </>
            ) : (
              <>
                <select
                  class="text-input"
                  value={selectedListId || (customLists[0]?.id ?? '__new__')}
                  onChange={(event) => {
                    const value = (event.currentTarget as HTMLSelectElement).value;
                    if (value === '__new__') {
                      const fresh: CustomBanlist = {
                        id: newListId(),
                        name: 'My banlist',
                        base: officialDetail?.fetchedAt ?? '',
                        added: [],
                        removed: [],
                      };
                      ensureCatalogueLoaded(() => setEditingList(fresh));
                    } else {
                      setSelectedListId(value);
                    }
                  }}
                >
                  {customLists.map((list) => (
                    <option value={list.id} key={list.id}>
                      {list.name}
                    </option>
                  ))}
                  <option value="__new__">New list…</option>
                </select>
                <p class="muted">
                  Official 3CB +{selectedCustomList?.added.length ?? 0} banned,{' '}
                  {selectedCustomList?.removed.length ?? 0} unbanned. Still follows official updates.
                </p>
                <div class="row-2">
                  <button
                    type="button"
                    class="secondary-button"
                    aria-disabled={!selectedCustomList}
                    onClick={() => {
                      if (!selectedCustomList) return;
                      ensureCatalogueLoaded(() => {
                        setSelectedListId(selectedCustomList.id);
                        setViewingBanlist(true);
                      });
                    }}
                  >
                    View
                  </button>
                  {/* With no saved lists the select already sits on "New list…",
                      so choosing it fires no change event and there is no way
                      forward. Edit doubles as "create" in that state. */}
                  <button
                    type="button"
                    class="secondary-button"
                    onClick={() => {
                      const list: CustomBanlist = selectedCustomList ?? {
                        id: newListId(),
                        name: 'My banlist',
                        base: officialDetail?.fetchedAt ?? '',
                        added: [],
                        removed: [],
                      };
                      ensureCatalogueLoaded(() => setEditingList(list));
                    }}
                  >
                    {selectedCustomList ? 'Edit' : 'New list'}
                  </button>
                </div>
                <div class="row-2">
                  <button
                    type="button"
                    class="secondary-button"
                    onClick={() => ensureCatalogueLoaded(() => setImporting(true))}
                  >
                    Import
                  </button>
                  <button
                    type="button"
                    class="secondary-button"
                    aria-disabled={!selectedCustomList}
                    onClick={() => {
                      if (!selectedCustomList) return;
                      handleExportList(selectedCustomList);
                    }}
                  >
                    Export
                  </button>
                </div>
                {busyLoadingCatalogue && <p class="muted">Loading…</p>}
                {exportText !== null && (
                  <>
                    <textarea class="paste-box" readOnly value={exportText} />
                    <button type="button" class="text-button" onClick={() => setExportText(null)}>
                      Done
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          /* One group, not three form rows. The description and the repeats
              toggle both belong to the cube above them, so they sit inside its
              group at the group's 8px rhythm instead of each claiming a full
              24px form gap of their own. */
          <div class="field-group">
            <label>
              Cube
              <select
                value={dealingBooster ? BOOSTER_OPTION : (selectedCube?.id ?? '')}
                onChange={(event) => {
                  const value = (event.currentTarget as HTMLSelectElement).value;
                  if (value === BOOSTER_OPTION) {
                    setUsingBooster(true);
                    // The format's own numbers, not the cube's: four decks of three.
                    setDecksPerPlayer(BOOSTER_DECKS);
                    setStartError('');
                    return;
                  }
                  setUsingBooster(false);
                  chooseCube(value);
                }}
              >
                {/* Cubes and boosters are both pool sources, so they share one
                    menu — but they are answers to different questions, and an
                    ungrouped list would read as though a pack were a cube. */}
                <optgroup label="Cubes">
                  {cubesFor(mode).map((cube) => (
                    <option value={cube.id} key={cube.id}>
                      {cube.name} ({cube.cardCount})
                    </option>
                  ))}
                </optgroup>
                {boosterOffered && (
                  <optgroup label="Booster packs">
                    <option value={BOOSTER_OPTION}>One booster pack each…</option>
                  </optgroup>
                )}
              </select>
            </label>
            {dealingBooster ? (
              <>
                <label>
                  Set
                  <select
                    value={boosterSet?.code ?? ''}
                    onChange={(event) => {
                      setBoosterSetCode((event.currentTarget as HTMLSelectElement).value);
                      setStartError('');
                    }}
                  >
                    {boosterGroups.map(([era, sets]) => (
                      <optgroup label={boosterTypeLabel(era)} key={era}>
                        {sets.map((set) => (
                          <option value={set.code} key={set.code}>
                            {set.name} ({set.released.slice(0, 4)})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <p class="muted">
                  {boosterSet
                    ? `Both players open one ${boosterSet.packSize}-card ${boosterTypeLabel(
                        boosterSet.boosterType
                      ).replace(/s$/, '')} from ${boosterSet.name}. Card images stream from Scryfall, so the first game with a set needs a connection.`
                    : 'Loading sets…'}
                </p>
              </>
            ) : (
              <>
                <p class="muted">{selectedCube?.description}</p>
                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    checked={allowRepeats}
                    onChange={(event) =>
                      toggleRepeats((event.currentTarget as HTMLInputElement).checked)
                    }
                  />
                  Allow repeats between pools
                </label>
              </>
            )}
          </div>
        )}

        {/* A pack's size is not a setting — the collation fixes it — so booster
            games show no pool stepper at all. */}
        {!isReal && !dealingBooster && (
          <div class="field-group">
            <div class="field-head">
              <span>Pool size</span>
              <small>min {minimumPool} · max {maximumPool}</small>
            </div>
            <div class="stepper">
              <button
                type="button"
                onClick={() => {
                  if (poolSize <= minimumPool) return;
                  setPoolSize(Math.max(minimumPool, poolSize - 5));
                }}
                aria-disabled={poolSize <= minimumPool}
              >
                -5
              </button>
              <button
                type="button"
                onClick={() => {
                  if (poolSize <= minimumPool) return;
                  setPoolSize(Math.max(minimumPool, poolSize - 1));
                }}
                aria-disabled={poolSize <= minimumPool}
              >
                -1
              </button>
              <output>{poolSize}</output>
              <button
                type="button"
                onClick={() => {
                  if (poolSize >= maximumPool) return;
                  setPoolSize(Math.min(maximumPool, poolSize + 1));
                }}
                aria-disabled={poolSize >= maximumPool}
              >
                +1
              </button>
              <button
                type="button"
                onClick={() => {
                  if (poolSize >= maximumPool) return;
                  setPoolSize(Math.min(maximumPool, poolSize + 5));
                }}
                aria-disabled={poolSize >= maximumPool}
              >
                +5
              </button>
            </div>
          </div>
        )}

        <div class="field-group">
          <div class="field-head">
            <span>Decks per player</span>
            <small>1–{maximumDecks}</small>
          </div>
          <div class="stepper">
            <button
              type="button"
              onClick={() => {
                if (decksPerPlayer <= 1) return;
                setDecksPerPlayer(Math.max(1, decksPerPlayer - 1));
              }}
              aria-disabled={decksPerPlayer <= 1}
            >
              -1
            </button>
            <output>{decksPerPlayer}</output>
            <button
              type="button"
              onClick={() => {
                if (decksPerPlayer >= maximumDecks) return;
                const next = Math.min(maximumDecks, decksPerPlayer + 1);
                setDecksPerPlayer(next);
                // Grow the pool so 3 cards per deck still fit (no card reuse across decks).
                // A booster pool cannot grow: the pack is whatever the pack is.
                if (!isReal && !dealingBooster && poolSize < 3 * next) {
                  setPoolSize(Math.min(maximumPool, 3 * next));
                }
              }}
              aria-disabled={decksPerPlayer >= maximumDecks}
            >
              +1
            </button>
          </div>
        </div>

        {/* One heading over both fields. The coloured left edge does what the
            two separate "Player N name" labels were doing, in no vertical
            space at all — and it introduces the player colours on the only
            screen where the mapping still has to be learned. The visible
            label is gone, so each input carries its own aria-label. */}
        <div class="field-group">
          <span>Player names</span>
          <input
            class="player-input player-input--p1"
            aria-label="Player 1 name"
            value={playerOne}
            placeholder="Player 1"
            onInput={(event) => setPlayerOne((event.currentTarget as HTMLInputElement).value)}
          />
          <input
            class="player-input player-input--p2"
            aria-label="Player 2 name"
            value={playerTwo}
            placeholder="Player 2"
            onInput={(event) => setPlayerTwo((event.currentTarget as HTMLInputElement).value)}
          />
        </div>

        {startError && <p class="error-text">{startError}</p>}
        <button
          type="button"
          class="primary-button"
          aria-disabled={!validConfig || starting}
          onClick={() => {
            if (!validConfig || starting) return;
            startGame();
          }}
        >
          {starting ? (isReal ? 'Loading cards…' : 'Dealing…') : 'Start game'}
        </button>
      </section>
    </main>
  );
}
