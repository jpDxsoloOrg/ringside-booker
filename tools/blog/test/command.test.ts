import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  formatBatchSummary,
  formatResult,
  redact,
  runPublishCommand,
} from '../src/publish/command';
import type { PublishCommandDeps } from '../src/publish/command';
import type { EnvFile } from '../src/publish/env';
import { BEGIN, COMMIT, ROLLBACK, UPSERT_POST } from '../src/publish/sql';
import { fakeBlog } from './fakeDatabase';
import type { FakeQueryable } from './fakeDatabase';
import { copyFixtureRepo, editRepoFile, removeRepo, writeRepoFile } from './helpers';

const DATABASE_URL = 'postgresql://blog_writer:s3cret-pass@db.example.test:5432/blog';
const AUTHOR_EMAIL = 'author@example.test';
const POST_FILE = 'docs/blog/01-the-first-fixture-post.md';
const NOW = new Date('2026-11-08T15:30:00.000Z');

const ENV_FILE: EnvFile = {
  displayPath: 'tools/blog/.env.local',
  exists: true,
  values: {
    BLOG_DATABASE_URL: DATABASE_URL,
    BLOG_AUTHOR_EMAIL: AUTHOR_EMAIL,
    BLOG_SITE_URL: 'https://blog.example.test',
  },
};

interface Harness {
  readonly deps: PublishCommandDeps;
  readonly out: string[];
  readonly err: string[];
  readonly connectedWith: string[];
}

let repoRoot = '';
let blog: FakeQueryable;

beforeEach(async () => {
  repoRoot = await copyFixtureRepo();
  blog = fakeBlog();
});

afterEach(async () => {
  await removeRepo(repoRoot);
});

function harness(overrides: Partial<PublishCommandDeps> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const connectedWith: string[] = [];
  return {
    out,
    err,
    connectedWith,
    deps: {
      repoRoot,
      // A private banned-terms list, so the required check has one to read.
      processEnv: { BLOG_BANNED_TERMS: 'zz-fixture-banned-term' },
      loadEnvFile: () => Promise.resolve(ENV_FILE),
      connect: (databaseUrl) => {
        connectedWith.push(databaseUrl);
        return Promise.resolve(blog);
      },
      now: () => NOW,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      ...overrides,
    },
  };
}

