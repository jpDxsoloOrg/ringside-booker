import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatReport, summarizeIssues } from '../src/check/format';
import { bannedTermPattern, maskTerm, maskTermsIn, parseTermList } from '../src/check/mask';
import { CheckUsageError, loadPrivateBannedTerms, runChecks } from '../src/check/run';
import type { RunChecksOptions } from '../src/check/run';
import type { CheckIssue, RuleId } from '../src/check/types';
import {
  copyFixtureRepo,
  editRepoFile,
  lineContaining,
  removeRepo,
  writeRepoFile,
} from './helpers';

const FINAL_POST = 'docs/blog/01-the-first-fixture-post.md';
const DRAFT_POST = 'docs/blog/02-the-second-fixture-post.md';
const BLOG_README = 'docs/blog/README.md';
const JOURNAL_ENTRY = 'docs/dev-journal/2026-11-first-entry.md';
const INBOX = 'docs/dev-journal/_inbox.md';
const BANNED_COMPANY = 'Fictional Banned Co';
const PRIVATE_FOLDER = 'fictional-private-notes/mechanics';

let repoRoot = '';

beforeEach(async () => {
  repoRoot = await copyFixtureRepo();
});

afterEach(async () => {
  await removeRepo(repoRoot);
});

/** Runs the checker on the copied repo with the private list injected, unless told otherwise. */
async function check(overrides: Partial<RunChecksOptions> = {}): Promise<CheckIssue[]> {
  return runChecks({
    repoRoot,
    requireBannedTerms: false,
    privateBannedTerms: [BANNED_COMPANY, PRIVATE_FOLDER],
    ...overrides,
  });
}

function withRule(issues: readonly CheckIssue[], rule: RuleId): CheckIssue[] {
  return issues.filter((issue) => issue.rule === rule);
}

/** Replaces the hook paragraph of the final post and returns the post's new text. */
async function replaceHook(repoPath: string, paragraph: string): Promise<string> {
  await editRepoFile(repoRoot, repoPath, (text) =>
    text
      .replace("The draft's hook paragraph.", paragraph)
      .replace(/This is the hook paragraph\.[^\n]*\n\[the journal entry\]\([^)]*\)\./, paragraph),
  );
  return readFile(join(repoRoot, repoPath), 'utf8');
}

describe('runChecks on the fixture repo', () => {
  it('finds nothing wrong with a valid final post, draft, journal entry and inbox', async () => {
    expect(await check()).toEqual([]);
  });

  it('is clean on the blog and journal with --only too', async () => {
    expect(await check({ only: 'blog' })).toEqual([]);
    expect(await check({ only: 'journal' })).toEqual([]);
  });
});

describe('mdx-compiles', () => {
  it('fails a bare Traced<T> in prose and points at its line in the file', async () => {
    const text = await replaceHook(
      FINAL_POST,
      'Every formula in the engine returns a value and the steps behind it, and the type\nfor that is Traced<T> in the engine.',
    );
    const issues = withRule(await check(), 'mdx-compiles');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      file: FINAL_POST,
      line: lineContaining(text, 'Traced<T> in the engine'),
    });
    expect(issues[0]?.message).toMatch(/closing tag/);
    expect(issues[0]?.message).not.toMatch(/\d+:\d+-\d+:\d+/);
  });

  it('passes the same text inside backticks', async () => {
    await replaceHook(FINAL_POST, 'The type for that is `Traced<T>` in the engine.');
    expect(await check()).toEqual([]);
  });

  it('fails {value} in prose, which compiles but breaks the rendered page', async () => {
    const text = await replaceHook(FINAL_POST, 'A trace holds {value} and its steps.');
    const issues = withRule(await check(), 'mdx-compiles');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.line).toBe(lineContaining(text, '{value}'));
    expect(issues[0]?.message).toMatch(/expression/);
  });

  it('fails a capitalised tag the blog has no component for', async () => {
    await replaceHook(FINAL_POST, 'Wrap it in <Panel>a panel</Panel> here.');
    expect(withRule(await check(), 'mdx-compiles')[0]?.message).toMatch(/<Panel> is not/);
  });

  it('is skipped for outline posts', async () => {
    await replaceHook(DRAFT_POST, 'Traced<T> is fine while outlining.');
    await editRepoFile(repoRoot, DRAFT_POST, (text) =>
      text.replace('status: draft', 'status: outline'),
    );
    await editRepoFile(repoRoot, BLOG_README, (text) => text.replace('| draft   |', '| outline |'));
    expect(withRule(await check(), 'mdx-compiles')).toEqual([]);
  });

  it('reports a post the transform cannot build, such as an image outside images/', async () => {
    await writeRepoFile(repoRoot, 'docs/blog/stray.svg', '<svg></svg>\n');
    await replaceHook(FINAL_POST, '![A stray image](stray.svg)');
    expect(withRule(await check(), 'mdx-compiles')[0]?.message).toMatch(
      /cannot build the blog payload/,
    );
  });
});

