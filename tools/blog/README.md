# Blog tools

`@ringside/blog-tools` checks the posts in [`docs/blog/`](../../docs/blog/) and the dev journal,
and publishes posts to my personal blog. The writing rules (frontmatter, statuses, the series
index, content rules) live in [`docs/blog/README.md`](../../docs/blog/README.md); this file covers
the commands and how publishing works.

## Commands

Run them from the repo root. File paths are relative to the root.

```sh
npm run blog:check                                   # check every post and journal entry
npm run blog:check -- docs/blog/01-why-im-building-a-wrestling-booking-sim.md

npm run blog:publish -- docs/blog/01-why-im-building-a-wrestling-booking-sim.md --dry-run
npm run blog:publish -- docs/blog/01-why-im-building-a-wrestling-booking-sim.md
```

`blog:publish` takes one post file and these flags:

| Flag               | What it does                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `--dry-run`        | Runs every step inside a transaction, prints what would change, then rolls back. Nothing is saved. |
| `--no-write-back`  | Doesn't write `publishedAt` back into the post and the series index.                               |
| `--allow-new-slug` | Publishes even though a post with the same title already exists on the blog under another slug.    |

Exit codes: 0 published (or nothing to do), 1 refused or failed, 2 bad arguments.

## Settings

The tools read these variables. Copy [`.env.example`](.env.example) to `tools/blog/.env.local`
and fill in the first three. `.env.local` is gitignored and never committed.

| Variable                 | Used by           | Where it's read from                    | Default                                                                  |
| ------------------------ | ----------------- | --------------------------------------- | ------------------------------------------------------------------------ |
| `BLOG_DATABASE_URL`      | publish           | `tools/blog/.env.local` **only**        | none, required                                                           |
| `BLOG_AUTHOR_EMAIL`      | publish           | `.env.local`, then the shell            | none, required                                                           |
| `BLOG_SITE_URL`          | publish           | `.env.local`, then the shell            | none, required                                                           |
| `BLOG_REPO_URL`          | publish           | `.env.local`, then the shell            | `https://github.com/jpDxsoloOrg/ringside-booker`                         |
| `BLOG_REPO_BRANCH`       | publish           | `.env.local`, then the shell            | `main`                                                                   |
| `BLOG_ASSET_BASE_URL`    | publish           | `.env.local`, then the shell            | `https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/...` |
| `BLOG_BANNED_TERMS_FILE` | check and publish | the shell (and `.env.local` on publish) | `~/.config/ringside-booker/banned-terms.txt`                             |

- **`BLOG_DATABASE_URL`** is the blog's PostgreSQL connection string. It's write access to a live
  site and this repo is public, so it is read from `tools/blog/.env.local` and nowhere else:
  exporting it in the shell does nothing, and no CI secret or workflow step holds it. Use the
  **direct (non-pooled)** connection string. A pooled endpoint in transaction-pooling mode can
  break the publisher's multi-statement transaction. Add `?sslmode=require` if the database
  needs TLS.
- **`BLOG_AUTHOR_EMAIL`** is the email of the blog user that new posts are credited to. That user
  must already exist on the blog.
- **`BLOG_SITE_URL`** is the blog's public origin. Published posts live at
  `${BLOG_SITE_URL}/blog/<slug>`.

Nothing the tools print includes the database URL, its password or host, or the author email.

## How publishing works

`blog:publish` refuses to run when `CI` is set ("publishing runs only from a local machine"),
before it reads any setting. Otherwise it:

1. Runs `blog:check` on the post with `--require-banned-terms`. Any error stops it before it
   connects to anything, so a post that fails a check is never written.
2. Builds the blog record from the post (links and images made absolute, comments removed).
   Only `draft` and `final` posts can be published.
3. Connects and checks the blog's schema: the `posts`, `tags`, `_PostTags` and `users` tables and
   every column the publisher touches. If the blog's schema has drifted, it stops and lists what
   is missing.
4. In one transaction: finds the author, reads the post by slug, and compares. If the title,
   content, excerpt, cover image, published flag and tags all match, it writes nothing and
   reports `unchanged`, so `updatedAt` stays put. Otherwise it creates any missing tags, upserts
   the post by slug and replaces its tag links. An update never changes the post's author,
   `createdAt` or an existing `publishedAt`.
5. Prints `created|updated|unchanged <slug> → <url>` and a table of the fields that changed.
   Content is shown as its length, line count and a short hash, not the full text.
6. On the first live publish of a `final` post, writes `publishedAt: YYYY-MM-DD` into the post's
   frontmatter and fills the post's `Published` cell in the series index. Commit both files.

If the slug in the file has no post on the blog but a post with the same title does, the
publisher assumes the slug was renamed and stops, because slugs are permanent. Pass
`--allow-new-slug` if it really is a new post.

The publisher writes to the blog's database directly with `pg` rather than through the blog's
HTTP API or ORM. The statements are in [`src/publish/sql.ts`](src/publish/sql.ts), with every
value passed as a parameter.

### What each status does on the blog

| Status               | On the blog                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `planned`, `outline` | Never published. The command refuses them.                                                           |
| `draft`              | Saved with `published = false`. Hidden from the public list; the post page returns 404.              |
| `final`              | Saved with `published = true` and a `publishedAt`. Listed on the blog and served at its URL at once. |

The blog's RSS feed is cached for up to an hour, so a new post can show up there late.

### Images

Post images live in `docs/blog/images/NN/` and are served from the public repo's raw URL
(`BLOG_ASSET_BASE_URL`). They aren't uploaded to the blog. That URL points at `main`, so images
only resolve once the post's branch is merged.

### Dry runs and rolling back

- **Dry run:** `npm run blog:publish -- <file> --dry-run` does everything inside a transaction and
  rolls it back. The output shows the action (`created`, `updated` or `unchanged`) and the field
  diff that a real publish would apply.
- **Undo an edit:** check out the previous version of the post file from git and publish it again.
  `publishedAt` stays as it was.
- **Take a post down:** set `status: draft` (and the series index row) and publish again. The post
  stays on the blog, hidden, with its `publishedAt` kept for when it goes back up. Nothing is ever
  deleted by the tools.

## Tests

`npm test` runs the unit tests, which use a fake database. The integration test,
[`test/publish.int.test.ts`](test/publish.int.test.ts), runs the publisher against a real
Postgres and is skipped unless `BLOG_IT_DATABASE_URL` is set. Point it at a throwaway local
database, never the blog's. It's never set in CI. The test creates its tables in a new schema and
drops the schema at the end.

```sh
docker run -d --rm --name blog-it -p 55432:5432 -e POSTGRES_PASSWORD=it postgres:16-alpine
BLOG_IT_DATABASE_URL=postgresql://postgres:it@localhost:55432/postgres \
  npx vitest run --project blog-tools test/publish.int.test.ts
docker stop blog-it
```
