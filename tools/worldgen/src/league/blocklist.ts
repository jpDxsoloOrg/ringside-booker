/**
 * The real-name blocklist for the league roster: the same committed list and the same matcher that
 * `validate-world` uses, so anything the league import keeps also passes `npm run validate:world`.
 *
 * Names (ring names, team names) match with the name rules; bios and move names are running text
 * and match with the blog checker's whole-word rules.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createEntry,
  matchesEntry,
  parseTermLines,
  textPattern,
  type BlocklistEntry,
} from '@ringside/validate-world/real-name-matcher';

export const BLOCKLIST_PATH = 'content/blocklist/real-names.txt';

export interface LeagueBlocklist {
  /** True when a name field matches a blocked name. */
  readonly blocksName: (value: string) => boolean;
  /** True when running text (a bio, a move name) mentions a blocked name. */
  readonly blocksText: (value: string) => boolean;
}

export function blocklistFromText(text: string): LeagueBlocklist {
  const terms = parseTermLines(text);
  const entries: BlocklistEntry[] = terms.map(({ spec, line }) =>
    createEntry(spec, BLOCKLIST_PATH, line),
  );
  const patterns = terms.map(({ spec }) => textPattern(spec));
  if (entries.length === 0) {
    throw new Error(`The blocklist ${BLOCKLIST_PATH} has no names in it`);
  }
  return {
    blocksName: (value) => entries.some((entry) => matchesEntry(value, entry)),
    blocksText: (value) =>
      patterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(value);
      }),
  };
}

export async function readLeagueBlocklist(repoRoot: string): Promise<LeagueBlocklist> {
  return blocklistFromText(await readFile(join(repoRoot, BLOCKLIST_PATH), 'utf8'));
}
