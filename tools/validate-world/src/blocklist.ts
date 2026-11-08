/**
 * The real-name blocklist: names of real performers, promotions, shows, titles and networks that
 * must never appear in the game's content.
 *
 * The committed list (`content/blocklist/real-names.txt`) is always loaded. A missing or empty list
 * is a usage error, so the check can never quietly switch itself off. Extra lists passed with
 * `--blocklist` are added on top of it; they never replace it.
 *
 * File format: one name per line; blank lines and lines starting with `#` are ignored.
 *
 * Matching ignores case, accents and punctuation:
 *
 * - A one-word entry (`Nightfall`) matches a field only when the whole field is that word, so a
 *   common word on the list does not flag every name that contains it.
 * - A longer entry (`Harbour City Wrestling`) matches when its words appear in a row anywhere in
 *   the field (`The Harbour City Wrestling Show`).
 * - Punctuation is tried both as a word break and as nothing, so `A.J. Example` matches
 *   `AJ Example` and `Rey-Example` matches `Rey Example`; a name with its spaces removed
 *   (`SmackExample` against `Smack Example`) matches too.
 */

import { readFile } from 'node:fs/promises';

/** The committed list, relative to the repository root. */
export const COMMITTED_BLOCKLIST_PATH = 'content/blocklist/real-names.txt';

/** A blocklist that cannot be used: missing, unreadable, empty or holding an unusable line. */
export class BlocklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlocklistError';
  }
}

export interface BlocklistEntry {
  /** The name as written in the file. */
  readonly name: string;
  /** The file it came from, as shown in messages. */
  readonly source: string;
  readonly line: number;
  /** Words with punctuation read as a break, then with punctuation dropped. */
  readonly spacedWords: readonly string[];
  readonly joinedWords: readonly string[];
  /** Every letter and digit, nothing else. */
  readonly compact: string;
}

export interface Blocklist {
  readonly entries: readonly BlocklistEntry[];
}

/** Letters that do not split into a base letter and an accent under Unicode decomposition. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/** Lower case, accents removed, special letters spelled out. Punctuation is kept for now. */
export function foldName(value: string): string {
  const lower = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return lower.replace(/[ßæœøłđðþı]/gu, (letter) => SPECIAL_LETTERS[letter] ?? letter);
}

function words(text: string): string[] {
  return text.split(/\s+/u).filter((word) => word.length > 0);
}

/** The forms of a name that matching compares. */
export function nameForms(value: string): {
  spacedWords: string[];
  joinedWords: string[];
  compact: string;
} {
  const folded = foldName(value);
  const spaced = folded.replace(/[^\p{L}\p{N}]+/gu, ' ');
  const joined = folded.replace(/[^\p{L}\p{N}\s]+/gu, '');
  return {
    spacedWords: words(spaced),
    joinedWords: words(joined),
    compact: folded.replace(/[^\p{L}\p{N}]+/gu, ''),
  };
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let all = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        all = false;
        break;
      }
    }
    if (all) {
      return true;
    }
  }
  return false;
}

function wordsMatch(field: readonly string[], entry: readonly string[]): boolean {
  if (entry.length === 1) {
    return field.length === 1 && field[0] === entry[0];
  }
  return containsRun(field, entry);
}

/** True when `value` matches `entry` under the rules at the top of this file. */
export function matchesEntry(value: string, entry: BlocklistEntry): boolean {
  const forms = nameForms(value);
  if (forms.compact.length > 0 && forms.compact === entry.compact) {
    return true;
  }
  return (
    wordsMatch(forms.spacedWords, entry.spacedWords) ||
    wordsMatch(forms.joinedWords, entry.joinedWords)
  );
}

/** The first entry `value` matches, in file order, or null. */
export function findBlockedName(value: string, blocklist: Blocklist): BlocklistEntry | null {
  return blocklist.entries.find((entry) => matchesEntry(value, entry)) ?? null;
}

/** Parses a blocklist file's text. Throws `BlocklistError` for a line with no letters or digits. */
export function parseBlocklist(text: string, source: string): BlocklistEntry[] {
  const entries: BlocklistEntry[] = [];
  text.split(/\r?\n/u).forEach((rawLine, index) => {
    const name = rawLine.trim();
    if (name.length === 0 || name.startsWith('#')) {
      return;
    }
    const forms = nameForms(name);
    if (forms.compact.length === 0) {
      throw new BlocklistError(
        `${source}:${String(index + 1)}: "${name}" has no letters or digits to match on`,
      );
    }
    entries.push({ name, source, line: index + 1, ...forms });
  });
  return entries;
}

/** Reads one blocklist file. A missing, unreadable or empty file throws `BlocklistError`. */
export async function readBlocklistFile(
  path: string,
  displayPath: string,
): Promise<BlocklistEntry[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BlocklistError(`Cannot read the blocklist ${displayPath}: ${reason}`);
  }
  const entries = parseBlocklist(text, displayPath);
  if (entries.length === 0) {
    throw new BlocklistError(
      `The blocklist ${displayPath} has no names in it; the real-name check cannot run without it`,
    );
  }
  return entries;
}

/** The committed list followed by every extra list, in the order given. */
export async function loadBlocklist(
  committed: { path: string; displayPath: string },
  extras: readonly { path: string; displayPath: string }[],
): Promise<Blocklist> {
  const entries = [...(await readBlocklistFile(committed.path, committed.displayPath))];
  for (const extra of extras) {
    entries.push(...(await readBlocklistFile(extra.path, extra.displayPath)));
  }
  return { entries };
}
