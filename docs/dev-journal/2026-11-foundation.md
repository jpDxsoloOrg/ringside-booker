---
title: 'Foundation: repo, data model and persistence'
date: 2026-11-08
epics: [FND]
milestone: ''
tickets:
  [
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
    FND-14,
  ]
blogCandidates: ['One World, one write path', 'Saves that pick up exactly where they left off']
---

# Foundation: repo, data model and persistence

## Summary

The Foundation epic is done. The repo is a workspaces monorepo with lint rules that enforce the
engine's rules, and CI runs every check on every pull request. The engine has one in-memory World
of typed tables, a transaction layer with an undo journal, and the schemas for every entity the
game needs so far: people, promotions and contracts, titles and shows, seasons, geography, media
and the money ledger. A save is a versioned, gzipped JSON document that loads through staged
checks and continues exactly like the world that wrote it, and the browser keeps saves in
IndexedDB slots with an autosave, three backups and `.rbsave` export and import. No game system
runs on any of this yet; that starts with SIM and WLD.

## What I built

- **FND-01: The monorepo.** npm workspaces for `packages/engine`, `apps/web` and one workspace per
  tool under `tools/`, a strict shared `tsconfig.base.json`, Prettier, and one root
  `vitest.config.ts` that runs every workspace as its own project. The engine exports its source
  directly, with no build step. `package.json`, `tsconfig.base.json`, `vitest.config.ts`,
  `README.md`
- **FND-02: Lint guard rails and CI.** An ESLint flat config that fails on `any`, `Math.random`,
  wall-clock reads, timers and DOM or app imports inside the engine, with a self-test that lints
  sample code to prove each rule still fires. A GitHub Actions `check` job runs format, lint,
  typecheck, tests and build on every pull request. `eslint.config.js`,
  `packages/engine/test/lint-guards.test.ts`, `.github/workflows/ci.yml`, `.github/dependabot.yml`
- **FND-03: Value types.** Branded IDs with short prefixes and an ID factory, `GameDate` as an ISO
  date string with timezone-free calendar maths, integer-cent `Cents` with one rounding helper,
  `ContentKey`, and the zod primitives the schemas build on. `packages/engine/src/core/ids.ts`,
  `core/date.ts`, `core/money.ts`, `core/content-key.ts`, `core/errors.ts`, `model/primitives.ts`
- **FND-04: The World store.** One typed table per entity kind, world metadata (dates, seed,
  players, packs and settings), declared secondary indexes, canonical ID ordering, and a generic
  reference and invariant checker driven by a table registry. `packages/engine/src/model/world.ts`,
  `model/table.ts`, `model/table-def.ts`, `model/world-meta.ts`, `model/integrity.ts`,
  `model/ref-path.ts`
- **FND-05: Transactions.** The only write path: a synchronous `Tx` that journals every insert,
  update, delete and metadata change, rolls back exactly, supports savepoints, refuses edits to
  append-only tables and returns a change set. `packages/engine/src/model/tx.ts`
- **FND-06: People.** The person schema: identity, roles, body, twelve core attributes in three
  groups, condition, hidden development fields, sparse regional popularity and a closed trait list
  with exclusive pairs. `packages/engine/src/model/entities/`, `docs/design/data-model.md#people`
- **FND-07: Promotions and employment.** Promotions and brands with controllers, contracts as
  `Employment` rows with an explicit lifecycle, and teams, stables and relationships.
  `packages/engine/src/model/controller.ts`, `model/entities/`,
  `docs/design/data-model.md#promotions-and-employment`
- **FND-08: Titles, shows, storylines and seasons.** Titles and reigns, event definitions with
  recurrence rules and slot-based show formats, event instances, segments as a match-or-angle
  union, participants, storylines and seasons. `packages/engine/src/model/recurrence.ts`,
  `model/entities/`, `docs/design/data-model.md#titles-events-storylines-and-seasons`
