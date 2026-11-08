# Data model

All game state lives in one `World`: world metadata plus one typed table per
entity kind. This doc is the map of those tables: the conventions every
entity follows, how tables reference each other, and (as the schemas land) one
section per group of entities.

Code: `packages/engine/src/model/`.

## The World store

- **Tables.** Each table is a `Map<Id, Entity>` built from a `TableDef`: the
  table name, the entity kind, the zod schema of a row, the reference fields,
  the secondary indexes, the cross-row invariants, and an `appendOnly` flag for
  tables that only ever grow (the ledger). The production registry is
  `TABLES` in `model/tables.ts`; each key equals its table's name, and no two
  tables share a kind.
- **Metadata.** `WorldMeta` (`model/world-meta.ts`) holds what is not a row:
  the world name, start and current date, the seed, the players, the content
  packs the world was built from (with the IDs minted for their records), the
  number of days simulated, and the settings chosen at new game. The settings
  include the level-playing-field flag (D-01) and the season length in days
  (D-08). There is no "the player's promotion" field: who runs a promotion or a
  brand is the `controller` on its row (D-07), and every human controller's
  `playerId` must be listed in `meta.players`.
- **Reads and writes.** Everyone reads through `WorldView`, a deep read-only
  view whose tables only have read methods. Writes go through a transaction
  (see [Transactions](#transactions)); nothing outside the model layer can
  write to a table without a cast.
- **Rows are plain JSON.** No classes, no `Map` or `Set` inside a row, and no
  `undefined` values (an optional field is left out instead). Rows serialise into a save as they are and
  cross the Web Worker boundary without conversion.

## Conventions

### IDs

Every entity has a branded string ID: a three letter prefix for its kind, an
underscore and a 10 character body in lowercase Crockford base32, for example
`per_3k9x0d7m2q`. IDs come from the seeded RNG, so a replay mints the same
ones. A row's `id` field always equals the key it is stored under.

| Kind              | Prefix | Kind           | Prefix |
| ----------------- | ------ | -------------- | ------ |
| `person`          | `per`  | `stable`       | `stb`  |
| `employment`      | `emp`  | `network`      | `net`  |
| `promotion`       | `pro`  | `deal`         | `dea`  |
| `brand`           | `brd`  | `venue`        | `ven`  |
| `title`           | `tit`  | `continent`    | `ctn`  |
| `titleReign`      | `trn`  | `country`      | `cty`  |
| `eventDefinition` | `evd`  | `region`       | `reg`  |
| `eventInstance`   | `evi`  | `relationship` | `rel`  |
| `segment`         | `seg`  | `mail`         | `mai`  |
| `participant`     | `ptc`  | `news`         | `nws`  |
| `storyline`       | `sty`  | `ledgerEntry`  | `led`  |
| `team`            | `tem`  | `season`       | `sea`  |

The source of truth is `ENTITY_KINDS` in `packages/engine/src/core/ids.ts`.

### Values

- **Dates** are `GameDate` strings (`YYYY-MM-DD`). Never JavaScript `Date`.
- **Money** is `Cents`: a whole number of cents, never a float of dollars.
- **Booleans** are real booleans, not `0`/`1` or `'yes'`/`'no'`.
- **Enums** are string unions backed by a zod enum, so the type and the
  runtime check come from one list.
- **Percent-like values** are 0–100 floats (skills, popularity, morale).
  Shares of money (a revenue split, a commission) are basis points, a whole
  number in 0–10000.
- **Sparse records** omit zero values. `regionalPop: Record<RegionId, number>`
  lists only regions where the popularity is above zero; a missing key reads
  as zero.
- **References** are IDs, never names and never nested copies of another row.

## The reference rule

There are two kinds of "who" in the game: the **person** and their
**employment** with a promotion. One rule decides which one a field points at:

- **Facts about a person reference `PersonId`.** Title reigns, teams, stables,
  relationships, match and segment participants, and a promotion's owner and
  booker all point at the person. A title reign still makes sense after the
  champion leaves the company; it belongs to the person.
- **Facts that exist only because someone is employed live on the
  `Employment` row.** Push, alignment, morale, momentum, brand, manager and
  ring name are all part of the employment. When the contract ends, they end
  with it.

So a field never points at an employment when it means the person, and
nothing employment-specific is stored on the person. Mixing the two makes every
lookup a guess about which ID a field holds; with one rule there is nothing to
guess.

## Canonical ordering

`ids()`, `values()`, `entries()` and `lookup()` always return rows in
ascending ID order, using plain UTF-16 code-unit comparison. Insertion order is
never visible.

The reason is determinism. If iteration followed insertion order, a world that
was saved and reloaded could iterate differently from one that kept running,
and rolling back a delete would move the row to the end. Ordering by ID makes
iteration a pure function of the table's contents.

Each table caches its sorted ID list. Only inserts and deletes rebuild it;
updating an existing row keeps it, and reads vastly outnumber inserts and
deletes.

## Indexes and invariants

- **Indexes** are declared on the `TableDef` and maintained on every write. A
  key function returns one key, an array of keys (the row is filed under each,
  which serves lookups from either side, such as relationships by person), or
  `null` to leave the row out. A **unique** index refuses a second row with the
  same key (`UniqueIndexError`) before anything changes. Indexes are derived
  data: they are never saved and are rebuilt on load.
- **Reference specs** list every field that holds an ID, using a small path
  syntax: `promotionId`, `members[].personId` (`[]` fans out over an array),
  `crew.announcerIds[]`, and `regionalPop{}` (`{}` uses a record's keys as the
  references). A spec can also target `player`, which checks the value against
  `meta.players`.
- **Invariants** are named cross-row rules ("at most one current reign per
  title") that return problems instead of throwing.

`checkWorld(view, registry)` runs it all and returns a report rather than
stopping at the first problem. It checks that each row is stored under its own
ID with the right kind prefix, resolves every reference (reporting dangling
ones with the table, row, exact path such as `tagIds[1]`, and missing ID), runs
every invariant, and optionally parses every row with its schema. A reference
to a kind that has no table is reported once per field, not once per row.
Reports are capped at 200 issues, with a count of how many more were found.

## Transactions

A transaction (`Tx`) is the only way to change the world. Code:
`packages/engine/src/model/tx.ts`.

```ts
const result = world.transact('contracts.expire', (tx) => {
  tx.update('employments', employmentId, { status: 'ended' });
  return tx.create('news', { headline, date });
});
```

- **One transaction per pipeline step.** The day pipeline opens a transaction
  for each step of each phase. If a step throws, only that step's writes are
  undone, the error goes into the day's report, and the next step runs. One
  bad step never cancels the rest of the day, so steps should stay small.
- **Savepoints for commands.** `tx.savepoint(label, body)` opens a nested
  scope that rolls back only its own writes when it throws and hands the
  failure back as a result. A command runs in a savepoint, so it is either
  fully applied or rejected with its reasons, and the step around it carries
  on. Savepoints nest. While one is open, only its own `tx` may write.
- **Bodies are synchronous.** A body that returns a promise is rolled back and
  fails with `TxStateError`. The undo journal assumes nothing else writes
  between an op and its undo, and the engine never needs to wait for anything.
  Opening a second top-level transaction inside one also throws; use a
  savepoint instead. A `tx` used after its transaction has ended throws too.
- **What rollback restores.** Every write is applied straight away (reads
  inside a transaction see its own writes) and recorded in an undo journal:
  the ID of each inserted row, the previous version of each updated or deleted
  row, and the previous metadata. Rolling back walks the journal backwards and
  puts each row back through the table's own write methods, so rows, every
  index, the cached ID order and the metadata all end up exactly as they were.
  IDs minted and RNG draws made during a failed transaction are not given
  back; the replay of the same day draws them the same way, so this stays
  deterministic. A property test runs 500 random write sequences that end in a
  throw and checks the world is byte-identical afterwards.
- **Why a journal and not snapshots.** A day touches a small part of the world.
  Recording the previous version of only what changed is far cheaper than
  copying thousands of rows before every step, and rollbacks are rare.
- **Write rules.** `insert` needs a valid ID of the table's kind that is not
  taken (`DuplicateIdError`). `create` mints the ID from the world's ID
  factory and inserts the row. `update` takes a partial patch or an updater
  function and may not change the ID. Append-only tables (the ledger) refuse
  `update` and `delete` (`AppendOnlyError`). A unique index clash throws
  `UniqueIndexError` and the whole transaction rolls back like any other
  error. Updaters must return a new object, never edit the row they were
  given.
- **IDs come from an installed factory.** `tx.create` mints through the
  `IdFactory` passed to `createWorld` or installed later with
  `world.setIdFactory`. The game runtime installs the minter over the seeded
  RNG streams; tests install one over predictable test entropy. With no
  factory installed `create` throws instead of falling back to an unseeded
  source, and the factory cannot be swapped while a transaction is open.
- **Write validation.** With `validateWrites: 'always'` on the world (tests and
  the test builders), every written row is parsed with its table's schema and
  every metadata change with the metadata schema; a failure throws
  `SchemaViolationError` naming the bad paths, such as `$.amount`. Stored rows
  are also deep-frozen, so a test that mutates a row it got back fails loudly.
  The default is `'never'`, because parsing every write in a daily loop over
  hundreds of workers is measurable. A single `transact` call can override
  the world setting. Saving always validates the whole world, so bad data is
  still caught at save and load time.
- **ChangeSet.** A committed transaction returns
  `{ meta, tables: { [table]: { inserted, updated, deleted } } }`: the net
  effect per row, each list in ID order, with tables nothing touched left
  out. Insert then update reports an insert, insert then delete reports
  nothing, update then delete reports a delete, and delete then re-insert
  reports an update. It is plain JSON, so it crosses the worker boundary, and
  the UI uses it to refresh only the queries that read a changed table.
- **Who sees what.** The engine's public API exports the `Tx`, `TxResult` and
  `ChangeSet` types but not `transact` itself: systems get their `tx` from the
  pipeline, and the UI only ever sees change sets.

## How to add a field

1. Add the field to the entity's zod schema and its TypeScript type follows.
2. If it holds an ID, add a reference spec; if screens or systems need to find
   rows by it, add an index.
3. Document it in the entity's section below.
4. Once the save format is frozen, bump the format version and add a tested
   migration that fills the field in older saves (see the save format doc, to
   come).

## People

Code: `packages/engine/src/model/entities/person.ts`. Table: `people` (kind `person`).

A person is everyone in the world: wrestlers, managers, announcers, referees,
producers and presenters. The row holds what is true of someone wherever they
work. Anything that exists only because they are employed (ring name per
promotion, push, alignment, morale, momentum) is on the employment instead (see
the reference rule above).

This section fixes the shape and the ranges. What the numbers do over time
(growth, aging, injuries, popularity drift) belongs to the Workers (WRK) epic,
and each field below names the epic that owns its meaning.

### Fields

| Field             | Type                           | Range / rule                                                                                                                  | Meaning owned by |
| ----------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `id`              | `PersonId`                     | `per_` ID                                                                                                                     | FND              |
| `givenName`       | string                         | 1–40 characters                                                                                                               | FND              |
| `familyName`      | string                         | 0–40 characters (empty for people known by one name)                                                                          | FND              |
| `defaultRingName` | string                         | 1–60 characters; used when no employment sets another ring name                                                               | FND              |
| `gender`          | `Gender`                       | `male`, `female`, `nonBinary`                                                                                                 | FND              |
| `birthDate`       | `GameDate`                     |                                                                                                                               | WRK (aging)      |
| `debutDate`       | `GameDate \| null`             | null = not yet debuted; otherwise at least 14 years after `birthDate`                                                         | WRK (experience) |
| `birthRegionId`   | `RegionId`                     | must exist in `regions`                                                                                                       | WLD              |
| `basedInRegionId` | `RegionId`                     | must exist in `regions`; where they live now                                                                                  | WLD, ECO         |
| `imageRef`        | `ImageRef`                     | relative asset path, `placeholder:<kind>` or null                                                                             | UI               |
| `masked`          | boolean                        |                                                                                                                               | CRTV             |
| `tags`            | string[]                       | at most 10, each 1–24 characters; free labels such as `generated`                                                             | tools            |
| `roles`           | `PersonRole[]`                 | non-empty, unique; see roles below                                                                                            | FND              |
| `status`          | `PersonStatus`                 | `active`, `semiRetired`, `hiatus`, `retired`, `deceased`, `outOfBusiness`                                                     | WRK, DAY         |
| `career`          | `{ canOwn, canBook }`          | booleans: can own a promotion, can be a promotion's booker                                                                    | AIP, ECO         |
| `motivation`      | `Motivation`                   | `money`, `legacy`, `power`, `enjoyment`, `thrill`                                                                             | ECO, SOC         |
| `heightCm`        | integer                        | 140–230                                                                                                                       | WRK              |
| `weightKg`        | integer                        | 40–250                                                                                                                        | WRK              |
| `build`           | `Build`                        | `slim`, `lean`, `average`, `athletic`, `muscular`, `stocky`, `heavy`, `superHeavy`                                            | MTCH             |
| `style`           | `RingStyle`                    | `allRounder`, `technician`, `brawler`, `highFlyer`, `powerhouse`, `hardcore`, `striker`, `grappler`, `showman`, `nonWrestler` | MTCH             |
| `attributes`      | `Record<AttributeKey, number>` | every key required, each 0–100                                                                                                | WRK, MTCH        |
| `condition`       | `Record<BodyPart, number>`     | `head`, `neck`, `back`, `arms`, `torso`, `legs`; each 0–100, 100 = perfect health                                             | WRK              |
| `fatigue`         | number                         | 0–100                                                                                                                         | WRK              |
| `injury`          | `Injury \| null`               | `{ kindKey, bodyPart, since, expectedReturn, canWorkAngles }`; `expectedReturn >= since`                                      | WRK              |
| `restrictions`    | `Restriction[]`                | at most 4; `{ kind: 'rehab' \| 'personalLeave', until }`                                                                      | WRK              |
| `development`     | `{ potential, ceilings }`      | `potential` integer −1000..1000; `ceilings` per attribute, optional, each 0–100                                               | WRK              |
| `regionalPop`     | `Record<RegionId, number>`     | sparse; each 0–100; an explicit 0 is refused; keys must exist in `regions`                                                    | WRK              |
| `traits`          | `TraitKey[]`                   | unique, at most 8, from the closed list; no exclusive pair together                                                           | see traits       |
| `vices`           | `{ alcohol, substances }`      | each `none`, `hidden`, `known`, `recovering`                                                                                  | WRK, SOC         |

Rules across fields:

- **Debut age.** `debutDate` is null or on or after the 14th birthday.
- **Ring style and roles go together.** Anyone whose `style` is not
  `nonWrestler` holds `wrestler` or `occasionalWrestler`, and a `nonWrestler`
  holds neither.
- **The dead are not injured.** `status: 'deceased'` means `injury` is null and
  `restrictions` is empty.

Roles: `wrestler`, `occasionalWrestler` (wrestles now and then, usually as well
as another role), `manager`, `presenter`, `announcer`, `referee`, `producer`. A
person can hold several roles.

Transient state: `fatigue`, `injury` and `restrictions` change from day to day.
A restriction is a spell when the person cannot work for a reason of their own
(rehab or personal leave). Suspensions and paid time off are given by an
employer, so they live on the employment (FND-07).

Development is hidden from the player by default. FND only fixes the ranges:
WRK decides how potential drains with age and gates growth and decline, and how
a ceiling caps an attribute. The −1000..1000 scale is a placeholder that WRK can
change with a migration.

Vices: `hidden` means the player's promotion has not discovered the vice;
`known` means it has. Discovery is per world for now; if multiplayer needs it
per promotion, it moves to a per-promotion record.

Indexes: `byStatus` (status), `byRole` (filed under each role the person holds)
and `byBasedInRegion` (`basedInRegionId`). There are no cross-table invariants
yet.

### Attributes

Twelve attributes, all 0–100 floats (the UI rounds them for display). Every
attribute has a clear consumer, and a non-wrestler simply has low in-ring
values. The ordered list is `ATTRIBUTE_KEYS`; `ATTRIBUTE_GROUPS` splits it into
the three groups below.

| Group     | Attribute      | Definition                                                                   | Main consumer |
| --------- | -------------- | ---------------------------------------------------------------------------- | ------------- |
| In-ring   | `ringwork`     | Move execution and match craft                                               | MTCH          |
| In-ring   | `psychology`   | Pacing, timing, telling a story, reading a crowd                             | MTCH          |
| In-ring   | `stamina`      | How long they can work at full pace                                          | MTCH, WRK     |
| In-ring   | `safety`       | How well they protect opponents                                              | MTCH (injury) |
| In-ring   | `athleticism`  | Speed, agility and power                                                     | MTCH          |
| Character | `mic`          | Promos and talking segments                                                  | MTCH          |
| Character | `charisma`     | Star quality and natural pull; the level popularity settles toward over time | MTCH, WRK     |
| Character | `presence`     | Visual impact: look, size or menace                                          | MTCH          |
| Crew      | `officiating`  | Referee work                                                                 | MTCH          |
| Crew      | `broadcasting` | Commentary and presenting                                                    | MTCH, EVT     |
| Crew      | `producing`    | Laying out and guiding other people's segments                               | MTCH          |
| Crew      | `booking`      | Creative judgement                                                           | AIP           |

Why twelve and not dozens: each one has a system that reads it. A long list of
attributes that nothing reads is noise for the player and for the generators.
Adding an attribute later is a schema change and a migration, which is cheap;
taking away one that saves and packs already use is not. `presence` is one
attribute rather than separate "looks" and "menace" because in practice they
answer the same question: does this person look like they matter?

### Traits

Traits are a closed list. The keys are a zod enum, so a typo cannot slip into a
save or a data pack, and a person holds at most 8. `TRAIT_GROUPS` lists the
keys by group and `EXCLUSIVE_TRAIT_PAIRS` lists the pairs nobody may hold
together; the schema rejects a person holding both sides of a pair and names
both traits in the error.

| Group       | Traits                                                                                               | Exclusive pairs                                                      | Intended consumer    |
| ----------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------- |
| Learning    | `fastLearner`, `slowLearner`                                                                         | `fastLearner` ⟂ `slowLearner`                                        | WRK (growth)         |
| Aging       | `agesWell`, `agesBadly`                                                                              | `agesWell` ⟂ `agesBadly`                                             | WRK (decline)        |
| Body        | `durable`, `injuryProne`                                                                             | `durable` ⟂ `injuryProne`                                            | WRK, MTCH (injuries) |
| Effort      | `workhorse`, `coaster`                                                                               | `workhorse` ⟂ `coaster`                                              | MTCH, WRK (fatigue)  |
| Big stage   | `bigMatchPerformer`, `shrinksOnBigStage`                                                             | `bigMatchPerformer` ⟂ `shrinksOnBigStage`                            | MTCH                 |
| Selling     | `generousSeller`, `poorSeller`                                                                       | `generousSeller` ⟂ `poorSeller`                                      | MTCH                 |
| Ring craft  | `tagSpecialist`, `teacher`, `improviser`                                                             | none                                                                 | MTCH, CRTV, WRK      |
| Locker room | `leader`, `professional`, `troublemaker`, `partier`, `prankster`, `sensitive`, `egotist`, `selfless` | `professional` ⟂ `troublemaker`, `egotist` ⟂ `selfless`              | SOC                  |
| Career      | `loyal`, `journeyman`                                                                                | `loyal` ⟂ `journeyman`                                               | ECO (contracts)      |
| Content     | `lovesHardcore`, `refusesHardcore`, `lovesComedy`, `refusesComedy`                                   | `lovesHardcore` ⟂ `refusesHardcore`, `lovesComedy` ⟂ `refusesComedy` | SOC (morale), MTCH   |
| Character   | `naturalHeel`, `naturalFace`                                                                         | `naturalHeel` ⟂ `naturalFace`                                        | CRTV, MTCH           |

Every trait needs at least one system that reads it once those epics land. The
consumer column makes a trait that nothing reads easy to spot; one that is
still unread when its epic ships gets wired or removed.

### Stored and derived

Stored: everything in the field table. Derived by WRK queries and never
stored:

- **Age** from `birthDate` and the current date.
- **Experience** from `debutDate` (and later, match history).
- **Weight class** from `weightKg`, using bands that are tunables. Changing the
  bands never needs a data migration, which is why the row stores a number and
  not a class.
- **Overall value and grades** (how good someone is at a role, what they are
  worth) from the attributes, popularity and traits.
- **Country and continent popularity** as population-weighted roll-ups of
  `regionalPop` (D-03).

### Why popularity is sparse and regional

Popularity is per region because touring, local heroes and TV reach only mean
something if place matters (D-03). Country and continent figures are always
computed from the regions, so there is one model to keep correct instead of
several to keep in sync.

It is sparse because most people are unknown in most regions. A world with 300
people and dozens of regions would otherwise store thousands of zeros. A
missing region reads as 0, and the schema refuses an explicit 0 so there is
exactly one way to write "unknown here". If a world ships with many regions,
WRK can add a minimum below which small values are dropped.

## Promotions and employment

_Promotions, brands, employments and contracts arrive with FND-07._

## Titles, events, storylines and seasons

_Titles and reigns, event definitions and instances, segments and
participants, storylines and seasons arrive with FND-08._

## Geography, media, mail, news and ledger

_Continents, countries and regions, networks and deals, venues, mail, news and
the money ledger arrive with FND-09._
