import { useEffect, useState } from 'preact/hooks';
import { MODE_RULES } from '../game';
import type { CubeData, CubeIndexEntry, GameConfig, GameMode } from '../types';

interface StartScreenProps {
  onStart: (config: GameConfig, cube: CubeData) => void;
  initial?: GameConfig;
}

export function StartScreen({ onStart, initial }: StartScreenProps) {
  const [cubes, setCubes] = useState<CubeIndexEntry[]>([]);
  const [cubeId, setCubeId] = useState(initial?.cubeId ?? '');
  const [mode, setMode] = useState<GameMode>(initial?.mode ?? '3cb');
  const [poolSize, setPoolSize] = useState(initial?.poolSize ?? 10);
  const [decksPerPlayer, setDecksPerPlayer] = useState(initial?.decksPerPlayer ?? 1);
  const [allowRepeats, setAllowRepeats] = useState(initial?.allowRepeats ?? false);
  const [playerOne, setPlayerOne] = useState(initial?.enteredNames[0] ?? '');
  const [playerTwo, setPlayerTwo] = useState(initial?.enteredNames[1] ?? '');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [indexError, setIndexError] = useState(false);
  const [startError, setStartError] = useState('');

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
    const compatible = cubesFor(nextMode);
    if (compatible.length === 0) return;
    const cube = compatible.find((entry) => entry.id === selectedCube.id) ?? compatible[0];
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
          setCubeId(firstCube.id);
          if (!initial) applyMode(firstMode, firstCube);
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

  if (loading) {
    return <main class="screen centered-screen">Loading cubes…</main>;
  }

  if (indexError || cubes.length === 0) {
    return (
      <main class="screen centered-screen">
        <div class="panel error-card">
          {'No cube data found — run `npm run cube` and rebuild.'}
        </div>
      </main>
    );
  }

  const selectedCube = cubes.find((cube) => cube.id === cubeId) ?? cubesFor(mode)[0] ?? cubes[0];
  const maximumPool = poolCap(selectedCube, allowRepeats);
  const minimumPool = 3 * decksPerPlayer;
  // Decks are capped by what the CUBE can supply (the pool auto-grows to fit),
  // not by the current pool size: floor(cubeSize / 2) cards per pool at 3 cards
  // per deck, i.e. floor(cubeSize / 6) decks. No other hard cap.
  const maximumDecks = Math.max(1, Math.floor(maximumPool / 3));
  const validConfig =
    poolSize >= minimumPool &&
    poolSize <= maximumPool &&
    decksPerPlayer >= 1 &&
    decksPerPlayer <= maximumDecks;

  const chooseCube = (nextId: string) => {
    const nextCube = cubes.find((cube) => cube.id === nextId) ?? cubes[0];
    setCubeId(nextCube.id);
    applyMode(nextCube.modes.includes(mode) ? mode : nextCube.modes[0], nextCube);
  };

  const toggleRepeats = (next: boolean) => {
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
              ([entryMode, rules]) => (
                <button
                  type="button"
                  class={`mode-option${entryMode === mode ? ' selected' : ''}`}
                  aria-disabled={cubesFor(entryMode).length === 0}
                  onClick={() => {
                    if (cubesFor(entryMode).length === 0) return;
                    switchMode(entryMode);
                  }}
                >
                  {rules.label}
                </button>
              )
            )}
          </div>
          <p class="muted">{MODE_RULES[mode].blurb}</p>
        </div>

        {/* One group, not three form rows. The description and the repeats
            toggle both belong to the cube above them, so they sit inside its
            group at the group's 8px rhythm instead of each claiming a full
            24px form gap of their own. */}
        <div class="field-group">
          <label>
            Cube
            <select
              value={selectedCube.id}
              onChange={(event) => chooseCube((event.currentTarget as HTMLSelectElement).value)}
            >
              {cubesFor(mode).map((cube) => (
                <option value={cube.id} key={cube.id}>
                  {cube.name} ({cube.cardCount})
                </option>
              ))}
            </select>
          </label>
          <p class="muted">{selectedCube.description}</p>
          <label class="checkbox-row">
            <input
              type="checkbox"
              checked={allowRepeats}
              onChange={(event) => toggleRepeats((event.currentTarget as HTMLInputElement).checked)}
            />
            Allow repeats between pools
          </label>
        </div>

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
                if (poolSize < 3 * next) setPoolSize(Math.min(maximumPool, 3 * next));
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
          {starting ? 'Dealing…' : 'Deal pools'}
        </button>
      </section>
    </main>
  );
}