- **FND-09: Geography, media, mail, news and the ledger.** Continents, countries and regions by ID
  at every level, venues, networks and TV deals, templated mail and news, and an append-only,
  signed money ledger. `packages/engine/src/model/entities/`,
  `docs/design/data-model.md#geography-media-mail-news-and-ledger`
- **FND-10: Test fixtures.** One builder per entity, a fluent `WorldBuilder`, the canned worlds
  `emptyWorld`, `tinyWorld` and `rosterWorld(n)`, and a golden snapshot of `tinyWorld`, exported as
  `@ringside/engine/testing` and kept out of shipped code by lint. `packages/engine/test/support/`,
  `packages/engine/test/fixtures/`
- **FND-11: The save format.** The save document, a gzip codec with canonical key order, a
  migration chain on raw JSON, a staged load pipeline that returns a report instead of throwing,
  and a size and speed smoke test. `packages/engine/src/persistence/`,
  `docs/design/save-format.md`
- **FND-12: Browser saves.** IndexedDB save slots through `idb`, an autosave policy, three rotating
  backups written in the same transaction as the save, persistent-storage requests, and `.rbsave`
  export and import. `apps/web/src/storage/`
- **FND-14: Hardening.** Closed the remaining `Math.random` lint bypasses, gave the odds helpers
  their own engine error type, and stopped Dependabot proposing toolchain majors.
  `eslint.config.js`, `packages/engine/src/core/rng/`, `.github/dependabot.yml`

## Decisions and why

### IDs, never names, and the reference rule

- **Decision:** Every reference is a branded ID. Facts about a person (reigns, teams, stables,
  relationships, match participants, owner and booker) point at the `PersonId`. Facts that only
  exist because someone is employed (ring name, push, alignment, morale, momentum, brand, manager)
  live on the `Employment` row.
- **Alternatives:** Names as keys; pointing everything at the contract; leaving each table to
  choose.
- **Why:** Names change and collide, and a mix of person and contract references means every
  system has to guess which one it holds. With one rule, a reign survives a release and a ring
  name dies with the contract, which is what should happen.
- **Revisit if:** A fact turns up that belongs to neither, such as a gimmick that follows a
  wrestler from company to company.

### Tables iterate in ID order

- **Decision:** Tables iterate in ascending ID order, not insertion order, with a sorted cache.
- **Alternatives:** Insertion order, which is what `Map` gives for free.
- **Why:** With insertion order, a world that was saved and reloaded could iterate differently from
  one that kept running, and rolling back a delete would move the row to the end. ID order makes
  iteration a pure function of the table's contents, which determinism needs.
- **Revisit if:** Sorting shows up in profiles of long skips.

### An undo journal, and only synchronous transactions

- **Decision:** A transaction records the "before" image of each row it touches and replays those
  backwards on failure. Transactions are synchronous; nothing inside one can await.
- **Alternatives:** Copy-on-write snapshots of the World per pipeline step; async transactions.
- **Why:** A day touches a small part of the world, and rollback is rare. Recording only what
  changed is far cheaper than copying thousands of rows per step. The journal only works if no
  other write slips in between an operation and its undo, and the engine never needs to wait on
  I/O, so synchronous costs nothing.
- **Revisit if:** A step needs real I/O, or the journal shows up as a hot spot in long skips.

### An installable ID factory, not an imported RNG

- **Decision:** The World gets its ID factory installed from outside. IDs are random bodies drawn
  from whatever entropy the factory was built with: per-kind seeded streams in the game, a counter
  in tests.
- **Alternatives:** Import the seeded RNG into the model; per-table counters.
- **Why:** The RNG lives in the simulation core, which depends on the model, so importing it would
  be a cycle. Installing it keeps one `tx.create` path for tests, the data-pack loader and save
  loads. Random bodies also stop anyone reading "created earlier" into ID order.
- **Revisit if:** Content packs need stable, human-chosen IDs.

### Integer cents and ISO date strings

- **Decision:** Money is integer cents, with all rounding in one helper. Game dates are ISO
  `YYYY-MM-DD` strings, converted to day numbers only inside the date maths.
