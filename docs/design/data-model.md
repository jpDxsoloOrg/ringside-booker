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

| Field               | Type                                                          | Notes                                         |
| ------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `id`                | `EventInstanceId`                                             |                                               |
| `promotionId`       | `PromotionId`                                                 |                                               |
| `eventDefinitionId` | `EventDefinitionId \| null`                                   | null for a one-off                            |
| `brandId`           | `BrandId \| null`                                             |                                               |
| `name`              | string, 1–60                                                  |                                               |
| `importance`        | as on the definition                                          | copied at scheduling                          |
| `format`            | `ShowFormat`                                                  | copied at scheduling                          |
| `date`              | `GameDate`                                                    | the live or taping date                       |
| `airDate`           | `GameDate`                                                    | not before `date`; equal unless taped         |
| `status`            | `'scheduled' \| 'booked' \| 'completed' \| 'cancelled'`       |                                               |
| `venueId`           | `VenueId \| null`                                             |                                               |
| `regionId`          | `RegionId`                                                    |                                               |
| `result`            | `null \| { score; attendance; gate: Cents; viewers \| null }` | set exactly when completed; EVT/ECO extend it |

Refs: `promotionId`, `eventDefinitionId`, `brandId`, `venueId`, `regionId`.
Indexes: `byPromotion`, `byDate`, `byDefinition`.

### Segments (`segments`, `seg_`)

A segment is a match or an angle, as a union on `kind`, so nothing can build a
segment without saying which it is, and every reader has to handle both. Use
`isMatch(segment)` / `isAngle(segment)` to narrow.

Shared fields:

| Field             | Type                                                                          | Notes                                        |
| ----------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| `id`              | `SegmentId`                                                                   |                                              |
| `eventInstanceId` | `EventInstanceId`                                                             |                                              |
| `slot`            | int ≥ 0                                                                       | position within its card section, from 0     |
| `preShow`         | boolean                                                                       | true = pre-show section, false = main card   |
| `label`           | string or null                                                                | a billing line such as a contender's match   |
| `storylineIds`    | `StorylineId[]`                                                               | unique                                       |
| `crew`            | `{ refereeId: PersonId \| null; producerId: PersonId \| null; announcerIds }` | at most 4 announcers                         |
| `rating`          | `null \| { score: 0–100; stars: 0–5 in quarter stars; traceId \| null }`      | set once the show is completed; MTCH extends |

`kind: 'match'` adds:

- `match`: `{ matchTypeKey; stipulationKeys[]; titleIds: TitleId[]; finishKey | null }`.
- `outcome`, the outcome union:
  - `null` until the show is completed;
  - `{ kind: 'win'; winningSide; methodKey }`, where `winningSide` is a
    participant `side`;
  - `{ kind: 'draw' }`;
  - `{ kind: 'noContest' }`.

`kind: 'angle'` adds `angle`: `{ angleTypeKey; beats }`, an ordered list of 1–8
beats, each `{ beatKey; personIds }` and nothing else. Angles have no minutes
either.

The content keys (`matchTypeKey`, `stipulationKeys`, `finishKey`,
`methodKey`, `angleTypeKey`, `beatKey`) point at data-pack catalogs owned by
MTCH and WLD. The World does not check they resolve; the content loader does.
`traceId` links to the recent-traces store kept in the save, so the Why? panel
can find a segment's trace.

Refs: `eventInstanceId`, `storylineIds[]`, `crew.refereeId`,
`crew.producerId`, `crew.announcerIds[]`, `match.titleIds[]`,
`angle.beats[].personIds[]`. Indexes: `byEventInstance`, `byStoryline`
(multi-key), `byTitle` (multi-key, title matches only), and unique `bySlot`
keyed `` `${eventInstanceId}|${preShow ? 'pre' : 'main'}|${slot}` ``, so a
second segment in the same slot is refused at write time.

### Participants (`participants`, `ptc_`)

Who is in a segment. A table of its own because "every segment this person
was in" is a hot query (history, morale, momentum, AI booking).

| Field              | Type                                                                   | Notes                           |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------- |
| `id`               | `ParticipantId`                                                        |                                 |
| `segmentId`        | `SegmentId`                                                            |                                 |
| `personId`         | `PersonId`                                                             |                                 |
| `side`             | int 0–7                                                                | a singles match uses 0 and 1    |
| `role`             | `'competitor' \| 'ringside' \| 'interferer' \| 'speaker' \| 'subject'` |                                 |
| `teamId`           | `TeamId \| null`                                                       | the team they represent, if any |
| `entranceOrder`    | int ≥ 1 or null                                                        | battle royals and similar       |
| `eliminationOrder` | int ≥ 1 or null                                                        | null when not eliminated        |

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
| `segments.slotsNotContiguous`                          | within an instance, main-card slots run 0..n-1, and pre-show slots run 0..m-1, separately |
| `segments.tooManyMainCard` / `segments.tooManyPreShow` | a section holds no more segments than `format.slots` / `format.preShowSlots`              |
| `segments.winningSideWithoutCompetitor`                | a match's `outcome.winningSide` has a `competitor` participant                            |
| `segments.titleFromOtherPromotion`                     | a match's `titleIds` belong to the instance's promotion                                   |
| `segments.resultBeforeCompletion`                      | `rating` and `outcome` are set only once the instance is `completed`                      |
| `segments.tooFewSides`                                 | a match has competitors on at least two distinct sides                                    |
| `seasons.activeCount` / `seasons.activeNotLatest`      | a non-empty table has exactly one active season, and it has the highest number            |
| `seasons.numberGap`                                    | season numbers run 1..n                                                                   |
| `seasons.notContiguous` / `seasons.overlap`            | each season starts the day after the previous one ends                                    |

Slot and format issues are reported against the `eventInstances` row, since
they are about the card as a whole.

## Geography, media, mail, news and ledger

_Continents, countries and regions, networks and deals, venues, mail, news and
the money ledger arrive with FND-09._
