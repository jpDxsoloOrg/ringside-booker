import { describe, expect, it } from 'vitest';

import {
  COMMIT,
  DELETE_POST_TAGS,
  INSERT_POST_TAG,
  INSERT_TAG,
  ROLLBACK,
  SELECT_AUTHOR_BY_EMAIL,
  SELECT_TAGS_BY_SLUG,
  UPSERT_POST,
} from '../src/publish/sql';
import {
  BlogAuthorError,
  BlogSlugChangeError,
  publishPost,
  summarizeContent,
} from '../src/publish/upsert';
import type { PublishOptions } from '../src/publish/upsert';
import type { PostPayload } from '../src/transform';
import { fakeBlog } from './fakeDatabase';
import type { FakePostRow } from './fakeDatabase';
import { catchAsyncError } from './helpers';

const NOW = new Date('2026-11-08T15:30:00.000Z');
const FIRST_PUBLISHED = new Date('2026-11-01T09:00:00.000Z');

const PAYLOAD: PostPayload = {
  title: 'Same seed, same show',
  slug: 'ringside-booker-03-same-seed-same-show',
  content: 'The opening paragraph of the post.\n\n## A section\n\nMore text here.\n',
  excerpt: 'How named random streams keep one change from reshuffling every other result.',
  published: true,
  publishedAt: NOW,
  coverImage: null,
  tags: [
    { name: 'gamedev', slug: 'gamedev' },
    { name: 'ringside-booker', slug: 'ringside-booker' },
    { name: 'typescript', slug: 'typescript' },
  ],
};

/** The blog's copy of PAYLOAD after an earlier publish. */
const EXISTING_ROW: FakePostRow = {
  id: 'post-1',
  title: PAYLOAD.title,
  content: PAYLOAD.content,
  excerpt: PAYLOAD.excerpt,
  coverImage: null,
  published: true,
  publishedAt: FIRST_PUBLISHED,
};
const EXISTING_TAGS = ['gamedev', 'ringside-booker', 'typescript'];

function options(overrides: Partial<PublishOptions> = {}): PublishOptions {
  let counter = 0;
  return {
    authorEmail: 'author@example.test',
    siteUrl: 'https://blog.example.test',
    dryRun: false,
    now: NOW,
    idFactory: () => {
      counter += 1;
      return `new-id-${String(counter)}`;
    },
    ...overrides,
  };
}

describe('publishPost: a new post', () => {
  it('creates the post, its missing tags and its tag links, then commits', async () => {
    const blog = fakeBlog();
    const result = await publishPost(blog, PAYLOAD, options());

    expect(result.action).toBe('created');
    expect(result.url).toBe(
      'https://blog.example.test/blog/ringside-booker-03-same-seed-same-show',
    );
    expect(result.publishedAt).toEqual(NOW);
    expect(result.dryRun).toBe(false);

    const tagInserts = blog.queriesOf(INSERT_TAG);
    expect(tagInserts.map((query) => query.values.slice(1))).toEqual([
      ['gamedev', 'gamedev'],
      ['ringside-booker', 'ringside-booker'],
      ['typescript', 'typescript'],
    ]);
    expect(blog.queriesOf(SELECT_TAGS_BY_SLUG)[0]?.values).toEqual([
      ['gamedev', 'ringside-booker', 'typescript'],
    ]);

    const [upsert] = blog.queriesOf(UPSERT_POST);
    expect(upsert?.values).toEqual([
      'new-id-4',
      PAYLOAD.title,
      PAYLOAD.slug,
      PAYLOAD.content,
      PAYLOAD.excerpt,
      null,
      true,
      NOW.toISOString(),
      NOW.toISOString(),
      NOW.toISOString(),
      'user-1',
    ]);

    expect(blog.queriesOf(DELETE_POST_TAGS)[0]?.values).toEqual(['new-id-4']);
    expect(blog.queriesOf(INSERT_POST_TAG).map((query) => query.values)).toEqual([
      ['new-id-4', 'tag-gamedev'],
      ['new-id-4', 'tag-ringside-booker'],
      ['new-id-4', 'tag-typescript'],
    ]);
    expect(blog.texts()[0]).toBe('BEGIN');
    expect(blog.texts().at(-1)).toBe(COMMIT);
  });

  it('lists every field with a value as a change, with content summarized', async () => {
    const result = await publishPost(fakeBlog(), PAYLOAD, options());
    expect(result.changes.map((change) => change.field)).toEqual([
      'title',
      'content',
      'excerpt',
      'published',
      'tags',
      'publishedAt',
    ]);
    const content = result.changes.find((change) => change.field === 'content');
    expect(content?.before).toBeNull();
    expect(content?.after).toBe(summarizeContent(PAYLOAD.content));
    expect(content?.after).toMatch(/^\d+ characters, 5 lines, sha256 [0-9a-f]{8}$/);
  });

  it('sends published = false and no publishedAt for a draft', async () => {
    const blog = fakeBlog();
    const draft: PostPayload = { ...PAYLOAD, published: false, publishedAt: null };
    const result = await publishPost(blog, draft, options());
    const values = blog.queriesOf(UPSERT_POST)[0]?.values ?? [];
    expect(values[6]).toBe(false);
    expect(values[7]).toBeNull();
    expect(result.publishedAt).toBeNull();
  });
});

