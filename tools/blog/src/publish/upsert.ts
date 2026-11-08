import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { PostPayload } from '../transform';
import type { Queryable } from './queryable';
import {
  BEGIN,
  COMMIT,
  DELETE_POST_TAGS,
  INSERT_POST_TAG,
  INSERT_TAG,
  ROLLBACK,
  SELECT_AUTHOR_BY_EMAIL,
  SELECT_POST_BY_SLUG,
  SELECT_POST_SLUG_BY_TITLE,
  SELECT_POST_TAG_SLUGS,
  SELECT_TAGS_BY_SLUG,
  UPSERT_POST,
} from './sql';

// Creates or updates one post on the blog, matched by slug, in a single transaction. A payload
// that matches what the blog already has writes nothing at all, so `updatedAt` only moves when
// the post really changed. A dry run does every step and then rolls back.

export type PublishAction = 'created' | 'updated' | 'unchanged';

export type PostField =
  'title' | 'content' | 'excerpt' | 'coverImage' | 'published' | 'publishedAt' | 'tags';

/** One field that differs between the blog and the payload. Content is shown as a summary. */
export interface FieldChange {
  readonly field: PostField;
  readonly before: string | null;
  readonly after: string | null;
}

export interface PublishResult {
  readonly action: PublishAction;
  readonly slug: string;
  readonly url: string;
  /** The post's `publishedAt` on the blog after this publish (or what it would be, for a dry run). */
  readonly publishedAt: Date | null;
  readonly changes: readonly FieldChange[];
  /** True when nothing was committed. */
  readonly dryRun: boolean;
}

export interface PublishOptions {
  /** The blog user new posts are credited to. */
  readonly authorEmail: string;
  /** The blog's public origin, for the returned URL. */
  readonly siteUrl: string;
  /** Run every step, then roll back instead of committing. */
  readonly dryRun: boolean;
  /** Publish under a new slug even when a post with the same title exists under another one. */
  readonly allowNewSlug?: boolean;
  /** Makes ids for new rows. The blog's ORM makes ids in application code; the columns have no default. */
  readonly idFactory?: () => string;
  /** Written to `updatedAt` (and `createdAt` for a new post); the column has no database default. */
  readonly now: Date;
}

/** No blog user has the configured author email. The message leaves the email out. */
export class BlogAuthorError extends Error {
  override readonly name = 'BlogAuthorError';

  constructor() {
    super('no user on the blog has the email set in BLOG_AUTHOR_EMAIL');
  }
}

/** The post's slug is new to the blog, but a post with the same title exists under another slug. */
export class BlogSlugChangeError extends Error {
  override readonly name = 'BlogSlugChangeError';
  readonly previousSlug: string;
  readonly newSlug: string;

  constructor(previousSlug: string, newSlug: string) {
    super(
      `slug appears to have changed from ${previousSlug}; slugs are permanent (docs/blog/README.md). ` +
        `Pass --allow-new-slug to publish ${newSlug} as a new post anyway.`,
    );
    this.previousSlug = previousSlug;
    this.newSlug = newSlug;
  }
}

/** The database answered with something the publisher did not expect. */
export class BlogPublishError extends Error {
  override readonly name = 'BlogPublishError';
}

const DateValue = z
  .union([z.date(), z.string()])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

const IdRow = z.object({ id: z.string() });
const SlugRow = z.object({ slug: z.string() });
const TagRow = z.object({ id: z.string(), slug: z.string() });
const ExistingPostRow = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  excerpt: z.string().nullable(),
  coverImage: z.string().nullable(),
  published: z.boolean(),
  publishedAt: DateValue.nullable(),
});
const UpsertedRow = z.object({
  id: z.string(),
  inserted: z.boolean(),
  publishedAt: DateValue.nullable(),
});

export type ExistingPost = z.infer<typeof ExistingPostRow> & {
  readonly tagSlugs: readonly string[];
};

