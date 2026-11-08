import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readBlogConfig } from '../src/config';
import { loadPost } from '../src/load';
import type { LoadedPost } from '../src/load';
import { assertBlogSchema } from '../src/publish/preflight';
import { publishPost } from '../src/publish/upsert';
import type { PublishOptions } from '../src/publish/upsert';
import { toPostPayload } from '../src/transform';
import type { PostPayload } from '../src/transform';
import { fixturePath } from './helpers';

// Runs the publisher against a real Postgres. Skipped unless BLOG_IT_DATABASE_URL is set, which
// must point at a throwaway local database (see tools/blog/README.md), never at the blog's own
// database, and is never set in CI. Everything happens in a fresh schema that is dropped at the
// end.

const DATABASE_URL = process.env['BLOG_IT_DATABASE_URL'] ?? '';
const SCHEMA = `blog_it_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const AUTHOR_EMAIL = 'author@example.test';

// The four tables the publisher touches, as the blog's ORM creates them, minus the parts the
// publisher never uses.
const DDL = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    excerpt TEXT,
    "coverImage" TEXT,
    published BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorId" TEXT NOT NULL REFERENCES users (id)
  )`,
  `CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE "_PostTags" (
    "A" TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    "B" TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY ("A", "B")
  )`,
];

describe.skipIf(DATABASE_URL === '')('publishPost against Postgres', () => {
  const client = new Client({ connectionString: DATABASE_URL });
  let payload: PostPayload;

  function options(now: Date, overrides: Partial<PublishOptions> = {}): PublishOptions {
    return {
      authorEmail: AUTHOR_EMAIL,
      siteUrl: 'https://blog.example.test',
      dryRun: false,
      now,
      ...overrides,
    };
  }

  async function postRows(): Promise<unknown[]> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT id, slug, published, "publishedAt" AT TIME ZONE 'UTC' AS "publishedAt",
         "updatedAt" AT TIME ZONE 'UTC' AS "updatedAt", "authorId"
       FROM posts`,
    );
    return result.rows;
  }

  async function linkedTagSlugs(): Promise<string[]> {
    const result = await client.query<{ slug: string }>(
      `SELECT tags.slug FROM "_PostTags" JOIN tags ON tags.id = "_PostTags"."B" ORDER BY tags.slug`,
    );
    return result.rows.map((row) => row.slug);
  }

  beforeAll(async () => {
    await client.connect();
    // The schema name is generated above from hex digits only, so it is safe to put in DDL.
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);
    for (const statement of DDL) {
      await client.query(statement);
    }
    await client.query('INSERT INTO users (id, email) VALUES ($1, $2)', ['user-1', AUTHOR_EMAIL]);
    await client.query('INSERT INTO tags (id, name, slug) VALUES ($1, $2, $3)', [
      'existing-tag',
      'gamedev',
      'gamedev',
    ]);

    const first = await loadPost(fixturePath('repo/docs/blog/01-the-first-fixture-post.md'));
    const second = await loadPost(fixturePath('repo/docs/blog/02-the-second-fixture-post.md'));
    const allPosts: LoadedPost[] = [first, second];
    payload = toPostPayload(first, {
      allPosts,
      config: readBlogConfig({}),
      now: new Date('2026-11-08T15:30:00.000Z'),
    });
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.end();
  });

  it('finds the schema it needs', async () => {
    await assertBlogSchema(client);
  });

  it('a dry run writes nothing', async () => {
    const result = await publishPost(client, payload, options(new Date(), { dryRun: true }));
    expect(result.action).toBe('created');
    expect(await postRows()).toEqual([]);
  });

  it('creates the post once and leaves it alone when nothing changed', async () => {
    const firstRun = await publishPost(client, payload, options(new Date('2026-11-08T16:00:00Z')));
    expect(firstRun.action).toBe('created');
    expect(firstRun.publishedAt).toEqual(new Date('2026-11-08T15:30:00.000Z'));

    const secondRun = await publishPost(client, payload, options(new Date('2026-11-09T08:00:00Z')));
    expect(secondRun.action).toBe('unchanged');
    expect(secondRun.publishedAt).toEqual(firstRun.publishedAt);

    const rows = await postRows();
    expect(rows).toEqual([
      {
        id: expect.any(String) as unknown,
        slug: payload.slug,
        published: true,
        publishedAt: new Date('2026-11-08T15:30:00.000Z'),
        updatedAt: new Date('2026-11-08T16:00:00.000Z'),
        authorId: 'user-1',
      },
    ]);
    expect(await linkedTagSlugs()).toEqual(['gamedev', 'ringside-booker', 'typescript']);
    const tagCount = await client.query<{ count: string }>('SELECT count(*) AS count FROM tags');
    expect(tagCount.rows[0]?.count).toBe('3');
  });

  it('updates an edited post and keeps its first publishedAt', async () => {
    const edited: PostPayload = {
      ...payload,
      content: `${payload.content}\nOne more paragraph.\n`,
      publishedAt: new Date('2026-12-01T00:00:00.000Z'),
      tags: payload.tags.filter((tag) => tag.slug !== 'typescript'),
    };
    const result = await publishPost(client, edited, options(new Date('2026-12-01T10:00:00Z')));
    expect(result.action).toBe('updated');
    expect(result.changes.map((change) => change.field)).toEqual(['content', 'tags']);
    expect(result.publishedAt).toEqual(new Date('2026-11-08T15:30:00.000Z'));
    expect(await linkedTagSlugs()).toEqual(['gamedev', 'ringside-booker']);
    expect(await postRows()).toMatchObject([{ updatedAt: new Date('2026-12-01T10:00:00.000Z') }]);
  });
});