describe('no-body-h1', () => {
  it('fails a # heading in the body', async () => {
    const text = await replaceHook(FINAL_POST, '# Title');
    const issues = withRule(await check(), 'no-body-h1');
    expect(issues).toEqual([
      expect.objectContaining({ file: FINAL_POST, line: lineContaining(text, '# Title') }),
    ]);
  });

  it('ignores # lines inside fenced code', async () => {
    expect(withRule(await check(), 'no-body-h1')).toEqual([]);
  });
});

describe('banned-terms', () => {
  it('fails a term from the private list and prints it masked', async () => {
    const text = await replaceHook(FINAL_POST, `I once booked a show for ${BANNED_COMPANY} here.`);
    const issues = withRule(await check(), 'banned-terms');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      line: lineContaining(text, 'booked a show'),
    });
    expect(issues[0]?.message).toContain('F******** B***** C*');
    expect(issues[0]?.message).not.toContain(BANNED_COMPANY);
  });

  it('matches case-insensitively, across a line break and in frontmatter and code', async () => {
    await editRepoFile(repoRoot, FINAL_POST, (text) =>
      text
        .replace('tags: [gamedev, typescript]', 'tags: [gamedev, fictional banned co]')
        .replace('const traced', '// FICTIONAL BANNED CO\nconst traced')
        .replace('This is the hook paragraph.', 'This is the fictional banned\nco hook.'),
    );
    const text = await readFile(join(repoRoot, FINAL_POST), 'utf8');
    const issues = withRule(await check(), 'banned-terms');
    expect(issues.map((issue) => issue.line)).toEqual([
      lineContaining(text, 'tags:'),
      lineContaining(text, 'the fictional banned'),
      lineContaining(text, '// FICTIONAL'),
    ]);
  });

  it('matches whole words only', async () => {
    await replaceHook(FINAL_POST, 'The Fictional Banned Company is a different name.');
    expect(withRule(await check(), 'banned-terms')).toEqual([]);
  });

  it('fails a private path fragment from the injected list, masked', async () => {
    await replaceHook(FINAL_POST, `My notes live in ~/source/${PRIVATE_FOLDER}/04.md for now.`);
    const issues = withRule(await check(), 'banned-terms');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain(maskTerm(PRIVATE_FOLDER));
    expect(formatReport(issues)).not.toContain(PRIVATE_FOLDER);
  });

  it('fails a name from content/blocklist/real-names.txt without the private list', async () => {
    await replaceHook(FINAL_POST, 'The main event starred Blocklisted Person in the opener.');
    const issues = withRule(await check({ privateBannedTerms: [] }), 'banned-terms');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.file).toBe(FINAL_POST);
    expect(issues[0]?.message).toContain('B********** P*****');
  });

  it('runs on journal entries, the inbox and the READMEs', async () => {
    await editRepoFile(
      repoRoot,
      INBOX,
      (text) => `${text}- 2026-11-09 [FND-02] ${BANNED_COMPANY}\n`,
    );
    await editRepoFile(repoRoot, JOURNAL_ENTRY, (text) =>
      text.replace('I set up', `${BANNED_COMPANY}: I set up`),
    );
    await editRepoFile(repoRoot, BLOG_README, (text) => `${text}\n${BANNED_COMPANY}\n`);
    const files = withRule(await check(), 'banned-terms').map((issue) => issue.file);
    expect(files).toEqual([BLOG_README, JOURNAL_ENTRY, INBOX]);
  });

  it('never prints a banned term in any message, whichever rule reports it', async () => {
    await editRepoFile(repoRoot, FINAL_POST, (text) =>
      text.replace('title: The first fixture post', `title: The ${BANNED_COMPANY} post`),
    );
    const issues = await check();
    expect(withRule(issues, 'series-index-sync')).toHaveLength(1);
    expect(formatReport(issues)).not.toMatch(/fictional banned co/i);
  });
});

