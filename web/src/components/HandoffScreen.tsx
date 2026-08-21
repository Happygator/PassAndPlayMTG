import { useRef, useState } from 'preact/hooks';

interface HandoffScreenProps {
  name: string;
  onReveal: () => void;
}

export function HandoffScreen({ name, onReveal }: HandoffScreenProps) {
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
    <main class="screen centered-screen handoff-screen">
      <div>
        <h1>Pass the device to <strong>{name}</strong></h1>
        <p>{name}: hold the button below to reveal your pool.</p>
      </div>
      <button
        type="button"
        class={`hold-button${holding ? ' holding' : ''}`}
        onPointerDown={startHolding}
        onPointerUp={stopHolding}
        onPointerLeave={stopHolding}
        onPointerCancel={stopHolding}
      >
        <span>Hold to reveal</span>
      </button>
    </main>
  );
}