describe('runPublishCommand', () => {
  it('publishes a final post, prints the result and writes publishedAt back', async () => {
    const run = harness();
    const exitCode = await runPublishCommand([POST_FILE], run.deps);

    expect(run.err.join('')).toBe('');
    expect(exitCode).toBe(0);
    expect(run.connectedWith).toEqual([DATABASE_URL]);
    expect(blog.ended).toBe(true);
    const output = run.out.join('');
    expect(output).toContain(
      'created ringside-booker-01-the-first-fixture-post → https://blog.example.test/blog/ringside-booker-01-the-first-fixture-post',
    );
    expect(output).not.toContain(DATABASE_URL);
    expect(output).not.toContain(AUTHOR_EMAIL);

    const post = await readFile(join(repoRoot, POST_FILE), 'utf8');
    expect(post).toContain('\npublishedAt: 2026-11-08\n---\n');
    const readme = await readFile(join(repoRoot, 'docs/blog/README.md'), 'utf8');
    expect(readme).toMatch(/\| 01 +\|.*\| 2026-11-08 \|/);
  });

  it('writes nothing back on a dry run or with --no-write-back', async () => {
    const original = await readFile(join(repoRoot, POST_FILE), 'utf8');
    const dryRun = harness();
    expect(await runPublishCommand([POST_FILE, '--dry-run'], dryRun.deps)).toBe(0);
    expect(dryRun.out.join('')).toContain('dry run: nothing was written');
    expect(blog.texts().at(-1)).toBe('ROLLBACK');

    blog = fakeBlog();
    expect(await runPublishCommand([POST_FILE, '--no-write-back'], harness().deps)).toBe(0);
    expect(await readFile(join(repoRoot, POST_FILE), 'utf8')).toBe(original);
  });

  it('never connects when the post fails a check', async () => {
    await editRepoFile(repoRoot, POST_FILE, (text) => `${text}\n# A body heading\n`);
    const run = harness();
    expect(await runPublishCommand([POST_FILE], run.deps)).toBe(1);
    expect(run.connectedWith).toEqual([]);
    expect(run.out.join('')).toContain('no-body-h1');
    expect(run.err.join('')).toContain('not published');
  });

  it('refuses to publish without the private banned-terms list', async () => {
    const run = harness({ processEnv: { BLOG_BANNED_TERMS_FILE: join(repoRoot, 'missing.txt') } });
    expect(await runPublishCommand([POST_FILE], run.deps)).toBe(1);
    expect(run.connectedWith).toEqual([]);
    expect(run.out.join('')).toContain('banned-terms-missing');
  });

  it('fails without connecting when the env file has no database URL', async () => {
    const run = harness({
      loadEnvFile: () =>
        Promise.resolve({ displayPath: 'tools/blog/.env.local', exists: false, values: {} }),
      processEnv: {
        BLOG_BANNED_TERMS: 'zz-fixture-banned-term',
        BLOG_DATABASE_URL: DATABASE_URL,
        BLOG_AUTHOR_EMAIL: AUTHOR_EMAIL,
        BLOG_SITE_URL: 'https://blog.example.test',
      },
    });
    expect(await runPublishCommand([POST_FILE], run.deps)).toBe(1);
    expect(run.connectedWith).toEqual([]);
    const errors = run.err.join('');
    expect(errors).toContain('BLOG_DATABASE_URL is not set in tools/blog/.env.local');
    expect(errors).not.toContain(DATABASE_URL);
  });

  it('redacts connection details from unexpected database errors and still closes the client', async () => {
    const failing = fakeBlog();
    const original = failing.query.bind(failing);
    failing.query = (text, values) =>
      text === UPSERT_POST
        ? Promise.reject(new Error('connection to db.example.test as blog_writer failed'))
        : original(text, values);
    blog = failing;
    const run = harness();
    expect(await runPublishCommand([POST_FILE], run.deps)).toBe(1);
    expect(failing.ended).toBe(true);
    const errors = run.err.join('');
    expect(errors).toContain('publish failed: connection to [redacted] as [redacted] failed');
  });

  it('rejects a missing file argument with exit code 2', async () => {
    const run = harness();
    expect(await runPublishCommand([], run.deps)).toBe(2);
    expect(run.err.join('')).toContain('Usage: npm run blog:publish');
  });
});

const PART_ONE_SLUG = 'ringside-booker-01-the-first-fixture-post';
const PART_TWO_SLUG = 'ringside-booker-02-the-second-fixture-post';
const PART_THREE_SLUG = 'ringside-booker-03-the-third-fixture-post';
const INDEX_SLUG = 'ringside-booker-series';

/** Turns the fixture's planned part 3 into a final post with a file, so parts 1 and 3 are live. */
async function addFinalPartThree(): Promise<void> {
  await writeRepoFile(
    repoRoot,
    'docs/blog/03-the-third-fixture-post.md',
    [
      '---',
      'title: The third fixture post',
      `slug: ${PART_THREE_SLUG}`,
      'series: ringside-booker',
      'part: 3',
      'status: final',
      'excerpt: A third fixture post, final, so the first post has a published next part.',
      'tags: [gamedev]',
      'journal: []',
      '---',
      '',
      'The third post opens here.',
      '',
    ].join('\n'),
  );
  await editRepoFile(repoRoot, 'docs/blog/README.md', (text) =>
    text.replace(
      '| 03   | A planned post, no file | planned |',
      '| 03   | The third fixture post | final |',
    ),
  );
}

/** The slugs the publisher upserted, in order. */
function upsertedSlugs(database: FakeQueryable): unknown[] {
  return database.queriesOf(UPSERT_POST).map((query) => query.values[2]);
}

