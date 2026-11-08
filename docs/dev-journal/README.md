# Dev journal

This folder is my dated record of how Ringside Booker gets built. Each entry
covers an epic or a milestone: what shipped, which calls I made and why, what
went wrong, and what comes next. I write entries while the decisions are fresh,
so blog posts can be drawn from them later without re-deriving anything. The
repository is public, which means this folder is public too. Entries are working
notes and less polished than the blog, but they follow the same public content
rules (see [Content rules](#content-rules)).

## Journal vs blog

|          | Journal (`docs/dev-journal/`)                 | Blog (`docs/blog/`)                      |
| -------- | --------------------------------------------- | ---------------------------------------- |
| Audience | Me, and anyone following the repo             | Readers who have never seen the code     |
| Polish   | Working notes, bullets are fine               | Edited posts with a beginning and an end |
| When     | Every epic close, milestone, or 30 quiet days | When an entry has a story worth telling  |
| Public   | Yes                                           | Yes                                      |

Blog posts start from journal entries. The `blogCandidates` field and the
`## Blog angle` section of each entry are where that starts.

## File naming

Entries live at `docs/dev-journal/YYYY-MM-<topic>.md`:

- `YYYY-MM` is the month the entry is written, not the month the work started.
- `<topic>` is kebab-case and must match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- If two entries share the same month and topic, the later one gets `-2` (then
  `-3`, and so on): `2027-03-state-of-the-build.md`,
  `2027-03-state-of-the-build-2.md`.

Examples: `2026-11-project-kickoff.md`, `2027-01-foundation.md`.

Month-level names keep the folder readable as a timeline. The `date` field in
the frontmatter keeps the exact order inside a month.

Files whose names start with `_` are templates or working files, not entries.
Tooling skips them when it lists entries:

- [`_template.md`](_template.md): copy this to start a new entry.
- [`_inbox.md`](_inbox.md): quick notes between entries.

## Cadence

1. **Epic close.** One entry when each epic closes. Every epic ends with a
   "Write the <Epic name> dev journal entry" ticket (for example FND-13,
   SIM-13, WLD-12 and UI-14). Future epics get the same closing ticket by the
   BLOG-10 convention.
2. **Milestones.** One entry per named milestone that spans several epics (for
   example "first playable season"). Set the `milestone` field.
3. **Thirty quiet days.** If 30 days pass with no entry, write a short "state of
   the build" entry with the topic `state-of-the-build`. Short is fine: what
   moved, what stalled, what's next.
4. **Inbox.** Quick notes go into [`_inbox.md`](_inbox.md) at any time. They are
   drained into the `## Raw notes` section of the next entry and then deleted
   from the inbox.

## Writing an entry

1. Copy `_template.md` to `YYYY-MM-<topic>.md`.
2. Fill in the frontmatter: `title`, `date` (ISO `YYYY-MM-DD`), `epics` (epic
   prefixes such as `[FND, SIM]`), `milestone` (a name, or empty), `tickets`
   (ticket IDs closed, such as `[FND-01, FND-02]`) and `blogCandidates` (short
   working titles, may be empty). Replace the `# Title of the entry` heading
   with the same title.
3. Write each section. Delete the italic prompt lines once a section is filled
   in. If a section has nothing to say, write "Nothing this time." rather than
   deleting it, so every entry keeps the same shape.
4. Move the bullets from `_inbox.md` into `## Raw notes`, then delete them from
   the inbox.
5. Add a row to the top of the [Index](#index).
6. Run `npm run blog:check -- --only journal`. It checks the file name, the
   frontmatter, the ten sections and the index row, plus the public content
   rules (see [`docs/blog/README.md`](../blog/README.md#checking-a-post)).

## Content rules

These match the blog's public rules, because both folders are in a public repo.

- **Voice.** First person, in my own voice. Past tense for what happened.
- **Our own game only.** Never name another game. When a comparison helps, say
  "other games in the genre" and describe our own version: what it does and
  why.
- **No outside sources.** Don't cite research notes, and don't refer to a
  reference design or a reference study. The journal records what was built
  and why, in our own terms.
- **No third-party formulas.** Never paste formulas from somewhere else. Our own
  formulas live in `docs/design/` and can be linked.
- **Fictional world.** No real wrestler names and no real promotion names.
- **Cite decisions by ID.** Point to decisions by their public ID in
  [`docs/design/design-decisions.md`](../design/design-decisions.md) (for
  example "D-04") or by design doc section.
- **Nothing private.** No credentials, personal details or private material.
  Anything that needs a private reference stays out of the repo entirely.

## Index

Newest entry at the top. Each new entry adds one row.

| Date       | Entry                                         | Epics | Blog post |
| ---------- | --------------------------------------------- | ----- | --------- |
| 2026-11-07 | [Project kickoff](2026-11-project-kickoff.md) | -     | Part 01   |
