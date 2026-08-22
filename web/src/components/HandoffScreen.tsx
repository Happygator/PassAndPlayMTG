import { useRef, useState } from 'preact/hooks';

interface HandoffScreenProps {
  name: string;
  /** Whose screen this is: drives the player tint (0 = player 1). */
  player: 0 | 1;
  poolSize: number;
  deckCount: number;
  onReveal: () => void;
}

export function HandoffScreen({ name, player, poolSize, deckCount, onReveal }: HandoffScreenProps) {
  const timer = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);

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

  return (
    <main class={`screen centered-screen handoff-screen player-${player + 1}`}>
      <div>
        <p class="kicker">Pass the device to</p>
        <h1>{name}</h1>
        <p>Hold the bar until it fills to reveal your sealed pool.</p>
      </div>
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
        {poolSize} cards · build {deckCount} {deckCount === 1 ? 'deck' : 'decks'}
      </p>
    </main>
  );
}
