# Ringside Booker: the blog series

I'm building a wrestling booking sim in the open, and these are the posts. The
dev journal in [`docs/dev-journal/`](../dev-journal/) is where I write things
down while they're fresh. This folder is where the parts worth reading end up:
one post per milestone, plus deep dives on the systems I think are interesting.
Each post is written here as Markdown, checked, and then pushed to my personal
blog. The repo is public, so drafts and outlines here are public too.

## Files

- Posts are named `docs/blog/NN-<kebab-title>.md`. `NN` is two digits, starts at
  `01`, and is equal to the post's `part`. `<kebab-title>` is lowercase letters,
  digits and single hyphens, for example `01-why-im-building-a-wrestling-booking-sim.md`.
- Files starting with `_` (like [`_template.md`](_template.md)) and this README
  are not posts. Tooling skips them.
- Images for a post go in `docs/blog/images/NN/`, where `NN` is the post's part,
  and are linked with a relative path such as `images/01/day-loop.svg`. On the
  blog they're served from the public repo's raw URL,
  `https://raw.githubusercontent.com/jpDxsoloOrg/ringside-booker/main/docs/blog/images/...`
  (the default for `BLOG_ASSET_BASE_URL`). That URL points at `main`, so an
  image only resolves once it has been merged. A draft pushed from a branch
  shows broken images until then.
