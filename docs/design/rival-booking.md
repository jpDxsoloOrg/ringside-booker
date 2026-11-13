# Rival booking

Rival promotions have shows on the calendar (EVT1), but until AIP4 nobody books
them: show night gives each one a traced off-screen score instead (EVT3). The
card planner (AIP4) books real cards for them, slot by slot. The same planner
later fills empty slots on the player's own booking screen (Auto-fill) and
books computer-GM brands (BRW6).

The planner **fills N slots and never sets lengths** (D-10). A show has
`format.slots` main-card slots and `format.preShowSlots` pre-show slots; a
slot's position gives its role (the last main-card slot is the main event),
and nothing in the planner sets or reads how long a segment runs.

Code: `packages/engine/src/systems/aip/card/`, inside the rival desk's `aip`
bundle ([rival-desk.md](rival-desk.md)); there is no second system. AIP4-01
lays the groundwork described here, all pure and read-only: the card pool, the
card shape, the tunables and the random streams. Nothing runs in the day loop
yet. Later AIP4 tickets add the picking, title matches, talking segments and
Auto-fill.

## Card pool

`buildCardPool(read, { instance, date, tunables })` (`card/pool.ts`) answers
"who and what may this show use today". It reads the world and never writes.

**Roster.** The show's promotion's `active` contracts that have started
(`employments` index `byPromotionStatus`), as a wrestler, manager or presenter.
Referees, announcers, producers and bookers are crew and are not booked into
segments. On a brand's show only that brand's contracts and brandless ones
count: the planner never books another brand's worker (the booking checks only
warn the player about that). On a show without a brand every contract counts.
One contract per person, the lowest ID.

**Per person** (`CardCandidate`):

| Field           | Rule                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `cardValue`     | The rival desk's traced card value at the promotion ([card value](rival-desk.md#card-value)), with the contract's taste         |
| `availability`  | WRK1's `availabilityOf` on the show's date ([workers.md](workers.md#availability))                                              |
| `canWrestle`    | Available, holds a wrestling role and is under contract as a wrestler                                                           |
| `canTalk`       | Available, or out but still able to do talking segments (`canWorkAngles`)                                                       |
| `restedEnough`  | Fatigue at or below `aip.card.maxFatigue`                                                                                       |
| `contractBlock` | `appearanceCap` when this year's appearances have reached the cap; `noHouseShows` on a house show for a contract with that perk |
| `teamIds`       | The pool's teams the person is in                                                                                               |
| `championOf`    | The pool's titles the person holds now (their open reign)                                                                       |
| `talkValue`     | The mean of mic and charisma, traced                                                                                            |

Someone who can neither wrestle nor talk is not a candidate. Tired and
contract-blocked people stay in the pool as a last resort, with their flags
set. Candidates are sorted by card value, highest first, then person ID, so a
later pick can take the first that fits and two builds on the same world agree.

**Teams.** Active tag and trio teams whose members can all wrestle on the
show, with the mean of their members' card values. A team with an injured,
suspended or other-brand member is left out.

**Titles.** The promotion's `active` titles that belong to the show's brand or
to no brand (all of them on a show without a brand), with prestige, holder
count, division, the open reign and its holders' names.

**`availableWrestlers`** counts candidates that can wrestle, are rested enough
and have no contract block. `aip.card.minWorkers` is the line under which a
later ticket cancels the show.

**`excluded`** lists, in roster order, everyone the planner will not book
first and why, for the plan's Why?:

| Case                            | Reason                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| Cannot work                     | WRK1's reason with its date: "Injured (leg injury) until 12 Feb"   |
| Injured but can talk            | "Injured (arm injury) until 25 Jan; can still do talking segments" |
| Too tired                       | "Tired (fatigue 82, limit 75)"                                     |
| Appearance cap used up          | "Used 24 of 24 contracted appearances"                             |
| No house shows, on a house show | "Contract: no house shows"                                         |

Several reasons for one person are joined with "; ".

**Taste.** The pool carries the taste of whoever books the show (`tasteOf`
for the show's deciding brand, see
[rival-desk.md](rival-desk.md#taste)). The planner reads three of its eight
axes, each 0–100: `talkShare` (share of talking segments), `titleFocus` (how
often titles are defended; AIP5 reads the same axis for title changes) and
`riskAppetite` (appetite for tag, multi-way and unusual match types). AIP2
shifts these same axes per booker; the planner adds none.

## Card shape

Before anyone is picked, the planner splits the main card. Three pure
functions in `card/formulas/cardShape.ts`, each fully traced.

### Talking slots

`talkSlotsFor({ showName, slots, importance, talkShare }, { tunables })`:

```
factor = 1 + aip.card.talkTasteSwing × (talkShare − 50) ÷ 50
share  = aip.card.talkShare.<importance> × factor, kept within 0 and aip.card.maxTalkShare
raw    = round(slots × share)
limit  = ceil((slots − 1) ÷ 2)   on a show whose main event must be a match
         ceil(slots ÷ 2)         on a house show
talking slots = min(raw, limit)
```

The limit is the room for talking segments with no two in a row (and, off a
house show, the last slot kept for a match). Taste 50 leaves the show's share
as it is; with the default swing of 0.5, taste 0 halves it and taste 100 adds
half again. A share of 0 gives 0, whatever the taste.

Examples at the defaults: a 6-slot regular show at taste 50 plans
`round(6 × 0.3) = 2` talking segments and 4 matches; taste 0 plans 1 and
taste 100 plans 3 (the limit on 6 slots). A house show plans none. A 3-slot
show other than a house show never has more than 1.

The trace reads "Main-card slots", "Talking share for a <importance> show",
"Booker's taste for talking (<n>)", "Rounded" and "Room without back-to-back
talking".

### Title matches

`titleMatchCapFor({ importance, matchSlots }, { tunables })`:

```
title match cap = min(aip.titles.maxPerShow.<importance>, matchSlots)
```

`matchSlots` is the main-card slots left once the talking slots are counted.

### Main event

`mainEventMustBeMatch(importance)` is a traced yes or no: house shows may end
on anything; every other show ends on a match.

## Random streams

Declared in `card/streams.ts`:

- `aip.card`: rival show planning. Shows are planned in event instance ID
  order, each drawing one sequence, so one show's draws never reorder another
  show's picks.
- `aip.autofill`: the player's Auto-fill. A stream of its own, so pressing
  Auto-fill never shifts what the rivals book.

## Tunables

Category `Rival booking`, in `card/tunables.ts`; the table is in
[tunables.md](tunables.md#rival-booking-tunables). Later AIP4 tickets append
their keys to the same file.

| Key                                  | Default                 | What it does                                                          |
| ------------------------------------ | ----------------------- | --------------------------------------------------------------------- |
| `aip.card.maxFatigue`                | 75                      | Fatigue above which a worker is only a last resort                    |
| `aip.card.minWorkers`                | 5                       | Fewer wrestlers fit to work than this cancels the show (0 never)      |
| `aip.card.mixedGender`               | false                   | Whether a non-title match may mix men and women                       |
| `aip.card.talkShare.<importance>`    | 0, 0.15, 0.3, 0.2, 0.15 | Talking share on house, minor, regular, major and flagship shows      |
| `aip.card.talkTasteSwing`            | 0.5                     | How far the booker's taste moves the talking share                    |
| `aip.card.maxTalkShare`              | 0.5                     | The largest talking share                                             |
| `aip.card.fillPreShow`               | true                    | Whether the pre-show slots are filled                                 |
| `aip.titles.maxPerShow.<importance>` | 1, 1, 2, 4, 6           | Most title matches on house, minor, regular, major and flagship shows |