- **Alternatives:** Floating-point money; dates as `Date` objects or integer day numbers.
- **Why:** Float money drifts over decades of daily wages, and drift breaks "same run, same
  result" across machines. ISO strings are readable in a save, sort correctly as text and are easy
  to validate, and with no timezone involved a date can't shift by a day on someone's phone.
- **Revisit if:** Date parsing shows up in profiles of long skips.

### Contracts have an explicit lifecycle

- **Decision:** An `Employment` is created as `offered` and moves through `signed` and `active` to
  one of five end states. A transitions table says which moves are legal, and a world invariant
  checks that the stored state is one the calendar could have reached.
- **Alternatives:** A contract row that exists only while it is active; a couple of booleans.
- **Why:** An offer is not a contract. If the two look the same, a wrestler with a pending offer
  can end up paid by two companies. Separate states mean systems have to move between them on
  purpose.
- **Revisit if:** Negotiation needs states in between, such as a counter-offer.

### Controllers on promotion and brand rows (D-07)

- **Decision:** Every promotion and brand has a `controller`: a human player by ID, or the
  computer. There is no "the player's promotion" field anywhere.
- **Alternatives:** One player promotion ID in world metadata, and retrofit multiplayer later.
- **Why:** D-07 says nothing may assume one player. Single-player, booking several brands yourself
  and online play are all the same data shape this way, and queries ask "what does this viewer
  run" instead.
- **Revisit if:** A single-player screen gets awkward because it has to look its promotion up.

### Show formats are slots, and no minutes are stored (D-10)

- **Decision:** A show format fixes how many main-card and pre-show slots a card has. A segment
  stores only its slot and section. Its role and duration class are derived from the position, the
  section and the match type.
- **Alternatives:** A length on every segment; a stored role next to the slot.
- **Why:** D-10. A stored role would disagree with the card order the moment a segment moved, and
  keeping position as the single source of truth lets later epics retune what each slot means
  without a migration. The format range is wider than the defaults, so a bonus slot can come later
  without a schema change.
- **Revisit if:** A stipulation needs finer control than a duration class.

### Seasons as rows, with the length as a setting (D-08)

- **Decision:** Seasons are world-wide rows (number, start, end, active or completed) found through
  a unique `activeSeason` index. The length is a world setting in days, from 28 to 730, and a
  change applies from the next season.
- **Alternatives:** A season counter in world metadata; a fixed year.
- **Why:** D-08 asks for configurable lengths, and history screens, brand-war standings and season
  recaps all need past seasons as records they can query. An index means there is no "current
  season" field to drift out of sync.
- **Revisit if:** Brands need seasons of their own.

### The level-playing-field flag (D-01)

- **Decision:** `levelPlayingField` is a world setting from day one, even though nothing reads it
  yet. When it's true, every shortcut computer-run promotions take is off.
- **Alternatives:** Adding it when the first shortcut lands.
- **Why:** D-01 promises that computer shortcuts are visible and can be switched off. Putting the
  switch in the settings now means each shortcut is built against it rather than retrofitted.
- **Revisit if:** Skips are fast enough with no shortcuts at all, and the flag has nothing to do.

### Save state parts are injected, not imported

- **Decision:** The save document has named slots for the simulation parts (RNG state, tunable
  overrides, traces, events, the failure log, the command log). Their schemas are passed in by the
  engine state that owns them; a slot without a schema accepts any plain JSON.
- **Alternatives:** The save format imports the simulation's schemas directly.
- **Why:** The simulation core builds on the save format, so importing its schemas would be a
  cycle. Named slots let both epics move at once, and tightening a slot is free while format v1 is
  unfrozen.
- **Revisit if:** The slots outgrow a flat list.

### Migrations work on raw JSON

- **Decision:** Each migration takes the previous version's document as plain JSON and returns the
  next one. They form one contiguous chain, checked when the module loads, and each step runs
  exactly once.
