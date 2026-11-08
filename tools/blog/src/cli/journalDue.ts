import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { EPIC_EXIT_CHECKLIST_PATH } from '../check/journal';
import {
  DEFAULT_DUE_THRESHOLD,
  computeJournalDue,
  formatJournalDue,
  readClosingTickets,
} from '../journal/due';
import { readJournalEntries } from '../journal/entries';
import { readCommitLog } from '../journal/git';

// `npm run journal:due -- [--threshold <commits>]`
// Advisory: always exits 0 once it has printed the report, so it can never fail a build.
// Exit code 2 means bad arguments.

const USAGE = `Usage: npm run journal:due -- [--threshold <commits>]

  --threshold <commits>  commits since an epic's last entry that make it due (default ${String(DEFAULT_DUE_THRESHOLD)})

Lists every epic prefix in the commit history with its last journal entry and the commits since.
An epic is also due when its closing ticket (docs/dev-journal/epic-exit-checklist.md) shows up in
a commit with no entry after it.
`;

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

async function readChecklist(): Promise<string> {
  try {
    return await readFile(join(REPO_ROOT, EPIC_EXIT_CHECKLIST_PATH), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        threshold: { type: 'string', default: String(DEFAULT_DUE_THRESHOLD) },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const threshold = Number(parsed.values.threshold);
  if (!/^\d+$/.test(parsed.values.threshold) || threshold < 1) {
    process.stderr.write(`--threshold must be a whole number of commits, 1 or more\n\n${USAGE}`);
    return 2;
  }

  const report = computeJournalDue({
    commits: await readCommitLog(REPO_ROOT),
    entries: await readJournalEntries(REPO_ROOT),
    closingTickets: readClosingTickets(await readChecklist()),
    now: new Date(),
    threshold,
  });
  process.stdout.write(formatJournalDue(report, threshold));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