/** The content the publisher upserted for a slug. */
function upsertedContent(database: FakeQueryable, slug: string): string {
  const query = database.queriesOf(UPSERT_POST).find((recorded) => recorded.values[2] === slug);
  const content = query?.values[3];
  return typeof content === 'string' ? content : '';
}

describe('runPublishCommand --all', () => {
  it('publishes every draft and final part in ascending order, then the index', async () => {
    await addFinalPartThree();
    const run = harness();
    expect(await runPublishCommand(['--all'], run.deps)).toBe(0);
    expect(run.err.join('')).toBe('');

    expect(upsertedSlugs(blog)).toEqual([
      PART_ONE_SLUG,
      PART_TWO_SLUG,
      PART_THREE_SLUG,
      INDEX_SLUG,
    ]);
    // One transaction per post.
    expect(blog.texts().filter((text) => text === BEGIN)).toHaveLength(4);
    expect(blog.texts().filter((text) => text === COMMIT)).toHaveLength(4);
    expect(blog.ended).toBe(true);

    // Part 1's next link skips the draft part 2 and goes to part 3.
    const partOne = upsertedContent(blog, PART_ONE_SLUG);
    expect(partOne).toContain(`**Next part:** [The third fixture post](/blog/${PART_THREE_SLUG})`);
    expect(partOne).not.toContain(`/blog/${PART_TWO_SLUG})`);
    const index = upsertedContent(blog, INDEX_SLUG);
    expect(index).toContain(`[The first fixture post](/blog/${PART_ONE_SLUG})`);
    expect(index).toContain('- Part 2: The second fixture post');

    const output = run.out.join('');
    expect(output).toMatch(/Part +Slug +Action/);
    expect(output).toMatch(new RegExp(`1 +${PART_ONE_SLUG} +created`));
    expect(output).toMatch(new RegExp(`index +${INDEX_SLUG} +created`));
  });

  it('writes publishedAt back for final parts published for the first time', async () => {
    const run = harness();
    expect(await runPublishCommand(['--all'], run.deps)).toBe(0);
    const post = await readFile(join(repoRoot, POST_FILE), 'utf8');
    expect(post).toContain('\npublishedAt: 2026-11-08\n---\n');
    const draft = await readFile(join(repoRoot, 'docs/blog/02-the-second-fixture-post.md'), 'utf8');
    expect(draft).not.toContain('publishedAt');
  });

  it('stops at the first failure and reports the parts already written', async () => {
    await addFinalPartThree();
    const failing = fakeBlog();
    const original = failing.query.bind(failing);
    // Records the statement, then fails it, as a database error mid-transaction would.
    failing.query = async (text, values) => {
      const result = await original(text, values);
      if (text === UPSERT_POST && values?.[2] === PART_TWO_SLUG) {
        throw new Error('deadlock detected');
      }
      return result;
    };
    blog = failing;
    const run = harness();

    expect(await runPublishCommand(['--all'], run.deps)).toBe(1);
    expect(upsertedSlugs(failing)).toEqual([PART_ONE_SLUG, PART_TWO_SLUG]);
    expect(failing.texts().filter((text) => text === COMMIT)).toHaveLength(1);
    expect(failing.texts().at(-1)).toBe(ROLLBACK);
    expect(failing.ended).toBe(true);

    const errors = run.err.join('');
    expect(errors).toContain(
      `stopped at part 2 (${PART_TWO_SLUG}); already written: part 1 (${PART_ONE_SLUG})`,
    );
    expect(errors).toContain('deadlock detected');
    const output = run.out.join('');
    expect(output).toMatch(new RegExp(`2 +${PART_TWO_SLUG} +failed`));
    expect(output).toMatch(new RegExp(`3 +${PART_THREE_SLUG} +not run`));
    expect(output).toMatch(new RegExp(`index +${INDEX_SLUG} +not run`));
  });

  it('never connects when any post in the folder fails a check', async () => {
    await editRepoFile(
      repoRoot,
      'docs/blog/02-the-second-fixture-post.md',
      (text) => `${text}\n# A body heading\n`,
    );
    const run = harness();
    expect(await runPublishCommand(['--all'], run.deps)).toBe(1);
    expect(run.connectedWith).toEqual([]);
    expect(run.out.join('')).toContain('no-body-h1');
  });

  it('publishes only the index with --index-only', async () => {
    const run = harness();
    expect(await runPublishCommand(['--index-only', '--dry-run'], run.deps)).toBe(0);
    expect(upsertedSlugs(blog)).toEqual([INDEX_SLUG]);
    expect(blog.texts().at(-1)).toBe(ROLLBACK);
    expect(run.out.join('')).toContain('dry run: nothing was written');
  });

  it('rejects --all with a file, --all with --index-only, and --allow-new-slug with --all', async () => {
    for (const argv of [
      ['--all', POST_FILE],
      ['--all', '--index-only'],
      ['--all', '--allow-new-slug'],
    ]) {
      const run = harness();
      expect(await runPublishCommand(argv, run.deps)).toBe(2);
      expect(run.connectedWith).toEqual([]);
      expect(run.err.join('')).toContain('Usage: npm run blog:publish');
    }
  });
});

