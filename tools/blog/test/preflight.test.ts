import { describe, expect, it } from 'vitest';

import { BlogSchemaError, assertBlogSchema } from '../src/publish/preflight';
import { SELECT_SCHEMA_COLUMNS } from '../src/publish/sql';
import { FULL_SCHEMA_COLUMNS, fakeBlog } from './fakeDatabase';
import { catchAsyncError } from './helpers';

describe('assertBlogSchema', () => {
  it('passes when every table and column is present', async () => {
    const blog = fakeBlog();
    await assertBlogSchema(blog);
    expect(blog.queries).toEqual([
      { text: SELECT_SCHEMA_COLUMNS, values: [['posts', 'tags', '_PostTags', 'users']] },
    ]);
  });

  it('lists a missing column and a missing table in one error', async () => {
    const blog = fakeBlog({
      schemaColumns: FULL_SCHEMA_COLUMNS.filter(
        (row) =>
          row.table_name !== 'tags' && !(row.table_name === '_PostTags' && row.column_name === 'B'),
      ),
    });
    const schemaError = await catchAsyncError(assertBlogSchema(blog), BlogSchemaError);
    expect(schemaError.missing).toEqual(['table tags', 'column _PostTags.B']);
    expect(schemaError.message).toContain('table tags');
    expect(schemaError.message).toContain('column _PostTags.B');
  });

  it('checks the camelCase columns by their exact names', async () => {
    const blog = fakeBlog({
      schemaColumns: FULL_SCHEMA_COLUMNS.map((row) =>
        row.column_name === 'publishedAt' ? { ...row, column_name: 'published_at' } : row,
      ),
    });
    const error = await catchAsyncError(assertBlogSchema(blog), BlogSchemaError);
    expect(error.missing).toEqual(['column posts.publishedAt']);
  });
});
