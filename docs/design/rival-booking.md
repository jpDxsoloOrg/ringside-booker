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
talking segments. AIP4-04 scores and orders the card and adds `planCard`,
the one entry point that plans a whole show. AIP4-05 books the rivals' shows
on show day. AIP4-06 adds Auto-fill for the player's own card and the Shows
tab's card query.

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
share       = 1 − aip.card.variantShare for the family's plain type,
              aip.card.variantShare ÷ variants for each variant,
              1 for a family of one type
poolFactor  = clamp(freeWrestlers ÷ (peopleNeeded × aip.card.poolComfort), 0, 1)
              when freeWrestlers ≥ peopleNeeded, else 0
tasteFactor = 1 for one-on-one, else 0.5 + riskAppetite ÷ 100
teamFactor  = aip.card.noTeamFactor for tag and trios with fewer than two
              free teams of that size, else 1
weight      = base × share × poolFactor × tasteFactor × teamFactor
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

**Plain types and variants.** A family's weight is shared between its types,
so adding a type never makes the family more common. The family's first type
by display order is its plain type (Singles for one-on-one, Three-Way for
multi-way, Handicap for other); the rest are variants (Endurance Match and
Sprint; Four-Way; Battle Royal). The plain type keeps `1 − aip.card.variantShare`
of the family weight and the variants split `aip.card.variantShare` evenly, so
at the default of 0.2 Singles weighs 80 and Endurance and Sprint 10 each: plain
singles are about four in five one-on-one matches, title matches included. The
trace says "The plain one-on-one match (2 variants share the rest)" or "One of
2 one-on-one variants". The family is counted over every non-hidden type
(`familyPlaceOf(type, matchTypesOf(read))`), not only those that fit tonight,
so a type's share never depends on the roster. A share of 0 keeps variants off
rival cards; 1 leaves only variants.

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

## Card score

