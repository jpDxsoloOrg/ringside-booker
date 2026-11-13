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
  tables whose rows are never edited: `true` for tables that only ever grow
  (the ledger), `'pruneOnly'` for logs whose old rows are deleted but never
  updated (the rival decision log). The production registry is
  `TABLES` in `model/tables.ts`; each key equals its table's name, and no two
  tables share a kind.
- **Metadata.** `WorldMeta` (`model/world-meta.ts`) holds what is not a row:
  the world name, start and current date, the seed, the players, the content
  packs the world was built from (with the IDs minted for their records), the
  content catalogs snapshotted from those packs at new game (`catalogs`: match
  types, angle types and win methods keyed by content key; `{}` for a world
  built without packs; see
  [data-packs.md](data-packs.md#match-and-segment-catalogs)), the number of
  days simulated, and the settings chosen at new game. The settings
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
| `aiProfile`       | `aip`  | `aiDecision`   | `aid`  |

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
to a kind that has no table is reported once per field, not once per row. An
invariant can mark an issue as a `warning` for a state that is legal but worth
flagging; warnings are listed but do not make the report fail.
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
  factory and inserts the row. `mintId` mints an ID without inserting, for a
  row whose fields name its own ID (a ledger row's `traceRef`); insert it
  with `insert`. `update` takes a partial patch or an updater
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
   migration that fills the field in older saves (see
   [save-format.md](save-format.md)).

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

Seeding: generated people get their starting `development`, `traits`, `vices`
and `regionalPop` from the WLD-07 seeds (see
[world-generation.md](world-generation.md#potential-traits-vices-and-popularity-seeding)).
Ceilings and the potential number come from one smooth curve over age, so they
never disagree; ceilings cover the in-ring and character attributes for
wrestlers and the role's own skills for everyone else, and are never below the
current value. Vices start as `hidden` or `none`, and popularity is seeded
sparsely, outward from the region the person is based in. Hand-made pack people
keep what the pack gives them unless the new-game "re-roll potential" option
recomputes their `development`.

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
stored (the helpers and formulas are in [workers.md](workers.md)):

- **Age** from `birthDate` and the current date.
- **Experience** from `debutDate` (and later, match history).
- **Availability** (can they work today, why not, until when) from the status,
  debut date, injury, restrictions and the employment's leave, compared with
  the date. See [workers.md](workers.md#availability).
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

The company side of the world and how people attach to it. Code:
`packages/engine/src/model/controller.ts` and
`packages/engine/src/model/entities/` (`promotion.ts`, `promotion-style.ts`,
`brand.ts`, `employment.ts`, `team.ts`, `stable.ts`, `relationship.ts`).

The key call: a contract is its own entity with a lifecycle. Everything that
only exists because someone works for a promotion (ring name, gimmick, push,
alignment, morale, momentum, brand, manager) lives on the `Employment` row.
Groupings that outlive a contract (teams, stables, relationships) point at
people, following the reference rule above.

### Controllers

Every promotion and every brand names who runs it (D-07):

| Shape                                 | Meaning                                                      |
| ------------------------------------- | ------------------------------------------------------------ |
| `{ kind: 'human', playerId: string }` | A human player; `playerId` (1–64 chars) is in `meta.players` |
| `{ kind: 'computer' }`                | The computer                                                 |

`playerId` is an opaque player identifier, not an entity ID. A reference spec
on `controller.playerId` (target `player`) checks it against `meta.players`.
Single-player is one human controller. There is no "player promotion" field
anywhere: a query that needs it looks for the rows whose controller names that
player. The command and query API re-exports this type instead of declaring
its own.

### Promotion (`promotions`, `pro_`)

| Field               | Type                                | Range / rule                                  | Semantics owned by |
| ------------------- | ----------------------------------- | --------------------------------------------- | ------------------ |
| `id`                | `PromotionId`                       |                                               |                    |
| `name`              | string                              | 1–60 chars                                    |                    |
| `shortName`         | string                              | 2–8 uppercase letters or digits               |                    |
| `logoRef`           | `ImageRef`                          | asset path, placeholder or null               | UI                 |
| `foundedOn`         | `GameDate`                          |                                               |                    |
| `status`            | `'active' \| 'dormant' \| 'closed'` |                                               | WLD                |
| `homeRegionId`      | `RegionId`                          | ref → region                                  |                    |
| `regionalPop`       | `Record<RegionId, number>`          | sparse, each > 0 and ≤ 100; keys ref → region | WRK                |
| `popularityGains`   | `{ month: YearMonth; byRegion }`    | `byRegion` sparse like `regionalPop`          | EVT5               |
| `prestige`          | number                              | 0–100                                         | WLD                |
| `cash`              | `Cents`                             | may be negative (debt)                        | ECO                |
| `style`             | `PromotionStyle`                    | see below                                     | WLD                |
| `ownerPersonId`     | `PersonId \| null`                  | ref → person                                  | AIP                |
| `bookerPersonId`    | `PersonId \| null`                  | ref → person                                  | AIP                |
| `parentPromotionId` | `PromotionId \| null`               | developmental parent; never itself; no cycles | WLD                |
| `production`        | record of 8 areas                   | each a whole number 0–10                      | ECO                |
| `policies`          | `{ catering, travel, medical }`     | each 0, 1, 2 or 3                             | ECO / SOC          |
| `color`             | string                              | `#rrggbb`, used by placeholder logos          | UI                 |
| `controller`        | `Controller`                        | who runs it                                   | WLD-10             |

Production areas: `stage`, `camera`, `editing`, `pyro`, `music`, `writing`,
`marketing`, `backOffice`. The 0–10 range is deliberately wide so the economy
design can use fewer tiers without a migration.

Styles (`promotion-style.ts`, importable on its own): `mainstream`,
`traditional`, `technical`, `hardHitting`, `hardcore`, `highFlying`,
`entertainment`.

Owner and booker are `PersonId`, not `EmploymentId`: an owner need not be on
the payroll. If a booker must also be employed, that is a query for the
systems that care.

`popularityGains` is what the promotion's shows have gained it in each region
in one calendar month (`month` is `YYYY-MM`, `yearMonthOf(date)`), so
[the monthly gain cap](promotion-popularity.md#monthly-cap) holds across
shows. `byRegion` is sparse: each value is > 0 and ≤ 100, a region with no
gain is left out, and its keys ref → region. When `month` is not the current
month the whole tally counts as empty; the next show starts a new one. Every
new promotion (pack loading, founding, builders) starts with
`{ month: <month of the start date>, byRegion: {} }`. Only the promotion
popularity system writes it (EVT5-02).

Index: `byStatus`.

### Brand (`brands`, `brd_`)

| Field         | Type                 | Range / rule                                            |
| ------------- | -------------------- | ------------------------------------------------------- |
| `id`          | `BrandId`            |                                                         |
| `promotionId` | `PromotionId`        | ref → promotion                                         |
| `name`        | string               | 1–40 chars                                              |
| `logoRef`     | `ImageRef`           |                                                         |
| `priority`    | number               | whole number ≥ 0; lower = more important (0 = flagship) |
| `active`      | boolean              |                                                         |
| `controller`  | `Controller \| null` | null = run by the promotion's controller (D-06)         |

Index: `byPromotion`. A brand with its own controller is all brand wars need
from the data model for now; drafts and brand-war seasons bring their own
tables later.

### Employment (`employments`, `emp_`)

| Group     | Field                    | Type                                                                             | Range / rule                                     |
| --------- | ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------ |
| Links     | `personId`               | `PersonId`                                                                       | ref → person                                     |
|           | `promotionId`            | `PromotionId`                                                                    | ref → promotion                                  |
|           | `brandId`                | `BrandId \| null`                                                                | ref → brand of the same promotion                |
|           | `managerPersonId`        | `PersonId \| null`                                                               | ref → person; never the employee                 |
| Lifecycle | `status`                 | `EmploymentStatus`                                                               | see the lifecycle below                          |
|           | `offeredOn`              | `GameDate`                                                                       |                                                  |
|           | `startsOn`               | `GameDate`                                                                       | ≥ `offeredOn`                                    |
|           | `endsOn`                 | `GameDate \| null`                                                               | > `startsOn`; null = open-ended                  |
|           | `endedOn`                | `GameDate \| null`                                                               | set exactly when the status is an ended one      |
| Role      | `role`                   | `wrestler \| manager \| presenter \| announcer \| referee \| producer \| booker` |                                                  |
| Character | `ringName`               | string                                                                           | 1–60 chars                                       |
|           | `gimmickKey`             | `ContentKey \| null`                                                             |                                                  |
|           | `alignment`              | `face \| heel \| tweener`                                                        |                                                  |
|           | `push`                   | `mainEvent \| upperCard \| midCard \| lowerCard \| enhancement \| none`          |                                                  |
| Terms     | `terms.kind`             | `written \| perAppearance \| development \| tour`                                |                                                  |
|           | `terms.exclusive`        | boolean                                                                          |                                                  |
|           | `terms.monthlyWage`      | `Cents`                                                                          | ≥ 0; must be 0 for `perAppearance`               |
|           | `terms.perAppearanceFee` | `Cents`                                                                          | ≥ 0                                              |
|           | `terms.signingBonus`     | `Cents`                                                                          | ≥ 0                                              |
|           | `terms.shares`           | `{ gateBp, merchBp, broadcastBp }`                                               | basis points, 0–10000 each                       |
|           | `terms.appearanceCap`    | number \| null                                                                   | whole number ≥ 1 per game year; null = no cap    |
|           | `terms.perks`            | `{ creativeControl, noHouseShows, ironClad, travelCovered }`                     | booleans                                         |
| State     | `morale`                 | number                                                                           | −100..100 (WRK/SOC)                              |
|           | `momentum`               | number \| null                                                                   | −100..100; null until the first appearance (WRK) |
|           | `appearancesThisYear`    | number                                                                           | whole number ≥ 0                                 |
|           | `lastAppearanceOn`       | `GameDate \| null`                                                               |                                                  |
|           | `leave`                  | `null \| { kind: suspension \| timeOff; until; paid }`                           | suspensions and time off belong to the contract  |

Indexes: `byPerson`, `byPromotion`, `byStatus`, and `byPromotionStatus` with
the key `` `${promotionId}|${status}` `` (`promotionStatusKey`), which serves
"the active roster of promotion X" without a scan.

Money shares are basis points: whole numbers, exact, and the same unit
everywhere money is split.

#### Lifecycle

An offer is not a contract. An employment is created as `offered` and only
pays a wage or appears on a card once it has moved to `active` on purpose.

```
                 +----------> declined
                 |
  offered -------+----------> withdrawn <----+
                 |                           |
                 +---------> signed ---------+
                                |
                                v
                             active ---------+----------> expired
                                             |
                                             +----------> released
                                             |
                                             +----------> quit
```

| From        | Allowed next statuses             |
| ----------- | --------------------------------- |
| `offered`   | `signed`, `declined`, `withdrawn` |
| `signed`    | `active`, `withdrawn`             |
| `active`    | `expired`, `released`, `quit`     |
| `declined`  | none (terminal)                   |
| `withdrawn` | none (terminal)                   |
| `expired`   | none (terminal)                   |
| `released`  | none (terminal)                   |
| `quit`      | none (terminal)                   |

`EMPLOYMENT_TRANSITIONS` holds this table and `canTransition(from, to)` reads
it. Commands that change an employment check it; the transaction layer does
not, so migrations and sandbox edits can still write any status. What the
world does check is that the stored state is one the lifecycle could have
reached:

- **In the row (schema):** `endedOn` is set exactly for `declined`,
  `withdrawn`, `expired`, `released` and `quit`, and never before `offeredOn`;
  an employment that was active (`expired`, `released`, `quit`) cannot end
  before `startsOn`; an `expired` employment has an `endsOn` and did not end
  before it.
- **Against the calendar (invariant `employments.unreachableState`):** no
  `offeredOn` is in the future; an `active`, `expired`, `released` or `quit`
  employment has `startsOn` on or before the current date; and no `endedOn` is
  in the future.

#### Invariants

| Code                              | Rule                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `employments.exclusiveConflict`   | A person with an active exclusive contract has no other active contract (so at most one exclusive one). |
| `employments.duplicateContract`   | At most one `signed` or `active` employment per person and promotion.                                   |
| `employments.brandOtherPromotion` | An employment's brand belongs to the employment's promotion.                                            |
| `employments.unreachableState`    | The stored status could have been reached by today (see above).                                         |
| `promotions.parentCycle`          | The developmental parent chain has no cycles. Each cycle is reported once, from its smallest ID.        |
| `teams.deceasedMember`            | An active team has no deceased member.                                                                  |
| `stables.deceasedMember`          | An active stable has no deceased member.                                                                |

Offers are free: a person can hold any number of `offered` rows, exclusive or
not, because nothing has been agreed yet.

### Team (`teams`, `tem_`)

| Field        | Type                                | Range / rule                                    |
| ------------ | ----------------------------------- | ----------------------------------------------- |
| `id`         | `TeamId`                            |                                                 |
| `kind`       | `'tag' \| 'trio'`                   |                                                 |
| `name`       | string                              | 1–60 chars                                      |
| `memberIds`  | `PersonId[]`                        | unique; exactly 2 for a tag team, 3 for a trio  |
| `experience` | number                              | 0–100; feeds the teamwork bonus                 |
| `status`     | `'active' \| 'inactive' \| 'split'` |                                                 |
| `formedOn`   | `GameDate`                          |                                                 |
| `splitOn`    | `GameDate \| null`                  | set exactly when `split`; not before `formedOn` |

Index: `byMember` (one entry per member).

### Stable (`stables`, `stb_`)

| Field         | Type                      | Range / rule                                        |
| ------------- | ------------------------- | --------------------------------------------------- |
| `id`          | `StableId`                |                                                     |
| `promotionId` | `PromotionId`             | ref → promotion                                     |
| `name`        | string                    | 1–60 chars                                          |
| `memberIds`   | `PersonId[]`              | unique, 2–12                                        |
| `leaderId`    | `PersonId \| null`        | must be a member                                    |
| `status`      | `'active' \| 'disbanded'` |                                                     |
| `formedOn`    | `GameDate`                |                                                     |
| `disbandedOn` | `GameDate \| null`        | set exactly when `disbanded`; not before `formedOn` |
| `imageRef`    | `ImageRef`                |                                                     |

Indexes: `byPromotion`, `byMember`.

**Teams are global, stables belong to a promotion.** A tag team is a unit of
people that can move between companies (or work for several) together, so it
has no promotion. A stable is a creative device of one company, so it does.
Stable members are not required to hold a contract with the stable's
promotion: someone can be between deals, and what happens to the stable then
is a creative decision, not a data rule.

### Relationship (`relationships`, `rel_`)

| Field           | Type                 | Range / rule                                                    |
| --------------- | -------------------- | --------------------------------------------------------------- |
| `id`            | `RelationshipId`     |                                                                 |
| `personAId`     | `PersonId`           | the smaller ID of the pair                                      |
| `personBId`     | `PersonId`           | the larger ID; `personAId < personBId`, so no self-relationship |
| `affinity`      | number               | −100..100 (SOC owns how it changes and decays)                  |
| `bonds`         | `RelationshipBond[]` | unique; at most one of `dating`, `engaged`, `married`           |
| `mentorId`      | `PersonId \| null`   | required exactly when `bonds` has `mentorship`; must be A or B  |
| `since`         | `GameDate`           |                                                                 |
| `lastChangedOn` | `GameDate`           | not before `since`                                              |

Bonds: `friends`, `rivals`, `dating`, `engaged`, `married`, `relatives`,
`mentorship`.

Pairs are stored in canonical order, so there is exactly one row per pair.
`relationshipKey(a, b)` returns `"smaller|larger"` whichever order it is
given, and the unique `byPair` index on that key refuses a second row for the
same pair at write time. The `byPerson` index files each row under both
people, so "everyone X has a relationship with" is one lookup.

## Titles, events, storylines and seasons

The creative and show-day tables: championships and their lineage, the shows
a promotion runs, what goes on each card, the stories that tie cards
together, and the seasons the whole world shares. Code:
`packages/engine/src/model/entities/` (`title.ts`, `title-reign.ts`,
`event-definition.ts`, `event-instance.ts`, `segment.ts`, `participant.ts`,
`storyline.ts`, `season.ts`) and `packages/engine/src/model/recurrence.ts`.

Every schema is a strict object: a field that is not listed is an error, not
something to carry along silently.

### Derived, never stored: slot role and duration class

Cards are built from segment slots, never from minutes (D-10). The World
stores where a segment sits (`slot` and `preShow`) and nothing else about its
place on the card:

- **Slot role** (opener, midcard, semi-main, main event, pre-show) is
  computed by MTCH from the slot position and the section.
- **Duration class** (short, standard, long) is computed by MTCH from the
  slot position, the section and the match type (a battle royal or an
  iron-man style stipulation can push it up or down).

Nothing in the World stores minutes, a running time, a length or a slot role.
A stored role would disagree with the card order the moment a segment moved;
deriving it keeps the order the single source of truth, and lets MTCH and EVT
retune what each position means without a data migration. A test walks the
zod shapes of `EventDefinition`, `EventInstance` and `Segment` and fails on
any key matching `/minute|length|duration|role/i`.

### Titles (`titles`, `tit_`)

| Field          | Type                                                                 | Notes                                             |
| -------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| `id`           | `TitleId`                                                            |                                                   |
| `promotionId`  | `PromotionId`                                                        |                                                   |
| `brandId`      | `BrandId \| null`                                                    | null for a promotion-wide title                   |
| `name`         | string, 1–60                                                         |                                                   |
| `holderCount`  | `1 \| 2 \| 3`                                                        | singles, tag, trios                               |
| `division`     | `{ gender: 'open' \| 'male' \| 'female'; minWeightKg; maxWeightKg }` | weights are kg or null for no limit; min ≤ max    |
| `prestige`     | 0–100                                                                |                                                   |
| `status`       | `'active' \| 'retired'`                                              |                                                   |
| `introducedOn` | `GameDate`                                                           |                                                   |
| `retiredOn`    | `GameDate \| null`                                                   | set exactly when retired; not before introduction |
| `imageRef`     | image ref or null                                                    |                                                   |
| `color`        | `#rrggbb`                                                            | for the placeholder belt art                      |

Refs: `promotionId`, `brandId`. Index: `byPromotion`.

There is **no current-champion field**. The champion is the open reign:
`titleReigns.lookupOne('openByTitle', titleId)`. Storing it on the title as
well would give two answers that can disagree.

### Title reigns (`titleReigns`, `trn_`)

| Field               | Type                                                                  | Notes                                          |
| ------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| `id`                | `TitleReignId`                                                        |                                                |
| `titleId`           | `TitleId`                                                             |                                                |
| `holderIds`         | `PersonId[]`                                                          | 1–3, unique; people, not employments           |
| `teamId`            | `TeamId \| null`                                                      | when a team won it as a team                   |
| `wonOn`             | `GameDate`                                                            |                                                |
| `lostOn`            | `GameDate \| null`                                                    | null = the current reign; not before `wonOn`   |
| `wonInSegmentId`    | `SegmentId \| null`                                                   | null for an inaugural or awarded reign         |
| `endedInSegmentId`  | `SegmentId \| null`                                                   | null while current or when it ended off-screen |
| `endReason`         | `null \| 'lost' \| 'vacated' \| 'stripped' \| 'retired' \| 'unified'` | set exactly when `lostOn` is set               |
| `defences`          | int ≥ 0                                                               |                                                |
| `holderNamesAtTime` | `string[]`                                                            | one ring name per holder, same order           |

Refs: `titleId`, `holderIds[]`, `teamId`, `wonInSegmentId`,
`endedInSegmentId`. Indexes: `byTitle`, `byHolder` (multi-key, one entry per
holder), unique `openByTitle` (keyed by `titleId` while `lostOn` is null, left
out otherwise), so a second open reign for a title is refused at write time.

A reign covers `wonOn` up to, but not including, `lostOn`. A title can change
hands twice on one show: the old reign ends on the day the new one starts, and
a reign won and lost on the same day covers no time.

### Event definitions (`eventDefinitions`, `evd_`)

A recurring or one-off show before any date is booked.

| Field               | Type                                                       | Notes                                       |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `id`                | `EventDefinitionId`                                        |                                             |
| `promotionId`       | `PromotionId`                                              |                                             |
| `brandId`           | `BrandId \| null`                                          | null for a promotion-wide (supershow) event |
| `name`              | string, 1–60                                               |                                             |
| `importance`        | `'house' \| 'minor' \| 'regular' \| 'major' \| 'flagship'` |                                             |
| `recurrence`        | `Recurrence`                                               | see below                                   |
| `format`            | `ShowFormat`                                               | see below                                   |
| `televised`         | boolean                                                    |                                             |
| `preferredRegionId` | `RegionId \| null`                                         |                                             |
| `preferredVenueId`  | `VenueId \| null`                                          |                                             |
| `activeFrom`        | `GameDate`                                                 |                                             |
| `activeUntil`       | `GameDate \| null`                                         | null while it keeps running                 |
| `logoRef`           | image ref or null                                          |                                             |

Refs: `promotionId`, `brandId`, `preferredRegionId`, `preferredVenueId`.
Index: `byPromotion`.

#### Recurrence

A union on `kind`. Weekdays are numbered 0 = Monday to 6 = Sunday, the same as
`weekday()` in `core/date.ts`.

| Kind          | Fields                                                       | Example                                                                                                              |
| ------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `weekly`      | `weekdays` (1–7, unique)                                     | Monday and Thursday TV: `{ kind: 'weekly', weekdays: [0, 3] }`                                                       |
| `everyNWeeks` | `intervalWeeks` (2–8), `weekday`, `anchor` (on that weekday) | every other Wednesday from 7 Jan 2026: `{ kind: 'everyNWeeks', intervalWeeks: 2, weekday: 2, anchor: '2026-01-07' }` |
| `monthly`     | `week` (1–4 or `'last'`), `weekday`                          | last Sunday of each month: `{ kind: 'monthly', week: 'last', weekday: 6 }`                                           |
| `annual`      | `month` (1–12), `week` (1–4 or `'last'`), `weekday`          | 2nd Saturday of June: `{ kind: 'annual', month: 6, week: 2, weekday: 5 }`                                            |
| `dates`       | `dates` (1–366, sorted, unique)                              | a short tour: `{ kind: 'dates', dates: ['2026-03-01', '2026-03-04'] }`                                               |

`everyNWeeks` occurs on its `anchor` and every `7 × intervalWeeks` days
after it, never before the anchor. The every-other-Wednesday example runs on
7 Jan, 21 Jan and 4 Feb 2026, but not on 14 Jan, and not on 24 Dec 2025.
Monthly and annual rules stop at week 4 or `'last'` because a 5th weekday
does not exist in every month.

`recurrence.occursOn(recurrence, date)` says whether a show falls on a date,
and `recurrence.nextOccurrence(recurrence, after)` returns the first show date
strictly after `after`, or null when there is none (a `dates` list with no
later date, or a date past the end of the supported calendar). Both are pure
and read dates only through `core/date.ts`. They are exported under the
`recurrence` namespace because the day-pipeline calendar already has a
`nextOccurrence` for phase cadences. Turning definitions into dated instances
is the EVT and DAY epics' job.

#### Show format and the slot model

`ShowFormat` is `{ slots, preShowSlots }`: the number of main-card segment
slots (3–12) and pre-show slots (0–3). A card has two sections, the main card
and the pre-show, and each numbers its slots from 0. Slot 0 of the main card
is always the opener, whatever the pre-show holds, because a pre-show segment
never becomes the opener or main event of the main card.

The ranges are wider than the defaults on purpose, so EVT can add a
production-budget bonus slot without a migration. The default slot count per
importance is content and tunables, not schema; WLD-08 suggests house 5,
minor 5, regular 6, major 8 and flagship 10 main-card slots, with 0–2 pre-show
slots on major and flagship shows.

### Event instances (`eventInstances`, `evi_`)

One dated show.

| Field               | Type                                                          | Notes                                 |
| ------------------- | ------------------------------------------------------------- | ------------------------------------- |
| `id`                | `EventInstanceId`                                             |                                       |
| `promotionId`       | `PromotionId`                                                 |                                       |
| `eventDefinitionId` | `EventDefinitionId \| null`                                   | null for a one-off                    |
| `brandId`           | `BrandId \| null`                                             |                                       |
| `name`              | string, 1–60                                                  |                                       |
| `importance`        | as on the definition                                          | copied at scheduling                  |
| `format`            | `ShowFormat`                                                  | copied at scheduling                  |
| `date`              | `GameDate`                                                    | the live or taping date               |
| `airDate`           | `GameDate`                                                    | not before `date`; equal unless taped |
| `status`            | `'scheduled' \| 'booked' \| 'completed' \| 'cancelled'`       |                                       |
| `venueId`           | `VenueId \| null`                                             |                                       |
| `genericVenue`      | `null \| GenericVenue` (below)                                | a local venue; never with `venueId`   |
| `regionId`          | `RegionId`                                                    |                                       |
| `result`            | `null \| EventResult` (below)                                 | set exactly when completed            |
| `cancellation`      | `null \| { reason: 'notRun' \| 'byPromotion'; on: GameDate }` | set exactly when cancelled            |

`GenericVenue` is `{ tier, capacity }`: one of the generic local venue sizes
(`room`, `smallHall`, `hall`, `largeHall`, `smallArena`, `arena`,
`largeArena`, `stadium`) and the capacity that size had when it was chosen,
1–200,000, so a later tunable change never rewrites a past show (EVT6-02, see
[box-office.md](box-office.md#generic-venues)). Both `venueId` and
`genericVenue` null means the venue is not chosen yet. Saves made before
EVT6-02 load with `genericVenue` null.

Refs: `promotionId`, `eventDefinitionId`, `brandId`, `venueId`, `regionId`.
Indexes: `byPromotion`, `byDate`, `byDefinition`, `byStatus` (so a phase can
read only the open shows) and the unique `byDefinitionAirDate`, keyed
`<eventDefinitionId>|<airDate>`.

There is at most one instance per definition and air date, whatever its
status. The unique index enforces it, and the calendar uses the same key to
decide whether a date still needs a show, so a cancelled or taped show is
never scheduled a second time. One-offs have no definition and are left out of
that index. `cancellation.reason` tells a show nobody ran (`notRun`) from one
its promotion called off (`byPromotion`). See [calendar.md](calendar.md).

`EventResult` is what a completed show produced. Each field has one writer;
the last three stay null until that feature lands, and crowd size is never the
same number as crowd reaction (D-02):

| Field         | Type            | Written by                                                                |
| ------------- | --------------- | ------------------------------------------------------------------------- |
| `score`       | 0–100           | EVT3: the final show score                                                |
| `rawScore`    | 0–100           | EVT3: the score before any `cap`-stage modifier; equals `score` if none   |
| `traceId`     | string or null  | EVT3: the ref key of the show score's trace                               |
| `attendance`  | int ≥ 0 or null | EVT6-05: people in the building, set when the box office settles          |
| `gate`        | `Cents` or null | EVT6-05: ticket revenue before workers' shares                            |
| `viewers`     | int ≥ 0 or null | ECO8; null for a show that did not air                                    |
| `ticketPrice` | `Cents`, absent | EVT6-05: one ticket's price; absent until the box office settles the show |
| `merch`       | `Cents`, absent | EVT6-05: live merch sales before workers' shares; absent until settled    |

See [show-night.md](show-night.md).

### Segments (`segments`, `seg_`)

A segment is a match or an angle, as a union on `kind`, so nothing can build a
segment without saying which it is, and every reader has to handle both. Use
`isMatch(segment)` / `isAngle(segment)` to narrow.

Shared fields:

| Field             | Type                                                                          | Notes                                        |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `id`              | `SegmentId`                                                                   |                                              |
| `eventInstanceId` | `EventInstanceId`                                                             |                                              |
| `slot`            | int ≥ 0                                                                       | position in its section, from 0; gaps = open |
| `preShow`         | boolean                                                                       | true = pre-show section, false = main card   |
| `label`           | string or null                                                                | a billing line such as a contender's match   |
| `storylineIds`    | `StorylineId[]`                                                               | unique                                       |
| `crew`            | `{ refereeId: PersonId \| null; producerId: PersonId \| null; announcerIds }` | at most 4 announcers                         |
| `rating`          | `null \| SegmentRating` (below)                                               | set once the show is completed               |

`kind: 'match'` adds:

- `match`: `{ matchTypeKey; stipulationKeys[]; titleIds: TitleId[]; finishKey | null }`.
  `finishKey` is the planned finish (`finish.clean`); `null` means "decided on
  the night". See [match-finishes.md](match-finishes.md).
- `outcome`, the outcome union. While the show is `scheduled` or `booked` it is
  the booker's planned result; once the show is `completed` it is the result
  that happened (written by EVT3). One field, so there is one source of truth.
  See [booking.md](booking.md#planned-results).
  - `null`: nothing planned (decided on the night), or no result yet;
  - `{ kind: 'win'; winningSide; methodKey }`, where `winningSide` is a
    participant `side` (0–29, `MAX_SIDE`);
  - `{ kind: 'draw' }`;
  - `{ kind: 'noContest' }`.

`kind: 'angle'` adds `angle`: `{ angleTypeKey; beats }`, an ordered list of 1–8
beats, each `{ beatKey; personIds }` and nothing else. Angles have no minutes
either.

The content keys (`matchTypeKey`, `stipulationKeys`, `finishKey`,
`methodKey`, `angleTypeKey`, `beatKey`) point at data-pack catalogs owned by
MTCH and WLD. The World's schema does not check they resolve. The match type,
method and angle type keys resolve against `meta.catalogs`, which
`checkSegmentContentKeys` (`systems/match/catalog/checkSegmentKeys.ts`) and
validate:world's `segment-keys` rule check. A finish key resolves against
`meta.catalogs.finishes` and must suit the match, which
`checkSegmentFinishes` and the `segment-finishes` rule check
([match-finishes.md](match-finishes.md)); beats and stipulations get their
catalogs (and checks) with MTCH5 and MTCH7.
`SegmentRating` is written by EVT3's `shows.runShows` from the segment's
rater ([match-rating.md](match-rating.md)):

| Field         | Type                 | Notes                                                         |
| ------------- | -------------------- | ------------------------------------------------------------- |
| `score`       | 0–100                | the segment score                                             |
| `stars`       | 0–5 in quarter stars |                                                               |
| `workRate`    | 0–100 or null        | null only when the rater has no work rate (a talking segment) |
| `crowd`       | 0–100 or null        | null only when the rater has no crowd component               |
| `expectation` | 0–100 or null        | null only when the rater has no expectation component         |
| `traceId`     | string or null       | the trace's ref key, `refKey(ref)`                            |

`traceId` links to the recent-traces store kept in the save, so the Why? panel
can find a segment's trace; `traceRefFromKey` (`systems/shows/traces.ts`)
turns it back into a ref.

Refs: `eventInstanceId`, `storylineIds[]`, `crew.refereeId`,
`crew.producerId`, `crew.announcerIds[]`, `match.titleIds[]`,
`angle.beats[].personIds[]`. Indexes: `byEventInstance`, `byStoryline`
(multi-key), `byTitle` (multi-key, title matches only), and unique `bySlot`
keyed `` `${eventInstanceId}|${preShow ? 'pre' : 'main'}|${slot}` ``, so a
second segment in the same slot is refused at write time.

### Participants (`participants`, `ptc_`)

Who is in a segment. A table of its own because "every segment this person
was in" is a hot query (history, morale, momentum, AI booking).

| Field              | Type                                                                   | Notes                                                                                          |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`               | `ParticipantId`                                                        |                                                                                                |
| `segmentId`        | `SegmentId`                                                            |                                                                                                |
| `personId`         | `PersonId`                                                             |                                                                                                |
| `side`             | int 0–29                                                               | a singles match uses 0 and 1; a 30-person battle royal 0–29; screens show side n as "Side n+1" |
| `role`             | `'competitor' \| 'ringside' \| 'interferer' \| 'speaker' \| 'subject'` |                                                                                                |
| `teamId`           | `TeamId \| null`                                                       | the team they represent, if any                                                                |
| `entranceOrder`    | int ≥ 1 or null                                                        | battle royals and similar                                                                      |
| `eliminationOrder` | int ≥ 1 or null                                                        | null when not eliminated                                                                       |

Refs: `segmentId`, `personId`, `teamId`. Indexes: `bySegment`, `byPerson`,
unique `bySegmentPerson` (a person appears once per segment).

### Storylines (`storylines`, `sty_`)

| Field         | Type                                                  | Notes                                    |
| ------------- | ----------------------------------------------------- | ---------------------------------------- |
| `id`          | `StorylineId`                                         |                                          |
| `promotionId` | `PromotionId`                                         |                                          |
| `brandId`     | `BrandId \| null`                                     |                                          |
| `name`        | string, 1–80                                          |                                          |
| `status`      | `'active' \| 'ended'`                                 |                                          |
| `startedOn`   | `GameDate`                                            |                                          |
| `endedOn`     | `GameDate \| null`                                    | set exactly when ended; not before start |
| `heat`        | 0–100                                                 | feeds the crowd and the D-09 shield      |
| `members`     | `{ personId; side: 'face' \| 'heel' \| 'neutral' }[]` | 1–12, one entry per person               |
| `summary`     | string, ≤ 500                                         |                                          |

Refs: `promotionId`, `brandId`, `members[].personId`. Indexes: `byPromotion`,
`byMember` (multi-key).

### Seasons (`seasons`, `sea_`)

Seasons (D-08) are world-wide: every promotion and brand shares them, so a
season has no promotion.

| Field       | Type                      | Notes                                          |
| ----------- | ------------------------- | ---------------------------------------------- |
| `id`        | `SeasonId`                |                                                |
| `number`    | int ≥ 1                   |                                                |
| `startDate` | `GameDate`                |                                                |
| `endDate`   | `GameDate`                | not before `startDate`; planned for the active |
| `status`    | `'active' \| 'completed'` |                                                |

No refs. Indexes: unique `byNumber`, unique `activeSeason` (key `'active'`
for the active season, left out otherwise). The current season is
`seasons.lookupOne('activeSeason', 'active')`; there is no "current season"
field on the world to drift out of sync.

Season rules:

- Exactly one season is active whenever the table has rows, and it is the
  one with the highest number. An empty table is allowed only while a world is
  being built: the new-game flow creates season 1.
- Numbers run 1, 2, 3, ... with no gaps.
- Seasons are contiguous: each starts the day after the previous one's
  `endDate`, with no gap and no overlap.
- A season's length comes from `WorldMeta.settings.season.lengthDays`. The
  active season's `endDate` is computed from it when the season is created; a
  changed length applies from the next season.
- Season end (rollover, awards, recaps) runs in the DAY epic. Results, awards
  and brand-war standings are added to the season by the DAY and BRW epics with
  a migration once the save format is frozen.

### Why some values are copied

Most fields are references, but three are deliberate copies, because history
must not change when a template or a name changes later:

- An instance's `importance` and `format` are copied from its definition when
  it is scheduled. Editing a weekly show's format next year must not rewrite
  the cards of last year's shows.
- A reign's `holderNamesAtTime` keeps the ring names the champions used when
  they won, so the title history still reads correctly after a rename.

### Invariants

`checkWorld` reports these cross-row rules (the unique indexes above refuse
the rest at write time):

| Code                                                   | Rule                                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `titleReigns.holderCountMismatch`                      | a reign has exactly `title.holderCount` holders                                           |
| `titleReigns.overlap`                                  | reigns of one title do not overlap in time                                                |
| `segments.slotOutsideFormat`                           | a main-card slot is below `format.slots`, and a pre-show slot below `format.preShowSlots` |
| `segments.tooManyMainCard` / `segments.tooManyPreShow` | a section holds no more segments than `format.slots` / `format.preShowSlots`              |
| `segments.winningSideWithoutCompetitor`                | a match's `outcome.winningSide` has a `competitor` participant                            |
| `segments.titleFromOtherPromotion`                     | a match's `titleIds` belong to the instance's promotion                                   |
| `segments.resultBeforeCompletion`                      | `rating` is set only once the instance is `completed`; `outcome` may hold a plan earlier  |
| `segments.tooFewSides`                                 | a match has competitors on at least two distinct sides                                    |
| `seasons.activeCount` / `seasons.activeNotLatest`      | a non-empty table has exactly one active season, and it has the highest number            |
| `seasons.numberGap`                                    | season numbers run 1..n                                                                   |
| `seasons.notContiguous` / `seasons.overlap`            | each season starts the day after the previous one ends                                    |

Slot and format issues are reported against the `eventInstances` row, since
they are about the card as a whole. A card may have gaps: each section numbers
from 0 and open slots are simply absent, so a booker can fill the main event
first and leave slot 3 open (D-10, [booking.md](booking.md#the-card-model)).

## Geography, media, mail, news and ledger

Code: `packages/engine/src/model/entities/` (`geography.ts`, `venue.ts`,
`network.ts`, `deal.ts`, `mail.ts`, `news.ts`, `ledger-entry.ts`).

### The location hierarchy

```
Continent (ctn_)  code EU, name
   └── Country (cty_)  continentId, code GBR, population, wrestlingInterest, economy, preferredStyle
          └── Region (reg_)  countryId, population, wrestlingInterest, preferredStyle,
                             neighbourRegionIds ↔ (mutual)
                 ├── Venue (ven_)  regionId, capacity, kind, exclusivePromotionId
                 └── popularity per region (regionalPop on people and promotions)
```

Regions are the unit popularity is stored per (D-03). Countries and continents
are population-weighted roll-ups for display and coarse checks. A country's
and a continent's `code` is two or three uppercase letters and unique (the
`byCode` unique indexes). A region's neighbours are listed on both sides: when
A lists B, B lists A, and `checkWorld` reports a one-sided pair as
`region.neighbourNotMutual`. A region cannot list itself.

**A location is always an ID.** Every field that names a place is a
`ContinentId`, `CountryId` or `RegionId`, at every level and in every table: a
promotion's home, a venue's region, a network's coverage. Never a name string,
never a country in one place and a region name in another. When the same fact
is stored as a name in one system and an ID in another, the systems that key on
it drift apart quietly, and nothing fails until a custom promotion's home stops
matching anything. One rule, enforced by the types, removes that whole class of
bug. A test scans the entity folder and fails on any `*Continent`, `*Country`
or `*Region` field (with or without an `Id`/`Ids` suffix) that is not ID-typed.

### Venues

A venue sits in one region and has a `capacity` (1–200,000) and a `kind`
(`hall`, `theatre`, `arena`, `stadium`, `studio`, `outdoor`). `openedOn` and
`closedOn` are optional dates (null means "always been there" and "still
open"), with `closedOn` after `openedOn`. `exclusivePromotionId` binds a venue
to one promotion. An open venue exclusive to a closed promotion is legal but
odd, so `checkWorld` lists it as a **warning** (`venue.exclusiveClosed`), which
does not fail the report.

### Networks and deals

A **network** is a TV channel, a pay-per-view provider or a streaming service
(`kind`), with a `reachTier` from 0 (local) to 4 (global) and an `active` or
`closed` status. Its `coverage` lists continents, countries and regions by ID
(at least one entry, no duplicates within a list). `coveredRegionIds(network,
view)` expands coverage to the regions it reaches: every region of a listed
continent's countries, every region of a listed country, and each listed
region, once each in ascending ID order. A promotion's own streaming service
has `ownerPromotionId` set.

A **deal** is a promotion's agreement with a network. `eventDefinitionId`
names the show it airs, or is null for every televised show of the promotion.
It has a status (`offered`, `active`, `expired`, `cancelled`, `declined`), the
dates it was offered, starts and ends (`endsOn` after `startsOn`), a timeslot,
an optional weekday, a live flag and its terms (`feePerShow`,
`perThousandViewers`, `costPerShow`, all non-negative cents). What the terms are
worth belongs to the economy. Invariants: the show belongs to the deal's
promotion (`deal.eventDefinitionNotOwned`), and an active deal is on an active
network (`deal.networkNotActive`).

### Mail and news: templated text

Mail is a promotion's inbox: a category, a sender (a person, another
promotion, or the game), a subject and body, references to the rows it is
about, read and archived flags, and an optional **decision** of two to five
options with unique keys. `chosenKey` is null until the reader picks, and then
must be one of the option keys. The `byPromotionUnread` index files a mail only
while it is unread. News is the public feed: a kind (`result`, `titleChange`,
`signing`, ...), a headline and body, the same references, an importance from 0
(filler) to 3 (front page) and an optional expiry date.

Subjects, bodies, headlines and option labels are **templated text**: a
content key plus parameters (`{ key: 'mail.contract.offer', params: { amount:
150000 } }`), never rendered English. Saves stay language-neutral, so adding a
language later needs no save migration, and the UI can turn parameters into
links (a person's name opens their profile). Which mail and news get sent, and
the text catalogs behind the keys, belong to the systems that send them.

### The ledger

Every movement of a promotion's cash is one `LedgerEntry`: a date, a category,
a signed amount in cents, an optional memo (up to 120 characters), optional
references to the event, person or deal it came from, and `traceRef`: where
the row's Why? trace is stored. `traceRef` is null only for rows written before
the finance system (test fixtures).

**Only `postMoney` writes rows and moves cash.** During play, the finance
system's `postMoney` ([finances.md](finances.md#postmoney)) is the one way a
promotion's cash changes: it appends the row and moves the cash in the same
transaction. A test fails if any other code writes `promotions.cash`, apart from
a new world's opening balances.

**Sign convention:** income is positive and costs are negative, and the
category decides which (`LEDGER_CATEGORY_SIGN`). The schema refuses an amount
with the wrong sign, and refuses zero. That makes "the sum of a promotion's
entries over a period equals its cash change over that period" a check the
economy can test.

The set is complete for the whole economy epic (ECO1-01 added `subsidyIncome`,
`charity`, `networkUpkeep`, `buyout` and `subsidy`), so later features never
change the enum. The player-facing labels and who posts each category are in
[finances.md](finances.md#categories).

| Income (+)      | Costs (−)        |
| --------------- | ---------------- |
| `tickets`       | `wages`          |
| `liveMerch`     | `appearanceFees` |
| `merch`         | `signingBonuses` |
| `broadcast`     | `severance`      |
| `ppv`           | `venueRent`      |
| `streaming`     | `production`     |
| `sponsorship`   | `travel`         |
| `otherIncome`   | `marketing`      |
| `subsidyIncome` | `backOffice`     |
|                 | `medical`        |
|                 | `catering`       |
|                 | `otherCost`      |
|                 | `charity`        |
|                 | `networkUpkeep`  |
|                 | `buyout`         |
|                 | `subsidy`        |

**Append-only:** the ledger table is `appendOnly: true`, so transactions refuse
to update or delete its rows. Money has to reconcile, and an edited history
can't be audited. A mistake is fixed with a new, correcting entry. A log that
must never be edited but may be pruned uses `appendOnly: 'pruneOnly'` instead:
`update` throws `AppendOnlyError`, `delete` is allowed (the rival decision log,
[below](#rival-desk)). The
`byPromotionMonth` index (key `<promotionId>|YYYY-MM`) serves monthly reports.

Volume: one entry per worker per day would grow saves fast. The economy posts
one wages entry per promotion per day (or per pay period), and may later fold
old months into summary rows.

### Popularity show changes (`popularityShowChanges`, `psc_`)

What one completed show did to its promotion's popularity, region by region
(EVT5-02). The promotion popularity system writes one row right after
`show.completed` ([promotion-popularity.md](promotion-popularity.md#after-every-show)),
so a results page can list every region the show reached months later, after
the full Why? traces have been thinned out.

| Field             | Type                                     | Range / rule                            |
| ----------------- | ---------------------------------------- | --------------------------------------- |
| `id`              | `PopularityShowChangeId`                 |                                         |
| `eventInstanceId` | `EventInstanceId`                        | ref → eventInstance; one per show       |
| `promotionId`     | `PromotionId`                            | ref → promotion                         |
| `date`            | `GameDate`                               | the day the show ran                    |
| `score`           | number                                   | 0–100, the show's score                 |
| `worldBefore`     | number                                   | 0–100, worldwide before the show        |
| `worldAfter`      | number                                   | 0–100, worldwide after it               |
| `regions`         | `Record<RegionId, PopularityShowRegion>` | every reached region; keys ref → region |

Each `PopularityShowRegion` is `{ source, networkId, weight, expectation,
before, after, capped }`: how the region saw the show (`show`, `neighbour` or
`tv`), the network of a `tv` route (set exactly when `source` is `tv`), how much
of the show it saw (above 0, at most 1), the score fans there expected, the
stored popularity before and after (0 when none is stored), and whether the
monthly gain cap made the gain smaller. Regions where nothing changed are listed
too, so the page can say "about what fans expected".

A `{}` marker must end a reference path, so `regions{}.networkId` is checked by
the `networksExist` invariant instead of `refs`.

Indexes: `byEventInstance` (unique), `byPromotion`. Rows dated more than
`promoPop.keepShowChangesDays` (365) before the 1st of a month are deleted that
day, which bounds the table at roughly a year of shows.

## Match aftermaths

### Aftermaths (`aftermaths`, `aft_`)

What one run match did to one competitor's popularity and momentum (MTCH3-03).
Show night's aftermath applier writes one row per competitor per match, with
the values the doors actually wrote, so results pages and Recent form agree
with profiles even after the full trace is gone. See
[match-aftermath.md](match-aftermath.md#stored-aftermaths).

| Field             | Type                                                       | Notes                                                                    |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `id`              | `AftermathId`                                              |                                                                          |
| `segmentId`       | `SegmentId`                                                | the match                                                                |
| `eventInstanceId` | `EventInstanceId`                                          | the match's show                                                         |
| `promotionId`     | `PromotionId`                                              | the show's promotion                                                     |
| `personId`        | `PersonId`                                                 | the competitor                                                           |
| `date`            | `GameDate`                                                 | the show's date                                                          |
| `outcome`         | `'win' \| 'loss' \| 'draw'`                                | a no contest stores nothing                                              |
| `showRegionId`    | `RegionId`                                                 |                                                                          |
| `popularity`      | `{ delta, byRegion: Record<RegionId, { before, after }> }` | `delta` before the spread and taper; `byRegion` only the regions reached |
| `momentum`        | `{ employmentId, before, after } \| null`                  | null without a contract; `before` null when this match started it        |
| `traceIds`        | `{ popularity, momentum }`                                 | `refKey`s of the `match.popularityGain` / `match.momentumGain` traces    |

Refs: `segmentId`, `eventInstanceId`, `promotionId`, `personId`,
`showRegionId`, `popularity.byRegion{}` and `momentum.employmentId`. Indexes:
`bySegment`, `byPerson`, `byEventInstance` and unique `bySegmentPerson`.
Invariants: `aftermaths.showMismatch` (the row's show is its segment's) and
`aftermaths.promotionMismatch` (its promotion runs that show).

The weekly `match.pruneAftermaths` phase keeps each worker's newest
`match.aftermath.keepPerPerson` rows. The weekly momentum drift reads the
newest row with a momentum to tell whether a worker wrestled that week
([match-aftermath.md](match-aftermath.md#momentum-drift)). Saves list the table with a default of
`[]`, so saves written before it existed load with it empty.

## Promotion history

### Promotion snapshots (`promotionSnapshots`, `psh_`)

One promotion's state on one day (DAY2-01): a row every Monday for every open
promotion, a `baseline` row on the day a new game starts, and one `month` row
per calendar month once weeks are older than
`office.history.fullDetailWeeks`. Rows are facts: no trace or random draw is
stored with them. See [office.md](office.md#history).

| Field           | Type                                                | Notes                                                               |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `id`            | `PromotionSnapshotId`                               |                                                                     |
| `promotionId`   | `PromotionId`                                       |                                                                     |
| `date`          | `GameDate`                                          | a Monday, or the start date for a baseline                          |
| `granularity`   | `'week' \| 'month' \| 'baseline'`                   | `PROMOTION_SNAPSHOT_GRANULARITIES`                                  |
| `cash`          | `Cents`                                             | may be negative                                                     |
| `prestige`      | 0..100                                              |                                                                     |
| `popularity`    | `{ headline, world, homeRegionValue, byContinent }` | 0..100 each; `byContinent` is sparse and leaves out continents at 0 |
| `rosterSize`    | integer ≥ 0                                         | active contracts that have started                                  |
| `averageMorale` | -100..100 or null                                   | unrounded mean; null when nobody is under contract                  |
| `extra`         | `Record<SnapshotFieldKey, number>`                  | registered fields; an absent key means "not recorded that week"     |

`SnapshotFieldKey` matches `/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/`.
Refs: `promotionId` and `popularity.byContinent{}`. Indexes: `byPromotion`,
unique `byPromotionDate` (key `<promotionId>|<date>`, helper
`promotionSnapshotKey`) and `byDate`. Saves list the table with a default of
`[]`, so saves written before it existed load with it empty.

## Rival desk

The rival desk's two tables (AIP1-01). See [rival-desk.md](rival-desk.md).
Saves list both with a default of `[]`, so saves written before they existed
load with them empty.

### Rival profiles (`aiProfiles`, `aip_`)

One row per computer-run unit: a computer promotion as a whole, or a computer
brand inside a human promotion ([units](rival-desk.md#units)).

| Field         | Type                                                       | Notes                                                                                       |
| ------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`          | `AiProfileId`                                              |                                                                                             |
| `promotionId` | `PromotionId`                                              |                                                                                             |
| `brandId`     | `BrandId` or null                                          | null for a whole promotion                                                                  |
| `taste`       | eight 0..100 axes or null                                  | null until AIP2; axes in `TASTE_AXES`                                                       |
| `featured`    | `{ ace, prospects, nextReviewOn, lastReviewedOn }` or null | null until AIP3; `ace` and each prospect are `{ employmentId, since }`, at most 2 prospects |
| `createdOn`   | `GameDate`                                                 |                                                                                             |
| `lastTurnOn`  | `GameDate` or null                                         | null before the unit's first turn                                                           |

Refs: `promotionId`, `brandId`, `featured.ace.employmentId` and
`featured.prospects[].employmentId`. Indexes: `byPromotion` and unique
`byUnit` (key `aiUnitKey(promotionId, brandId)` =
`<promotionId>|<brandId ?? '-'>`). Invariants: `brandBelongsToPromotion` and
`featuredEmploymentsBelongToUnit`.

### Rival decisions (`aiDecisions`, `aid_`)

The decision log: `appendOnly: 'pruneOnly'`, so rows are added and pruned,
never edited ([decision log](rival-desk.md#decision-log)).

| Field         | Type                                                                    | Notes                                                 |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `id`          | `AiDecisionId`                                                          |                                                       |
| `promotionId` | `PromotionId`                                                           |                                                       |
| `brandId`     | `BrandId` or null                                                       | null for a whole-promotion unit                       |
| `date`        | `GameDate`                                                              | the day it was decided                                |
| `kind`        | string                                                                  | lower camelCase, at most 40 characters; open, no enum |
| `summary`     | `TemplatedText`                                                         | content key plus short params                         |
| `refs`        | `{ personIds, employmentIds, titleIds, promotionIds, eventInstanceId }` | lists default to `[]`, at most 12 IDs each            |
| `traceRef`    | `TraceRef` or null                                                      | a summary-only trace                                  |
| `revealOn`    | `GameDate`                                                              | other controllers see the row from this day           |
| `importance`  | 0..3                                                                    | 0 routine, 3 headline                                 |

Refs: `promotionId`, `brandId` and every ID in `refs`. Indexes:
`byPromotion`, `byPromotionDate` (key `<promotionId>|<date>`, helper
`aiDecisionDateKey`) and `byRevealOn`. Rows older than
`aip.decisionLogRetentionDays` are pruned once revealed.
