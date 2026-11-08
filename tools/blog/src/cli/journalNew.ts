import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { JOURNAL_TOPIC_PATTERN } from '../check/journal';
import { createJournalEntry } from '../journal/newEntry';

// `npm run journal:new -- <topic> [--epic <PREFIX>]... [--force]`
// Exit codes: 0 entry written, 1 the entry could not be written, 2 bad arguments.

const USAGE = `Usage: npm run journal:new -- <topic> [--epic <PREFIX>]... [--force]

  <topic>          kebab-case topic, for example foundation or state-of-the-build
  --epic <PREFIX>  epic prefix the entry covers, such as FND (repeat for several); only that
                   epic's tickets are listed. Every ticket in the commits when left out.
  --force          overwrite docs/dev-journal/YYYY-MM-<topic>.md instead of adding -2, -3...

Writes docs/dev-journal/YYYY-MM-<topic>.md from _template.md, pre-filled with the commits since the
newest entry and the notes in _inbox.md, then empties the inbox down to its header.
`;

const EPIC_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*$/;

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function usageError(message: string): number {
  process.stderr.write(`${message}\n\n${USAGE}`);
  return 2;
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        epic: { type: 'string', multiple: true, default: [] },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error: unknown) {
    return usageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const [topic, ...extra] = positionals;
  if (topic === undefined || extra.length > 0) {
    return usageError('give exactly one topic');
  }
  if (!JOURNAL_TOPIC_PATTERN.test(topic)) {
    return usageError(`"${topic}" is not a kebab-case topic (lowercase letters, digits, hyphens)`);
  }
  const badEpic = values.epic.find((epic) => !EPIC_PREFIX_PATTERN.test(epic));
  if (badEpic !== undefined) {
    return usageError(`"${badEpic}" is not an epic prefix such as FND or SIM`);
  }

  try {
    const created = await createJournalEntry({
      repoRoot: REPO_ROOT,
      topic,
      epics: [...new Set(values.epic)],
      force: values.force,
      now: new Date(),
    });
    process.stdout.write(`${created.path}\n`);
    process.stderr.write(
      `Commits since ${created.since ?? 'the start'}; ${String(created.inboxNotes)} inbox note(s) drained.\n` +
        'Next: fill in every section, add the Index row in docs/dev-journal/README.md, and run\n' +
        'npm run blog:check -- --only journal\n',
    );
    return 0;
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