- **Alternatives:** Migrations written against the current TypeScript types.
- **Why:** A migration from v3 to v4 has to keep working after v5 changes the types again.
  Migrations that import live types rot.
- **Revisit if:** A migration needs logic that is painful without types. Then it gets a frozen copy
  of the old type, not the live one.

### The engine owns gzip

- **Decision:** The engine encodes and decodes saves, gzip included, with `CompressionStream`.
  Browser storage only keeps bytes.
- **Alternatives:** Compress in the storage layer; store plain JSON.
- **Why:** `.rbsave` files have to be readable by headless tools in Node as well as in the browser,
  and the same stream API exists in both. One codec, and storage stays a dumb byte store.
- **Revisit if:** A target platform lacks `CompressionStream`.

### Three backups, and import never overwrites

- **Decision:** Each slot keeps its current save, an autosave and three rotating backups, all
  written in one IndexedDB transaction. Importing a file always creates a new slot.
- **Alternatives:** One backup; letting import replace a slot.
- **Why:** A bad day (a bug, releasing a star by accident) is usually noticed within a few
  in-game weeks, and a monthly backup covers that. Backups are complete copies written with the
  save, so they are always loadable. Importing onto an existing slot is the easiest way to destroy
  a game by mistake.
- **Revisit if:** Saves get big enough that five copies per slot hit storage quotas on phones.

## How this differs from other games in the genre

- Every reference in the data is an ID, all the way down to regions, so renaming a wrestler, a
  town or a promotion can't break anything that points at it.
- A contract offer is a different thing from a contract, so nobody gets paid by two companies.
- Cards are slots in an order, not minutes, and nothing about a segment's role is stored where it
  could disagree with the card.
- Nothing in the data assumes there is one player.
- A save loads through staged checks and says exactly what is wrong with it, field by field,
  instead of crashing or loading half a world.
- Backups are written with the save, so a backup is never older or broken in a way the save isn't.

## Numbers

- **Engine tests:** 1,508 tests in 63 files, from `npx vitest run --project engine` on main at
  `fbed0b4`. That count covers the whole engine package, including SIM's work so far. Counting the
  folders this epic owns (the ID, date and money tests, `model/`, `persistence/` without the
  data-pack tests, the builders, the golden fixture and the lint guards) from the JSON reporter
  gives about 790. The web storage layer adds 46 tests in `apps/web/src/storage`.
- **Coverage:** 94.9% of lines and 91.5% of branches across `packages/engine/src`, from
  `vitest run --project engine --coverage`. Grouped by folder from the JSON summary: `model/` is at
  98.6% of lines and 95.0% of branches, `persistence/` without the data-pack loader at 93.9% and
  88.2%.
- **Save size:** `tinyWorld()` encodes to 4,080 bytes gzipped (38,609 bytes of JSON before gzip),
  measured with a throwaway test that called `encodeSave` on its test save document.
  `rosterWorld(300)` with 5,000 ledger entries encodes to 100,768 bytes, about 98 KB, from the log
  line of the FND-11 size test (`packages/engine/test/persistence/size.test.ts`). The test's limit
  is 2 MB.
- **Encode and load time:** 39 to 51 ms to encode and 57 to 79 ms to load the 300-wrestler save,
  over four runs of the same size test on my dev machine (Node 20.20.1 under WSL2). The test's
  limit is 1.5 s for both together.
- **CI `check` job:** 49 s on the wave 1 pull request, 2 min 14 s at wave 5, 2 min 30 s at wave 6,
  and between 2 min 26 s and 3 min 5 s on the latest runs, from the job start and end times
  GitHub Actions reports (`gh run view`). The growth isn't all Foundation: the job now also runs
  coverage, the blog and journal check and world validation.

## What went wrong or surprised me

- **Small tooling traps on day one.** Vitest treats every match of a project glob as a config, so
  `tools/*` loaded `tools/README.md` and crashed; the glob now names `tools/*/vitest.config.ts`.
  `tsc -b` refuses a composite project with no source files, so the web app needed one tiny file
  before it had any UI.
