import type { FunctionComponent } from 'preact';
import { ResumeBanner } from './ResumeBanner';

interface ResumeGateProps {
  savedAt: string;
  label: string;
  busy: boolean;
  error: string | null;
  onResume: () => void;
  onDiscard: () => void;
}

/**
 * An unfinished game takes the whole screen rather than sitting above the
 * new-game form.
 *
 * It began as a banner, which meant a phone had to render 170px of banner on
 * top of a 577px form and the primary action fell below the fold. Making it a
 * gate fixes that by not drawing the form at all -- and it is the more honest
 * shape anyway: there is exactly one saved game, so starting a new one always
 * discards it, and a choice with consequences should be made deliberately
 * rather than by scrolling past it.
 */
export const ResumeGate: FunctionComponent<ResumeGateProps> = ({
  savedAt,
  label,
  busy,
  error,
  onResume,
  onDiscard,
}) => (
  <main class="screen start-screen">
    <header class="title-block">
      <p class="kicker">Sealed Pass-and-Play</p>
      <h1>Game in progress</h1>
    </header>

    <ResumeBanner
      savedAt={savedAt}
      label={label}
      busy={busy}
      error={error}
      onResume={onResume}
      onDiscard={onDiscard}
    />
  </main>
);
