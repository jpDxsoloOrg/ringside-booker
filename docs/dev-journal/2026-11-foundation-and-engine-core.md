---
title: 'Milestone 1: foundation and engine core'
date: 2026-11-08
epics: [FND, SIM, BLOG]
milestone: 'Foundation and engine core'
tickets:
  [
    BLOG-01,
    BLOG-02,
    BLOG-03,
    BLOG-04,
    BLOG-05,
    BLOG-06,
    BLOG-07,
    BLOG-08,
    BLOG-09,
    BLOG-10,
    BLOG-12,
    FND-01,
    FND-02,
    FND-03,
    FND-04,
    FND-05,
    FND-06,
    FND-07,
    FND-08,
    FND-09,
    FND-10,
    FND-11,
    FND-12,
    FND-13,
    FND-14,
    SIM-01,
    SIM-02,
    SIM-03,
    SIM-04,
    SIM-05,
    SIM-06,
    SIM-07,
    SIM-08,
    SIM-09,
    SIM-10,
    SIM-11,
    SIM-12,
    SIM-13,
  ]
blogCandidates: ['Foundations: one World, deterministic days, numbers that explain themselves']
---

# Milestone 1: foundation and engine core

## Summary

The first milestone is done: the Foundation and Simulation core epics are both closed, and the
tooling that turns this journal into a blog series has published its first post. Together they
give the game one World of typed tables with a single write path, saves that continue exactly
where they left off, and a day loop that is deterministic, isolates failures step by step, and
explains every number it produces. This entry is the cross-epic view. The per-epic detail lives in
the [Foundation entry](2026-11-foundation.md) and the [Simulation core entry](2026-11-sim-core.md),
and I don't repeat their decision blocks here. What's new in this entry is the end-to-end numbers,
the two foundation calls neither entry wrote up, and the blog tooling, which has no closing entry
of its own.

## What I built

- **FND-01 to FND-14: Foundation.** The monorepo, the lint guard rails, value types, the World
  store, transactions, every entity schema the game needs so far, test fixtures, the save format
  and browser save slots. Written up in the [Foundation entry](2026-11-foundation.md) (FND-13).
- **SIM-01 to SIM-12: Simulation core.** Named RNG streams, odds helpers, cadences, tunables,
  traces and the trace store, the event bus, the day pipeline, multi-day advance, the engine API,
  the fatigue reference system and the headless runner. Written up in the
  [Simulation core entry](2026-11-sim-core.md) (SIM-13).
- **BLOG-01: Journal conventions.** The entry template, the ten sections, the inbox and the
  cadence. `docs/dev-journal/README.md`, `docs/dev-journal/_template.md`,
  `docs/dev-journal/_inbox.md`
- **BLOG-02: The kickoff entry.** The baseline every later entry is measured against: the
  architecture calls, D-01 to D-10 and the four open questions.
  `docs/dev-journal/2026-11-project-kickoff.md`
- **BLOG-03: The series format.** The series index, the post frontmatter, the status lifecycle and
  the post template. `docs/blog/README.md`, `docs/blog/_template.md`
- **BLOG-04: The blog tools workspace.** The frontmatter schema, the post loader and the transform
  that turns a repo post into blog content (relative links made absolute, comments stripped).
  `tools/blog/src/frontmatter.ts`, `tools/blog/src/load.ts`, `tools/blog/src/transform.ts`
- **BLOG-05: The checker.** `npm run blog:check`: frontmatter, file names, MDX compilation, both
  banned-terms lists, private references, links, alt text, the series index and the journal
  rules, run on every pull request. `tools/blog/src/check/`, `.github/workflows/ci.yml`
- **BLOG-06: The publisher.** `npm run blog:publish` upserts a post into the blog's database by
  slug inside one transaction, after a schema preflight, and writes `publishedAt` back on the
  first live publish. `tools/blog/src/publish/`
- **BLOG-07: Series navigation.** The header and footer every published part gets, the series
  index post built from the blog README, and `--all` and `--index-only`. `tools/blog/src/series.ts`,
  `tools/blog/src/indexPost.ts`
- **BLOG-08 and BLOG-09: Part 1.** The outline, then the post and its loop diagram, published on
  2026-11-08. `docs/blog/01-why-im-building-a-wrestling-booking-sim.md`,
  `docs/blog/images/01/loop.svg`
- **BLOG-10: Journal tooling.** `journal:new` scaffolds an entry from the commits and the inbox,
  `journal:due` says which epics owe one, and the epic exit checklist gives every epic a closing
  ticket. `tools/blog/src/journal/`, `docs/dev-journal/epic-exit-checklist.md`
- **BLOG-12: Everyday words in the real-name check.** One-word names that are also ordinary words
  carry a `[case]` flag in the list, and the blog checker and the world validator share one
  matcher. `tools/validate-world/src/realNameMatcher.ts`, `content/blocklist/real-names.txt`
