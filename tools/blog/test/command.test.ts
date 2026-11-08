import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatResult, redact, runPublishCommand } from '../src/publish/command';
import type { PublishCommandDeps } from '../src/publish/command';
import type { EnvFile } from '../src/publish/env';
import { UPSERT_POST } from '../src/publish/sql';
import { fakeBlog } from './fakeDatabase';
import type { FakeQueryable } from './fakeDatabase';
import { copyFixtureRepo, editRepoFile, removeRepo } from './helpers';

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
