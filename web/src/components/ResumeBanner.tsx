import type { FunctionComponent } from 'preact';

interface ResumeBannerProps {
  /** ISO timestamp the save was written. */
  savedAt: string;
  /** "Alex vs Sam - 3CB Sealed": enough to recognise which game this is. */
  label: string;
  busy: boolean;
  error: string | null;
  onResume: () => void;
  onDiscard: () => void;
}

/**
 * Offered on the start screen when a game was left unfinished (APP-MIGRATION.md
 * M7). Deliberately an offer rather than an automatic jump: dropping someone
 * back into a week-old game they had forgotten about is worse than one tap, and
 * the same code runs on the website where a reload is routine.
 */
export const ResumeBanner: FunctionComponent<ResumeBannerProps> = ({
  savedAt,
  label,
  busy,
  error,
  onResume,
  onDiscard,
}) => {
  const when = (() => {
    const parsed = new Date(savedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
  })();
  return (
    <section class="panel resume-banner">
      <div class="resume-banner__text">
        {/* No heading here: ResumeGate supplies it, and this component is only
            ever rendered inside that gate. */}
        <p>{label}</p>
        {when && <p class="resume-banner__when">Saved {when}</p>}
      </div>
      {error && <p class="error-text">{error}</p>}
      <div class="resume-banner__actions">
        <button
          type="button"
          class="primary-button"
          aria-disabled={busy}
          onClick={() => {
            if (busy) return;
            onResume();
          }}
        >
          {busy ? 'Resuming…' : 'Resume game'}
        </button>
        <button
          type="button"
          class="secondary-button"
          aria-disabled={busy}
          onClick={() => {
            if (busy) return;
            onDiscard();
          }}
        >
          Discard
        </button>
      </div>
    </section>
  );
};