describe('publishPost: an existing post', () => {
  it('updates it and keeps the publishedAt the blog already has', async () => {
    const blog = fakeBlog({ existingPost: EXISTING_ROW, existingTagSlugs: EXISTING_TAGS });
    const edited: PostPayload = { ...PAYLOAD, content: `${PAYLOAD.content}\nOne more line.\n` };
    const result = await publishPost(blog, edited, options());

    expect(result.action).toBe('updated');
    expect(result.publishedAt).toEqual(FIRST_PUBLISHED);
    expect(result.changes.map((change) => change.field)).toEqual(['content']);

    const upsertText = blog.queriesOf(UPSERT_POST)[0]?.text ?? '';
    expect(upsertText).toContain(
      '"publishedAt" = COALESCE(posts."publishedAt", EXCLUDED."publishedAt")',
    );
    expect(upsertText).not.toMatch(/"authorId" = EXCLUDED/);
    expect(upsertText).not.toMatch(/"createdAt" = EXCLUDED/);
    expect(blog.queriesOf(DELETE_POST_TAGS)[0]?.values).toEqual(['post-1']);
    expect(blog.texts().at(-1)).toBe(COMMIT);
  });

  it('reports a status change to draft as a published change and keeps publishedAt', async () => {
    const blog = fakeBlog({ existingPost: EXISTING_ROW, existingTagSlugs: EXISTING_TAGS });
    const hidden: PostPayload = { ...PAYLOAD, published: false, publishedAt: FIRST_PUBLISHED };
    const result = await publishPost(blog, hidden, options());
    expect(result.action).toBe('updated');
    expect(result.changes).toEqual([{ field: 'published', before: 'true', after: 'false' }]);
    expect(result.publishedAt).toEqual(FIRST_PUBLISHED);
  });

  it('reports a changed tag list', async () => {
    const blog = fakeBlog({
      existingPost: EXISTING_ROW,
      existingTagSlugs: ['gamedev', 'ringside-booker'],
    });
    const result = await publishPost(blog, PAYLOAD, options());
    expect(result.changes).toEqual([
      {
        field: 'tags',
        before: 'gamedev, ringside-booker',
        after: 'gamedev, ringside-booker, typescript',
      },
    ]);
  });

  it('returns unchanged and writes nothing when the blog already matches', async () => {
    const blog = fakeBlog({ existingPost: EXISTING_ROW, existingTagSlugs: EXISTING_TAGS });
    // A newer publishedAt in the payload is not a change: the first publish date is kept.
    const result = await publishPost(blog, { ...PAYLOAD, publishedAt: NOW }, options());

    expect(result.action).toBe('unchanged');
    expect(result.changes).toEqual([]);
    expect(result.publishedAt).toEqual(FIRST_PUBLISHED);
    expect(blog.writes()).toEqual([]);
    expect(blog.texts().some((text) => /\bUPDATE\b/.test(text))).toBe(false);
    expect(blog.texts().at(-1)).toBe(COMMIT);
  });
});

describe('publishPost: dry run', () => {
  it('runs the steps and ends with ROLLBACK, never COMMIT', async () => {
    const blog = fakeBlog();
    const result = await publishPost(blog, PAYLOAD, options({ dryRun: true }));
    expect(result.action).toBe('created');
    expect(result.dryRun).toBe(true);
    expect(blog.texts().at(-1)).toBe(ROLLBACK);
    expect(blog.texts()).not.toContain(COMMIT);
  });

  it('ends an unchanged dry run with ROLLBACK too', async () => {
    const blog = fakeBlog({ existingPost: EXISTING_ROW, existingTagSlugs: EXISTING_TAGS });
    const result = await publishPost(blog, PAYLOAD, options({ dryRun: true }));
    expect(result.action).toBe('unchanged');
    expect(blog.texts().at(-1)).toBe(ROLLBACK);
  });
});

describe('publishPost: refusals', () => {
  it('throws BlogAuthorError before any write when the author is unknown', async () => {
    const blog = fakeBlog({ authorId: null });
    const error = await catchAsyncError(publishPost(blog, PAYLOAD, options()), BlogAuthorError);
    expect(error.message).not.toContain('author@example.test');
    expect(blog.writes()).toEqual([]);
    expect(blog.texts()).toEqual(['BEGIN', SELECT_AUTHOR_BY_EMAIL, ROLLBACK]);
  });

  it('refuses a slug that looks renamed, unless allowed', async () => {
    const renamed: PostPayload = { ...PAYLOAD, slug: 'ringside-booker-03-a-new-slug' };
    const blog = fakeBlog({ sameTitleSlug: PAYLOAD.slug });
    const error = await catchAsyncError(publishPost(blog, renamed, options()), BlogSlugChangeError);
    expect(error.message).toContain(
      `slug appears to have changed from ${PAYLOAD.slug}; slugs are permanent (docs/blog/README.md)`,
    );
    expect(blog.writes()).toEqual([]);
    expect(blog.texts().at(-1)).toBe(ROLLBACK);

    const allowed = await publishPost(
      fakeBlog({ sameTitleSlug: PAYLOAD.slug }),
      renamed,
      options({ allowNewSlug: true }),
    );
    expect(allowed.action).toBe('created');
  });
});

describe('publishPost: parameters', () => {
  it('never puts a payload value into SQL text', async () => {
    const blog = fakeBlog();
    await publishPost(blog, PAYLOAD, options());
    const values = [
      PAYLOAD.title,
      PAYLOAD.slug,
      PAYLOAD.content,
      PAYLOAD.excerpt,
      'author@example.test',
      'new-id-1',
      'user-1',
      NOW.toISOString(),
      ...PAYLOAD.tags.map((tag) => tag.name),
    ];
    for (const query of blog.queries) {
      for (const value of values) {
        expect(query.text).not.toContain(value);
      }
    }
    // Every statement that carries values refers to them by position.
    for (const query of blog.queries.filter((recorded) => recorded.values.length > 0)) {
      expect(query.text).toMatch(/\$1\b/);
    }
  });
});
