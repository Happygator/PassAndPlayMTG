import { useMemo, useState } from 'preact/hooks';
import { newListId, parseImport } from '../banlists';
import type { CustomBanlist, ImportResult } from '../banlists';
import { foldName } from '../catalogue';
import type { Catalogue } from '../catalogue';

interface ImportBanlistScreenProps {
  catalogue: Catalogue;
  official: ReadonlySet<string>;
  officialFetchedAt: string;
  onCreate: (list: CustomBanlist) => void;
  onBack: () => void;
}

export function ImportBanlistScreen({
  catalogue,
  official,
  officialFetchedAt,
  onCreate,
  onBack,
}: ImportBanlistScreenProps) {
  const [text, setText] = useState('');
  const [name, setName] = useState('Imported list');
  const [showErrors, setShowErrors] = useState(false);
  const nameIndex = useMemo(
    () => new Map(catalogue.cards.map((card) => [foldName(card.name), card.name])),
    [catalogue]
  );
  const result: ImportResult = useMemo(
    () => parseImport(text, official, nameIndex),
    [text, official, nameIndex]
  );

  if (showErrors && result.problems.length > 0) {
    return (
      <main class="screen import-banlist-screen">
        <header class="screen-header">
          <p class="kicker">Import stopped</p>
          <h1>{result.problems.length} lines did not match</h1>
        </header>
        <div class="err-head">
          Nothing was imported. Fix these lines and paste again — the rest of the list is fine ({result.added.length} bans, {result.removed.length} unbans).
        </div>
        <div class="err-list">
          {result.problems.map((problem) => (
            <div class="err-row" key={`${problem.line}-${problem.text}`}>
              <span class="ln">LINE {problem.line}</span>
              <span class="txt">{problem.text}</span>
              <span class="why">{problem.why}</span>
            </div>
          ))}
        </div>
        <button type="button" class="text-button" onClick={() => setShowErrors(false)}>
          ← Back to paste
        </button>
        <p class="muted">
          Names must match a real card exactly, punctuation included. Front-face names are enough for
          double-faced cards.
        </p>
      </main>
    );
  }

  return (
    <main class="screen import-banlist-screen">
      <div class="sheet-bar">
        <button type="button" class="text-button" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          class="text-button"
          onClick={() => {
            if (result.problems.length > 0) {
              setShowErrors(true);
              return;
            }
            onCreate({
              id: newListId(),
              name: name.trim() || 'Imported list',
              base: officialFetchedAt,
              added: result.added,
              removed: result.removed,
            });
          }}
        >
          Create
        </button>
      </div>

      <header class="screen-header">
        <p class="kicker">Import a banlist</p>
        <h1>Paste a list</h1>
      </header>
      <textarea
        class="paste-box"
        value={text}
        onInput={(event) => setText((event.currentTarget as HTMLTextAreaElement).value)}
        rows={10}
        placeholder="One card name per line. Prefix with - to unban."
      />
      <input
        class="name-input"
        value={name}
        onInput={(event) => setName((event.currentTarget as HTMLInputElement).value)}
        placeholder="List name"
      />
      <p class="import-summary">
        <span class="ok">{result.added.length} cards to ban · matched</span>
        <span class="ok">{result.removed.length} unbans (leading -)</span>
        {result.problems.length > 0 && (
          <span class="bad">{result.problems.length} lines did not match a card</span>
        )}
      </p>
    </main>
  );
}