describe('banned-terms-missing', () => {
  it('is a warning when the list is missing and not required', async () => {
    const issues = await runChecks({
      repoRoot,
      requireBannedTerms: false,
      env: {},
      homeDir: repoRoot,
    });
    expect(issues).toEqual([
      expect.objectContaining({ rule: 'banned-terms-missing', severity: 'warning' }),
    ]);
  });

  it('is an error when the list is required', async () => {
    const issues = await runChecks({
      repoRoot,
      requireBannedTerms: true,
      env: {},
      homeDir: repoRoot,
    });
    expect(issues).toEqual([
      expect.objectContaining({ rule: 'banned-terms-missing', severity: 'error' }),
    ]);
  });

  it('reads the list from BLOG_BANNED_TERMS, then BLOG_BANNED_TERMS_FILE, then the default file', async () => {
    const listPath = join(repoRoot, 'list.txt');
    await writeFile(listPath, '# private\n\nFrom File\n');
    expect(
      await loadPrivateBannedTerms({ BLOG_BANNED_TERMS: 'One\nTwo Words\n' }, repoRoot),
    ).toEqual(['One', 'Two Words']);
    expect(
      await loadPrivateBannedTerms(
        { BLOG_BANNED_TERMS: '  ', BLOG_BANNED_TERMS_FILE: listPath },
        repoRoot,
      ),
    ).toEqual(['From File']);
    await mkdir(join(repoRoot, '.config', 'ringside-booker'), { recursive: true });
    await writeFile(join(repoRoot, '.config', 'ringside-booker', 'banned-terms.txt'), 'Default\n');
    expect(await loadPrivateBannedTerms({}, repoRoot)).toEqual(['Default']);
    expect(
      await loadPrivateBannedTerms(
        { BLOG_BANNED_TERMS_FILE: join(repoRoot, 'nope.txt') },
        repoRoot,
      ),
    ).toBeNull();
  });

  it('treats a list with only comments as missing', async () => {
    expect(
      await loadPrivateBannedTerms({ BLOG_BANNED_TERMS: '# nothing yet' }, repoRoot),
    ).toBeNull();
  });
});

describe('no-private-references', () => {
  it('fails a research note citation in a post', async () => {
    const text = await replaceHook(FINAL_POST, 'This follows research note 04 §5 closely.');
    const issues = withRule(await check(), 'no-private-references');
    expect(issues).toEqual([
      expect.objectContaining({ file: FINAL_POST, line: lineContaining(text, 'research note 04') }),
    ]);
  });

  it('fails "the reference design" in a journal entry and in the inbox', async () => {
    await editRepoFile(repoRoot, JOURNAL_ENTRY, (text) =>
      text.replace('I set up the repo.', 'I set up the repo like the reference design.'),
    );
    await editRepoFile(
      repoRoot,
      INBOX,
      (text) => `${text}- 2026-11-09 [FND-02] same as the Reference Study\n`,
    );
    const files = withRule(await check(), 'no-private-references').map((issue) => issue.file);
    expect(files).toEqual([JOURNAL_ENTRY, INBOX]);
  });

  it('ignores fenced code and skips the READMEs, which state the rule', async () => {
    await editRepoFile(repoRoot, FINAL_POST, (text) =>
      text.replace('const traced', '// reference design\nconst traced'),
    );
    expect(withRule(await check(), 'no-private-references')).toEqual([]);
  });
});

