import { useRef, useState } from 'preact/hooks';
import { BanlistScreen } from './BanlistScreen';

interface HandoffScreenProps {
  name: string;
  /** Whose screen this is: drives the player tint (0 = player 1). */
  player: 0 | 1;
  poolSize: number;
  deckCount: number;
  /** Extra terms line shown above the hold button (real-3CB banlist notice). */
  terms?: { title: string; detail: string };
  /** When present, lets the player open the full banlist before revealing. */
  banlist?: {
    title: string;
    cards: { name: string; scryfallId: string }[];
    subtitle?: string;
    deviations?: { added: string[]; removed: string[] };
    baseLabel?: string;
  };
  onReveal: () => void;
}

export function HandoffScreen({
  name,
  player,
  poolSize,
  deckCount,
  terms,
  banlist,
  onReveal,
}: HandoffScreenProps) {
  const timer = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  const [viewing, setViewing] = useState(false);

  const stopHolding = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  const startHolding = () => {
    if (timer.current !== null) return;
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onReveal();
    }, 600);
  };

  if (viewing && banlist) {
    return <BanlistScreen {...banlist} onBack={() => setViewing(false)} />;
  }

  return (
    <main class={`screen centered-screen handoff-screen player-${player + 1}`}>
      <div>
        <p class="kicker">Pass the device to</p>
        <h1>{name}</h1>
        <p>
          Hold the bar until it fills to {poolSize === 0 ? 'start building' : 'reveal your sealed pool'}.
        </p>
      </div>
      {terms && (
        <div class="handoff-terms">
          <b>{terms.title}</b>
          <span>{terms.detail}</span>
        </div>
      )}
      {banlist && (
        <button
          type="button"
          class="secondary-button"
          onClick={() => {
            // Clear any hold in progress before swapping to the banlist view:
            // otherwise a hold begun just before this tap could fire onReveal
            // while the banlist is on screen, exposing the pool behind it.
            stopHolding();
            setViewing(true);
          }}
        >
          View banlist
        </button>
      )}
      <button
        type="button"
        class={`hold-button${holding ? ' holding' : ''}`}
        onPointerDown={startHolding}
        onPointerUp={stopHolding}
        onPointerLeave={stopHolding}
        onPointerCancel={stopHolding}
        // Belt to the CSS braces: iOS raises the callout/magnifier from the
        // long-press gesture, which surfaces here as a contextmenu event.
        onContextMenu={(event) => event.preventDefault()}
      >
        <span>Hold to reveal</span>
      </button>
      <p class="handoff-status">
        {poolSize === 0
          ? `Build ${deckCount} ${deckCount === 1 ? 'deck' : 'decks'} from any legal card`
          : `${poolSize} cards to build ${deckCount} ${deckCount === 1 ? 'deck' : 'decks'} with`}
      </p>
    </main>
  );
}
