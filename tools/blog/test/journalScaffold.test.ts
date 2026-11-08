import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  JOURNAL_INBOX_PATH,
  JOURNAL_TEMPLATE_PATH,
  isJournalEntryFileName,
  journalFileName,
  journalFrontmatter,
  journalSections,
} from '../src/check/journal';
import type { JournalRuleContext } from '../src/check/journal';
import { readSource } from '../src/check/markdown';
import {
  UNTRACKED,
  groupByTicket,
  readCommitSubjects,
  readFirstCommitDate,
  ticketIdsIn,
} from '../src/journal/git';
import { splitInbox } from '../src/journal/inbox';
import { createJournalEntry } from '../src/journal/newEntry';
import { buildJournalEntry, titleCaseTopic } from '../src/journal/scaffold';
import type { BuildJournalEntryInput } from '../src/journal/scaffold';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SUBJECTS = [
  '[FND-01] Scaffold the monorepo',
  'FND-02: World store',
  'fix typo',
  '[SIM-01] RNG',
];

const INBOX_ITEMS = [
  '- 2026-11-03 [FND-02] Typed tables beat one big map for the store.',
  '- 2026-11-05 [SIM-01] Named RNG streams kept two systems apart.\n  A second line stays with it.',
];

/** Midday local time, so the local date is 2026-11-08 in every time zone. */
const NOW = new Date(2026, 10, 8, 12, 0, 0);

let template = '';

beforeEach(async () => {
  template = await readFile(join(REPO_ROOT, JOURNAL_TEMPLATE_PATH), 'utf8');
});

function entryInput(overrides: Partial<BuildJournalEntryInput> = {}): BuildJournalEntryInput {
  return {
    template,
    topic: 'foundation',
    epics: [],
    now: NOW,
    lastEntryDate: '2026-11-01',
    commitsByTicket: groupByTicket(SUBJECTS),
    inboxItems: INBOX_ITEMS,
    ...overrides,
  };
}

function frontmatterOf(content: string): Record<string, unknown> {
  const data = readSource('docs/dev-journal/x.md', content).frontmatterData;
  if (typeof data !== 'object' || data === null) {
    throw new Error('no frontmatter');
  }
  return { ...data };
}

/** The lines of the `## <heading>` section, up to the next `##` heading. */
function sectionOf(content: string, heading: string): string {
  const start = content.indexOf(`## ${heading}\n`);
  const end = content.indexOf('\n## ', start + 1);
  return content.slice(start, end === -1 ? undefined : end);
}

describe('groupByTicket', () => {
  it('groups bracketed and leading IDs and puts the rest under untracked', () => {
    expect(Object.fromEntries(groupByTicket(SUBJECTS))).toEqual({
      'FND-01': ['[FND-01] Scaffold the monorepo'],
      'FND-02': ['FND-02: World store'],
      'SIM-01': ['[SIM-01] RNG'],
      [UNTRACKED]: ['fix typo'],
    });
  });

  it('also reads the conventional trailing form, listing a commit under every ID it names', () => {
    expect(ticketIdsIn('feat: world store (FND-04)')).toEqual(['FND-04']);
    expect(ticketIdsIn('fix: rounding (SIM-05, FND-14)')).toEqual(['SIM-05', 'FND-14']);
    expect(ticketIdsIn('chore(deps): bump a tool')).toEqual([]);
    const groups = groupByTicket(['fix: rounding (SIM-05, FND-14)', 'feat: ids (FND-14)']);
    expect(Object.fromEntries(groups)).toEqual({
      'SIM-05': ['fix: rounding (SIM-05, FND-14)'],
      'FND-14': ['fix: rounding (SIM-05, FND-14)', 'feat: ids (FND-14)'],
    });
  });
});

