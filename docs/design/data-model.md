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
  (see the transactions section, to come); nothing outside the model layer can
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

## How to add a field

1. Add the field to the entity's zod schema and its TypeScript type follows.
2. If it holds an ID, add a reference spec; if screens or systems need to find
   rows by it, add an index.
3. Document it in the entity's section below.
4. Once the save format is frozen, bump the format version and add a tested
   migration that fills the field in older saves (see the save format doc, to
   come).

## People

_The person entity and its parts arrive with FND-06._

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

_Titles and reigns, event definitions and instances, segments and
participants, storylines and seasons arrive with FND-08._

## Geography, media, mail, news and ledger

_Continents, countries and regions, networks and deals, venues, mail, news and
the money ledger arrive with FND-09._
