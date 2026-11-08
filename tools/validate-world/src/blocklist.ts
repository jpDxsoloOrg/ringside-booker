/**
 * The real-name blocklist: names of real performers, promotions, shows, titles and networks that
 * must never appear in the game's content.
 *
 * The committed list (`content/blocklist/real-names.txt`) is always loaded. A missing or empty list
 * is a usage error, so the check can never quietly switch itself off. Extra lists passed with
 * `--blocklist` are added on top of it; they never replace it.
 *
 * The file format and the matching rules live in `./realNameMatcher.ts`, which the blog checker
 * uses too, so a name is blocked the same way in content and in posts.
 */

import { readFile } from 'node:fs/promises';
import {
  createEntry,
  matchesEntry,
  parseTermLines,
  TermLineError,
  type BlocklistEntry,
} from './realNameMatcher';

export { matchesEntry, nameForms, type BlocklistEntry } from './realNameMatcher';

/** The committed list, relative to the repository root. */
export const COMMITTED_BLOCKLIST_PATH = 'content/blocklist/real-names.txt';

/** A blocklist that cannot be used: missing, unreadable, empty or holding an unusable line. */
export class BlocklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlocklistError';
  }
}

export interface Blocklist {
  readonly entries: readonly BlocklistEntry[];
}

/** The first entry `value` matches, in file order, or null. */
export function findBlockedName(value: string, blocklist: Blocklist): BlocklistEntry | null {
  return blocklist.entries.find((entry) => matchesEntry(value, entry)) ?? null;
}

/**
 * Parses a blocklist file's text. Throws `BlocklistError` for a line with no letters or digits or
 * with a flag it cannot use.
 */
export function parseBlocklist(text: string, source: string): BlocklistEntry[] {
  let terms: ReturnType<typeof parseTermLines>;
  try {
    terms = parseTermLines(text);
  } catch (error: unknown) {
    if (error instanceof TermLineError) {
      const rawLine = text.split(/\r?\n/u)[error.line - 1]?.trim() ?? '';
      throw new BlocklistError(`${source}:${String(error.line)}: "${rawLine}": ${error.message}`);
    }
    throw error;
  }
  return terms.map(({ spec, line }) => {
    const entry = createEntry(spec, source, line);
    if (entry.compact.length === 0) {
      throw new BlocklistError(
        `${source}:${String(line)}: "${spec.name}" has no letters or digits to match on`,
      );
    }
    return entry;
  });
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