describe('no-todo-in-final', () => {
  it('fails TODO in a final post', async () => {
    const text = await replaceHook(FINAL_POST, 'TODO: write the hook.');
    expect(withRule(await check(), 'no-todo-in-final')).toEqual([
      expect.objectContaining({ severity: 'error', line: lineContaining(text, 'TODO: write') }),
    ]);
  });

  it('passes TODO in a fenced code block and in inline code', async () => {
    await replaceHook(FINAL_POST, 'The linter flags `TODO` comments.');
    expect(withRule(await check(), 'no-todo-in-final')).toEqual([]);
  });

  it('only warns in a draft', async () => {
    await replaceHook(DRAFT_POST, 'TBD');
    expect(withRule(await check(), 'no-todo-in-final')).toEqual([
      expect.objectContaining({ severity: 'warning', file: DRAFT_POST }),
    ]);
  });
});

describe('links-resolve and images-have-alt', () => {
  it('fails a missing image', async () => {
    const text = await replaceHook(FINAL_POST, '![A missing picture](images/01/missing.svg)');
    expect(withRule(await check(), 'links-resolve')).toEqual([
      expect.objectContaining({ line: lineContaining(text, 'missing.svg') }),
    ]);
  });

  it('fails a link to a missing repo file and an anchor no heading has', async () => {
    await replaceHook(
      FINAL_POST,
      'See [the doc](../design/missing.md) and [part two](02-the-second-fixture-post.md#no-such-heading).',
    );
    const messages = withRule(await check(), 'links-resolve').map((issue) => issue.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatch(/does not exist/);
    expect(messages[1]).toMatch(/no heading with the anchor #no-such-heading/);
  });

  it('fails an empty alt text in a final post and warns in a draft', async () => {
    await replaceHook(FINAL_POST, '![](images/01/diagram.svg)');
    await replaceHook(DRAFT_POST, '![ ](images/01/diagram.svg)');
    expect(
      withRule(await check(), 'images-have-alt').map((issue) => [issue.file, issue.severity]),
    ).toEqual([
      [FINAL_POST, 'error'],
      [DRAFT_POST, 'warning'],
    ]);
  });
});

describe('series-index-sync', () => {
  it('fails a post missing from the README index', async () => {
    await editRepoFile(repoRoot, BLOG_README, (text) => text.replace(/^\| 02 .*\n/m, ''));
    const issues = withRule(await check(), 'series-index-sync');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.file).toBe(DRAFT_POST);
    expect(issues[0]?.message).toContain('no row');
  });

  it('fails a status that differs from the file, and a non-planned row with no file', async () => {
    await editRepoFile(repoRoot, BLOG_README, (text) =>
      text.replace('| final   |', '| draft   |').replace('| planned |', '| outline |'),
    );
    const issues = withRule(await check(), 'series-index-sync');
    expect(issues.map((issue) => issue.file)).toEqual([FINAL_POST, BLOG_README]);
  });

  it('still runs over the whole folder when only some files are checked', async () => {
    await editRepoFile(repoRoot, BLOG_README, (text) => text.replace(/^\| 02 .*\n/m, ''));
    const issues = await check({ files: [FINAL_POST] });
    expect(withRule(issues, 'series-index-sync')).toHaveLength(1);
  });
});

describe('frontmatter-valid, file-name-matches-part and excerpt-length', () => {
  it('reports every schema problem with its path and line', async () => {
    await editRepoFile(repoRoot, DRAFT_POST, (text) =>
      text
        .replace('tags: [gamedev]', 'tags: [gamedev, Bad Tag]')
        .replace('series: ringside-booker\n', ''),
    );
    const issues = withRule(await check(), 'frontmatter-valid');
    expect(issues.map((issue) => issue.message)).toEqual([
      expect.stringMatching(/^series: /),
      expect.stringMatching(/^tags\.1: /),
    ]);
    expect(issues[1]?.line).toBe(7);
  });

  it('fails a part that differs from the file name, and a shared slug', async () => {
    await editRepoFile(repoRoot, DRAFT_POST, (text) =>
      text
        .replace('part: 2', 'part: 3')
        .replace(
          'slug: ringside-booker-02-the-second-fixture-post',
          'slug: ringside-booker-01-the-first-fixture-post',
        ),
    );
    const messages = withRule(await check(), 'file-name-matches-part').map(
      (issue) => issue.message,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        'part is 3 but the file name starts with 02',
        expect.stringMatching(/slug .* is also used by docs\/blog\/02-/),
        expect.stringMatching(/slug .* is also used by docs\/blog\/01-/),
      ]),
    );
  });

  it('fails a post file that is not named NN-<kebab-title>.md', async () => {
    await writeRepoFile(repoRoot, 'docs/blog/Notes.md', '---\ntitle: x\n---\n');
    const issues = await check();
    expect(withRule(issues, 'file-name-matches-part')).toEqual([
      expect.objectContaining({ file: 'docs/blog/Notes.md' }),
    ]);
  });

  it('warns about an excerpt outside 50 to 200 characters', async () => {
    await editRepoFile(repoRoot, DRAFT_POST, (text) =>
      text.replace(/^excerpt: .*$/m, 'excerpt: Too short.'),
    );
    expect(withRule(await check(), 'excerpt-length')).toEqual([
      expect.objectContaining({ severity: 'warning', line: 7 }),
    ]);
  });
});