describe('runPublishCommand: stale navigation hint', () => {
  it("names the previous part's Next link after publishing a new final part", async () => {
    await addFinalPartThree();
    const run = harness();
    expect(await runPublishCommand(['docs/blog/03-the-third-fixture-post.md'], run.deps)).toBe(0);
    expect(run.out.join('')).toContain(
      "Part 1's Next link and the series index are out of date; run `npm run blog:publish -- --all`",
    );
  });

  it('names only the index when the post has no published neighbours', async () => {
    const run = harness();
    expect(await runPublishCommand([POST_FILE], run.deps)).toBe(0);
    expect(run.out.join('')).toContain(
      'The series index is out of date; run `npm run blog:publish -- --all`',
    );
  });

  it('says nothing for a draft or a dry run', async () => {
    const draft = harness();
    expect(await runPublishCommand(['docs/blog/02-the-second-fixture-post.md'], draft.deps)).toBe(
      0,
    );
    const dryRun = harness();
    blog = fakeBlog();
    expect(await runPublishCommand([POST_FILE, '--dry-run'], dryRun.deps)).toBe(0);
    for (const run of [draft, dryRun]) {
      expect(run.out.join('')).not.toContain('out of date');
    }
  });
});

describe('formatBatchSummary', () => {
  it('prints Part | Slug | Action as aligned columns', () => {
    expect(
      formatBatchSummary(
        [
          { part: '1', slug: 'ringside-booker-01-x', action: 'updated' },
          { part: 'index', slug: 'ringside-booker-series', action: 'unchanged' },
        ],
        false,
      ),
    ).toBe(
      [
        '',
        'Part   Slug                    Action',
        '-----  ----------------------  ---------',
        '1      ringside-booker-01-x    updated',
        'index  ringside-booker-series  unchanged',
        '',
      ].join('\n'),
    );
  });
});

describe('formatResult', () => {
  it('prints the action line and a table of changes', () => {
    const text = formatResult({
      action: 'updated',
      slug: 'ringside-booker-01-x',
      url: 'https://blog.example.test/blog/ringside-booker-01-x',
      publishedAt: NOW,
      changes: [{ field: 'published', before: 'true', after: 'false' }],
      dryRun: false,
    });
    expect(text).toBe(
      [
        'updated ringside-booker-01-x → https://blog.example.test/blog/ringside-booker-01-x',
        '',
        'field      before  after',
        '---------  ------  -----',
        'published  true    false',
        '',
      ].join('\n'),
    );
  });
});

describe('redact', () => {
  it('masks the longest secret first', () => {
    expect(redact('a host.example and host', ['host', 'host.example'])).toBe(
      'a [redacted] and [redacted]',
    );
  });
});
