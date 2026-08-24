import type { CustomBanlist } from '../banlists';

interface BanlistDigestScreenProps {
  fetchedAt: string;
  added: string[];
  removed: string[];
  affected: CustomBanlist[];
  onKeep: () => void;
  onDismiss: () => void;
}

// Diff tracking keeps a custom list current automatically, but an official unban
// silently adds a card the player never approved to its effective legal set. This
// screen makes that change visible instead of silent.
export function BanlistDigestScreen({
  fetchedAt,
  added,
  removed,
  affected,
  onDismiss,
}: BanlistDigestScreenProps) {
  return (
    <main class="screen banlist-digest-screen">
      <header class="screen-header">
        <p class="kicker">Banlist updated</p>
        <h1>Official 3CB</h1>
      </header>
      <p class="muted">
        Synced {fetchedAt}. {added.length + removed.length} changes.
      </p>
      <div class="digest">
        {added.map((name) => (
          <div class="digest-row add" key={`add-${name}`}>
            <span>{name}</span>
            <span class="what">NOW BANNED</span>
          </div>
        ))}
        {removed.map((name) => (
          <div class="digest-row remove" key={`remove-${name}`}>
            <span>{name}</span>
            <span class="what">NOW LEGAL</span>
          </div>
        ))}
      </div>
      {affected.length > 0 && (
        <div class="affects">
          {affected.map((list) => (
            <p key={list.id}>
              <b>{list.name}</b> follows this list, so these changes apply to your games.
            </p>
          ))}
        </div>
      )}
      <button type="button" class="primary-button" onClick={onDismiss}>
        Got it
      </button>
    </main>
  );
}
