import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JOURNAL_SECTIONS } from '../src/check/journal';
import { runChecks } from '../src/check/run';
import type { CheckIssue, RuleId } from '../src/check/types';
import { copyFixtureRepo, editRepoFile, removeRepo, writeRepoFile } from './helpers';

const ENTRY = 'docs/dev-journal/2026-11-first-entry.md';
const JOURNAL_README = 'docs/dev-journal/README.md';

let repoRoot = '';
let validEntry = '';

beforeEach(async () => {
  repoRoot = await copyFixtureRepo();
  validEntry = await readFile(join(repoRoot, ENTRY), 'utf8');
});

afterEach(async () => {
  await removeRepo(repoRoot);
});

async function checkJournal(): Promise<CheckIssue[]> {
  return runChecks({
    repoRoot,
    requireBannedTerms: false,
    privateBannedTerms: ['Fictional Banned Co'],
    only: 'journal',
  });
}

function withRule(issues: readonly CheckIssue[], rule: RuleId): CheckIssue[] {
  return issues.filter((issue) => issue.rule === rule);
}

/** Adds an index row for a new entry, so only the rule under test fires. */
async function indexEntry(fileName: string): Promise<void> {
  await editRepoFile(
    repoRoot,
    JOURNAL_README,
    (text) => `${text}| 2026-11-08 | [Another entry](${fileName}) | - | - |\n`,
  );
}

describe('journal rules', () => {
  it('pass a valid entry', async () => {
    expect(await checkJournal()).toEqual([]);
  });

  it('do not treat the epic exit checklist as an entry', async () => {
    await writeRepoFile(
      repoRoot,
      'docs/dev-journal/epic-exit-checklist.md',
      '# Epic exit checklist\n\n## Closing tickets\n\n| Epic | Closing ticket ID | Entry file |\n',
    );
    expect(await checkJournal()).toEqual([]);
  });

  it('fail a file name without a two-digit month', async () => {
    await writeRepoFile(repoRoot, 'docs/dev-journal/2026-1-x.md', validEntry);
    await indexEntry('2026-1-x.md');
    expect(await checkJournal()).toEqual([
      expect.objectContaining({ rule: 'journal-file-name', file: 'docs/dev-journal/2026-1-x.md' }),
    ]);
  });

  it('accept a -2 suffix and fail a month that does not exist', async () => {
    await writeRepoFile(repoRoot, 'docs/dev-journal/2026-11-first-entry-2.md', validEntry);
    await indexEntry('2026-11-first-entry-2.md');
    await writeRepoFile(
      repoRoot,
      'docs/dev-journal/2026-13-x.md',
      validEntry.replace('date: 2026-11-07', 'date: 2026-12-07'),
    );
    await indexEntry('2026-13-x.md');
    expect(withRule(await checkJournal(), 'journal-file-name').map((issue) => issue.file)).toEqual([
      'docs/dev-journal/2026-13-x.md',
    ]);
  });

  it('fail a date outside the month in the file name', async () => {
    await writeRepoFile(
      repoRoot,
      'docs/dev-journal/2026-11-x.md',
      validEntry.replace('date: 2026-11-07', 'date: 2026-12-03'),
    );
    await indexEntry('2026-11-x.md');
    const issues = await checkJournal();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: 'journal-frontmatter',
      file: 'docs/dev-journal/2026-11-x.md',
      line: 3,
    });
    expect(issues[0]?.message).toContain('2026-12-03 is not in 2026-11');
  });

  it('fail missing, malformed and unknown frontmatter fields', async () => {
    await editRepoFile(repoRoot, ENTRY, (text) =>
      text
        .replace("milestone: ''\n", '')
        .replace('tickets: [FND-01]', 'tickets: [fnd one]')
        .replace('epics: [FND]', 'epics: [FND]\nmood: tired'),
    );
    const messages = withRule(await checkJournal(), 'journal-frontmatter').map(
      (issue) => issue.message,
    );
    expect(messages).toHaveLength(3);
    expect(messages.join('\n')).toMatch(/milestone/);
    expect(messages.join('\n')).toMatch(/tickets\.0/);
    expect(messages.join('\n')).toMatch(/mood/);
  });

  it('fail an entry with no frontmatter block', async () => {
    await editRepoFile(repoRoot, ENTRY, (text) => text.replace(/^---[\s\S]*?\n---\n/, ''));
    const issues = withRule(await checkJournal(), 'journal-frontmatter');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(1);
    expect(issues[0]?.message).toContain('---');
  });

  it('fail an entry missing the ## Numbers heading', async () => {
    await editRepoFile(repoRoot, ENTRY, (text) => text.replace('## Numbers\n', ''));
    const issues = await checkJournal();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.rule).toBe('journal-sections');
    expect(issues[0]?.message).toContain('## Numbers');
  });

  it('fail sections out of order', async () => {
    await editRepoFile(repoRoot, ENTRY, (text) =>
      text
        .replace('## Summary', '## PLACEHOLDER')
        .replace('## Next', '## Summary')
        .replace('## PLACEHOLDER', '## Next'),
    );
    const issues = withRule(await checkJournal(), 'journal-sections');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.message).join('\n')).toMatch(/keep the template's order/);
  });

  it('ignore a heading inside fenced code', async () => {
    await editRepoFile(repoRoot, ENTRY, (text) =>
      text.replace('## Numbers\n', '```md\n## Numbers\n```\n'),
    );
    expect(withRule(await checkJournal(), 'journal-sections')).toHaveLength(1);
  });

  it('warn about an entry missing from the README index', async () => {
    await writeRepoFile(repoRoot, 'docs/dev-journal/2026-11-unlisted.md', validEntry);
    expect(await checkJournal()).toEqual([
      expect.objectContaining({
        rule: 'journal-index-sync',
        severity: 'warning',
        file: 'docs/dev-journal/2026-11-unlisted.md',
      }),
    ]);
  });

  it('skip the template and the inbox for the entry rules', async () => {
    await writeRepoFile(repoRoot, 'docs/dev-journal/_template.md', '# Template\n');
    expect(await checkJournal()).toEqual([]);
  });

  it('expect the same ten sections as the real journal template, in its order', async () => {
    const template = await readFile(
      fileURLToPath(new URL('../../../docs/dev-journal/_template.md', import.meta.url)),
      'utf8',
    );
    const headings = [...template.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([...JOURNAL_SECTIONS]);
  });
});
