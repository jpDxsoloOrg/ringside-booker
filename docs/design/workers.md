# Workers

Nearly every part of the game asks the same small questions about a person: how
old are they, can they work today, may they hold this title, which weight class
are they in, what grade is a 72, who do they work for. The `workers` system
(`packages/engine/src/systems/workers/`) answers each of them once, so the
booking screen, the rival bookers and the roster screens can never disagree.

Nothing on this page is stored. Every answer is worked out from the person and
employment rows when it is asked for (see
[data-model.md](data-model.md#stored-and-derived)), so there is no flag to keep
in sync and no migration when a rule changes.

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
| 2   | No `debutDate`, or `debutDate` is after the date          | `notDebuted`               | "Has not debuted yet"                      | the debut date      |
| 3   | An `injury` with `date < injury.expectedReturn`           | `injured`                  | "Injured (leg injury)"                     | `expectedReturn`    |
| 4   | A `restrictions[]` entry with `date < until`              | `rehab` or `personalLeave` | "In rehab", "On personal leave"            | the entry's `until` |
| 5   | Person status is `hiatus`                                 | `personalLeave`            | "On hiatus"                                | none                |
| 6   | `employment.leave` with `date < leave.until`              | `suspended` or `timeOff`   | "Suspended", "On time off"                 | `leave.until`       |
| 7   | Anything else                                             | `available`                | "Available"                                | none                |

Details:

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
