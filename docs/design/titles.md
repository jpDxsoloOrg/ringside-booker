# Titles

The titles system (`packages/engine/src/systems/titles/`) owns the
championships: who holds each belt, who may, what a new belt is worth and how
long a reign has lasted. The tables it reads and writes, `titles` and
`titleReigns`, are described in
[data-model.md](data-model.md#titles-titles-tit_).

CRTV1-01 built the foundation on this page. CRTV1-02 adds the queries (the
Titles screen, the lineage, eligible holders), CRTV1-03 the
[commands](#commands) (create, edit, award, vacate, retire, reactivate) and
the daily [orphaned-champion rule](#orphaned-champions), and
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
| Commands     | `commands.ts`            | `titles.create`, `edit`, `award`, `vacate`, `retire`, `reactivate` ([commands](#commands)); checks in `validate.ts`  |
| Doors        | `doors.ts`               | `vacateTitle`, `retireTitle`, `reactivateTitle`: every vacancy and retirement outside a match                        |
| Phase        | `phases.ts`              | `titles.vacateOrphaned`: the daily [orphaned-champion rule](#orphaned-champions)                                     |

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
| `stripped`  | CRTV1-03: `titles.award` over a current champion                   |
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

## Commands

The booker's office (CRTV1-03, `commands.ts`): what titles exist and, outside
the ring, who holds them. Match results that change titles are EVT3's. Each
command checks everything first, applies in one transaction, returns plain
JSON, publishes one event (none for `edit`) and is written to the command log
with the controller that issued it. The rival desk uses the same commands on
its own promotions (`source: 'ai'`); a player's call is `source: 'player'`.
None of them changes morale, momentum, popularity or prestige.

Every command on an existing title starts with the same checks
(`validate.ts`), and stops at the first that fails:

| Code            | Player text                                                                               |
| --------------- | ----------------------------------------------------------------------------------------- |
| `titleNotFound` | "That title no longer exists." (field `titleId`)                                          |
| `notAllowed`    | "The Bravo Championship belongs to Bravo Wrestling. You can only change your own titles." |
| `titleRetired`  | "The Altura Legends Title is retired. Reactivate it first." (not for `reactivate`)        |

`notAllowed` is the built-in code: the issuer must run the title's promotion
(`controlsPromotion`), so the computer is refused on the player's titles and a
player on a rival's. Every reason names its subject (the title, person, team,
brand or promotion) and, when a form field is at fault, `field`.

| Command             | Arguments                                                                                    | Result                              | Event               |
| ------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------- |
| `titles.create`     | `promotionId`, `brandId` (or null), `name`, `holderCount` (1–3), `division`, `tier`, `color` | `{ titleId }`                       | `title.created`     |
| `titles.edit`       | `titleId`, and any of `name`, `brandId`, `division`, `color`, `holderCount`                  | `{ titleId }`                       | none                |
| `titles.award`      | `titleId`, `holderIds`, `teamId` (or null)                                                   | `{ reignId, previousReignId }`      | `title.awarded`     |
| `titles.vacate`     | `titleId`                                                                                    | `{ reignId }`                       | `title.vacated`     |
| `titles.retire`     | `titleId`                                                                                    | `{ endedReignId }` (null if vacant) | `title.retired`     |
| `titles.reactivate` | `titleId`                                                                                    | `{ titleId }`                       | `title.reactivated` |

**Create** makes an active, vacant title introduced today, with its
[starting prestige](#starting-prestige) and that formula's Why? at
`titles.prestige` / the title. **Edit** never changes prestige, tier or dates
(prestige moves through CRTV2, sandbox edits are MOD2's). **Award** ends a
current reign `stripped` today and opens the new one today (two awards on one
day leave a reign won and lost that day, which the overlap rule allows).
**Vacate** ends it `vacated` with a Why? at `titles.vacancy` / the reign
("Vacated by the booker"). **Retire** ends a current reign `retired` and sets
`status: 'retired'` and `retiredOn`; **reactivate** brings it back active and
vacant. Both keep `introducedOn` and the lineage.

The commands' own refusals:

| Code                  | Command      | Field                                 | Player text                                                                                                      |
| --------------------- | ------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `promotionNotFound`   | create       | `promotionId`                         | "That promotion no longer exists."                                                                               |
| `notAllowed`          | create       |                                       | "Bravo Wrestling isn't yours. You can only create titles for your own promotion."                                |
| `brandNotInPromotion` | create, edit | `brandId`                             | "That brand isn't part of Altura Pro."                                                                           |
| `brandInactive`       | create, edit | `brandId`                             | "Altura Classic is no longer running. Pick an active brand."                                                     |
| `nameLength`          | create, edit | `name`                                | "Give the title a name." / "Title names can be up to 60 characters." (after trimming)                            |
| `duplicateName`       | create, edit | `name`                                | "Altura Pro already has a title called Test Crown." (same promotion, any case)                                   |
| `weightRange`         | create, edit | `division.maxWeightKg`                | "The weight limit (90 kg) is below the minimum weight (100 kg)."                                                 |
| `holderCountLocked`   | edit         | `holderCount`                         | "Vacate the title before changing how many people hold it."                                                      |
| WRK1's reasons        | edit         | `division`                            | "Kai Storm couldn't hold it any more: too heavy for the TV Title (limit 90 kg, weighs 100 kg). Vacate it first." |
| eligibility           | award        | `holderIds[i]`, `holderIds`, `teamId` | Every [`isEligibleHolder`](#holders) reason                                                                      |
| `alreadyChampion`     | award        | `holderIds`                           | "Kai Storm already holds the Altura Television Title."                                                           |
| `alreadyVacant`       | vacate       |                                       | "The Altura Championship is already vacant."                                                                     |
| `notRetired`          | reactivate   |                                       | "The Altura Championship isn't retired."                                                                         |

Names are unique per promotion, not per world: two promotions may each have a
"World Championship". Award's per-holder reasons point at the holder's place
in the list (`holderIds[0]`, the second mention for a duplicate), the same
path style as `invalidArgs`; `wrongHolderCount` points at `holderIds` and
`teamMismatch` at `teamId`.

**Doors.** The commands write through `doors.ts`, and later features call the
same functions so they never write reigns themselves: `vacateTitle(ctx, {
titleId, reasonKey, source, explanation })` (ECO4 contracts, ECO9 closures,
ECO11 call-ups), `retireTitle(ctx, { titleId, source })` and
`reactivateTitle(...)`. They throw on misuse (vacating a vacant title,
retiring a retired one) and do not check who may: callers do.

## Orphaned champions

`titles.vacateOrphaned` (`phases.ts`, group `contracts`, order 90, daily) keeps
the lineage honest: a champion who no longer works for the title's promotion
(or its parent) for `titles.orphanGraceDays` days loses the title.

- **Who counts as gone.** A holder without a working contract with the title's
  promotion or its parent today ([working for the title's promotion](#holders)).
  A main-roster worker holding a developmental title is not gone.
- **Since when.** The latest day such a contract ended
  (`lastEmployedForTitleOn`), or the day they won the title when none has.
- **Grace.** The title is vacated when any holder has been gone for at least
  `titles.orphanGraceDays` days (default 7; 0 vacates on the day they leave).
- **Tag and trios titles** are vacated whole when one holder is gone; the title
  is never split.
- **Every promotion alike.** The rule is the same for the player's promotions
  and the rivals'; there is no rival shortcut. Retired titles are ignored.

It runs after the day's contract changes in the same group (the lifecycle at
10, walk-outs at 30), so a contract that ends today counts today. A daily
check rather than a reaction to `contract.expired` / `released` / `quit`: the
vacancy comes days after the event and the save holds no pending vacancies.
It is cheap: one `openByTitle` lookup per active title and one employment
lookup per champion, and the Why? is built only for a title it vacates. It
also catches champions who left before the rule existed.

The vacancy goes through `vacateTitle` (`reasonKey: 'orphaned'`, `source:
'system'`) with a decision Why? at `titles.vacancy` / the reign: one rule per
holder ("Rook Halvorsen has had no contract with Altura or its parent since 2
Mar 2027 (12 days)", failed once past the grace; "Kai Storm works for Altura",
passed), the `titles.orphanGraceDays` line, and "A champion has been gone
longer than the grace period". The lineage shows it as the Why? on "Vacated".
Nothing else changes: CRTV2 moves prestige on `title.vacated`, and a morale
reaction would be WRK8's.

| Key                      | Default | Range | Unit | Meaning                                                                                    |
| ------------------------ | ------- | ----- | ---- | ------------------------------------------------------------------------------------------ |
| `titles.orphanGraceDays` | 7       | 0–365 | days | Days a champion may be without a contract with the title's promotion (or its parent) first |

The release preview's `holdsTitle` warning says so: "Holds the <title>. If
they leave, the title is vacated after 7 days."
