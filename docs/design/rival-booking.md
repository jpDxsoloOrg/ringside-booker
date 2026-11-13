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
yet. AIP4-02 adds the title picture and the challengers. AIP4-03 fills the
rest of the card: storyline segments, filler matches, the fallback chain and
talking segments. Later AIP4 tickets order and write the card, and add
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

## Title picture

`decideTitlePicture(pool, { today, taste, cap, alreadyBooked? }, { read, tunables, rng })`
(`card/titlePicture.ts`) answers "which titles are on the line tonight, who
challenges, and in what match". It reads the world and writes nothing; it
returns `{ planned, skipped, trace }` for the card planner (AIP4-04).

Titles are considered in prestige order (highest first, then title ID), never
shuffled. Each title gets one decision, labelled with its name, and its rules
run in this order:

1. **"Vacant: crown a new champion".** A vacant title is always wanted.
2. **"Champion available tonight".** Every holder is in the card pool, can
   wrestle, is rested enough and has no contract block. Otherwise the title is
   skipped with the pool's reason: "Champion Haruto Ise can't defend tonight:
   Injured (leg injury) until 12 Feb".
3. **Urgency.** The title is due when its urgency reaches
   `aip.titles.dueThreshold`: "Due: urgency 1.6 ≥ 1", or "Not due: urgency
   0.4 < 1" and skipped.
4. **The cap.** The card holds at most `titleMatchCapFor` title matches:
   "Card already has 2 title matches (limit 2)".

Wanted titles are booked vacant first, then by urgency (highest first), then
prestige, so on a busy night the most overdue titles get the slots. A champion
already booked in an earlier title match tonight is not booked again. Each
title then needs a match type and challengers; a title without them is skipped
("No eligible challenger tonight"), never forced into an invalid match.

### Urgency

`titleUrgency({ titleName, prestige, daysSinceDefence, importance, titleFocus })`
(`card/formulas/titleUrgency.ts`), in points:

```
interval = aip.titles.defenceIntervalDays × (1 + aip.titles.tempoSwing × (50 − titleFocus) ÷ 50),
           at least 1 day
overdue  = daysSinceDefence ÷ interval
urgency  = overdue + prestige ÷ 100 × aip.titles.prestigeWeight
                   + aip.titles.importanceBonus.<importance>
```

`titleFocus` is the booker's taste axis (`tasteOf`). At the default swing of
0.5, taste 100 halves the usual gap (a title every two weeks) and taste 0 makes
it half as long again. Prestige adds a little: a 100-prestige title is due a
little sooner than a 0-prestige one. The importance bonus is how big shows put
several titles on the line: a major show adds 1 and the flagship 2, enough to
make every title with a fit champion due.

**Days since the last defence** (`card/titleHistory.ts`, `lastDefenceOf`): the
date of the latest completed show with a match for the title (`segments` index
`byTitle`), else the open reign's `wonOn`. Until show night completes title
matches (EVT3), every reign counts from the day it was won and the trace says
so: "No completed defence yet: counting from the reign's start". That makes
long reigns look ever more due, which is honest.

The trace reads "Usual gap between defences", "Booker's title taste (<n>)",
"<d> days since the last defence", "Prestige" and "A <importance> show".

### Match type

A title match is rolled among the non-hidden match types that allow titles,
have two equal sides and take the title's holder count per side (for a singles
title: singles, endurance and sprint; a handicap match never holds a title).
The weights are the filler matches' [match type weights](#match-types), with
the people the match needs, the wrestlers still free and the free teams of the
title's size. The roll comes after the challengers are picked and is a
decision in the title's trace; when every weight is 0 the first type by
display order is used.

## Challengers

`pickChallengers(pool, title, { alreadyBooked }, { read, tunables, rng })`
(`card/challengers.ts`) returns one challenging side for a defence, two for a
vacant title, or null.

Rules, in order, for each candidate in the card pool (each failure is a rule
line in the trace):

1. fit tonight: can wrestle, rested enough, no contract block;
2. not on tonight's card already;
3. not a holder of this title;
4. not a holder of another title, while `aip.titles.excludeOtherChampions` is
   on (champions defend their own titles);
5. eligible for the title: WRK1's `isEligibleForTitle`, with its reason text
   ("Too heavy for the Cruiserweight Title (limit 100 kg, weighs 120 kg)").
   Gender and weight limits are checked as inclusive ranges, never as exact
   matches;
6. not one of the title's last `aip.titles.recentChallengers` challengers.

**Why recent challengers rest.** A rival that books the same challenger week
after week looks broken, so the last few challengers sit out. When resting them
leaves nobody, the rule is lifted with the line "No fresh challenger: a rematch
is allowed". Recent challengers are the competitors of the title's latest
completed matches who did not hold it going in (`recentChallengersOf`).