- **This entry and part 2.** The milestone entry and blog part 2,
  `docs/blog/02-foundations.md`.

## Decisions and why

### Where each foundation call is written up

The ticket for this entry asked me to check that the two epic entries cover the foundation calls
between them, and to say which kickoff call or open question each one settled. Two were missing
as decision blocks, the person attribute set and the save versioning policy, so they get blocks
below. Everything else stays where it was written.

| Topic                              | Written up in                                                                                                                                                                                        | What it settled from the [kickoff](2026-11-project-kickoff.md)                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person attribute set               | [Below](#twelve-attributes-each-with-a-reader)                                                                                                                                                       | The default "cosmetic stats get wired or dropped" from `design-decisions.md`, applied to people                                                                                                                         |
| Transactions and the undo journal  | [Foundation](2026-11-foundation.md#an-undo-journal-and-only-synchronous-transactions)                                                                                                                | "One World store, typed tables, undo journal" held; transactions also became synchronous                                                                                                                                |
| Controllers and commands (D-07)    | [Foundation](2026-11-foundation.md#controllers-on-promotion-and-brand-rows-d-07), [Simulation core](2026-11-sim-core.md#controllers-viewers-and-the-command-log-before-multiplayer-exists-d-07)      | D-07 and "Controllers, commands and a viewer on every query" held as written                                                                                                                                            |
| Save format with named state parts | [Foundation](2026-11-foundation.md#save-state-parts-are-injected-not-imported), [Simulation core](2026-11-sim-core.md#save-state-parts-registered-by-the-engine-api-not-imported-by-the-save-format) | "IndexedDB saves with `.rbsave` export" held, with six named parts                                                                                                                                                      |
| ID generation from the seeded RNG  | [Foundation](2026-11-foundation.md#an-installable-id-factory-not-an-imported-rng), [Simulation core](2026-11-sim-core.md#named-rng-streams-and-one-stream-per-id-prefix)                             | "Branded IDs" held; the change is how: an installed factory with a stream per ID prefix                                                                                                                                 |
| Named RNG streams                  | [Simulation core](2026-11-sim-core.md#named-rng-streams-and-one-stream-per-id-prefix)                                                                                                                | "Seeded RNG with named streams" held, and its revisit signal (stream state bloating saves) is answered by saving only touched streams                                                                                   |
| Tunables, "0 means 0"              | [Simulation core](2026-11-sim-core.md#0-means-0-for-tunables)                                                                                                                                        | "Tunables registry where 0 means 0" held                                                                                                                                                                                |
| `Traced<T>` and trace summaries    | [Simulation core](2026-11-sim-core.md#every-result-carries-its-trace-and-old-traces-become-summaries)                                                                                                | "`Traced<T>` on every formula" held. The open question "How much trace history a save keeps" is half settled: the shape is fixed (200 full traces per kind, 5,000 summaries), the numbers wait on multi-year save sizes |
| Pipeline error isolation           | [Simulation core](2026-11-sim-core.md#one-transaction-one-rng-snapshot-and-one-staging-per-step)                                                                                                     | "Phase pipeline with per-step rollback" held, and rollback grew to cover the RNG, events and traces                                                                                                                     |
| Save versioning and migrations     | [Foundation](2026-11-foundation.md#migrations-work-on-raw-json) and [below](#save-format-v1-stays-unfrozen-until-the-first-public-build)                                                             | The "tested migrations" half of "IndexedDB saves with `.rbsave` export"                                                                                                                                                 |

The open question "How big the default world is" isn't settled yet. The headless runner it was
waiting for exists now, so it gets answered when the default world's people land.

### Twelve attributes, each with a reader

- **Decision:** A person has twelve attributes from 0 to 100 in three groups: in-ring (ringwork,
  psychology, stamina, safety, athleticism), character (mic, charisma, presence) and crew
  (officiating, broadcasting, producing, booking). Each one names the system that will read it in
  [`data-model.md`](../design/data-model.md#attributes). Popularity is not an attribute: it is
  sparse and per region (D-03).
- **Alternatives:** A long list of fine-grained ratings; a handful of broad ones; separate rating
  sets for wrestlers and for staff.
- **Why:** A rating nothing reads teaches the player to care about the wrong number, which is the
  "wired or dropped" default applied to people. One set for everyone keeps one schema, and a
  referee who can't wrestle simply has low in-ring numbers. Adding an attribute later is a cheap
  schema change; taking one away after saves and packs use it is not, so I started small.
- **Revisit if:** The match rating epic needs a distinction that two of these can't express
  together.

### Save format v1 stays unfrozen until the first public build

- **Decision:** `formatVersion` is one whole number. Until the first public build is tagged,
  schema changes edit v1 in place and regenerate the golden fixture. From that build on, every
  schema change bumps the version and ships a migration and a fixture.
- **Alternatives:** A migration for every schema tweak from day one; no version field until it's
  needed.
- **Why:** Nobody has a save worth keeping yet, and a migration per tweak would bury the real ones
  in noise. The version field, the migration chain and its tests all exist already, so the first
  real migration is routine instead of a rescue.
- **Revisit if:** Anyone outside my machine starts keeping saves before the first tagged build.

### Lower layers expose slots, higher layers fill them

- **Decision:** Where Foundation code needed something Simulation core owns, the Foundation side
  takes it as a parameter instead of importing it: the World gets its ID factory installed, and
  the save format takes each state part's schema from the engine API.
- **Alternatives:** Let the model import the RNG and the simulation schemas, and live with the
  cycle; merge the two epics into one.
- **Why:** The simulation builds on the model, so an import the other way is a cycle. With slots
  the two epics could be built side by side, tests can install a counter instead of an RNG, and the
  one file that wires everything together (`core/api/saveParts.ts`) is easy to find.
- **Revisit if:** The number of injected pieces grows to the point where wiring a test world takes
  more setup than the test.

### Blog: publish by writing to the blog's database, upserting by slug

- **Decision:** `blog:publish` connects to the blog's Postgres directly with `pg` and upserts the
  post by slug in one transaction. It checks the schema first, writes nothing when nothing
  changed, and never touches the author, `createdAt` or an existing `publishedAt`.
- **Alternatives:** The blog's admin HTTP API; its ORM; pasting posts into the admin editor.
- **Why:** The blog's create endpoint derives the slug from the title, has no update by slug and
  needs a browser session, so using it would have meant changing the blog first. Generating its
  ORM client here would tie this repo to another codebase's build. Plain SQL against a checked
  schema touches four tables, and it's easy to test with a fake database. The connection string
  lives only in a gitignored local file, and the command refuses to run in CI, so publishing stays
  a deliberate local act. The slug is the post's permanent identity, so it's the natural key, and refusing
  a slug change it can detect protects every link to a post.
- **Revisit if:** The blog's schema changes often enough that the preflight keeps stopping
  publishes.

### Blog: series navigation is generated, not written

- **Decision:** The publisher adds the "Part N" header and the previous and next footer to every
  post it builds, linking only `final` parts, and builds the series index post from the blog
  README. `--all` republishes the whole series in one go.
- **Alternatives:** Writing the links into each post by hand; teaching the blog's templates about
  series.
- **Why:** Hand-written links go stale the moment a new part goes up. The blog is shared with other
  writing, so the series logic belongs in this repo, not in its templates.
- **Revisit if:** The blog grows real series support of its own.

### Blog: images come from the public repo's raw URL

- **Decision:** Post images live in `docs/blog/images/NN/` and are linked from the public repo's
  raw URL on `main`. Nothing is uploaded to the blog.
- **Alternatives:** Uploading images to the blog's storage on publish.
- **Why:** No upload step and no second copy to keep in sync, and the image is versioned with the
  post. The cost is that an image only resolves after it is merged, so a draft pushed from a branch
  shows a broken image until then.
- **Revisit if:** Raw URLs get slow or rate limited for readers.

### Blog: two banned-terms lists

- **Decision:** The checker reads two lists: the committed real-name blocklist the world validator
  also uses, and a private list that lives outside the repo (a local file, or a CI secret). The
  publisher refuses to run without the private list, and the output masks every match.
- **Alternatives:** One committed list; one private list for everything.
- **Why:** Real wrestler and promotion names are safe to commit, and sharing them with the world
  validator means the game data and the writing follow one rule. Some terms must never appear in
  the public repo at all, not even inside a blocklist, so they can't share a file with it.
- **Revisit if:** The private list grows to need the same everyday-word handling as the real-name
  list. It already reads the `[case]` flag, so that should only take an entry.

### One milestone post instead of two

- **Decision:** Part 2 covers both epics at once instead of one post each.
- **Alternatives:** A Foundation post and a Simulation core post.
- **Why:** On its own, "save files and IDs" is thin. Together with the engine core it tells one
  story: how the game stays deterministic and explainable. The deep dives on streams and traces
  stay planned as parts 3 and 4.
- **Revisit if:** Part 2 runs long enough that it needs splitting anyway.

## How this differs from other games in the genre

- The whole game state is one set of tables that point at each other by ID. Renaming a wrestler,
  a town or a promotion can't break anything, and the save is that same set of tables written out.
- A day is a list of steps, each with its own transaction, and a bug in one step costs that step,
  not the day, the save or the session.
- The same save and seed play the same year on two different machines, down to a matching world
  hash, so a bug report can be a seed and a command.
- Every number carries the working that produced it, built while the maths runs, and the screen
  that shows it reads that working instead of a separate explanation.
- The development notes and the blog come from the same repo, checked by the same tools, and both
  are public.

## Numbers

All measured on 2026-11-08 on my machine (Intel i5-13600KF, Node 20.20.1, WSL2), on `main` at
`4aeab06`, which includes the World generation and UI work merged since the epic entries.

- **Engine tests:** 1,759 tests in 78 files, from `npx vitest run --project engine`. The runner
  adds 34 tests (`--project sim-runner`) and the blog tools 224, plus 4 skipped integration tests
  that only run against a local Postgres (`--project blog-tools`).
- **Coverage:** 95.7% of lines and 91.6% of branches across the engine, from
  `npx vitest run --project engine --coverage`.
- **Headless runner speed:** `npm run sim -- --days 365` on the runner's default fixture world
  (300 people, seed 1), three runs: 77 to 78 ms of advance time, 4,710 to 4,759 days per second,
  0.73 to 0.85 s for the whole command timed with `/usr/bin/time`. Every run ended on world hash
  `6d2224a84ca62573`, the same hash the [Simulation core entry](2026-11-sim-core.md#numbers)
  recorded, with more World generation work and the UI shell merged since.
- **Save size:** the same fixture world as a complete save (header, World and all six state parts,
  gzipped) is 24,908 bytes at the start (470,804 bytes of JSON) and 34,513 bytes after 365 days
  (797,321 bytes of JSON). The growth is the event log, the stored traces and the touched RNG
  streams. Measured with a throwaway script that ran the fixture through `createSaveDocument` and
  `encodeSave`; the script isn't committed.
- **Tunables registered:** 49 keys in `ALL_TUNABLES`: 6 `sim.*`, 2 `condition.*` and 41
  `worldgen.*`, counted from the registry's keys.
- **Blog:** one part and the series index post published before this entry.

## What went wrong or surprised me

- **The numbers dated within a day.** The Simulation core entry counted 1,715 engine tests; by the
  time I wrote this one, World generation work had added 44 more. Every figure in part 2 now carries its
  date and machine.
- **The real-name check flagged everyday words.** Some one-word names on the real-name list are
  also ordinary words, so the checker flagged harmless sentences, part 1 included, and I reworded a
  phrase before I understood the problem. BLOG-12 added the `[case]` flag and moved the matcher
  into one module the world validator and the blog checker share.
- **The first publish waited on local setup.** Part 1 was written and checked before the publish
  credentials and the private list existed on my machine, which is easy to forget until publish
  day.
- **The milestone ticket expected two missing blocks.** Checking the two epic entries against the
  list of foundation calls found the attribute set and the versioning policy only in the design
  docs, never argued for in the journal.
- **Better than expected:** the year-long runner hash didn't move when World generation and the UI
  shell landed on `main`. The new code adds tunables, schemas and screens, but nothing it added
  changed what the fixture world does in a year, which is exactly what named streams are for.

## Open questions

- **When to freeze save format v1.** Still the first tagged public build, and I haven't picked
  which build that is.
- **Trace retention numbers.** 200 full traces per kind and 5,000 summaries are guesses until a
  multi-year run with real systems shows what they cost in a save.
- **How big the default world is.** The runner can time it now; the answer waits on the default
  world's people.
- **Whether parts 3 and 4 still earn a post each.** Part 2 introduces named streams and traces.
  The deep dives should go further (the world hash, the replay check, the Why? panel in a real
  screen) or fold into later parts.

## Blog angle

This entry, the [Foundation entry](2026-11-foundation.md) and the
[Simulation core entry](2026-11-sim-core.md) feed part 2, "Foundations: one World, deterministic
days, numbers that explain themselves", for readers who program but haven't built a sim. Part 1
promised that every number explains itself; part 2 shows the plumbing: one World of tables, a day
as a list of transactions, named random streams, and `Traced<T>` with a real trace tree.

The blog tooling itself (a checker that knows MDX's traps, publishing by slug, generated series
navigation) could be a short post for people who blog from a repo, but it isn't on the plan.

## Raw notes

- 2026-11-08 [BLOG-09] Wrote part 1 from its outline. The "check at writing time" list earned its
  place: the Why? panel, the worker host, IndexedDB saves and the level playing field switch still
  don't exist, so the post describes them as plans. The first real publish waits on local setup
  (`tools/blog/.env.local` and the private banned-terms list), which is easy to forget until
  publish day. The blog shows remote `.svg` images as-is, so the raw GitHub URL for the loop
  diagram works without touching the blog's config.

## Next

- **WLD** finishes the fictional world: geography, names, the default promotions and their
  people, and the new-game command. Part 5 is drawn from its closing entry.
- **UI** finishes the shell, the save screens and the first screens that show explained numbers.
- **Blog:** parts 3 and 4 stay planned until their entries give them more than part 2 already
  says.
