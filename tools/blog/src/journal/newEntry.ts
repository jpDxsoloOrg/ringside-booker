import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { JOURNAL_DIR, JOURNAL_INBOX_PATH, JOURNAL_TEMPLATE_PATH } from '../check/journal';
import { freeEntryFileName, readJournalEntries } from './entries';
import { groupByTicket, readCommitSubjects, readFirstCommitDate } from './git';
import { splitInbox } from './inbox';
import { buildJournalEntry } from './scaffold';

// What `npm run journal:new` does, apart from reading its arguments.

export interface CreateJournalEntryOptions {
  /** Absolute path of the repository root. */
  readonly repoRoot: string;
  /** The kebab-case topic; the caller has validated it. */
  readonly topic: string;
  /** Epic prefixes to keep in `tickets`; empty keeps every ticket. */
  readonly epics: readonly string[];
  /** Overwrite `YYYY-MM-<topic>.md` instead of moving on to `-2`, `-3`... */
  readonly force: boolean;
  readonly now: Date;
}

export interface CreatedJournalEntry {
  /** Repo-relative path of the new entry. */
  readonly path: string;
  /** Where the commits were read from: the newest entry's date, or the first commit's. */
  readonly since: string | null;
  readonly inboxNotes: number;
}

/**
 * Scaffolds a journal entry from the commits since the newest entry and the inbox notes, writes
 * it, and then empties the inbox down to its header. Without `force`, an existing file is never
 * overwritten: the entry takes the next free `-N` name instead.
 */
export async function createJournalEntry(
  options: CreateJournalEntryOptions,
): Promise<CreatedJournalEntry> {
  const { repoRoot } = options;
  const entries = await readJournalEntries(repoRoot);
  const lastEntryDate = entries.at(-1)?.date ?? null;
  const since = lastEntryDate ?? (await readFirstCommitDate(repoRoot));
  const subjects = since === null ? [] : await readCommitSubjects(since, repoRoot);

  const template = await readFile(join(repoRoot, JOURNAL_TEMPLATE_PATH), 'utf8');
  const inboxPath = join(repoRoot, JOURNAL_INBOX_PATH);
  const inbox = splitInbox(await readFile(inboxPath, 'utf8'));

  const draft = buildJournalEntry({
    template,
    topic: options.topic,
    epics: options.epics,
    now: options.now,
    lastEntryDate,
    commitsByTicket: groupByTicket(subjects),
    inboxItems: inbox.items,
  });

  const folder = join(repoRoot, JOURNAL_DIR);
  const fileName = options.force ? draft.fileName : freeEntryFileName(folder, draft.fileName);
  // 'wx' fails if the file appeared in the meantime, so nothing is overwritten without --force.
  await writeFile(join(folder, fileName), draft.content, { flag: options.force ? 'w' : 'wx' });
  if (inbox.items.length > 0) {
    await writeFile(inboxPath, inbox.header);
  }

  return { path: `${JOURNAL_DIR}/${fileName}`, since, inboxNotes: inbox.items.length };
}