**Singles titles.** The survivors are ranked by card value; the top
`aip.titles.challengerPool` are considered with their card-value traces ("#1
Haruto Ise, card value 71") and one is picked by a weighted roll on the
`aip.card` stream (weight = card value, at least 1). The roll is in the trace.
The same seed always gives the same pick.

**Team titles** (two or three holders). Challengers are the pool's teams of
the matching kind (tag for two, trios for three) whose members all pass the
rules, ranked by mean card value, picked the same way. When no team is free,
the best eligible worker outside any team is paired with the workers closest
to them in card value: "No established team free: A & B paired for tonight".
The champions' side is the open reign's holders, with the reign's team.

**Vacant titles.** The two best contenders (people or teams) by the same rules
meet, with no roll: "Vacant title: the two best eligible contenders meet".

Who wins is not decided here; AIP5 owns winners and title changes.

## Filling the card

`fillCard(pool, { titles, matchSlots, talkSlots, talkRoom?, alreadyBooked? },
{ read, tunables, rng })` (`card/fill.ts`) returns every segment a show gets
tonight, in no order yet: AIP4-04 places them in slots and AIP4-05 writes them.
It books, in this order:

1. the title matches already decided by the [title picture](#title-picture),
   as they are;
2. [storyline segments](#storylines), each taking a match or a talking slot;
3. a filler match for every match slot left. Its type is rolled with the
   [match type weights](#match-types), then every place is filled through the
   [fallback chain](#fallback-chain);
4. a [talking segment](#talking-segments) for every talking slot.

Each planned segment (`PlannedSegment`) has a stable `key` (`title:<id>`,
`storyline:<id>`, `filler:<n>`, `talk:<n>`), its `source`, EVT2's draft (no
stipulations, finish, crew or planned result yet; MTCH7, MTCH8 and AIP5 add
those) and a decision labelled with the matchup ("Haruto Ise vs Daichi
Kuroe"), whose value is the match or angle type and whose lines read like a
booker's notes: where the slot came from, the type roll, each place's ranked
candidates with card values and every fallback level tried. Slots nobody can
fill come back in `open` with the reason; storylines left out come back in
`skippedStorylines`.

**What is never broken.** Nobody is in two matches on one card, nobody is over
`booking.maxAppearancesPerShow`, nobody unavailable wrestles, and contract
blocks (appearance cap used up, no house shows) are never relaxed. Every draft
passes EVT2's `structuralProblems`.

## Match types

`matchTypeWeight` (`card/formulas/matchTypeWeight.ts`) weighs one match type
for one slot. A type's family comes from its shape: two sides of one is
one-on-one, two of two tag, two of three trios, a fixed three or more sides of
one multi-way, anything else (a handicap match, a battle royal) other.

```
base        = aip.card.typeWeight.<family>
poolFactor  = clamp(freeWrestlers ÷ (peopleNeeded × aip.card.poolComfort), 0, 1)
              when freeWrestlers ≥ peopleNeeded, else 0
tasteFactor = 1 for one-on-one, else 0.5 + riskAppetite ÷ 100
teamFactor  = aip.card.noTeamFactor for tag and trios with fewer than two
              free teams of that size, else 1
weight      = base × poolFactor × tasteFactor × teamFactor
```

With exactly enough free wrestlers at the default comfort of 2 a type keeps
half its weight; the trace says "Only 3 free wrestlers, needs 4" when it is
short. A booker with a taste for risk books more unusual matches ("Booker's
taste for unusual matches (70)"), but never moves one-on-one. A match needs
the fewest sides its type allows, each of the smallest size (a handicap match
puts one more on the last side).

The filler roll leaves out types at weight 0 and types that would leave fewer
than two free wrestlers for each match slot still to book ("Three-Way needs 3,
leaving too few for the 2 matches still to book"), so a seven-person roster
never gets a battle royal while other matches wait. When every type is left
out, the slot falls back to a one-on-one type with the note "Every match type
weighs 0 tonight: a one-on-one match".

The weight is per type, so a family with several types (singles, endurance
and sprint are all one-on-one) is picked that much more often than its base
weight alone suggests.

## Fallback chain

`findWorker(pool, seat, rules, level)` (`card/fallback.ts`) lists who may take
one place at one level, best card value first. The planner tries levels 1 to
4 and stops at the first that finds anyone; each level tried is a rule line.
The pick among the hits is a roll weighted by card value (at least 1), so the
strongest free workers go first and the card stacks naturally.

Never relaxed: the worker can wrestle tonight, has no contract block, is not
in a match on this card or already in this one, is under
`booking.maxAppearancesPerShow`, and is the match's gender unless
`aip.card.mixedGender` is on (the first place sets the gender).

1. Rested (fatigue at most `aip.card.maxFatigue`), the opposite alignment to
   the other side where one is set (two-sided matches), outside any team (in a
   one-on-one match), among the top `aip.card.pickWindow` free workers.
2. Any alignment, team members too, still among the top `aip.card.pickWindow`.
3. Anyone free on the roster.
4. Tired workers too (still available), as a last resort.

The window is taken after the never-relaxed rules, never before, so nobody
fit is lost below a window full of people who can't work tonight.

**Teams.** A side of two or three takes a free team of that size first: the
pool's teams whose members are all free, rested and of one gender, ranked by
mean card value, a weighted roll among the top `aip.card.pickWindow`. Only
when no team fits are workers paired for tonight, place by place ("Side 1: no
free team, pairing workers for tonight").

**Stepping down.** When a place can't be filled at any level, the match steps
down and starts again: trios to tag to one-on-one, multi-way and every other
shape to one-on-one ("Could not fill Six-Person Tag: stepping down to Tag
Team"). When even a one-on-one fails, the slot becomes a talking segment if
the card has room for one more (no two talking segments in a row:
`talkRoomFor`), else it stays open: "Not enough free workers".

## Talking segments

`buildTalkSegment(pool, { key, storylineId?, alreadyBooked }, deps)`
(`card/talk.ts`) returns one planned angle, or null when nobody can talk. MTCH5
will replace its single default beat through this function.

- Speakers can talk tonight (available, or out but still able to do talking
  segments: "Injured, but can talk") and have no contract block. Fatigue does
  not matter: talking costs no stamina.
- Level 1 takes people not on the card yet; level 2 also takes people already
  wrestling tonight, within `booking.maxAppearancesPerShow`.
- The first speaker is rolled among the top `aip.card.pickWindow` by talking
  ability (the mean of mic and charisma), weighted by it. A second joins with
  `aip.card.secondSpeakerChance`.
- The kind of angle is a plain roll among the non-hidden angle types whose
  speaker range holds the speakers.

## Storylines

`storylinesForShow` and `planStorylineSegment` (`card/storylineSegments.ts`)
give the promotion's stories their place before the filler.

- Which: active storylines of the promotion whose brand is none or the show's,
  with heat at least `aip.card.storylineMinHeat`, hottest first (then ID), at
  most `aip.card.maxStorylineSegments`.
- What: when a face and a heel of the story can both wrestle tonight (free,
  rested, no contract block, the same gender unless mixed matches are on), a
  roll of `aip.card.storylineMatchChance` decides a match: one on one, or a
  tag match when each side has two free members (with their team when they
  are one). Otherwise a talking segment with the story's free members who can
  talk, face side first, cut to the angle type's most speakers.
- Room: a match takes a match slot and a talking segment a talking slot. When
  the one wanted is full the other is tried; with neither the story is
  skipped: "No room on the card tonight" (or "Nobody in the story is free
  tonight").

Every draft carries `storylineIds: [storylineId]`, so the story shield (D-09)
and storyline heat apply to rival cards too. AIP6 and CRTV4 own storylines'
life cycles and heat; until AIP6 rivals rarely have storylines, so this step
is often empty.

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

| Key                                       | Default                 | What it does                                                          |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| `aip.card.maxFatigue`                     | 75                      | Fatigue above which a worker is only a last resort                    |
| `aip.card.minWorkers`                     | 5                       | Fewer wrestlers fit to work than this cancels the show (0 never)      |
| `aip.card.mixedGender`                    | false                   | Whether a non-title match may mix men and women                       |
| `aip.card.talkShare.<importance>`         | 0, 0.15, 0.3, 0.2, 0.15 | Talking share on house, minor, regular, major and flagship shows      |
| `aip.card.talkTasteSwing`                 | 0.5                     | How far the booker's taste moves the talking share                    |
| `aip.card.maxTalkShare`                   | 0.5                     | The largest talking share                                             |
| `aip.card.fillPreShow`                    | true                    | Whether the pre-show slots are filled                                 |
| `aip.titles.maxPerShow.<importance>`      | 1, 1, 2, 4, 6           | Most title matches on house, minor, regular, major and flagship shows |
| `aip.titles.defenceIntervalDays`          | 28                      | Usual gap between defences at middling title taste                    |
| `aip.titles.tempoSwing`                   | 0.5                     | How far title taste moves the usual gap                               |
| `aip.titles.prestigeWeight`               | 0.5                     | Urgency per 100 prestige                                              |
| `aip.titles.importanceBonus.<importance>` | 0, 0, 0, 1, 2           | Urgency added on house, minor, regular, major and flagship shows      |
| `aip.titles.dueThreshold`                 | 1                       | Urgency at which a title is due                                       |
| `aip.titles.recentChallengers`            | 2                       | Latest challengers who rest before challenging again                  |
| `aip.titles.challengerPool`               | 3                       | Best contenders the challenger is picked from                         |
| `aip.titles.excludeOtherChampions`        | true                    | Whether champions are kept out of other title pictures                |
| `aip.card.maxStorylineSegments`           | 2                       | Most storyline segments on one show                                   |
| `aip.card.storylineMinHeat`               | 0                       | Heat a storyline needs for a segment (0: every active one)            |
| `aip.card.storylineMatchChance`           | 0.5                     | Chance a storyline gets a match rather than a talking segment         |
| `aip.card.typeWeight.<family>`            | 100, 35, 10, 6, 2       | Base weight of one-on-one, tag, multi-way, trios and other types      |
| `aip.card.poolComfort`                    | 2                       | Times the people a match needs before its type gets full weight       |
| `aip.card.noTeamFactor`                   | 0.25                    | Weight left to tag and trios types with fewer than two free teams     |
| `aip.card.pickWindow`                     | 5                       | Best free workers each place is chosen from                           |
| `aip.card.secondSpeakerChance`            | 0.5                     | Chance a talking segment gets a second speaker                        |
