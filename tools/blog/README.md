# @ringside/blog-tools

Tooling for the dev journal in [`docs/dev-journal/`](../../docs/dev-journal/) and the blog series
in [`docs/blog/`](../../docs/blog/). Every command runs from the repo root through an `npm run`
script there, and reads and writes paths relative to the repo root.

| Command                                                         | What it does                                         |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `npm run blog:check -- [--only blog\|journal] [file...]`        | Checks posts and journal entries against the rules   |
| `npm run journal:new -- <topic> [--epic <PREFIX>]... [--force]` | Scaffolds a journal entry from commits and the inbox |
| `npm run journal:due -- [--threshold <commits>]`                | Lists epics that have shipped work since their entry |

`blog:check` is described in [`docs/blog/README.md`](../../docs/blog/README.md#checking-a-post).

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
| `src/cli/`     | The three command-line entry points                                         |
| `src/check/`   | The blog and journal checker and its rules                                  |
| `src/journal/` | Journal tooling: git history, inbox, entry scaffolding, the due report      |
| `src/*.ts`     | Post frontmatter, loading and the publish transform                         |
| `test/`        | Vitest tests; `test/fixtures/repo` is a small repo the checker tests run on |
