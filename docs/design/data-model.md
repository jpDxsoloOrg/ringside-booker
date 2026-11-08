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

_Promotions, brands, employments and contracts arrive with FND-07._

## Titles, events, storylines and seasons

_Titles and reigns, event definitions and instances, segments and
participants, storylines and seasons arrive with FND-08._

## Geography, media, mail, news and ledger

_Continents, countries and regions, networks and deals, venues, mail, news and
the money ledger arrive with FND-09._
