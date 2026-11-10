# Workers

Nearly every part of the game asks the same small questions about a person: how
old are they, can they work today, may they hold this title, which weight class
are they in, what grade is a 72, who do they work for. The `workers` system
(`packages/engine/src/systems/workers/`) answers each of them once, so the
booking screen, the rival bookers and the roster screens can never disagree.

None of those answers is stored. Each one is worked out from the person and
employment rows when it is asked for (see
[data-model.md](data-model.md#stored-and-derived)), so there is no flag to keep
in sync and no migration when a rule changes.

The system also owns the [doors](#doors): the only code that changes a worker's
push, alignment, role, popularity, momentum or morale once the world exists.

| Question                           | Function                                     | Returns                |
| ---------------------------------- | -------------------------------------------- | ---------------------- |
| How old are they?                  | `ageOn(person, date)`                        | Whole years            |
| How long have they been wrestling? | `experienceYears(person, date)`              | Years, with a fraction |
| Can they work today?               | `availabilityOf(person, employment, date)`   | `Availability`         |
| May they hold this title?          | `isEligibleForTitle(person, title)`          | `Reason[]`             |
| Which weight class?                | `weightClass({ weightKg }, { tunables })`    | `Traced<WeightClass>`  |
| What grade is this value?          | `gradeOf(value)`                             | Grade, band and reason |
| Who do they work for?              | `activeEmploymentsOf`, `primaryEmploymentOf` | Employment rows        |
| Are they a free agent?             | `isFreeAgent(read, personId, date)`          | `boolean`              |
| What are they mainly?              | `mainRoleOf(person, primaryEmployment)`      | `RatingRole`           |

All of them are exported from `@ringside/engine`.

## Availability

`availabilityOf(person, employment, date)` returns:

```ts
interface Availability {
  status: AvailabilityStatus;
  reason: string; // written for the player
  until: GameDate | null; // the first day back
  canWorkAngles: boolean;
}
```

`employment` is the contract the question is being asked for, because a
suspension or time off belongs to one employer. Pass `null` for a free agent.

The rules are checked in this order and the first one that matches wins:

| #   | Rule                                                      | Status                     | Reason shown                               | `until`             |
| --- | --------------------------------------------------------- | -------------------------- | ------------------------------------------ | ------------------- |
| 1   | Person status is `retired`, `deceased` or `outOfBusiness` | `retired`                  | "Retired", "Deceased", "Left the business" | none                |
| 2   | `debutDate` is after the date, or missing (see below)     | `notDebuted`               | "Has not debuted yet"                      | the debut date      |
| 3   | An `injury` with `date < injury.expectedReturn`           | `injured`                  | "Injured (leg injury)"                     | `expectedReturn`    |
| 4   | A `restrictions[]` entry with `date < until`              | `rehab` or `personalLeave` | "In rehab", "On personal leave"            | the entry's `until` |
| 5   | Person status is `hiatus`                                 | `personalLeave`            | "On hiatus"                                | none                |
| 6   | `employment.leave` with `date < leave.until`              | `suspended` or `timeOff`   | "Suspended", "On time off"                 | `leave.until`       |
| 7   | Anything else                                             | `available`                | "Available"                                | none                |

Details:

- A missing `debutDate` only means "not debuted yet" for someone who holds a
  role that has a debut: wrestler, occasional wrestler or manager
  (`DEBUT_ROLES`). Referees, announcers, presenters and producers never get a
  debut date (see [world-generation.md](world-generation.md)), so for them a
  missing date is skipped and the later rules decide. A debut date that is
  still ahead counts for every role.
- When several restrictions are running, the one that ends last is the one
  reported.
- A `semiRetired` person is `available`, with the reason "Semi-retired: works
  occasional dates".
- An injury beats a suspension that overlaps it. Once the injury has healed, the
  suspension is what is left, and it is reported from then on.

### `until` is the first day back

Every end date here (`injury.expectedReturn`, a restriction's `until`, a leave's
`until`) is the **first day the person can work again**, so the check is always
`date < until`. The day's phases run for date D before the world moves on to
D + 1, which means someone whose suspension ends on the 10th can be booked on
the 10th. Any system that writes one of these dates (injuries, discipline,
contracts) writes the first day back, never the last day out.

### Why nothing clears the flags

Availability compares dates on every read. An injury, restriction or leave whose
date has passed simply stops counting, whether or not anything has removed it
from the row. If a daily phase had to flip a flag when an injury ended, one
skipped or failed phase would leave someone injured forever. Comparing dates
can't go stale.

### Talking segments

`canWorkAngles` says whether the person can appear in a non-wrestling segment on
the date. It is true for `available`, true for an injury whose own
`canWorkAngles` is true (the reason then ends "; can still do talking
segments"), and false for every other status. Booking uses it to let an injured
wrestler cut a promo.

## Title eligibility

`isEligibleForTitle(person, title)` returns every rule that stops the person
from holding the title, as `Reason`s with a code, a message written for the
player and the person as the subject. An empty list means they are eligible.

| Code             | Refused when                                                               | Example message                                                              |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `titleRetired`   | The title's status is `retired`                                            | "The Coastal Championship has been retired"                                  |
| `notAWrestler`   | The person holds neither the `wrestler` nor the `occasionalWrestler` role  | "Only wrestlers can hold the Coastal Championship"                           |
| `divisionGender` | The division is `male` or `female` and the person's gender is not that one | "The Coastal Women's Championship is a women's title"                        |
| `belowMinWeight` | `weightKg` is under the division's `minWeightKg`                           | "Too light for the Cruiserweight title (needs at least 80 kg, weighs 79 kg)" |
| `aboveMaxWeight` | `weightKg` is over the division's `maxWeightKg`                            | "Too heavy for the Cruiserweight title (limit 93 kg, weighs 94 kg)"          |

- Both weight limits are inclusive: 80 kg and 93 kg are both eligible for an
  80-93 kg title. A `null` limit means no limit on that side.
- Reasons always come back in the order of the table, and all failing rules are
  listed, not only the first.
- **Non-binary wrestlers are eligible for `open` divisions only.** This is a
  placeholder rule that I still need to confirm. It is one branch in one
  function, so changing it later is cheap.
- Eligibility is about the division, not about today. An injured or suspended
  champion is still eligible; whether they can defend the title is an
  availability question.

## Weight class

A person row stores `weightKg` and never a class. `weightClass` reads the class
off the weight using four limits that are tunables, so moving a limit moves
people on the next read with no data change.

| Class             | Weight                                       |
| ----------------- | -------------------------------------------- |
| Lightweight       | Up to the lightweight limit                  |
| Cruiserweight     | Over that, up to the cruiserweight limit     |
| Light heavyweight | Over that, up to the light heavyweight limit |
| Heavyweight       | Over that, up to the heavyweight limit       |
| Super heavyweight | Over the heavyweight limit                   |

A weight exactly on a limit is still in that class: with the defaults, 93 kg is
a cruiserweight and 94 kg is a light heavyweight.

| Key                                         | Kind    | Default | Range  | Unit      | What it does                                                                              |
| ------------------------------------------- | ------- | ------- | ------ | --------- | ----------------------------------------------------------------------------------------- |
| `workers.weightClass.lightweightMaxKg`      | integer | 70      | 40–250 | kilograms | Heaviest weight that still counts as a lightweight                                        |
| `workers.weightClass.cruiserweightMaxKg`    | integer | 93      | 40–250 | kilograms | Heaviest weight that still counts as a cruiserweight                                      |
| `workers.weightClass.lightHeavyweightMaxKg` | integer | 105     | 40–250 | kilograms | Heaviest weight that still counts as a light heavyweight                                  |
| `workers.weightClass.heavyweightMaxKg`      | integer | 130     | 40–250 | kilograms | Heaviest weight that still counts as a heavyweight; anyone over it is a super heavyweight |

The result is a decision trace, so the Why? panel can show it. Every limit is
read and checked on every call, so the trace always lists all four by their
tunable, with one line per band:

```
Weight class: lightHeavyweight
  95 kg is within the Light heavyweight limit of 105 kg
  - Lightweight limit: 70 kg (tunable, default 70)
  - Because 95 kg is over the Lightweight limit of 70 kg
  - Cruiserweight limit: 93 kg (tunable, default 93)
  - Because 95 kg is over the Cruiserweight limit of 93 kg
  - Light heavyweight limit: 105 kg (tunable, default 105)
  - Did not apply: 95 kg is over the Light heavyweight limit of 105 kg
  - Heavyweight limit: 130 kg (tunable, default 130)
  - Did not apply: 95 kg is over the Heavyweight limit of 130 kg
```

**Limits set out of order.** Each limit can be overridden on its own, so a save
can end up with the cruiserweight limit below the lightweight limit. That never
throws. A limit below the one before it is read as the one before it, and the
trace gets a note saying so ("The Cruiserweight limit of 60 kg is below the
Lightweight limit of 70 kg, so 70 kg is used"). The band in question is then
empty, and there is never a gap between classes.

Weight class is a label for screens and filters. A title's own weight limits
(`division.minWeightKg` / `maxWeightKg`) are separate numbers on the title, so a
promotion can run a "cruiserweight" title with whatever limit it likes.

## Grades

A grade is the letter shown next to a 0–100 value such as an attribute.
`gradeOf(value)` returns the grade, the band's lowest and highest whole value,
and a reason for the player ("72 is in the B+ band, 72 to 77").

| Grade | From | To  |
| ----- | ---- | --- |
| S     | 96   | 100 |
| A+    | 90   | 95  |
| A     | 84   | 89  |
| A-    | 78   | 83  |
| B+    | 72   | 77  |
| B     | 66   | 71  |
| B-    | 60   | 65  |
| C+    | 54   | 59  |
| C     | 47   | 53  |
| C-    | 40   | 46  |
| D     | 30   | 39  |
| E     | 20   | 29  |
| F     | 0    | 19  |

- The value is kept inside 0 to 100 and rounded to the whole number the screen
  shows before the band is looked up. Attributes are stored as decimals, and
  without the rounding a 77.6 would be shown as "78" next to a B+ while the
  table says 78 is an A-. Grading the shown number keeps the letter and the
  number in step.
- The bands are **display labels, not balance numbers**, so they are a constant
  table (`GRADE_BANDS`) and not tunables. Nothing in the simulation reads a
  letter; formulas always use the number. When a trace needs to cite a band,
  `gradeFloorOf(grade)` gives the band's lower bound as a traced constant with
  the reason "Display bands for grades".
- The bands are narrower through the middle of the scale (six or seven points)
  than at the bottom (ten or twenty), because that is where most of a roster
  sits and where a letter needs to tell people apart.

## Employer, free agent and main role

These are the only definitions of "employer" and "free agent". Every worker
query uses them instead of reading the employments table its own way.

- `activeEmploymentsOf(read, personId, date)`: the person's employments with
  status `active` and `startsOn` on or before the date, in ID order. Offers,
  signed contracts that have not started and ended contracts are left out.
- `primaryEmploymentOf(read, personId, date)`: the main one of those, or `null`.
  An exclusive written contract comes first, then the earliest `startsOn`, then
  the lowest ID.
- `isFreeAgent(read, personId, date)`: true when there is no active employment.

A person can be rated in seven roles (`RATING_ROLES`): wrestler, manager,
presenter, announcer, referee, producer and booker. An occasional wrestler is
rated as a wrestler. `mainRoleOf(person, primaryEmployment)` is the role their
main employer hired them in, or for a free agent the first role they hold in
the standard role order (wrestler first), whatever order the row stores them in.

## Doors

Six things about a worker are changed by a lot of different features: push,
alignment and role on an employment, popularity per region on a person or a
promotion, and momentum and morale on an employment. Matches move them, so do
storylines, contract talks, rival bookers, tournaments and the passing of time.
If each feature wrote the row itself, each would clamp a little differently,
some would forget the trace or the event, and one of them would eventually
store a popularity of 0.

So every one of those changes goes through a **door** in
`packages/engine/src/systems/workers/doors.ts`. Nothing else writes those
fields after the world has been created.

| Change              | Door                                                                            | Range               |
| ------------------- | ------------------------------------------------------------------------------- | ------------------- |
| Push                | `setPush(ctx, { employmentId, push, source, reason })`                          | a push level        |
| Alignment           | `setAlignment(ctx, { employmentId, alignment, source, reason })`                | an alignment        |
| Role                | `setRole(ctx, { employmentId, role, source, reason })`                          | a role              |
| Regional popularity | `applyPopularityChange(ctx, { subject, regionWeights, delta, source, reason })` | 0 to 100 per region |
| Momentum            | `applyMomentumChange(ctx, { employmentId, delta, source, reason })`             | −100 to 100         |
| Morale              | `applyMoraleChange(ctx, { employmentId, delta, source, reason })`               | −100 to 100         |

### The contract

Every door does the same five things, in this order:

1. **Checks its arguments.** An unknown employment, an employment that has
   ended (declined, withdrawn, expired, released or quit), an unknown person or
   promotion, an unknown region or an empty reason throws
   `InvalidArgumentError`. That is a bug in the caller, so callers check first.
   A throw rolls the whole step back: nothing the step wrote, recorded or
   published survives.
2. **Keeps the result in range.** Popularity stays between 0 and 100 in every
   region; momentum and morale stay between −100 and 100.
3. **Writes through the step's transaction**, so the change is undone with the
   rest of the step if anything later in it fails.
4. **Records one trace** at a known place, so the screen can show a Why? for
   the latest change.
5. **Publishes one event.**

A change that changes nothing (the push is already that, the delta is 0, the
value is already at the end of its scale) does none of steps 3 to 5 and returns
`changed: false`.

Every door returns the same shape:

```ts
interface DoorResult<T> {
  changed: boolean;
  before: T;
  after: T;
  traceRef: TraceRef | null; // null when nothing changed
}
```

**A door never decides why; callers pass the reason and the delta.** The door
only applies what it is given. The one rule a door adds of its own is the
popularity taper below, because that belongs to popularity and not to any
feature that moves it.

### Who may call a door

A door takes a `DoorContext`, which is the part of a step's context it needs:
`date`, `tx`, `read`, `tunables`, `publish` and `recordTrace`. Day phases,
reactions to events and a command's `apply` all have those, so any of them can
call a door, and nothing outside a step can.

Each call names who is asking and why:

- `source` is `player`, `ai` or `system`. A push the player chose and a push a
  rival booker chose are different stories for the worker and for the news.
- `reason` is `{ key, label }`. The key is stable and goes into the event
  (`match.win`, `contract.payCut`), so listeners can react by reason. The label
  is the same reason written for the player and goes into the trace.

World creation is the one exception to "only the doors write". New-game setup,
world generation and loading a data pack create rows with their first values
directly, because there is no before to trace and nobody listening yet.

A test (`test/systems/workers/doorOwnership.test.ts`) scans the engine source
and fails if any other file passes one of the six fields in a write to the
employments, people or promotions tables. It reads text, so it is a guard rail
and not a proof: a write hidden behind a spread or a helper gets past it, and a
new write still deserves a look in review.

### Events

| Event                         | Payload                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `employment.pushChanged`      | `employmentId`, `personId`, `promotionId`, `from`, `to`, `source`, `reasonKey`                                   |
| `employment.alignmentChanged` | `employmentId`, `personId`, `promotionId`, `from`, `to`, `source`, `reasonKey`                                   |
| `employment.roleChanged`      | `employmentId`, `personId`, `promotionId`, `from`, `to`, `source`, `reasonKey`                                   |
| `popularity.changed`          | `subjectKind`, `subjectId`, `worldBefore`, `worldAfter`, `regionsChanged`, `source`, `reasonKey`                 |
| `momentum.changed`            | `employmentId`, `personId`, `promotionId`, `before` (null on a first appearance), `after`, `source`, `reasonKey` |
| `morale.changed`              | `employmentId`, `personId`, `promotionId`, `before`, `after`, `source`, `reasonKey`                              |

`regionsChanged` is how many regions ended with a different stored value.
`worldBefore` and `worldAfter` are the worldwide figures from the
[popularity roll-up](geography.md#popularity-roll-up).

### Trace kinds

| Trace kind              | ID            | What it explains                               |
| ----------------------- | ------------- | ---------------------------------------------- |
| `workers.push`          | employment ID | The latest push change: what it was, and why   |
| `workers.alignment`     | employment ID | The latest turn                                |
| `workers.role`          | employment ID | The latest role change                         |
| `workers.popularity`    | person ID     | A person's latest popularity change, by region |
| `promotions.popularity` | promotion ID  | A promotion's latest popularity change         |
| `workers.momentum`      | employment ID | The latest momentum change                     |
| `workers.morale`        | employment ID | The latest morale change                       |

The trace store keeps the newest trace for each kind and ID. Two changes to the
same worker on one day leave the later trace; the event log still has both.

### Push, alignment and role

`setPush` and `setAlignment` write the new value and record a decision trace
that says what the value was and gives the caller's reason.

`setRole` does a little more, because a job comes with rules:

- The person gains the matching person role if they do not hold it yet
  (referee for a referee, and so on). A part-time wrestler already counts as a
  wrestler. A booker needs no person role.
- Moving into a crew job (presenter, announcer, referee, producer or booker)
  ends the worker's push: the role door calls `setPush` with `none` and the
  reason key `role.changed`, so that change gets its own trace and event like
  any other. Managers keep whatever push they have.
- Two moves are refused. `setRoleProblems(read, employmentId, role)` returns
  them as reasons written for the player, so a command can check before it
  calls the door and show the same words the door would throw:

| Code                    | Refused when                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `styleForbidsWrestling` | The person's ring style is `nonWrestler` and the role is wrestler |
| `cannotBook`            | The role is booker and the person cannot book (`career.canBook`)  |
| `unknownEmployment`     | The employment does not exist                                     |
| `employmentEnded`       | The employment has ended                                          |

### Popularity door

`applyPopularityChange` takes one `delta` in points and a weight from 0 to 1
for each region that should feel it. Regions that are not named are untouched.
A weight outside 0 to 1 is brought back inside, with a note in the trace. Each
weighted region then gets:

```
change = delta × weight × taper
after  = change + before, kept between 0 and 100, stored to two decimal places
```

**The taper** is what stops a star climbing forever. Each person has a
**popularity anchor**, `popularityAnchor({ charisma })`: their charisma times
`workers.popularity.anchorFromCharisma`, kept between 0 and 100. A gain made
while a region is already above the anchor is slowed:

```
taper = max(taperFloor, 1 − (before − anchor) ÷ taperSpan)
```

With the defaults, a wrestler with 50 charisma who is at 70 in a region is half
way through the 40-point span, so half of a gain lands. Past the whole span the
floor applies and a quarter still lands.

- A span of 0 applies the floor as soon as someone is above their anchor.
- A floor of 0 lets gains stop completely.
- A region at or below the anchor takes gains in full.
- **Losses are never tapered.** Falling is as easy from the top as from the
  middle.
- **Promotions are never tapered.** They have no anchor.

Popularity drift will pull towards the same anchor, which is why it is its own
function.

**Stored popularity stays sparse.** A region that ends at 0 is removed from the
stored map, never written as 0, and so is a region that ends below
`workers.popularity.dropBelow`. At the default of 0 only exact zeros are
removed.

The trace is one parent, "Popularity change: " followed by the reason, with a
line per region, most populous first. Its value is the total of the points
moved across the regions. When the caller passes a traced `delta`, its working
is shown once under "Change asked for".

| Key                                     | Kind   | Default | Range | Unit       | What it does                                                                                          |
| --------------------------------------- | ------ | ------- | ----- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `workers.popularity.anchorFromCharisma` | number | 1       | 0–2   | multiplier | How much of a person's charisma sets their popularity anchor; 0 puts every anchor at 0                |
| `workers.popularity.taperSpan`          | number | 40      | 0–100 | points     | Points above the anchor over which a gain shrinks to nothing; 0 applies the taper floor straight away |
| `workers.popularity.taperFloor`         | number | 0.25    | 0–1   | ratio      | Smallest share of a gain that still lands above the anchor; 0 lets gains stop completely              |
| `workers.popularity.dropBelow`          | number | 0       | 0–10  | points     | A regional popularity that a change leaves below this is removed; 0 removes only exact zeros          |

### Momentum door

`applyMomentumChange` adds the delta and keeps the result between −100 and 100.

Momentum is empty until a worker's first appearance under a contract. The first
change fills it in before adding the delta: it starts from the person's
popularity in the employing promotion's home region, times
`workers.momentum.initialPopFactor`. The trace says so ("First appearance:
starts from home-region popularity"). A first change always counts as a change,
even with a delta of 0, because empty became a number.

| Key                                 | Kind   | Default | Range | Unit       | What it does                                                                                    |
| ----------------------------------- | ------ | ------- | ----- | ---------- | ----------------------------------------------------------------------------------------------- |
| `workers.momentum.initialPopFactor` | number | 1       | 0–2   | multiplier | Share of home-region popularity a first appearance starts momentum from; 0 starts everyone at 0 |

### Morale door

`applyMoraleChange` adds the delta and keeps the result between −100 and 100.
That is all it does.

The morale door applies whatever delta it is given. It does not know what a
win or a loss is worth, and it must never decide that a loss is upsetting.
Losing inside a hot storyline costs little or no morale
([D-09](design-decisions.md#d-09-losing-inside-a-hot-storyline-doesnt-hurt-morale-2026-11-07)), and that rule lives in one place: the
result-morale formula, which works out the story shield. Anything that changes
morale because of a match result goes through that formula first and hands the
answer to this door. No feature works out loss morale on its own, or a wrestler
booked to lose in a hot angle ends up angry about it.
