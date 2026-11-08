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
to a kind that has no table is reported once per field, not once per row. An
invariant can mark an issue as a `warning` for a state that is legal but worth
flagging; warnings are listed but do not make the report fail.
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
a signed amount in cents, an optional memo (up to 120 characters) and optional
references to the event, person or deal it came from.

**Sign convention:** income is positive and costs are negative, and the
category decides which (`LEDGER_CATEGORY_SIGN`). The schema refuses an amount
with the wrong sign, and refuses zero. That makes "the sum of a promotion's
entries over a period equals its cash change over that period" a check the
economy can test.

| Income (+)    | Costs (−)        |
| ------------- | ---------------- |
| `tickets`     | `wages`          |
| `liveMerch`   | `appearanceFees` |
| `merch`       | `signingBonuses` |
| `broadcast`   | `severance`      |
| `ppv`         | `venueRent`      |
| `streaming`   | `production`     |
| `sponsorship` | `travel`         |
| `otherIncome` | `marketing`      |
|               | `backOffice`     |
|               | `medical`        |
|               | `catering`       |
|               | `otherCost`      |

**Append-only:** the ledger table is `appendOnly`, so transactions refuse to
update or delete its rows. Money has to reconcile, and an edited history can't
be audited. A mistake is fixed with a new, correcting entry. The
`byPromotionMonth` index (key `<promotionId>|YYYY-MM`) serves monthly reports.

Volume: one entry per worker per day would grow saves fast. The economy posts
one wages entry per promotion per day (or per pay period), and may later fold
old months into summary rows.