async function queryRows<Row>(
  client: Queryable,
  schema: z.ZodType<Row>,
  text: string,
  values: unknown[],
): Promise<Row[]> {
  const result = await client.query(text, values);
  const parsed = z.array(schema).safeParse(result.rows);
  if (!parsed.success) {
    throw new BlogPublishError(`unexpected rows from the blog database: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Publishes one post. See the module comment for the transaction rules. */
export async function publishPost(
  client: Queryable,
  payload: PostPayload,
  options: PublishOptions,
): Promise<PublishResult> {
  const idFactory = options.idFactory ?? randomUUID;
  const url = `${options.siteUrl}/blog/${payload.slug}`;
  await client.query(BEGIN);
  try {
    // Step 1: the author.
    const [author] = await queryRows(client, IdRow, SELECT_AUTHOR_BY_EMAIL, [options.authorEmail]);
    if (author === undefined) {
      throw new BlogAuthorError();
    }

    // Step 2: the post as the blog has it now, if it has it.
    const existing = await readExistingPost(client, payload.slug);
    if (existing === null && options.allowNewSlug !== true) {
      const [sameTitle] = await queryRows(client, SlugRow, SELECT_POST_SLUG_BY_TITLE, [
        payload.title,
        payload.slug,
      ]);
      if (sameTitle !== undefined) {
        throw new BlogSlugChangeError(sameTitle.slug, payload.slug);
      }
    }

    const changes = diffPost(existing, payload);
    if (existing !== null && changes.length === 0) {
      await client.query(options.dryRun ? ROLLBACK : COMMIT);
      return {
        action: 'unchanged',
        slug: payload.slug,
        url,
        publishedAt: existing.publishedAt,
        changes,
        dryRun: options.dryRun,
      };
    }

    // Step 3: make sure every tag exists, then look up their ids.
    for (const tag of payload.tags) {
      await client.query(INSERT_TAG, [idFactory(), tag.name, tag.slug]);
    }
    const tagSlugs = payload.tags.map((tag) => tag.slug);
    const tagRows = await queryRows(client, TagRow, SELECT_TAGS_BY_SLUG, [tagSlugs]);
    const tagIdsBySlug = new Map(tagRows.map((row) => [row.slug, row.id]));

    // Step 4: the post itself.
    const nowIso = options.now.toISOString();
    const [upserted] = await queryRows(client, UpsertedRow, UPSERT_POST, [
      idFactory(),
      payload.title,
      payload.slug,
      payload.content,
      payload.excerpt,
      payload.coverImage,
      payload.published,
      payload.publishedAt?.toISOString() ?? null,
      nowIso,
      nowIso,
      author.id,
    ]);
    if (upserted === undefined) {
      throw new BlogPublishError('the post upsert returned no row');
    }

    // Step 5: replace the post's tag links.
    await client.query(DELETE_POST_TAGS, [upserted.id]);
    for (const slug of tagSlugs) {
      const tagId = tagIdsBySlug.get(slug);
      if (tagId === undefined) {
        throw new BlogPublishError(`tag ${slug} was not found after creating it`);
      }
      await client.query(INSERT_POST_TAG, [upserted.id, tagId]);
    }

    await client.query(options.dryRun ? ROLLBACK : COMMIT);
    return {
      action: upserted.inserted ? 'created' : 'updated',
      slug: payload.slug,
      url,
      publishedAt: upserted.publishedAt,
      changes,
      dryRun: options.dryRun,
    };
  } catch (error: unknown) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function rollbackQuietly(client: Queryable): Promise<void> {
  try {
    await client.query(ROLLBACK);
  } catch {
    // The original error is the one worth reporting.
  }
}

async function readExistingPost(client: Queryable, slug: string): Promise<ExistingPost | null> {
  const [row] = await queryRows(client, ExistingPostRow, SELECT_POST_BY_SLUG, [slug]);
  if (row === undefined) {
    return null;
  }
  const tagRows = await queryRows(client, SlugRow, SELECT_POST_TAG_SLUGS, [row.id]);
  return { ...row, tagSlugs: tagRows.map((tagRow) => tagRow.slug) };
}

// ---------------------------------------------------------------------------------------------
// Diff: which fields the publish changes. An empty list for an existing post means "unchanged".
// ---------------------------------------------------------------------------------------------

/** Lists the fields that differ. For a new post, every field that has a value. */
export function diffPost(existing: ExistingPost | null, payload: PostPayload): FieldChange[] {
  const payloadTags = sortedSlugs(payload.tags.map((tag) => tag.slug));
  const fields: FieldChange[] = [
    { field: 'title', before: existing?.title ?? null, after: payload.title },
    {
      field: 'content',
      before: existing === null ? null : summarizeContent(existing.content),
      after: summarizeContent(payload.content),
    },
    { field: 'excerpt', before: existing?.excerpt ?? null, after: payload.excerpt },
    { field: 'coverImage', before: existing?.coverImage ?? null, after: payload.coverImage },
    {
      field: 'published',
      before: existing === null ? null : String(existing.published),
      after: String(payload.published),
    },
    {
      field: 'tags',
      before: existing === null ? null : sortedSlugs(existing.tagSlugs),
      after: payloadTags,
    },
  ];
  // publishedAt is kept from the first publish, so it only changes while the blog has none.
  const existingPublishedAt = existing?.publishedAt ?? null;
  fields.push({
    field: 'publishedAt',
    before: existingPublishedAt?.toISOString() ?? null,
    after: (existingPublishedAt ?? payload.publishedAt)?.toISOString() ?? null,
  });

  if (existing === null) {
    return fields.filter((change) => change.after !== null);
  }
  const contentChanged = existing.content !== payload.content;
  return fields.filter((change) =>
    change.field === 'content' ? contentChanged : change.before !== change.after,
  );
}

/** Content is too long to print, so the diff shows its size and a short hash. */
export function summarizeContent(content: string): string {
  const lineCount = content === '' ? 0 : content.replace(/\n$/, '').split('\n').length;
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  return `${String(content.length)} characters, ${String(lineCount)} lines, sha256 ${hash}`;
}

function sortedSlugs(slugs: readonly string[]): string {
  return [...slugs].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)).join(', ');
}
