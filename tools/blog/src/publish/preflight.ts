import { z } from 'zod';

import type { Queryable } from './queryable';
import { SELECT_SCHEMA_COLUMNS } from './sql';

// The publisher writes straight to the blog's tables, so before any write it checks that every
// table and column it touches is still there. If the blog's schema drifts, publishing stops with
// a list of what is missing instead of failing halfway through.

/** The tables and columns the publisher reads or writes. */
export const REQUIRED_BLOG_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  posts: [
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
  ],
  tags: ['id', 'name', 'slug'],
  // The ORM's implicit many-to-many table: A is the post id, B the tag id.
  _PostTags: ['A', 'B'],
  users: ['id', 'email'],
};

/** The blog database is missing tables or columns the publisher needs. */
export class BlogSchemaError extends Error {
  override readonly name = 'BlogSchemaError';
  /** Each missing table, or `table.column` for a missing column. */
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    const details = missing.map((item) => `  - ${item}`).join('\n');
    super(`the blog database does not have the schema the publisher expects\n${details}`);
    this.missing = missing;
  }
}

const ColumnRow = z.object({ table_name: z.string(), column_name: z.string() });

/** Throws BlogSchemaError listing every missing table and column. */
export async function assertBlogSchema(client: Queryable): Promise<void> {
  const tableNames = Object.keys(REQUIRED_BLOG_SCHEMA);
  const result = await client.query(SELECT_SCHEMA_COLUMNS, [tableNames]);
  const present = new Map<string, Set<string>>();
  for (const row of z.array(ColumnRow).parse(result.rows)) {
    const columns = present.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    present.set(row.table_name, columns);
  }

  const missing: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_BLOG_SCHEMA)) {
    const presentColumns = present.get(table);
    if (presentColumns === undefined) {
      missing.push(`table ${table}`);
      continue;
    }
    for (const column of columns) {
      if (!presentColumns.has(column)) {
        missing.push(`column ${table}.${column}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new BlogSchemaError(missing);
  }
}