describe('buildJournalEntry', () => {
  it('lists only the chosen epics in tickets', () => {
    const entry = buildJournalEntry(entryInput({ epics: ['FND'] }));
    const frontmatter = frontmatterOf(entry.content);
    expect(frontmatter['epics']).toEqual(['FND']);
    expect(frontmatter['tickets']).toEqual(['FND-01', 'FND-02']);
    expect(sectionOf(entry.content, 'What I built')).not.toContain('SIM-01');
  });

  it('lists every ticket when no epic is given, in ID order', () => {
    const entry = buildJournalEntry(
      entryInput({
        commitsByTicket: groupByTicket([...SUBJECTS, '[FND-10] Ten', '[FND-3] Three']),
      }),
    );
    expect(frontmatterOf(entry.content)['tickets']).toEqual([
      'FND-01',
      'FND-02',
      'FND-3',
      'FND-10',
      'SIM-01',
    ]);
  });

  it('fills the title, date and heading from the topic and now', () => {
    const entry = buildJournalEntry(entryInput({ topic: 'state-of-the-build' }));
    const frontmatter = frontmatterOf(entry.content);
    expect(frontmatter['title']).toBe('State of the Build');
    expect(frontmatter['date']).toBe('2026-11-08');
    expect(entry.content).toContain('\n# State of the Build\n');
    expect(entry.content).not.toContain('# Title of the entry');
  });

  it("names the file after now's year and month", () => {
    expect(buildJournalEntry(entryInput()).fileName).toBe('2026-11-foundation.md');
    expect(buildJournalEntry(entryInput({ now: new Date(2027, 0, 31, 12) })).fileName).toBe(
      '2027-01-foundation.md',
    );
  });

  it('pre-fills a What I built bullet per ticket with its commit subjects', () => {
    const section = sectionOf(buildJournalEntry(entryInput()).content, 'What I built');
    expect(section).toContain('- **FND-01: Feature name.**');
    expect(section).toContain('  - [FND-01] Scaffold the monorepo');
    expect(section).toContain('- **FND-02: Feature name.**');
    expect(section).toContain('  - FND-02: World store');
    expect(section).toContain('- **Commits without a ticket ID.**');
    expect(section).toContain('  - fix typo');
    expect(section).toContain('since 2026-11-01');
    expect(section).not.toContain('TICKET-ID');
  });

  it('puts the inbox bullets under Raw notes exactly as written', () => {
    const section = sectionOf(buildJournalEntry(entryInput()).content, 'Raw notes');
    for (const item of INBOX_ITEMS) {
      expect(section).toContain(item);
    }
    expect(section).not.toContain('Bullets drained from');
  });

  it('writes "Nothing this time." under Raw notes when the inbox is empty', () => {
    const section = sectionOf(
      buildJournalEntry(entryInput({ inboxItems: [] })).content,
      'Raw notes',
    );
    expect(section).toContain('Nothing this time.');
  });

  it('passes the journal file name, frontmatter and section rules', () => {
    for (const epics of [[], ['FND']]) {
      const entry = buildJournalEntry(entryInput({ epics }));
      const context: JournalRuleContext = {
        source: readSource(`docs/dev-journal/${entry.fileName}`, entry.content),
        readme: null,
      };
      expect([
        ...journalFileName(context),
        ...journalFrontmatter(context),
        ...journalSections(context),
      ]).toEqual([]);
    }
  });

  it('quotes the title so a word YAML treats as a value stays a string', () => {
    expect(titleCaseTopic('a-b-c')).toBe('A B C');
    expect(buildJournalEntry(entryInput({ topic: 'null' })).content).toContain("title: 'Null'");
    expect(frontmatterOf(buildJournalEntry(entryInput({ topic: 'null' })).content)['title']).toBe(
      'Null',
    );
  });
});

describe('splitInbox', () => {
  it('keeps the header, fenced example included, and returns the notes', () => {
    const header = '# Journal inbox\n\n```\n- YYYY-MM-DD [TICKET-ID] note\n```\n\n## Notes\n';
    const inbox = splitInbox(`${header}\n${INBOX_ITEMS.join('\n')}\n\nloose text\n`);
    expect(inbox.header).toBe(header);
    expect(inbox.items).toEqual([...INBOX_ITEMS, 'loose text']);
  });

  it('treats a file without a Notes heading as all header', () => {
    expect(splitInbox('# Inbox\n- a note')).toEqual({ header: '# Inbox\n- a note\n', items: [] });
  });
});

describe('createJournalEntry', () => {
  let repoRoot = '';

  async function git(...args: string[]): Promise<void> {
    await execFileAsync('git', args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });
  }

  async function commit(subject: string): Promise<void> {
    await git('commit', '--allow-empty', '--quiet', '-m', subject);
  }

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'journal-new-'));
    await mkdir(join(repoRoot, 'docs/dev-journal'), { recursive: true });
    await writeFile(join(repoRoot, JOURNAL_TEMPLATE_PATH), template);
    await writeFile(
      join(repoRoot, JOURNAL_INBOX_PATH),
      `# Journal inbox\n\n## Notes\n\n${INBOX_ITEMS.join('\n')}\n`,
    );
    await git('init', '--quiet');
    for (const subject of SUBJECTS) {
      await commit(subject);
    }
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reads commit subjects oldest first, and the first commit date', async () => {
    expect(await readCommitSubjects('2000-01-01', repoRoot)).toEqual(SUBJECTS);
    expect(await readCommitSubjects('2099-01-01', repoRoot)).toEqual([]);
    expect(await readFirstCommitDate(repoRoot)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('writes the entry, drains the inbox, and takes -2 instead of overwriting', async () => {
    const options = { repoRoot, topic: 'foundation', epics: ['FND'], force: false, now: NOW };
    const first = await createJournalEntry(options);
    expect(first.path).toBe('docs/dev-journal/2026-11-foundation.md');
    expect(first.inboxNotes).toBe(2);
    const content = await readFile(join(repoRoot, first.path), 'utf8');
    expect(content).toContain('  - [FND-01] Scaffold the monorepo');
    expect(content).toContain(INBOX_ITEMS[0]);
    expect(await readFile(join(repoRoot, JOURNAL_INBOX_PATH), 'utf8')).toBe(
      '# Journal inbox\n\n## Notes\n',
    );

    const second = await createJournalEntry(options);
    expect(second.path).toBe('docs/dev-journal/2026-11-foundation-2.md');
    expect(second.inboxNotes).toBe(0);
    expect(await readFile(join(repoRoot, first.path), 'utf8')).toBe(content);

    const forced = await createJournalEntry({ ...options, force: true });
    expect(forced.path).toBe('docs/dev-journal/2026-11-foundation.md');
    const names = (await readdir(join(repoRoot, 'docs/dev-journal'))).filter(
      isJournalEntryFileName,
    );
    expect(names.sort()).toEqual(['2026-11-foundation-2.md', '2026-11-foundation.md']);
  });
});
