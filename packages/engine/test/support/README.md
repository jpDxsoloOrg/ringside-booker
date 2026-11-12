# Test support

Shared fixtures for building valid worlds in tests. The engine's tests import them by relative
path; tests in `tools/*` and `apps/web` import them from `@ringside/engine/testing`. Lint keeps
that entry out of app and engine source, so none of this ever ships.

`@ringside/engine/testing` also exports the assertion helpers, which import `expect` from Vitest
and so only load inside a Vitest run. A tool that builds fixture worlds from a plain Node process,
such as the headless runner, imports `@ringside/engine/testing/fixtures` instead: the same
fixtures without the assertions (`fixtures.ts`). The lint ban covers both entries.

## Entity builders

One builder per entity, in `builders/` (one file per area):

| File            | Builders                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `people.ts`     | `aPerson`                                                                                                                     |
| `promotions.ts` | `aPromotion`, `aBrand`, `anEmployment`, `aTeam`, `aStable`, `aRelationship`                                                   |
| `creative.ts`   | `aTitle`, `aTitleReign`, `anEventDefinition`, `anEventInstance`, `aMatch`, `anAngle`, `aParticipant`, `aStoryline`, `aSeason` |
| `geography.ts`  | `aContinent`, `aCountry`, `aRegion`, `aVenue`                                                                                 |
| `media.ts`      | `aNetwork`, `aDeal`                                                                                                           |
| `inbox.ts`      | `aMail`, `aNews`                                                                                                              |
| `ledger.ts`     | `aLedgerEntry`                                                                                                                |

```ts
const veteran = aPerson({ birthDate: parseGameDate('1980-03-01'), attributes: { psychology: 85 } });
const contract = anEmployment({ personId: veteran.id, terms: { exclusive: false } });
```

- Every builder takes a deep partial: nested objects (`attributes`, `condition`, `terms`, ...)
  merge field by field, arrays are replaced whole. A union value with a different `kind` (a
  recurrence, a controller, an outcome) replaces the default whole, so give it in full.
- Every builder returns a row that passes its zod schema. Overrides that break the schema throw,
  listing each issue. To test a rejection, build a valid row and spread the bad field over it.
- Defaults are boring and written at the top of each file: people are 28-year-old active wrestlers
  with every attribute at 50 and condition 100; event definitions are weekly with 6 slots and no
  pre-show; seasons are season 1, active, 91 days from `TEST_START_DATE` (2026-01-05).
- References default to the first row of each kind (`pro_0000000001`, `per_0000000001`, ...), so a
  row built on its own points where a small test world would have its first row.
- `aMatch` and `anAngle` take the next free main-card slot of their instance unless given `slot`
  (or `preShow: true` for the pre-show).

### IDs and names

IDs come from `TestIds`, one `sequentialIdEntropy` counter per entity kind: people are
`per_0000000001`, `per_0000000002`, ..., promotions `pro_0000000001`, ... Any builder accepts an
explicit `id`, and `testId(kind, n)` gives the `n`th ID of a kind. `setup.ts` restarts the
counters before every engine test. Outside the engine, call `resetTestIds()` in a `beforeEach`.

Placeholder names come from a fixed list: `Test Person 001`, `Test Promotion A`, `Test Title 001`.
Never use real names in fixtures.

## WorldBuilder

```ts
const { world, ids } = worldBuilder({ startDate: '2026-01-05' })
  .withGeography('mini')
  .withPromotion({ name: 'Test Promotion A' }, (promotion) =>
    promotion
      .withRoster(8)
      .withTitle({ name: 'Test Heavyweight Title' }, { holder: 0 })
      .withWeeklyShow({ name: 'Test Weekly', weekdays: [4] }),
  )
  .build();

ids.promotions.A; // pro_0000000001
ids.people[0]; // per_0000000001, the first wrestler on A's roster
```

- The world is a real game world (`createWorld(TABLES, ...)`) and every row goes in through one
  transaction with write validation on, so a world the builder returns is one the game could hold.
- Season 1 is created from the start date unless you call `.withoutSeason()`;
  `.withSeasons(n)` creates `n` back-to-back seasons with only the last one active.
- `.withCatalogs(catalogs = TEST_CATALOGS)` puts catalogs on `meta.catalogs`, as a new game
  snapshots them from the packs. `TEST_CATALOGS` is the shipped base catalogs
  (`content/base/catalogs/*.json`) read through the real record schemas, so tests follow the
  shipped data. Without the call a world has `catalogs: {}`.
- `.with(label, (context) => { ... })` runs your own step in the same transaction. Pass
  `context.sequence` to the builders so IDs and names continue the world's sequence, and use
  `context.insert(table, row)` so the IDs land in `ids`.
- Every `build()` returns an identical, independent world. Later `tx.create` calls continue the
  same ID counters.

## Canned worlds

- `emptyWorld()`: metadata only.
- `tinyWorld()`: two promotions (one run by `player-1`, one by the computer) and at least one row
  in every table, with `TEST_CATALOGS`; see its doc comment in `worlds.ts` for the exact contents.
- `rosterWorld(n)`: one promotion with `n` wrestlers, with `TEST_CATALOGS`, for performance and
  save-size tests.

## Saves

- `tinySaveDocument()`: a v1 save of `tinyWorld()`, saved by promotion A's controller at
  `TEST_SAVED_AT`, with `PLACEHOLDER_SIM_STATE` for the simulation parts.
- `testSaveDocument(world, overrides)`: the same for any world, with no header promotion unless
  given one.
- `gzipJson(value)` (in `gzip-json.ts`, Node only and not exported from the testing entry): packs
  any value the way an `.rbsave` is packed, without the encoder's checks, so a test can hand the
  loader a document the encoder would refuse.
- `measureAgainstReference(run)` (in `cpu-budget.ts`, Node only and not exported from the testing
  entry): times `run` in CPU time against a fixed plain-JavaScript workload measured just before
  and after it, so a speed guard can bound the ratio, which holds on a busy machine where a fixed
  number of milliseconds does not.

## Assertions

- `expectValidWorld(world)` parses every row with its schema and runs `checkWorld`; on failure it
  prints the first 10 issues.
- `expectChange(txResult, { table, inserted, updated, deleted })` checks a committed transaction
  changed exactly those rows.

## Rules

- **Never use randomness in fixtures**, not even seeded. Fixture changes should show up in diffs,
  and the RNG's stream layout may change. Vary values with fixed arithmetic instead, as
  `rosterWorld` does.
- Build through the builders and `WorldBuilder`, not by hand-writing rows, so fixtures follow the
  schemas when they change.

## Golden files

`test/fixtures/golden.test.ts` compares `tinyWorld()` with `test/fixtures/worlds/tiny-world.json`,
and `tinySaveDocument()` with `test/fixtures/saves/v1-tiny.json`. When a schema or builder change
alters them on purpose, regenerate the files and review the diff:

```sh
npm run fixtures:write -w @ringside/engine
```
