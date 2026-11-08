# Blog tools

`@ringside/blog-tools` checks the posts in [`docs/blog/`](../../docs/blog/) and the dev journal in
[`docs/dev-journal/`](../../docs/dev-journal/), scaffolds journal entries, and publishes posts to
my personal blog. The writing rules (frontmatter, statuses, the series index, content rules) live
in [`docs/blog/README.md`](../../docs/blog/README.md); this file covers the commands and how
publishing works.

## Commands

Run them from the repo root. File paths are relative to the root.

| Command                                                         | What it does                                         |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `npm run blog:check -- [--only blog\|journal] [file...]`        | Checks posts and journal entries against the rules   |
| `npm run blog:publish -- <file> [flags]`                        | Publishes one post to the blog                       |
| `npm run journal:new -- <topic> [--epic <PREFIX>]... [--force]` | Scaffolds a journal entry from commits and the inbox |
| `npm run journal:due -- [--threshold <commits>]`                | Lists epics that have shipped work since their entry |

`blog:check` is described in [`docs/blog/README.md`](../../docs/blog/README.md#checking-a-post).

## blog:publish

```sh
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

## journal:new

```sh
npm run journal:new -- foundation --epic FND
```

1. Finds the newest journal entry's `date`. Commits are read from that day onwards, or from the
   first commit when there are no entries.
2. Reads `docs/dev-journal/_template.md` and the notes under `## Notes` in
   `docs/dev-journal/_inbox.md`.
3. Writes `docs/dev-journal/YYYY-MM-<topic>.md` (year and month from today's date) with `title`
   (the topic in title case), `date`, `epics` and `tickets` filled in. `tickets` holds the IDs
   whose prefix is one of the `--epic` values, or every ID when no `--epic` is given. The
   `## What I built` section gets a bullet per ticket listing its commit subjects, plus one bullet
   for commits without a ticket ID. `## Raw notes` gets the inbox notes exactly as written.
4. Rewrites `_inbox.md` to its header, so the notes live only in the new entry.
5. Prints the new file's path.

`<topic>` must be kebab-case. When the file name is taken the entry gets `-2`, `-3` and so on;
nothing is overwritten unless `--force` is given, which writes over `YYYY-MM-<topic>.md`.

The entry still has the template's prompts in it. Fill every section, add the Index row in
`docs/dev-journal/README.md`, and run `npm run blog:check -- --only journal`.

## journal:due

```sh
npm run journal:due
npm run journal:due -- --threshold 20
```

Prints `Epic | Last entry | Commits since | Status` with one row per epic prefix in the commit
history. "Last entry" is the newest entry whose `epics` lists the epic. "Commits since" counts the
epic's commits dated after that entry (commits on the entry's own date count as covered). The
status is `due` when:

- the epic has `--threshold` (default 10) or more commits since its last entry, or
- the epic's closing ticket, from the table in
  [`docs/dev-journal/epic-exit-checklist.md`](../../docs/dev-journal/epic-exit-checklist.md),
  appears in a commit subject with no entry for the epic after it.

A closing line reports `state-of-the-build due` when the newest entry is more than 30 days old.
The command is advisory: it always exits 0 after printing, and CI does not run it.

## Ticket IDs in commit subjects

Both journal commands group commits by the ticket ID in the subject. These forms are read:

- `[FND-01] Scaffold the monorepo`
- `FND-02: World store`
- `feat: world store (FND-02)`, the conventional form, which may list several IDs:
  `fix: rounding (SIM-05, FND-14)`

A commit naming two tickets is listed under both. Subjects with no ID are kept as "untracked"
rather than dropped. Merge commits are skipped, since their subjects repeat the work they merge.
Git runs through `execFile` with an argument array, never a shell.

## Layout

| Path           | Contents                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| `src/cli/`     | The command-line entry points                                               |
| `src/check/`   | The blog and journal checker and its rules                                  |
| `src/journal/` | Journal tooling: git history, inbox, entry scaffolding, the due report      |
| `src/publish/` | The publisher: settings, preflight, SQL, upsert and the write-back          |
| `src/*.ts`     | Post frontmatter, loading and the publish transform                         |
| `test/`        | Vitest tests; `test/fixtures/repo` is a small repo the checker tests run on |

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
