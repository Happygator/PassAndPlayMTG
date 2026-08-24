import { foldName } from './catalogue';

export interface CustomBanlist {
  id: string;
  name: string;
  /** The official banlist revision this diff was authored against (its `fetchedAt`). */
  base: string;
  /** Canonical card names banned on top of the official list. */
  added: string[];
  /** Canonical card names taken off the official list. */
  removed: string[];
}

export interface ImportProblem { line: number; text: string; why: string; }
export interface ImportResult { added: string[]; removed: string[]; problems: ImportProblem[]; }

const CUSTOM_LISTS_KEY = 'sealed:banlists';
const LAST_SEEN_OFFICIAL_KEY = 'sealed:official-banlist-seen';

export function loadCustomLists(): CustomBanlist[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CUSTOM_LISTS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as CustomBanlist[]) : [];
  } catch {
    // Storage disabled or malformed: behave as though no custom lists exist.
    return [];
  }
}

export function saveCustomList(list: CustomBanlist): CustomBanlist[] {
  const current = loadCustomLists();
  const index = current.findIndex((entry) => entry.id === list.id);
  const next = index === -1
    ? [...current, list]
    : current.map((entry, entryIndex) => (entryIndex === index ? list : entry));
  try {
    window.localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(next));
  } catch {
    // Not worth surfacing: the list remains available for this render only.
  }
  return next;
}

export function deleteCustomList(id: string): CustomBanlist[] {
  const next = loadCustomLists().filter((entry) => entry.id !== id);
  try {
    window.localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(next));
  } catch {
    // Not worth surfacing: storage may be unavailable in this webview.
  }
  return next;
}

export function newListId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function effectiveBanned(
  official: ReadonlySet<string>,
  list: CustomBanlist | null
): Set<string> {
  const effective = new Set(official);
  if (!list) return effective;
  list.added.forEach((name) => effective.add(name));
  // Add first, then remove: a name in both arrays intentionally ends up legal.
  list.removed.forEach((name) => effective.delete(name));
  return effective;
}

export function formatExport(list: CustomBanlist): string {
  const added = [...list.added].sort((a, b) => a.localeCompare(b));
  const removed = [...list.removed]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `-${name}`);
  return `${[...added, ...removed].join('\n')}\n`;
}

// No fuzzy matching, "did you mean", or autocorrection of any kind is intentional:
// card names collide (Rite of Flame vs Rite of Replication, Solitude vs Solemnity,
// and many Ajanis), so a wrong guess could silently ban or unban the wrong card.
// Folding (see foldName) is exact normalisation of punctuation and case, not fuzzy matching; it can never resolve a misspelling to a different card.
// Report the problem and let the user fix it. When problems is non-empty callers
// must import nothing; a partial import looks complete and is not. This function
// only reports problems; ImportBanlistScreen enforces the all-or-nothing import.
export function parseImport(
  text: string,
  official: ReadonlySet<string>,
  /** foldName(canonical) -> canonical card name. Lets a list typed with iOS
   *  smart quotes resolve against ASCII card names. */
  nameIndex: ReadonlyMap<string, string>
): ImportResult {
  const added: string[] = [];
  const removed: string[] = [];
  const problems: ImportProblem[] = [];
  const seen = new Map<string, number>();

  text.split('\n').forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const isUnban = trimmed.startsWith('-');
    const rawName = isUnban ? trimmed.slice(1).trim() : trimmed;
    const canonical = nameIndex.get(foldName(rawName));
    if (!canonical) {
      problems.push({ line: lineNumber, text: trimmed, why: 'No card has this name.' });
      return;
    }
    const name = canonical;
    if (seen.has(name)) {
      problems.push({ line: lineNumber, text: trimmed, why: 'Listed twice.' });
      return;
    }
    if (isUnban && !official.has(name)) {
      problems.push({
        line: lineNumber,
        text: trimmed,
        why: 'Marked for unban, but this card is not on the list you are importing onto.',
      });
      return;
    }
    if (!isUnban && official.has(name)) {
      problems.push({
        line: lineNumber,
        text: trimmed,
        why: 'Already banned by the official list.',
      });
      return;
    }

    if (isUnban) removed.push(name);
    else added.push(name);
    seen.set(name, lineNumber);
  });

  return { added, removed, problems };
}

export function readLastSeenOfficial(): { fetchedAt: string; names: string[] } | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LAST_SEEN_OFFICIAL_KEY) ?? 'null') as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as { fetchedAt?: unknown; names?: unknown };
    if (typeof value.fetchedAt !== 'string' || !Array.isArray(value.names)) return null;
    if (!value.names.every((name) => typeof name === 'string')) return null;
    return { fetchedAt: value.fetchedAt, names: value.names as string[] };
  } catch {
    return null;
  }
}

export function writeLastSeenOfficial(fetchedAt: string, names: string[]): void {
  try {
    window.localStorage.setItem(LAST_SEEN_OFFICIAL_KEY, JSON.stringify({ fetchedAt, names }));
  } catch {
    // Not worth surfacing: the digest may be shown again in a restricted webview.
  }
}

export function diffOfficial(
  previous: readonly string[],
  current: readonly string[]
): { added: string[]; removed: string[] } {
  const previousNames = new Set(previous);
  const currentNames = new Set(current);
  const added = current
    .filter((name) => !previousNames.has(name))
    .sort((a, b) => a.localeCompare(b));
  const removed = previous
    .filter((name) => !currentNames.has(name))
    .sort((a, b) => a.localeCompare(b));
  return { added, removed };
}
