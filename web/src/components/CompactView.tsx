interface CompactViewProps {
  /** Headline: whose turn it is, or an invitation when there is no game yet. */
  title: string;
  /** One supporting line. Keep it short -- the tray is ~270pt tall. */
  detail: string;
  onOpen: () => void;
}

/**
 * What the extension shows in the `.compact` tray (APP-MIGRATION.md §6.2).
 *
 * Compact is a "tap to open" affordance and nothing else. This is not a
 * stylistic choice: the start screen needs 855px and the tray offers ~270,
 * which puts the primary button 414px below the fold -- measured, not
 * estimated. So compact gets its own view with exactly one action, and
 * everything real happens after `requestPresentationStyle(.expanded)`.
 */
export function CompactView({ title, detail, onOpen }: CompactViewProps) {
  return (
    <main class="compact-view">
      <p class="compact-view__kicker">Sealed Pass-and-Play</p>
      <h1 class="compact-view__title">{title}</h1>
      <p class="compact-view__detail">{detail}</p>
      <button type="button" class="primary-button" onClick={onOpen}>
        Open
      </button>
    </main>
  );
}
