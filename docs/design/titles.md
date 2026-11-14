# Titles

The titles system (`packages/engine/src/systems/titles/`) owns the
championships: who holds each belt, who may, what a new belt is worth and how
long a reign has lasted. The tables it reads and writes, `titles` and
`titleReigns`, are described in
[data-model.md](data-model.md#titles-titles-tit_).

CRTV1-01 built the foundation on this page. CRTV1-02 adds the queries (the
Titles screen, the lineage, eligible holders), CRTV1-03 the commands (create,
award, vacate, retire, reactivate) and the daily orphaned-champion rule, and
CRTV2 moves prestige over time. Show-night title changes are EVT3's
([show-night.md](show-night.md#title-outcomes)).

| Piece        | Where                    | What it does                                                                                                         |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Tiers        | `tiers.ts`               | `TITLE_TIERS`, `TITLE_TIER_LABELS`: World, Secondary, Specialty ([not stored](#tiers))                               |
| Tunables     | `tunables.ts`            | `titles.startPrestige.*`, category `Titles`                                                                          |
| Formulas     | `formulas/`              | `startingPrestige`, `reignDays`                                                                                      |
| Holders      | `helpers/holders.ts`     | `currentReign`, `currentHolders`, `titlesHeldBy`, `reignLabel`                                                       |
| Eligibility  | `helpers/eligibility.ts` | `isEligibleHolder`: the one holder check                                                                             |
| Employment   | `helpers/employment.ts`  | `employedForTitle`, `lastEmployedForTitleOn`, `ringNameForTitle`                                                     |
| Reign writes | `reigns.ts`              | `openReign`, `closeReign`: the only code that writes reigns                                                          |
| Traces       | `traces.ts`              | `titles.prestige` (per title): the Why? behind a belt's prestige                                                     |
| Events       | `events.ts`              | `title.created`, `title.awarded`, `title.vacated`, `title.retired`, `title.reactivated` (published from CRTV1-03 on) |
| Queries      | `queries.ts`             | `titles.list`, `titles.detail`, `titles.eligibleHolders` ([queries](#queries))                                       |
| Rows         | `rows.ts`                | `TitleCardRow`, `prestigeExplanation`, `divisionLabel`, `endReasonLabel`                                             |
| Records      | `records.ts`             | `titleRecords`, `daysVacant` ([records](#records))                                                                   |

## Starting prestige

What a newly created title is worth on day one. Code:
`formulas/startingPrestige.ts`.

```
stature  = (promotion prestige − promotionAnchor) × promotionWeight
prestige = round(clamp(base for the tier + stature, 0, 100))
```

The tier picks the base. A big promotion's new belt starts a little higher, a
small one's a little lower; with `promotionWeight` at 0 every new title starts
at exactly its tier's base. Halves round up.

The numbers are our own. They sit below most of the default world's belts on
purpose, so a new title has to earn its place (CRTV2 moves prestige with the
matches and champions it gets).

| Key                                    | Default | Range | Unit   | Meaning                                                       |
| -------------------------------------- | ------- | ----- | ------ | ------------------------------------------------------------- |
| `titles.startPrestige.world`           | 55      | 0–100 | points | Starting prestige of a new World title                        |
| `titles.startPrestige.secondary`       | 35      | 0–100 | points | Starting prestige of a new Secondary title                    |
| `titles.startPrestige.specialty`       | 20      | 0–100 | points | Starting prestige of a new Specialty title                    |
| `titles.startPrestige.promotionAnchor` | 50      | 0–100 | points | Promotion prestige at which a new title gets no adjustment    |
| `titles.startPrestige.promotionWeight` | 0.3     | 0–1   | ratio  | Share of the promotion's distance from the anchor that counts |

**Worked example.** Altura (prestige 80) creates a Secondary title:
35 + (80 − 50) × 0.3 = 35 + 9 = **44**. A World title there would start at
55 + 9 = 64; a Specialty title at a prestige-30 indie at 20 + (30 − 50) × 0.3
= 14.

The trace names the tier base, the promotion's prestige, the anchor and the
weight, so the Why? on a new belt reads "Secondary title base 35, promotion
stature +9 (80, no adjustment at 50, share 0.3)".

**Founded promotions.** A promotion founded at new game has no standing to
scale by, so its starter belt keeps the new-game number
(`newgame.found.titlePrestige`, see
[new-game.md](new-game.md#founding-a-promotion)). It still gets a
`titles.prestige` trace whose one step is that tunable, so its Why? works like
any other belt's.

## Days held

How long a reign has lasted. Code: `formulas/reignDays.ts`.

```
days held = max(0, days from wonOn to (lostOn, or today while current))
```

A reign counts from the day it was won up to, not including, the day it ended
(the same rule the [overlap check](data-model.md#title-reigns-titlereigns-trn_)
uses). So a reign won today reads 0, and so does a reign won and lost on the
same show; the UI words 0 as "Won today". The trace starts from "From 4 Jan
2027 to 12 Mar 2027" (or "to today") and carries that rule as a note.

## Holders

The champion is never stored on the title. It is the **open reign**, the one
with `lostOn === null`, found through the unique `openByTitle` index. Every
"who is champion" question goes through `currentReign` / `currentHolders`
(`[]` means vacant), and "what does this person hold" through `titlesHeldBy`
(open reigns only, in ID order; optionally one promotion's). Contracts' own
`titlesHeldBy` is a re-export of this one.

`reignLabel` names a reign in the lineage: the team's name when the champions
won it as a team that still exists, otherwise the ring names they used when
they won (`holderNamesAtTime`, joined with " & "). A later rename does not
rewrite history.

**Working for the title's promotion.** A worker counts as on the roster for a
title when they have a working contract (WRK1's `activeEmploymentsOf`) with the
title's promotion or with its parent (`parentPromotionId`), so a main-roster
worker may hold a developmental title, not the other way round.
`employedForTitle` answers that; `lastEmployedForTitleOn` gives the latest day
such a contract ended, for CRTV1-03's orphaned-champion rule.

**Who may hold it.** `isEligibleHolder(read, title, { holderIds, teamId },
date)` is the one holder check: the award command, the eligible-holders query
and later booking (EVT2, AIP) all call it. It returns every reason, in this
order; an empty list means eligible.

| Code               | Player text                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `titleRetired`     | "The Altura Legends Title is retired. Reactivate it first."          |
| `wrongHolderCount` | "The Altura Tag Team Championship needs 2 champions."                |
| `duplicateHolder`  | "Kai Storm is named more than once."                                 |
| `notOnRoster`      | "Kai Storm doesn't work for Altura Pro."                             |
| WRK1's reasons     | `notAWrestler`, `divisionGender`, `belowMinWeight`, `aboveMaxWeight` |
| `teamMismatch`     | "The Night Shift isn't made up of these champions." (or has split)   |

WRK1's own `titleRetired` ([workers.md](workers.md#title-eligibility)) is not
repeated per holder.

## Writing reigns

`openReign` and `closeReign` (`reigns.ts`) are the only code in the titles
system that creates or ends a reign, and every other feature should call them
rather than write `titleReigns` itself:

- `openReign(ctx, { titleId, holderIds, teamId, wonInSegmentId })` starts a
  reign on `ctx.date` with no defences. `holderNamesAtTime` is each holder's
  ring name with the title's promotion (or its parent), falling back to their
  default ring name.
- `closeReign(ctx, { reignId, endReason, endedInSegmentId })` ends it on
  `ctx.date`.

Both throw an `InvariantError` on misuse (opening while the title has a
current reign, closing a reign that has ended). The table's invariants
(`openByTitle`, `reignsDoNotOverlap`, `holderCountMatchesTitle`) stay the last
line of defence. To hand a title over on one day, close the old reign first,
then open the new one.

| `endReason` | Written by                                                         |
| ----------- | ------------------------------------------------------------------ |
| `lost`      | EVT3, show night: the champion lost a title match                  |
| `vacated`   | CRTV1-03: the booker vacates it, or the orphaned-champion rule     |
| `stripped`  | Later creative features (a champion stripped for cause)            |
| `retired`   | CRTV1-03 when the title is retired; DAY6 when the champion retires |
| `unified`   | A later unification feature                                        |

`retired` covers both a retired title and a retired champion. The lineage
(CRTV1-02) tells them apart by comparing the reign's `lostOn` with the title's
`retiredOn`: equal means the title was retired with the reign; otherwise the
champion retired.

EVT3's show-night title change (`systems/shows/titles.ts`) landed before this
system and still writes its reigns itself; CRTV1-06 points it at these two
functions.

## Tiers

World, Secondary and Specialty (`TITLE_TIERS`, labels in `TITLE_TIER_LABELS`).
The tier is a choice made when a title is created, and its only job is to pick
the [starting prestige](#starting-prestige) base. It is **not stored** on the
title: once a title exists only its prestige matters, so a Secondary belt that
earns its way up is worth as much as a World title with the same prestige.
Keeping it out of the save also means no schema change, so existing saves keep
loading.

## Queries

Three queries (CRTV1-02), all plain JSON, none of them throwing: a title id
that is not in the world comes back as the reason `titleNotFound` ("That title
doesn't exist any more."). Titles and lineages are public knowledge in the game
world, so every viewer gets the same rows. The one difference is `editable`:
true only when the viewer is a controller that runs the title's promotion
(`controlsPromotion`). A rival's titles are never editable for the player, and
the omniscient viewer is read-only too; screens show or hide every action from
it.

### The title card (`TitleCardRow`)

Every query returns titles as the same card (`rows.ts`): id, name, promotion
and brand (ids and names; `brandName` null for a promotion-wide title),
`holderCount`, `division` and `divisionLabel`, `prestige` with its Why?,
`status`, `introducedOn`, `retiredOn`, `imageRef`, `color`, `editable`, and the
`champion` (null = vacant): the open reign's holders (current ring names with
the title's promotion), `teamId`, `label` (`reignLabel`), `wonOn`, `daysHeld`
([days held](#days-held) to today) and `defences`.

`divisionLabel` puts the division in words: "Open", "Men's" or "Women's"; with
a weight limit, the [weight class](workers.md#weight-class) of the top limit
and the limits, such as "Cruiserweight: up to 93 kg", "Women's, Lightweight:
up to 70 kg" or "Heavyweight: 100 kg and over". An open division with a weight
limit shows only the weight part.

**Prestige explanation.** Exactly one of `prestigeTraceRef` and
`prestigeTrace` is set, so every prestige number on screen explains itself:

1. The stored `titles.prestige` trace when there is one (titles created in
   play, and later every prestige move from CRTV2): `prestigeTraceRef`.
2. Otherwise, a title that was there when the game began (`introducedOn` on or
   before `meta.startDate`) gets an inline one-line trace, "Prestige set by
   the world file". The 28 default-world titles start this way.
3. Otherwise, an inline "Prestige today" with the note "The full breakdown is
   only kept for recent changes" (the stored trace has been dropped).

### `titles.list`

Args `{ scope: 'own' | 'world', status: 'active' | 'retired' | 'all' }`.
Result `{ groups, counts }`; each group is `{ key, promotionId,
promotionName, brandId, brandName, logoRef, titles }`.

- **`own`**: the viewer's promotions (`viewerPromotionIds`, id order). One
  group per brand of each, in brand `priority` order (key `brand:<id>`, the
  brand's logo), then a "Promotion-wide" group for titles with no brand (key
  `promotionWide:<promotionId>`, the promotion's logo). An inactive brand shows
  only while it still owns a title in the filter.
- **`world`**: every other promotion, one group each (key `promotion:<id>`,
  `brandId` and `brandName` null), ordered by promotion prestige descending,
  then name, then id. Inside a group, titles go by brand priority first
  (promotion-wide last).
- Inside every group: prestige descending, then name, then id. Empty groups
  are left out.
- `status` filters on the title's status. `counts` (`{ active, retired }`)
  counts the scope's titles before the filter, for the tabs.
- A seat that runs no promotion (unemployed, a computer controller) and the
  omniscient viewer get no `own` groups and every promotion under `world`.

Grouping reads `brands` and `promotions` directly, so brand renames and
reorders (CRTV6) show up with no change here.

### `titles.detail`

Args `{ titleId }`. Result `{ title, reigns, records, stats }`:

- `title`: the card.
- `reigns`: the full lineage, newest first (`wonOn` descending, then id
  descending; the open reign always first). Each `ReignRow` has `reignId`,
  `number` (1 = the first reign, counted in the order they were won), the
  holders (`nameAtTime` from `holderNamesAtTime`, `currentRingName`,
  `imageRef`), `teamId`, `label`, `wonOn`, `lostOn`, `daysHeld` and
  `daysHeldTrace` (the inline `reignDays` trace), `defences`, `endReason` and
  `endReasonLabel`, `endTraceRef` (`{ kind: 'titles.vacancy', id: reignId }`
  when CRTV1-03 stored why it was vacated), and the raw `wonInSegmentId` /
  `endedInSegmentId` for the results pages to link.
- `records`: see [records](#records).
- `stats`: `totalReigns`, `distinctChampions` (different people) and
  `daysVacant`.

Lineage is history the player keeps forever: the weekly history roll-up does
not prune reigns.

| `endReason`  | `endReasonLabel`                                                                  |
| ------------ | --------------------------------------------------------------------------------- |
| (open reign) | "Current champion"                                                                |
| `lost`       | "Lost the title"                                                                  |
| `vacated`    | "Vacated"                                                                         |
| `stripped`   | "Stripped"                                                                        |
| `unified`    | "Unified"                                                                         |
| `retired`    | "Title retired" when `lostOn` is the title's `retiredOn`, else "Champion retired" |

### `titles.eligibleHolders`

Args `{ titleId, includeIneligible }`. Everyone with a working contract with
the title's promotion or its parent (WRK1's active employments; one
promotion's roster, never the whole world) is checked with `isEligibleHolder`
as a single holder. `wrongHolderCount` and `titleRetired` are left out: the
holder count, the team and the title's status are award-time checks.

Result `{ holderCount, teams, people, ineligible }`:

- `people` (`EligiblePerson`): `personId`, `ringName`, `imageRef`, `gender`,
  `weightKg`, `weightClass`, `push`, `brandId`, `sameBrand`, `availability`
  (WRK1's `availabilityOf`) and `isCurrentHolder`. Ordered same brand first,
  then push (main event first), then ring name, then id.
- `teams`, for tag (2) and trios (3) titles only: active teams of that kind
  (`tag`, `trio`) whose members are all in `people`, same brand first, then
  name. Screens list them before the people.
- `ineligible`, only with `includeIneligible`: `{ personId, ringName,
reasons }` with the [holder reasons](#holders), by ring name.

A brand mismatch is a hint (`sameBrand: false`, true for every worker when the
title is promotion-wide), never a refusal (D-06: warn, don't block).

## Records

`titleRecords(reigns, peopleById, today)` (`records.ts`) is a pure function:
the lineage passes its reigns and the champions' birth dates and ring names.
Each record is `{ value, label, personIds, reignIds }`, or null when no reign
qualifies.

| Record             | Value                                  | Counts                                                     |
| ------------------ | -------------------------------------- | ---------------------------------------------------------- |
| `longestReign`     | days held                              | every reign, the current one counted to today              |
| `shortestReign`    | days held                              | finished reigns only (null while nobody has lost it)       |
| `mostDefences`     | defences                               | one reign                                                  |
| `mostReigns`       | reigns                                 | per person; every holder of a tag or trios reign counts it |
| `mostCombinedDays` | days                                   | per person, over all their reigns                          |
| `oldestChampion`   | age in whole years on the day they won | per reign and holder                                       |
| `youngestChampion` | age in whole years on the day they won | per reign and holder                                       |

A reign record's `label` is the reign's label; a person record's is the
person's ring name today. People the lineage knows nothing about are skipped
for the age records.

**Ties** go to the earliest `wonOn`, then the lowest id. For a reign record
that is the reign's own `wonOn` and id; for a person record, the person's first
reign of the title, then their person id; for the age records the reign, then
the person id (two holders of one tag reign of the same age).

**Days vacant** (`daysVacant`): days from `introducedOn` up to today (or to
`retiredOn` for a retired title) that no reign covers, counting each reign the
way [days held](#days-held) does. Parts of reigns before `introducedOn` and
overlaps are counted once.
