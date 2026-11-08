import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { CI_REFUSAL, runPublishCommand } from '../src/publish/command';
import type { PublishCommandDeps } from '../src/publish/command';
import {
  PublishEnvError,
  loadEnvFile,
  parseEnvFallback,
  parseEnvText,
  readPublishEnv,
} from '../src/publish/env';
import type { EnvFile } from '../src/publish/env';
import { catchError } from './helpers';

const DATABASE_URL = 'postgresql://blog_writer:s3cret-pass@db.example.test:5432/blog';
const AUTHOR_EMAIL = 'author@example.test';
const SITE_URL = 'https://blog.example.test/';

function envFile(values: Record<string, string>): EnvFile {
  return { displayPath: 'tools/blog/.env.local', exists: true, values };
}

const COMPLETE_FILE = envFile({
  BLOG_DATABASE_URL: DATABASE_URL,
  BLOG_AUTHOR_EMAIL: AUTHOR_EMAIL,
  BLOG_SITE_URL: SITE_URL,
});

describe('readPublishEnv', () => {
  it('reads every setting from the env file', () => {
    expect(readPublishEnv({ envFile: COMPLETE_FILE, processEnv: {} })).toEqual({
      databaseUrl: DATABASE_URL,
      authorEmail: AUTHOR_EMAIL,
      siteUrl: 'https://blog.example.test',
    });
  });

  it('reports BLOG_DATABASE_URL missing when it is only in the shell environment', () => {
    const error = catchError(
      () =>
        readPublishEnv({
          envFile: envFile({ BLOG_AUTHOR_EMAIL: AUTHOR_EMAIL, BLOG_SITE_URL: SITE_URL }),
          processEnv: { BLOG_DATABASE_URL: DATABASE_URL },
        }),
      PublishEnvError,
    );
    expect(error.problems).toHaveLength(1);
    expect(error.message).toContain('BLOG_DATABASE_URL');
    expect(error.message).toContain('tools/blog/.env.local');
    expect(error.message).not.toContain(DATABASE_URL);
  });

  it('prefers the env file and falls back to the shell for the author email and site URL', () => {
    const fromShell = readPublishEnv({
      envFile: envFile({ BLOG_DATABASE_URL: DATABASE_URL }),
      processEnv: { BLOG_AUTHOR_EMAIL: 'shell@example.test', BLOG_SITE_URL: SITE_URL },
    });
    expect(fromShell.authorEmail).toBe('shell@example.test');

    const fromFile = readPublishEnv({
      envFile: COMPLETE_FILE,
      processEnv: { BLOG_AUTHOR_EMAIL: 'shell@example.test' },
    });
    expect(fromFile.authorEmail).toBe(AUTHOR_EMAIL);
  });

  it('names every missing variable and the file, and treats empty values as missing', () => {
    const error = catchError(
      () =>
        readPublishEnv({
          envFile: envFile({ BLOG_DATABASE_URL: '', BLOG_AUTHOR_EMAIL: '  ' }),
          processEnv: {},
        }),
      PublishEnvError,
    );
    expect(error.problems).toHaveLength(3);
    for (const variable of ['BLOG_DATABASE_URL', 'BLOG_AUTHOR_EMAIL', 'BLOG_SITE_URL']) {
      expect(error.message).toContain(variable);
    }
    expect(error.message).toContain('tools/blog/.env.local');
  });

  it('names an invalid variable without printing its value', () => {
    const badDatabaseUrl = 'mysql://user:hunter2-secret@host/db';
    const badEmail = 'not-an-email-hunter2';
    const error = catchError(
      () =>
        readPublishEnv({
          envFile: envFile({
            BLOG_DATABASE_URL: badDatabaseUrl,
            BLOG_AUTHOR_EMAIL: badEmail,
            BLOG_SITE_URL: SITE_URL,
          }),
          processEnv: {},
        }),
      PublishEnvError,
    );
    expect(error.message).toContain('BLOG_DATABASE_URL');
    expect(error.message).toContain('BLOG_AUTHOR_EMAIL');
    expect(error.message).not.toContain('hunter2');
  });
});

describe('env file parsing', () => {
  const TEXT = [
    '# a comment',
    'BLOG_DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require',
    'BLOG_AUTHOR_EMAIL="author@example.test"',
    "export BLOG_SITE_URL='https://blog.example.test'",
    'BLOG_REPO_BRANCH=main # trailing comment',
    'EMPTY=',
    '',
  ].join('\n');

  const EXPECTED = {
    BLOG_DATABASE_URL: 'postgresql://user:pass@host:5432/db?sslmode=require',
    BLOG_AUTHOR_EMAIL: 'author@example.test',
    BLOG_SITE_URL: 'https://blog.example.test',
    BLOG_REPO_BRANCH: 'main',
    EMPTY: '',
  };

  it('parses with the fallback parser', () => {
    expect(parseEnvFallback(TEXT)).toEqual(EXPECTED);
  });

  it('parses into a plain object without touching process.env', () => {
    const before = { ...process.env };
    expect(parseEnvText(TEXT)).toEqual(EXPECTED);
    expect(process.env).toEqual(before);
  });

  it('loads a file, and treats a missing file as empty', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'blog-env-'));
    try {
      const path = join(folder, '.env.local');
      await writeFile(path, TEXT);
      expect(await loadEnvFile(path, 'tools/blog/.env.local')).toEqual({
        displayPath: 'tools/blog/.env.local',
        exists: true,
        values: EXPECTED,
      });
      expect(await loadEnvFile(join(folder, 'missing'), 'x')).toEqual({
        displayPath: 'x',
        exists: false,
        values: {},
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe('the CI guard', () => {
  it('refuses under CI before reading any setting', async () => {
    let envFileReads = 0;
    let connects = 0;
    const errors: string[] = [];
    const deps: PublishCommandDeps = {
      repoRoot: '/nowhere',
      processEnv: { CI: 'true', BLOG_DATABASE_URL: DATABASE_URL },
      loadEnvFile: () => {
        envFileReads += 1;
        return Promise.resolve(COMPLETE_FILE);
      },
      connect: () => {
        connects += 1;
        return Promise.reject(new Error('must not connect'));
      },
      now: () => new Date('2026-11-08T00:00:00.000Z'),
      stdout: () => undefined,
      stderr: (text) => errors.push(text),
    };

    const exitCode = await runPublishCommand(['docs/blog/01-post.md'], deps);
    expect(exitCode).toBe(1);
    expect(envFileReads).toBe(0);
    expect(connects).toBe(0);
    expect(errors.join('')).toContain(CI_REFUSAL);
  });

  it('makes the real CLI entry exit with the refusal when CI=true', async () => {
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
    const entry = fileURLToPath(new URL('../src/cli/publish.ts', import.meta.url));
    let failure: unknown = null;
    try {
      await promisify(execFile)(process.execPath, [tsxCli, entry, 'docs/blog/01-post.md'], {
        env: { ...process.env, CI: 'true' },
      });
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof Error) || !('stderr' in failure) || !('code' in failure)) {
      throw new Error('expected the CLI to exit with an error');
    }
    expect(failure.code).toBe(1);
    expect(String(failure.stderr)).toContain(CI_REFUSAL);
  }, 30_000);
});
