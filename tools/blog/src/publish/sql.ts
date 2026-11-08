// Every statement the publisher sends to the blog database. Values only ever travel as `$n`
// parameters; nothing is interpolated into these strings. The blog's ORM names columns in
// camelCase, so those columns (and the `_PostTags` join table) are double-quoted.
//
// Timestamps are `timestamp(3) without time zone` holding UTC, as the blog's ORM writes them.
// They are sent as ISO strings (Postgres ignores the trailing `Z` for that type, which keeps the
// UTC wall-clock time) and read back with `AT TIME ZONE 'UTC'`, so the driver gets a value with
// a zone and builds the right Date whatever the local time zone is.

export const BEGIN = 'BEGIN';
export const COMMIT = 'COMMIT';
export const ROLLBACK = 'ROLLBACK';

/** $1: the table names to look up. */
export const SELECT_SCHEMA_COLUMNS = `
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`;

/** $1: author email. */
export const SELECT_AUTHOR_BY_EMAIL = 'SELECT id FROM users WHERE email = $1';

/** $1: post slug. */
export const SELECT_POST_BY_SLUG = `
SELECT id, title, content, excerpt, "coverImage", published,
  "publishedAt" AT TIME ZONE 'UTC' AS "publishedAt"
FROM posts
WHERE slug = $1`;

/** $1: post id. The slugs of the tags linked to the post. */
export const SELECT_POST_TAG_SLUGS = `
SELECT tags.slug
FROM tags
JOIN "_PostTags" ON "_PostTags"."B" = tags.id
WHERE "_PostTags"."A" = $1
ORDER BY tags.slug`;

/** $1: payload title, $2: payload slug. Another post with the same title, for the slug guard. */
export const SELECT_POST_SLUG_BY_TITLE = `
SELECT slug
FROM posts
WHERE title = $1 AND slug <> $2
ORDER BY "createdAt"
LIMIT 1`;

/** $1: new tag id, $2: name, $3: slug. Leaves an existing tag with that slug alone. */
export const INSERT_TAG = `
INSERT INTO tags (id, name, slug)
VALUES ($1, $2, $3)
ON CONFLICT (slug) DO NOTHING`;

/** $1: tag slugs. */
export const SELECT_TAGS_BY_SLUG = 'SELECT id, slug FROM tags WHERE slug = ANY($1::text[])';

/**
 * $1 id (used only when the row is new), $2 title, $3 slug, $4 content, $5 excerpt,
 * $6 coverImage, $7 published, $8 publishedAt, $9 createdAt, $10 updatedAt, $11 authorId.
 * An update keeps the row's id, authorId, createdAt and any publishedAt it already has.
 */
export const UPSERT_POST = `
INSERT INTO posts (id, title, slug, content, excerpt, "coverImage", published, "publishedAt",
  "createdAt", "updatedAt", "authorId")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  content = EXCLUDED.content,
  excerpt = EXCLUDED.excerpt,
  "coverImage" = EXCLUDED."coverImage",
  published = EXCLUDED.published,
  "publishedAt" = COALESCE(posts."publishedAt", EXCLUDED."publishedAt"),
  "updatedAt" = EXCLUDED."updatedAt"
RETURNING id, (xmax = 0) AS inserted, "publishedAt" AT TIME ZONE 'UTC' AS "publishedAt"`;

/** $1: post id. */
export const DELETE_POST_TAGS = 'DELETE FROM "_PostTags" WHERE "A" = $1';

/** $1: post id, $2: tag id. In the ORM's implicit join table, A is the post and B the tag. */
export const INSERT_POST_TAG = 'INSERT INTO "_PostTags" ("A", "B") VALUES ($1, $2)';
