import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { JOURNAL_DIR, JournalFrontmatter, isJournalEntryFileName } from '../check/journal';
import { readSource } from '../check/markdown';

// Lists the existing journal entries for journal:new and journal:due.

/** The parts of an entry the journal tools need. */
export interface JournalEntrySummary {
  readonly fileName: string;
  /** The frontmatter `date`, `YYYY-MM-DD`. */
  readonly date: string;
  readonly epics: readonly string[];
}

/**
 * Reads every journal entry in docs/dev-journal, oldest first by `date` (then by file name).
 * Entries whose frontmatter does not pass the journal schema are skipped; `blog:check` reports
 * them.
 */
export async function readJournalEntries(repoRoot: string): Promise<JournalEntrySummary[]> {
  const folder = join(repoRoot, JOURNAL_DIR);
  const names = (await readdir(folder, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .filter(isJournalEntryFileName);

  const entries: JournalEntrySummary[] = [];
  for (const fileName of names) {
    const source = readSource(
      `${JOURNAL_DIR}/${fileName}`,
      await readFile(join(folder, fileName), 'utf8'),
    );
    const parsed = JournalFrontmatter.safeParse(source.frontmatterData);
    if (parsed.success) {
      entries.push({ fileName, date: parsed.data.date, epics: parsed.data.epics });
    }
  }
  return sortEntries(entries);
}

/** Oldest first by `date`, then by file name. */
export function sortEntries(entries: readonly JournalEntrySummary[]): JournalEntrySummary[] {
  return [...entries].sort(
    (left, right) =>
      compareText(left.date, right.date) || compareText(left.fileName, right.fileName),
  );
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The file name a new entry gets in `folder`: `fileName` itself when it is free, otherwise the
 * first free `-2`, `-3`... variant, as docs/dev-journal/README.md describes.
 */
export function freeEntryFileName(folder: string, fileName: string): string {
  if (!existsSync(join(folder, fileName))) {
    return fileName;
  }
  const stem = fileName.replace(/\.md$/, '');
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${String(suffix)}.md`;
    if (!existsSync(join(folder, candidate))) {
      return candidate;
    }
  }
}