describe('the files option', () => {
  it('runs the per-file rules only on the given files', async () => {
    await replaceHook(DRAFT_POST, '# Title');
    expect(withRule(await check({ files: [FINAL_POST] }), 'no-body-h1')).toEqual([]);
    expect(
      withRule(await check({ files: [join(repoRoot, DRAFT_POST)] }), 'no-body-h1'),
    ).toHaveLength(1);
  });

  it('refuses files outside docs/blog and docs/dev-journal, and missing files', async () => {
    await expect(check({ files: ['content/blocklist/real-names.txt'] })).rejects.toThrow(
      CheckUsageError,
    );
    await expect(check({ files: ['docs/blog/99-missing.md'] })).rejects.toThrow(/no such file/);
  });
});

describe('masking', () => {
  it('keeps the first letter of each word and stars the rest', () => {
    expect(maskTerm(BANNED_COMPANY)).toBe('F******** B***** C*');
    expect(maskTerm('  Two   Words ')).toBe('T** W****');
  });

  it('masks every term inside a message', () => {
    expect(maskTermsIn(`title "The ${BANNED_COMPANY} post"`, [BANNED_COMPANY])).toBe(
      'title "The F******** B***** C* post"',
    );
  });

  it('matches whole words and escapes regular expression characters', () => {
    expect(bannedTermPattern('a.b (c)').test('see a.b (c) here')).toBe(true);
    expect(bannedTermPattern('a.b').test('axb')).toBe(false);
    expect(bannedTermPattern('Co').test('Company')).toBe(false);
  });

  it('parses a term list, ignoring comments and blank lines', () => {
    expect(parseTermList('# header\n\n  One  \r\nTwo words\n')).toEqual(['One', 'Two words']);
  });
});

describe('formatReport', () => {
  it('groups issues by file and ends with the summary', () => {
    const report = formatReport([
      {
        rule: 'no-body-h1',
        severity: 'error',
        file: 'docs/blog/01-a.md',
        line: 12,
        message: 'one',
      },
      {
        rule: 'excerpt-length',
        severity: 'warning',
        file: 'docs/blog/01-a.md',
        line: 4,
        message: 'two',
      },
      {
        rule: 'journal-index-sync',
        severity: 'warning',
        file: 'docs/dev-journal/x.md',
        message: 'three',
      },
    ]);
    expect(report).toBe(
      [
        'docs/blog/01-a.md:12  error  no-body-h1  one',
        'docs/blog/01-a.md:4  warning  excerpt-length  two',
        '',
        'docs/dev-journal/x.md  warning  journal-index-sync  three',
        '',
        '1 error, 2 warnings',
        '',
      ].join('\n'),
    );
  });

  it('prints only the summary when there is nothing to report', () => {
    expect(formatReport([])).toBe('0 errors, 0 warnings\n');
    expect(summarizeIssues([])).toBe('0 errors, 0 warnings');
  });
});
