import type { Queryable } from '../src/publish/queryable';
import {
  SELECT_AUTHOR_BY_EMAIL,
  SELECT_POST_BY_SLUG,
  SELECT_POST_SLUG_BY_TITLE,
  SELECT_POST_TAG_SLUGS,
  SELECT_SCHEMA_COLUMNS,
  SELECT_TAGS_BY_SLUG,
  UPSERT_POST,
} from '../src/publish/sql';

/** One statement the code under test sent. */
export interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** A Queryable that records every statement and answers with rows from `respond`. */
export class FakeQueryable implements Queryable {
  readonly queries: RecordedQuery[] = [];
  ended = false;
  private readonly respond: (text: string, values: readonly unknown[]) => readonly unknown[];

  constructor(respond: (text: string, values: readonly unknown[]) => readonly unknown[]) {
    this.respond = respond;
  }

  query(text: string, values: unknown[] = []): Promise<{ readonly rows: readonly unknown[] }> {
    this.queries.push({ text, values });
    try {
      return Promise.resolve({ rows: this.respond(text, values) });
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  end(): Promise<void> {
    this.ended = true;
    return Promise.resolve();
  }

  /** The statement texts, trimmed, in order. */
  texts(): string[] {
    return this.queries.map((query) => query.text.trim());
  }

  /** The recorded statements whose text is exactly `text`. */
  queriesOf(text: string): RecordedQuery[] {
    return this.queries.filter((query) => query.text === text);
  }

  /** Statements that write: INSERT, UPDATE or DELETE. */
  writes(): RecordedQuery[] {
    return this.queries.filter((query) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(query.text));
  }
}

/** A post as the fake blog database holds it. */
export interface FakePostRow {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly excerpt: string | null;
  readonly coverImage: string | null;
  readonly published: boolean;
  readonly publishedAt: Date | null;
}

export interface FakeBlogState {
  readonly authorId: string | null;
  readonly existingPost: FakePostRow | null;
  readonly existingTagSlugs: readonly string[];
  /** The slug of another post with the payload's title, for the slug-change guard. */
  readonly sameTitleSlug: string | null;
  /** Rows for the information_schema query. */
  readonly schemaColumns: readonly { table_name: string; column_name: string }[];
}

export const FULL_SCHEMA_COLUMNS: readonly { table_name: string; column_name: string }[] = [
  ...[
    'id',
    'title',
    'slug',
    'content',
    'excerpt',
    'coverImage',
    'published',
    'publishedAt',
    'createdAt',
    'updatedAt',
    'authorId',
  ].map((column) => ({ table_name: 'posts', column_name: column })),
  ...['id', 'name', 'slug'].map((column) => ({ table_name: 'tags', column_name: column })),
  ...['A', 'B'].map((column) => ({ table_name: '_PostTags', column_name: column })),
  ...['id', 'email', 'password'].map((column) => ({ table_name: 'users', column_name: column })),
];

/**
 * A fake blog: answers the publisher's reads from `state` and its post upsert the way Postgres
 * would (keeping an existing `publishedAt`). Writes other than the upsert return no rows.
 */
export function fakeBlog(overrides: Partial<FakeBlogState> = {}): FakeQueryable {
  const state: FakeBlogState = {
    authorId: 'user-1',
    existingPost: null,
    existingTagSlugs: [],
    sameTitleSlug: null,
    schemaColumns: FULL_SCHEMA_COLUMNS,
    ...overrides,
  };
  return new FakeQueryable((text, values) => {
    switch (text) {
      case SELECT_SCHEMA_COLUMNS:
        return state.schemaColumns;
      case SELECT_AUTHOR_BY_EMAIL:
        return state.authorId === null ? [] : [{ id: state.authorId }];
      case SELECT_POST_BY_SLUG:
        return state.existingPost === null ? [] : [state.existingPost];
      case SELECT_POST_TAG_SLUGS:
        return state.existingTagSlugs.map((slug) => ({ slug }));
      case SELECT_POST_SLUG_BY_TITLE:
        return state.sameTitleSlug === null ? [] : [{ slug: state.sameTitleSlug }];
      case SELECT_TAGS_BY_SLUG: {
        const slugs = values[0];
        return Array.isArray(slugs)
          ? slugs.map((slug) => ({ id: `tag-${String(slug)}`, slug: String(slug) }))
          : [];
      }
      case UPSERT_POST: {
        const sentPublishedAt = values[7];
        const publishedAt =
          state.existingPost?.publishedAt ??
          (typeof sentPublishedAt === 'string' ? new Date(sentPublishedAt) : null);
        return [
          {
            id: state.existingPost?.id ?? String(values[0]),
            inserted: state.existingPost === null,
            publishedAt,
          },
        ];
      }
      default:
        return [];
    }
  });
}