- To start a post, copy `_template.md` to the next free number and add its row
  to the [series index](#series-index).

## Frontmatter

Every post starts with a YAML frontmatter block. Unknown keys are an error.
The blog stores each post as one `Post` record (`title`, `slug`, `content`,
`excerpt`, `coverImage`, `published`, `publishedAt`, plus linked tags). The
"Maps to" column says which column each field fills. Fields marked repo-only
never reach the blog as they are; they drive how the post is listed and
published.

| Field         | Type                                     | Required                | Example                                                     | Maps to                                  |
| ------------- | ---------------------------------------- | ----------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `title`       | string, 90 characters or fewer           | yes                     | `"Same seed, same show"`                                    | `Post.title` (rendered as the page's H1) |
| `slug`        | string                                   | yes                     | `ringside-booker-03-same-seed-same-show`                    | `Post.slug`                              |
| `series`      | literal `ringside-booker`                | yes                     | `ringside-booker`                                           | repo-only                                |
| `part`        | integer, 1 or more                       | yes                     | `3`                                                         | repo-only                                |
| `status`      | `planned`, `outline`, `draft` or `final` | yes                     | `draft`                                                     | repo-only; sets `Post.published`         |
| `excerpt`     | string, 50 to 200 characters             | for `draft` and `final` | `"How named random streams keep one change from..."`        | `Post.excerpt`                           |
| `tags`        | array of 1 to 6 tag names                | yes                     | `[gamedev, typescript, simulation]`                         | `Post.tags` (linked `Tag` rows)          |
| `publishedAt` | ISO date, `YYYY-MM-DD`                   | no                      | `2026-12-01`                                                | `Post.publishedAt`                       |
| `coverImage`  | absolute `https://` URL                  | no                      | `https://raw.githubusercontent.com/.../images/03/cover.png` | `Post.coverImage`                        |
| `journal`     | array of `docs/dev-journal/*.md` paths   | yes (may be `[]`)       | `[docs/dev-journal/2026-11-project-kickoff.md]`             | repo-only                                |

The post body (everything after the frontmatter) becomes `Post.content`.

Rules for the fields:

- **`slug`** matches `^ringside-booker-[a-z0-9]+(-[a-z0-9]+)*$`. The prefix is
  there because the blog is shared with other series and slugs are unique
  across the whole blog. By convention it is `ringside-booker-NN-<kebab-title>`.
  Slugs must be unique within the series and **never change after the first
  publish**, because that breaks every link to the post. The publish script
  refuses a slug change it can detect.
- **`tags`** are lowercase names matching `^[a-z0-9][a-z0-9 -]{0,30}$`, with no
  duplicates. `ringside-booker` is added automatically, so don't list it. Tags
  are created on the blog if they're missing, so nobody needs to create them by
  hand first.
- **`publishedAt`** is left out while writing. The publish script writes it
  back to the file (and fills the post's `Published` cell in the index below)
  the first time a `final` post goes live. After that it doesn't move, even if
  the post is edited and pushed again.
- **`coverImage`** is optional. For an image in this repo, use its raw URL
  under `docs/blog/images/`.
- **`excerpt`** is what shows on the blog's post list and in link previews. It's
  optional while a post is `planned` or `outline`.
- Optional fields that aren't set are left out of the file or commented out (as
  in the template). An empty value doesn't count as "not set".

## Status lifecycle

A post normally moves through these states in order. `status` is the only thing
that decides what the publish script does with it. To take a live post down,
set it back to `draft` and publish it again. Its `publishedAt` stays as it was.

| Status    | What the file holds                                              | What the publish script does                                                                |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `planned` | A row in the series index. A file is optional and needs no body. | Nothing. Planned posts are listed in the index only.                                        |
| `outline` | Frontmatter plus bullet beats for each section.                  | Never pushes it.                                                                            |
| `draft`   | Full prose, still being revised.                                 | Pushes it with `published = false`. The public post page returns 404 for unpublished posts. |
| `final`   | Finished post.                                                   | Pushes it with `published = true`, and writes back `publishedAt` on the first publish.      |

A note on drafts: the only place to see a pushed draft on the blog is the admin
editor's preview, and that preview renders plain Markdown, not MDX. It's an
approximation of the live page, not the real thing. The checker (see
[MDX safety](#mdx-safety)) is what catches problems that only show up when the
post is rendered for real.

## Series index

Titles on `planned` rows are tentative. They'll change when the post gets
outlined. "Draws from" names the dev journal entries the post is built from.
"Published" is the date the post first went live, filled in by the publish
script.

| Part | Title                                                                       | Status  | Draws from                                    | Published |
| ---- | --------------------------------------------------------------------------- | ------- | --------------------------------------------- | --------- |
| 01   | Why I'm building a wrestling booking sim                                    | outline | Project kickoff journal entry                 | -         |
| 02   | Foundations: one World, deterministic days, numbers that explain themselves | planned | Foundation (FND) and simulation (SIM) entries | -         |
| 03   | Same seed, same show: randomness with named streams                         | planned | Simulation (SIM) entry                        | -         |
| 04   | Every number explains itself: the Why? panel                                | planned | Simulation (SIM) and UI entries               | -         |
| 05   | Building a fictional wrestling world from scratch                           | planned | World (WLD) entry                             | -         |
| 06   | A desktop game that fits on a phone                                         | planned | UI entry                                      | -         |
| 07   | How a match gets its rating                                                 | planned | Match rating epic entry (later)               | -         |

When a post's status changes, its row changes in the same commit. The title and
status in the row must match the file.

## Content rules

These are the same rules the dev journal follows, because both folders live in
the public repo `jpDxsoloOrg/ringside-booker`. They apply from the first commit,
not just at publish time: outlines, drafts and HTML comments in this folder are
readable by anyone.

- **First person, in my own voice as the developer.** "I built", "I changed my
  mind", not "we" or "the team".
- **No other games by name.** Don't name another game, cite research notes, or
  refer to a reference design or a reference study. When a comparison helps,
  say "other games in the genre" and nothing more specific, then describe our
  own version.
- **No real wrestling.** No real wrestler names, real promotion names or real
  logos. Use the fictional world's names and placeholders.
- **No borrowed formulas.** Don't paste third-party formulas. Explain our own.
- **Our own code.** Code samples come from this repo.
- **Cite decisions by ID.** Design decisions are referred to by their public
  `D-NN` ID from [`docs/design/design-decisions.md`](../design/design-decisions.md),
  for example "D-04".
- **Images are our own work and have alt text.** Every image has alt text that
  describes what it shows.

## MDX safety

The blog renders posts as MDX, not plain Markdown. Some ordinary Markdown text
breaks an MDX page at render time, so these rules apply everywhere outside
inline code spans and fenced code blocks:

- **No bare `<` followed by a letter.** MDX reads it as the start of a JSX tag.
  A generic type like `Traced<T>` has to go in backticks, or be written with
  entities as `Traced&lt;T&gt;`. This comes up a lot in this project.
- **No bare `{` or `}`.** MDX reads braces as JavaScript expressions. Put them
  in backticks.
- **No HTML comments in the published output.** MDX doesn't accept
  `<!-- ... -->`. Comments are fine in the repo file because the publish
  transform strips them, but remember the repo is public, so they follow the
  content rules too.
- **No H1 in the body.** The blog renders `title` as the page's H1, so sections
  start at `##`.