`cardScore` (`card/formulas/cardScore.ts`) gives every planned segment one
traced score, in points, and the [order](#ordering) places segments by it. One
score and one ordering: the main event the Why? names is the main event on the
card.

```
base     = mean(participants' card values)          a line per person
         × aip.card.order.talkFactor                talking segments only
titles   = Σ prestige × aip.card.order.titleWeight  a line per title
heat     = max heat × aip.card.order.heatWeight     the hottest storyline only
featured = aip.card.order.aceBoost with the ace in it, or
           aip.card.order.prospectBoost with a prospect in it (the larger
           counts, never both)
score    = base + titles + heat + featured
```

Card values are AIP1's at the show's promotion. A segment with nobody in it
scores 0 with the note "Nobody in it yet: it scores 0". The trace is titled
"Card score: <matchup>" and reads "Haruto Ise", "The World Title is on the
line", "Storyline 'Ise vs Kuroe' heat 64", "Ace Haruto Ise". The ace and
prospects are AIP3's featured workers on the unit's profile; before the rival
desk names any the line reads "No ace or prospects named yet" and adds 0.

The score is a ranking, not a 0-100 stat, so it is never clamped: a title
match between two stars may score above 100. A weight of 0 means the part adds 0.

## Ordering

`orderCard(segments, scores, { slots, preShowSlots, mainEventMustBeMatch,
fixed }, { tunables })` (`card/order.ts`) gives each planned segment a slot.
Rules, in order, each a line in the order trace:

1. **Strongest match closes the show.** The main event slot (the last
   main-card slot) gets the highest-scoring match. On a house show it gets the
   highest-scoring segment of any kind.
2. **Second-best match opens the show.** With `aip.card.order.hotOpener` and
   at least three matches on the main card, the second-highest match takes
   slot 1. Opening hot is common booking craft and pairs with EVT4's opener
   check; the flag turns it off.
3. **Builds towards the main event.** The rest fill the remaining main-card
   slots in ascending score. On a short card they take the open slots nearest
   the main event, so the slots left empty fall early on the card, never just
   before the main event.
4. **No two talking segments in a row.** When rule 3 puts two together, the
   talking segments move to the nearest slots that keep them apart, keeping
   their order, and the matches close up around them; each move is a line
   ("Moved so no two talking segments are in a row: <segment> from Slot 2 to
   Slot 4"). The [card shape](#talking-slots) always leaves room for this. If
   the only way needs slot 1, the hot opener gives way ("The second-best match
   gives up the opener: the talking segments need the room"). If segments
   already on the card make it impossible, the order is kept with a note.
5. **Lowest-scoring matches go on the pre-show.** While `aip.card.fillPreShow`
   is on, the pre-show slots take the lowest-scoring matches, the lowest
   first. Talking segments never go to the pre-show.

The main card is filled before the pre-show: the best matches and every
talking segment go to the main card, and only the matches left over go to the
pre-show. Segments that find no slot come back in `unplaced`.

A rule is checked over the running order, so a slot left empty between two
segments does not keep them apart. Fixed segments (see
[keep-filled mode](#keep-filled-mode)) never move; planned segments only take
open slots.

## Planning a card

`planCard(read, { instance, today, mode, taste? }, { tunables, rng })`
(`card/planCard.ts`) is the single read-only entry point the rival shows, the
player's Auto-fill (AIP4-06) and computer-GM brands (BRW6) call. It never
writes and draws only from the stream passed in. It runs:

1. the [card pool](#card-pool);
2. **the cancel rule**: with fewer wrestlers fit to work
   (`availableWrestlers`) than `aip.card.minWorkers` the plan is
   `{ kind: 'cancel', reason: "Only 4 wrestlers available, needs 5" }`, with
   the pool's exclusions ("Taro: Tired (fatigue 82, limit 75)") in the trace.
   0 never cancels;
3. the [card shape](#card-shape): talking slots, the title match cap and the
   main event rule;
4. the [title picture](#title-picture), under the cap;
5. [filling the card](#filling-the-card): storyline segments, filler matches
   (main-card and, while `aip.card.fillPreShow` is on, pre-show ones) and
   talking segments;
6. a [card score](#card-score) per segment and the [order](#ordering).

`taste` defaults to `tasteOf` for the show's deciding unit; BRW6 passes the
GM's.

The result is plain JSON:

- `{ kind: 'card', placements, open, planTrace, counts }`. Each placement has
  its slot (0-based, as stored), `preShow`, the draft, its source, its card
  score, a `headline` of two or three short reasons for lists ("Strongest
  match closes the show", "Title due: 34 days since the last defence", "Ace
  Haruto Ise") and a `slotTrace`: the decision "Slot <n> · <role>" (role from
  MTCH1's `slotRoleOf`) that includes the slot role, the segment's own
  decision (title picture or fill notes), its card score and the rule that
  placed it. That is the Why? the Shows tab and the Auto-fill reasons sheet
  open. `open` lists the slots left empty with the reason, and `counts` the
  matches, talking segments, title matches and storyline segments;
- `{ kind: 'cancel', reason, planTrace }`.

`planTrace` is the decision "Card plan: <show>" with the shape, the title
picture, the fill summary (storylines considered and skipped), the exclusions
and the running order.

### Keep-filled mode

With `mode: 'keepFilled'` the segments already on the card (EVT2's
`cardSegments`) stay exactly where they are and only the open slots are
planned:

- people already on the card count as booked (a wrestler in a kept match is in
  no other match);
- kept title matches count towards the cap, and their titles are not picked
  again;
- kept talking segments on the main card count towards the talking share and
  the room for talking;
- storylines with a kept segment get no second one ("Already on tonight's
  card").

`mode: 'fresh'` plans the whole card as if it were empty; whoever writes the
plan clears the card first.

## Show day

`aip.bookShow` (`card/bookShowJob.ts`, AIP4-05) is how rivals book their own
shows. It is a `beforeShow` rival job ([rival-desk.md](rival-desk.md#jobs)),
so it runs in `aip.runTurns` (group `aiTurns`) on every day a computer unit has
an open show, before the `shows` group runs the day's shows
([day-pipeline.md](day-pipeline.md#groups)).

**Which shows.** The unit's shows dated today that are still `scheduled` and
whose controller is the computer (`showControllerOf`: the brand's own
controller when it has one, else the promotion's), in event instance ID order.
A show a human runs is never touched; the day still stops on it
(`shows.tonight`) and the player runs it from the show screen. A computer GM
brand inside the player's promotion is its own unit and books from its own
roster only. Each show runs in a savepoint of its own
(`aip.bookShow:<instanceId>`), with its own buffered events and traces, so one
show going wrong never undoes another: it is logged, published as
`aip.jobFailed` (which `npm run sim -- --strict` fails on) and left as it was.

**Planning.** `planCard` with the `aip.card` stream: `keepFilled` when the show
already holds segments (a brand handed to a computer GM after the player booked
part of it), so those stay where they are; otherwise `fresh`, on a cleared
card ([keep-filled mode](#keep-filled-mode)).

**Writing.** Each placement goes through EVT2's card writer
(`writeSegment`), the same code the player's commands use, with no planned
winner. A placement the writer would refuse (`structuralProblems`) is skipped:
its slot stays open and the reason goes in the log and the plan trace. The
booker never throws on a bad placement.

**Booked-card steps.** Right after the card is written and before it is
validated, every step added with
`registerBookedCardStep({ id, order, run(ctx, { instance, segmentIds, plan }) })`
(`card/bookedCardSteps.ts`) runs, by `order` then id, each in its own savepoint
with its own buffered events and traces. A step that throws is logged and
skipped, with nothing it did left behind, and the card still books. Duplicate
ids throw when registering. AIP5 sets the winners here, MTCH8 the crew and
MTCH7 the stipulations, without editing the booker.

**Validation.** EVT2's `validateCard` checks the card. A match with no planned
winner (`noPlannedResult`) is fine: AIP5 sets winners, or show night's
auto-winner decides. Any other error is a planner bug: the segments behind it
are removed ("Removed Slot 3: <message>" in the plan trace) and the card is
checked once more.

**Book or cancel.** A card that can run sets the show `booked` and publishes
`aip.cardBooked { eventInstanceId, promotionId, brandId, segmentCount,
titleMatchCount }`. The show is cancelled instead, exactly as
`calendar.cancelShow` does it (`cancelShow`: `status: 'cancelled'`,
`cancellation: { reason: 'byPromotion', on: today }` and one `show.cancelled`),
when:

- the plan is `cancel`: fewer wrestlers fit to work than
  `aip.card.minWorkers` ("Only 3 wrestlers available, needs 5"); or
- the card still cannot run after the repair, for example too few filled
  main-card slots for `booking.minFilledMainShare`. The reason is the check's
  message, and the segments this booking wrote come off again (segments that
  were already on the card stay).

No save change: the explanation lives in the decision and the trace, and the
calendar shows the cancellation as called off by the promotion.

Without show night (EVT3) a booked card is not run; the calendar's
close-past-shows rule marks the show Not run after its day and its segments
stay readable.

**Decision log.** Each show gets a `card` decision (chip "Card"), hidden
until the show airs (`revealOn` = the show's air date):

- booked: `aip.decision.card-booked` with `show`, `matches`, `talking`,
  `titles`: "Booked <show>: 5 matches, 2 talking segments, 1 title match";
- cancelled: `aip.decision.show-cancelled` with `show`, `reason`: "Cancelled
  <show>: Only 3 wrestlers available, needs 5".

Refs: the show and its promotion. Importance 1 for a booked card, 2 for a
cancelled show. The web text catalog (`apps/web/src/text/catalogs/aip.ts`)
and the engine's `decisionSummaryText` say the same words.

**Traces.** A whole plan is 70 to 330 KB of JSON, and eleven rivals book
hundreds of shows a year, so rival shows never keep it:

- `aip.cardPlan` (by event instance ID): "Booking <show>", the plan and what
  happened when it was written (skipped placements, removed segments), stored
  summary-only. The card decision points at it;
- `aip.cardSlot` (by segment ID): "Slot <n> · <role>" with the segment's
  headline reasons and its card score, a few hundred bytes. It is kept in full
  for `aip.card.keepDetailDays` (28) days after the show, then only its
  summary: `aip.pruneCardDetail` (group `periodic`, order 43, daily) demotes
  the slots of the shows dated exactly that many days ago (the player's
  auto-filled slots too, see [Auto-fill](#auto-fill)), with a full
  sweep on the 1st of each month for anything a lowered setting left behind.
  The per-kind limits (`sim.traceRetentionPerKind`, `sim.traceBytesPerKind`)
  still apply on top.

The save keeps about the last month in detail: the cards themselves (which
shows ran, who was on them, the results) are public facts other features read
and stay; trimming those is POL4-08's.

## Auto-fill

`aip.autoFillCard { eventInstanceId, keepFilledSlots? }` (`card/commands.ts`)
lends the planner to the player for their own show. It only suggests: what it
writes are ordinary segments the player can change, move or remove, and the
player still runs the show from the show screen.

Refused, in the booking commands' order, with these messages:

| Code            | When                                                           | Message                                                             |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `showNotFound`  | No such show                                                   | That show no longer exists                                          |
| `notYourShow`   | The issuer does not run the show (`controlsShow`)              | Only the person running (the brand or promotion) can book this show |
| `showCompleted` | EVT2's `editBlockOf`                                           | This show has already run                                           |
| `showCancelled` | EVT2's `editBlockOf`                                           | This show was cancelled                                             |
| `showPast`      | EVT2's `editBlockOf`                                           | This show has already happened                                      |
| `noCatalog`     | The save has no match types (from before MTCH1)                | This save has no match types to book from                           |
| `cardFull`      | `keepFilledSlots` is not false and no slot it may fill is open | Every slot is already filled                                        |

The slots it may fill are the main card's and, while `aip.card.fillPreShow` is
on, the pre-show's.

It runs `planCard` with the `aip.autofill` stream (never `aip.card`, so a
press never changes what the rivals book): in keep-filled mode by default,
or in fresh mode when `keepFilledSlots` is false. Fresh mode plans before
anything is cleared, so a plan that cannot fill the card leaves it as it was;
only a `card` plan clears the card (one `card.changed` with `cleared`). Each
placement goes through EVT2's `writeSegment` with `outcome: null` and
publishes one `card.changed` (`added`). A placement the writer would refuse
is skipped and listed as open with the writer's message. Auto-fill:

- **never sets a winner**, whatever MTCH2's Random winners says; the
  booked-card steps (AIP5's winners) belong to the rival show-day job and
  never run here;
- **never cancels the show**: a `cancel` plan (a thin roster) returns
  `{ filled: [], open: [], kept, message: "Only 4 wrestlers available, needs 5" }`
  and changes nothing.

Result:

```ts
{
  filled: AutoFilledSlot[]; // running order
  open: { displayNumber, preShow, reason }[];
  kept: number;            // segments that were on the card and stayed
  message: string | null;  // why nothing was filled
}
AutoFilledSlot = {
  segmentId, preShow, displayNumber, roleLabel,
  label,      // the matchup, "Ace vs Rookie"
  headline,   // two or three short reasons
  traceRef,   // { kind: 'aip.cardSlot', id: segmentId }
}
```

Each written segment gets the same short Why? as a rival slot (`aip.cardSlot`:
the slot, its headline reasons and card score, a few kilobytes), not the whole
plan, and `aip.pruneCardDetail` demotes it to its summary once the show is
`aip.card.keepDetailDays` old, so the player's slots follow the same "about
the last month in detail" rule.

## Show cards

`aip.showCards { promotionId, past?, upcoming? }` (`card/queries.ts`): a
promotion's shows with their cards, slot by slot, for the promotion profile's
Shows tab. Rows come from `eventInstances` by promotion: `past` (1 to 30,
default 10) shows dated before today, newest first, then `upcoming` (0 to 10,
default 4) shows from today on, soonest first; ties by ID.

```ts
ShowCardRow = {
  eventInstanceId, name, date, airDate, importance, brandName, status,
  statusLabel,      // 'Coming up' | 'Booked' | 'Completed' | 'Not run' | 'Cancelled'
  revealed,
  hiddenText,       // 'Card is revealed when the show airs' | null
  cancelledReason,  // the planner's reason once revealed, else EVT1's reason in words
  planTraceRef,     // aip.cardPlan, when revealed and kept
  score,            // EVT3's show score once run and revealed
  slots: ShowCardSlot[],
}
ShowCardSlot = {
  displayNumber, preShow, role, roleLabel, // MTCH1's slotRoleOf
  segment: {
    segmentId, kind, typeName,
    label,          // the segment's label, else the matchup
    sides: [{ name, teamId, isChampions, people: [{ personId, name, imageRef }] }],
    titles: [{ titleId, name, imageRef }],
    storylines: [{ storylineId, name }],
    outcome: { kind, winningSide } | null,
    reasonTraceRef, // aip.cardSlot, while kept
  } | null,         // null: an open main-card slot
}
```

Slots are in running order: the pre-show's only when filled, then every
main-card slot, open ones included. A side's name is its team's when the whole
side is one team, else the ring names joined with " & "; ring names come from
the contract with the show's promotion, else the default ring name (EVT2's
`showPeople`). `isChampions` marks a side that held one of the match's titles
going into the show. Trace refs are given only while the store still holds
them. A cancelled row has no slots.

**Reveal rule.** A row's card is shown when `isRevealedTo(read, viewer,
promotionId, airDate)` says so: the same function and the same date the
decision log uses for the show's `card` decision, so a card and its log entry
always reveal together. That is always for the promotion's own controller, a
sandbox game and the all-seeing viewer (tools), and for anyone else once the
air date has been simulated: a rival show booked and run today is hidden today
and shown tomorrow. A hidden row keeps only what the calendar already shows
(name, dates, status) and carries `hiddenText`, `slots: []`, no plan trace, no
score and only EVT1's cancellation words ("Called off by the promotion"), so
nothing about the card leaks. Nothing in either result is a length or a time.

### Screens (AIP4-07)

- **Promotions > (a promotion) > Shows** (`?tab=shows`, order 40, registered
  by `screens/promotions/profile/tabs/registerShowsTab.tsx`; shown where the
  Decision log is): "Recent shows" then "Coming up", each show a
  `RivalShowCard` disclosure (date, name, importance, brand, status with the
  score once run). Opened, a revealed card is one `CardSlot` per slot through
  `toRivalCardSlotProps`, with a "Why this segment?" button on each filled slot
  while `reasonTraceRef` is kept and a "Why this card?" beside the header while
  `planTraceRef` is. Hidden rows open onto `hiddenText`; cancelled rows onto
  "Show cancelled" and `cancelledReason`. A completed row opens on "Show
  score N" with "Why this score?" (`scoreTraceRef`, EVT3's `shows.showScore`
  trace) and a "See results" link to `routes.game.showResults(id)` (AIP4-08).
  A completed show with none of its segments kept (old shows keep only a
  summary) has no slots and reads "Details are kept for the last 4 weeks."
- **Booking > Auto-fill** (side panel `aip.autoFill`, order 50,
  `screens/booking/panels/`): "Auto-fill empty slots" (`keepFilledSlots:
true`) and "Rebook whole card" behind a confirmation (`false`), off with the
  engine's reason when the card cannot change or every slot is taken. A press
  opens the reasons sheet: each filled slot with its headline and Why?, the
  slots left open and why, the planner's message, and "Pick a winner for each
  match before you run the show."
- **Decision log**: `card` decisions get the "Card" chip from
  `registerDecisionKind`; no web change.

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

| Key                                       | Default                 | What it does                                                                 |
| ----------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `aip.card.maxFatigue`                     | 75                      | Fatigue above which a worker is only a last resort                           |
| `aip.card.minWorkers`                     | 5                       | Fewer wrestlers fit to work than this cancels the show (0 never)             |
| `aip.card.mixedGender`                    | false                   | Whether a non-title match may mix men and women                              |
| `aip.card.talkShare.<importance>`         | 0, 0.15, 0.3, 0.2, 0.15 | Talking share on house, minor, regular, major and flagship shows             |
| `aip.card.talkTasteSwing`                 | 0.5                     | How far the booker's taste moves the talking share                           |
| `aip.card.maxTalkShare`                   | 0.5                     | The largest talking share                                                    |
| `aip.card.fillPreShow`                    | true                    | Whether the pre-show slots are filled                                        |
| `aip.card.keepDetailDays`                 | 28                      | Days a rival show's per-slot Why? is kept in full, then only a summary       |
| `aip.titles.maxPerShow.<importance>`      | 1, 1, 2, 4, 6           | Most title matches on house, minor, regular, major and flagship shows        |
| `aip.titles.defenceIntervalDays`          | 28                      | Usual gap between defences at middling title taste                           |
| `aip.titles.tempoSwing`                   | 0.5                     | How far title taste moves the usual gap                                      |
| `aip.titles.prestigeWeight`               | 0.5                     | Urgency per 100 prestige                                                     |
| `aip.titles.importanceBonus.<importance>` | 0, 0, 0, 1, 2           | Urgency added on house, minor, regular, major and flagship shows             |
| `aip.titles.dueThreshold`                 | 1                       | Urgency at which a title is due                                              |
| `aip.titles.recentChallengers`            | 2                       | Latest challengers who rest before challenging again                         |
| `aip.titles.challengerPool`               | 3                       | Best contenders the challenger is picked from                                |
| `aip.titles.excludeOtherChampions`        | true                    | Whether champions are kept out of other title pictures                       |
| `aip.card.maxStorylineSegments`           | 2                       | Most storyline segments on one show                                          |
| `aip.card.storylineMinHeat`               | 0                       | Heat a storyline needs for a segment (0: every active one)                   |
| `aip.card.storylineMatchChance`           | 0.5                     | Chance a storyline gets a match rather than a talking segment                |
| `aip.card.typeWeight.<family>`            | 100, 35, 10, 6, 2       | Base weight of one-on-one, tag, multi-way, trios and other types             |
| `aip.card.variantShare`                   | 0.2                     | Share of a family's weight its variants split; the plain type keeps the rest |
| `aip.card.poolComfort`                    | 2                       | Times the people a match needs before its type gets full weight              |
| `aip.card.noTeamFactor`                   | 0.25                    | Weight left to tag and trios types with fewer than two free teams            |
| `aip.card.pickWindow`                     | 5                       | Best free workers each place is chosen from                                  |
| `aip.card.secondSpeakerChance`            | 0.5                     | Chance a talking segment gets a second speaker                               |
| `aip.card.order.titleWeight`              | 0.3                     | Card score per prestige point of a title on the line                         |
| `aip.card.order.heatWeight`               | 0.2                     | Card score per heat point of the hottest storyline                           |
| `aip.card.order.aceBoost`                 | 12                      | Card score added with the ace in a segment                                   |
| `aip.card.order.prospectBoost`            | 6                       | Card score added with a prospect in a segment                                |
| `aip.card.order.talkFactor`               | 0.8                     | Share of its speakers' card value a talking segment scores                   |
| `aip.card.order.hotOpener`                | true                    | Whether the second-best match opens the show                                 |

## Integration

AIP4-08 wired rival card planning to the partners that were on `main` when it
ran (main up to Sprint 7: EVT3-01..07/09/10 and POL4-06/07 among this list).
Partners plug in through `registerBookedCardStep`, `buildTalkSegment` and their
own registries, never through the planner's ordering or validation code.

| Partner                       | Status                  | How it is wired                                                                                                                                                                                                                                                                     |
| ----------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVT3 (show night)             | wired (AIP4-08)         | Cards booked by `aip.bookShow` run through `shows.runShows`: every segment is rated and the show is not scored off-screen (that stays for a computer show with no segments). `aip.showCards` rows carry `scoreTraceRef`; the Shows tab shows the score, its Why? and "See results". |
| AIP3 (push review, featured)  | wires from its own pack | `aiProfiles.featured` exists but nothing names aces or prospects yet (no `aip.pushReview`), so the card score says "No ace or prospects named yet".                                                                                                                                 |
| AIP5 (winners, title changes) | wires from its own pack | Not on `main`; plugs in through `registerBookedCardStep`.                                                                                                                                                                                                                           |
| AIP6 (creative upkeep)        | wires from its own pack | No `aip.creativeUpkeep` on `main`. Storyline segments already carry `storylineIds` from `fillCard`.                                                                                                                                                                                 |
| MTCH7 (stipulations)          | wires from its own pack | No `stipulations.json` catalog on `main`; `aip.card.stipulationChance` is left for MTCH7-07.                                                                                                                                                                                        |
| MTCH8 (crew)                  | wires from its own pack | No `suggestCrew` on `main`; rival segments keep `crew` empty.                                                                                                                                                                                                                       |
| MTCH5 (angle beats)           | wires from its own pack | No beat catalog or `angleTemplatesFor` on `main`; `buildTalkSegment` keeps its default beat.                                                                                                                                                                                        |
| ECO11 (territories)           | wires from its own pack | No development assignments on `main`; no `registerCardPoolSource` seam was added.                                                                                                                                                                                                   |
| MP3 / MP5 (multiplayer)       | wires from its own pack | No server package or auto-ready on `main`. A promotion whose controller turns `computer` is booked by `aip.bookShow` with no extra code.                                                                                                                                            |
| POL4 (performance budgets)    | wires from its own pack | POL4-06/07 (save size budget, slow-suite split) are on `main`, but there is no long-skip benchmark with a per-day budget to add `aip.bookShow` to.                                                                                                                                  |