- **Writing code before its lint rules existed cost a cleanup.** The value types landed in
  parallel with the lint config, and applying the config afterwards found 27 errors, mostly the
  casts that made branded IDs. The fix routed every brand through a type guard instead, which is
  better anyway.
- **The `Math.random` ban had holes.** `globalThis.Math.random`, a `Math` alias, template-literal
  keys and computed keys all slipped past the first rule. It took two passes to close them, and
  every form now has a lint-guard test. A promise rule also let `await p.then(...)` through until I
  switched it to strict mode.
- **Name clashes between parallel tickets.** The nominal-type helper and the brand entity both
  wanted to be called `Brand`, and show recurrence wanted a `nextOccurrence` that the calendar
  already exported. The helper became `Branded` and the recurrence helpers moved into a
  `recurrence` namespace.
- **Review caught real bugs.** The tiny test world had title reigns starting before the titles
  existed. The reference checker passed a plain string where an ID list was expected, as long as
  the string named a real row. Re-saving a loaded save dropped any `__proto__` key. Each one has a
  regression test now.
- **Load order needed one swap.** Integrity checks read through indexes, so the build stage has to
  run before the integrity stage. The world is still only handed out after integrity passes.
- **Browser corners.** jsdom's `File` has no `arrayBuffer()`, so the storage tests run in Node with
  a fake IndexedDB. `navigator.storage.persist()` doesn't exist in workers, so the persistence
  request has to come from the main thread.
- **Better than expected:** saves are tiny. A 300-wrestler world with 5,000 ledger entries is
  about 98 KB, a twentieth of the budget, and the whole round trip is well under a fifth of a
  second.

## Open questions

- **When to freeze save format v1.** Until the first public build, schema changes edit v1 in place
  and regenerate the golden fixture. I haven't picked the build that freezes it.
- **How the ledger stays small.** A row per wage per worker per day would swamp saves. The plan is
  one wages entry per promotion per pay period, plus maybe a step that folds old months into
  summary rows. The economy epic decides, with the size test watching.
- **Phone storage.** The manual check of export and import on Android Chrome and iOS Safari at
  390px is still open, and I don't know yet how often an unused phone browser evicts saves. The UI
  should nudge phone players to export now and then.
- **Two tabs, one slot.** Two tabs writing the same slot is last writer wins for now. A "slot in
  use" warning across tabs might be worth it later.
- **Regional popularity size.** It is sparse and drops zeros, but a world with many regions may
  need a threshold below which small values are dropped. The geography content will tell.
- **Runtime audit advisories.** Two moderate advisories in the router need its next major version.
  That upgrade probably wants its own ticket.

## Blog angle

This entry feeds part 2, "Foundations: one World, deterministic days, numbers that explain
themselves", together with the SIM entry. For readers who program but haven't built a sim:

- **One World, one write path.** Typed tables, IDs instead of names, the reference rule, and why a
  transaction with an undo journal beats copying the world.
- **Saves that pick up exactly where they left off.** Canonical ordering, raw-JSON migrations,
  staged load reports, and the numbers: under 100 KB for a 300-wrestler world.
- **Data that can't disagree with itself.** No stored current champion, no stored segment role,
  no current-season field; indexes answer those questions instead.

## Raw notes

Nothing this time.

## Next

- **SIM** builds on the store and the save format: SIM-10 wires the RNG, tunables, traces, events
  and logs into the save's named slots and exposes the command and query API, SIM-11 runs the
  first real system through a day, and SIM-12 adds a headless runner that hashes the world to
  prove same seed, same result.
- **WLD** fills the tables: the data-pack loader already writes through `Tx`, and next come the
  geography, the name and worker generators, the default world and the new-game command that sets
  the season length and the level-playing-field flag.
- **UI** moves the engine into a Web Worker (UI-08) and builds the title and save slot screens
  (UI-11) on top of the storage layer, which is where the phone export and import check gets done
  properly.
- **BLOG-11** turns this entry and SIM's into the milestone entry and part 2.
