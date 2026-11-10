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

| Question                                   | Function                                       | Returns                |
| ------------------------------------------ | ---------------------------------------------- | ---------------------- |
| How old are they?                          | `ageOn(person, date)`                          | Whole years            |
| How long have they been wrestling?         | `experienceYears(person, date)`                | Years, with a fraction |
| Can they work today?                       | `availabilityOf(person, employment, date)`     | `Availability`         |
| May they hold this title?                  | `isEligibleForTitle(person, title)`            | `Reason[]`             |
| Which weight class?                        | `weightClass({ weightKg }, { tunables })`      | `Traced<WeightClass>`  |
| What grade is this value?                  | `gradeOf(value)`                               | Grade, band and reason |
| Who do they work for?                      | `activeEmploymentsOf`, `primaryEmploymentOf`   | Employment rows        |
| Are they a free agent?                     | `isFreeAgent(read, personId, date)`            | `boolean`              |
| What are they mainly?                      | `mainRoleOf(person, primaryEmployment)`        | `RatingRole`           |
| How good are they at a job?                | `roleRating`, `overallOf`, `overallByRole`     | `Traced<number>`       |
| How known are they to these fans?          | `footprintPopularity`, `footprintPopularityAt` | `Traced<number>`       |
| Where on the card would they expect to be? | `expectedPush`, `expectedPushAt`               | `Traced<Push>`         |

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

## Role ratings

There is **no stored overall** anywhere, on purpose. A 70-rated referee and a
70-rated wrestler are good at different jobs, and one number per person would
have to pretend they are the same thing. Instead a person has a rating for
every one of the seven roles, worked out on read from their twelve attributes
and that role's weights. Screens show the main role's rating by default.

```
rating = Σ (weight × attribute) ÷ Σ weight
```

over the attributes whose weight for the role is above 0, in the standard
attribute order, kept between 0 and 100.

- `roleRating({ role, attributes }, { tunables })` is the formula.
- `overallOf(person, role, { tunables })` is the same for a person row. An
  occasional wrestler's wrestler rating uses the wrestler weights, and the
  trace has a note saying so.
- `overallByRole(person, { tunables })` gives all seven at once.

Every weight is its own tunable, `workers.rating.<role>.<attribute>`: 84 of
them, 0 to 10 in steps of 0.5, in the `Worker ratings` category. The defaults
(a blank cell is 0, so the attribute does not count for that role):

| Attribute    | Wrestler | Manager | Presenter | Announcer | Referee | Producer | Booker |
| ------------ | -------- | ------- | --------- | --------- | ------- | -------- | ------ |
| Ring work    | 3        |         |           |           |         |          |        |
| Psychology   | 2        | 1       |           | 1         | 1       | 2        | 1.5    |
| Stamina      | 1        |         |           |           | 0.5     |          |        |
| Safety       | 1        |         |           |           |         |          |        |
| Athleticism  | 1.5      |         |           |           |         |          |        |
| Mic skills   | 1        | 3       | 2         | 1.5       |         |          |        |
| Charisma     | 1.5      | 2       | 2         | 0.5       |         |          |        |
| Presence     | 1        | 1.5     | 2         |           |         |          |        |
| Officiating  |          |         |           |           | 4       |          |        |
| Broadcasting |          |         | 1         | 3         |         |          |        |
| Producing    |          |         |           |           |         | 4        | 1      |
| Booking      |          |         |           |           |         | 1        | 4      |
| Total weight | 12       | 7.5     | 7         | 6         | 5.5     | 7        | 6.5    |

Rules that hold whatever the weights are set to:

- **0 means 0.** A weight overridden to 0 takes the attribute out of the
  rating, and its line out of the trace, on the next read. A weight above 0 on
  an attribute the role did not use before brings it in.
- **All weights 0 gives 0.** If every weight for a role is 0 there is nothing
  to average, so the rating is 0 and the trace has the note "Every weight for
  this role is 0, so the rating is 0".
- **No rounding in the engine.** Rounding inside the formula would make sorts
  unstable and the trace wrong by up to half a point. Screens show a whole
  number or one decimal place.

### Worked example

Rook Halvorsen, an upper-card wrestler in the default world, rated as a
wrestler:

```
Wrestler rating: 67.08
  Ring work 84 × weight 3        252     (workers.rating.wrestler.ringwork)
  Psychology 80 × weight 2       160     (workers.rating.wrestler.psychology)
  Stamina 69 × weight 1           69     (workers.rating.wrestler.stamina)
  Safety 71 × weight 1            71     (workers.rating.wrestler.safety)
  Athleticism 51 × weight 1.5     76.5   (workers.rating.wrestler.athleticism)
  Mic skills 46 × weight 1        46     (workers.rating.wrestler.mic)
  Charisma 61 × weight 1.5        91.5   (workers.rating.wrestler.charisma)
  Presence 39 × weight 1          39     (workers.rating.wrestler.presence)
                                 805
  ÷ Total weight 12               67.08
  Kept between 0 and 100          67.08
```

The Why? panel shows exactly these lines, each with the tunable that set its
weight. The same person rates 42.2 as a booker and 30.3 as a referee, which is
why there is no single overall.

## Expected push

Expected push is where on the card a worker would expect to be at a given
promotion: main event, upper card, mid card, lower card or enhancement. The
profile shows it as "Would expect: Upper card at Altura" with a Why?. It is
derived on read from stored popularity, so when popularity moves, expected
push follows with nothing to keep in sync.

`expectedPush(inputs, { tunables })` takes the job (`employmentRole`), the
worker's and the promotion's regional popularity, the promotion's name and the
map's regions. `expectedPushAt(read, personId, promotionId, tunables)` gathers
those from the world: it uses the job the person has at that promotion, or the
job they are known for when they do not work there.

The steps, every one of them in the trace:

1. **Crew are not pushed.** A referee, announcer, producer, presenter or booker
   expects `none`. Wrestlers and managers go on.
2. **The promotion's fan base.** The regions where the promotion's popularity
   is at least `workers.expectedPush.footprintMinPop` (10). Each region counts
   by its fans: `population × promotion popularity ÷ 100`. If no region
   reaches the minimum, every region where the promotion has any popularity
   counts. If there are none of those either, the promotion has no fans yet and
   the answer is `enhancement`: nobody is a draw there.
3. **Two popularity figures over that fan base.** The worker's (`W`) and the
   promotion's own (`P`), each the fan-weighted mean of regional popularity.
   This is `footprintPopularity`, described below.
4. **Standing.**
   `standing = W ÷ max(P, workers.expectedPush.minPromotionPop)`. A standing of
   1 means the worker is as well known to these fans as the promotion itself.
   The floor (5) stops a promotion almost nobody has heard of from turning
   every worker into a headliner.
5. **The decision.** If `W` is at least `workers.expectedPush.starPop` (75) the
   worker expects the main event: a star is a star anywhere. Otherwise it is
   the first position, from the top down, whose threshold the standing reaches:

   | Position    | Standing at least | Tunable                               |
   | ----------- | ----------------- | ------------------------------------- |
   | Main event  | 0.85              | `workers.expectedPush.mainEventRatio` |
   | Upper card  | 0.65              | `workers.expectedPush.upperCardRatio` |
   | Mid card    | 0.45              | `workers.expectedPush.midCardRatio`   |
   | Lower card  | 0.25              | `workers.expectedPush.lowerCardRatio` |
   | Enhancement | anything lower    |                                       |

   A standing exactly on a threshold earns the position. The thresholds are
   checked top down, so one set out of order by an override makes a position
   unreachable and never throws.

**Why a ratio and not size tiers.** The obvious way to do this is a table per
promotion size: "at a big promotion you need 70 to main event, at a small one
40". That makes expectations jump the day a promotion crosses a size line, and
it needs a row for every size. A ratio has neither problem. The same worker
expects less as the promotion grows, a little at a time, and a promotion that
is big in one country and unknown in another is judged by the fans it actually
has. This follows the "smooth scaling instead of hard size tiers" default in
[design-decisions.md](design-decisions.md).

**Why the star rule.** A ratio alone says a worker at 80 should only be upper
card at a promotion at 100. Nobody that famous thinks of themselves as anything
but a headliner, so popularity of 75 or more among the promotion's fans is
enough on its own. Setting `starPop` to 100 effectively turns the rule off.

Rook Halvorsen again, at Altura Wrestling Entertainment: his popularity among
Altura's fans is 40.8, Altura's own is 58.6, so his standing is 0.70. That
reaches the upper card mark of 0.65 and not the main event mark of 0.85.

### Footprint popularity

`footprintPopularity({ subjectPop, promotionPop, promotionName, regions }, { tunables })`
is steps 2 and 3 on their own: how well known a subject is among one
promotion's fans.

```
fans in a region      = population × promotion popularity there ÷ 100
footprint popularity  = Σ (fans × subject popularity) ÷ Σ fans
```

The subject can be a person or the promotion itself. Its trace is labelled
"Popularity where <promotion> draws" and lists the five regions with the most
fans one by one, then the rest as a single line, then the total.

- `footprintPopularityValue(...)` is the same number with no trace, added up
  in the same order, for lists that need it for a whole roster.
- `footprintPopularityAt(read, personId, promotionId, tunables)` reads the
  inputs from the world.
- `fanBaseOf(promotionPop, regions, minPop)` gives the fan base itself.

This is the one place a footprint is worked out. Roster columns, fit and
morale read this helper, so no two screens can disagree about how known
someone is to a promotion's crowd. A wrestler who is a star at home and unknown
where a promotion runs has a low footprint popularity there, whatever their
world figure says.

### Calibration

`packages/engine/test/systems/workers/calibration.test.ts` runs expected push
for every employed wrestler in the default world and compares it with the push
they actually have. With the defaults above:

| Promotion                       | Own popularity | Wrestlers | Exact | Within one position |
| ------------------------------- | -------------- | --------- | ----- | ------------------- |
| Altura Wrestling Entertainment  | 58.6           | 44        | 100%  | 100%                |
| Tessen Pro Wrestling            | 55.1           | 26        | 100%  | 100%                |
| Cielo Alto Lucha Libre          | 53.1           | 26        | 100%  | 100%                |
| Ashlar Pro Wrestling            | 35.0           | 12        | 92%   | 100%                |
| Golden Poppy Wrestling          | 34.7           | 12        | 92%   | 100%                |
| Longleaf Championship Wrestling | 31.2           | 12        | 83%   | 100%                |
| Eisenwerk Wrestling             | 28.9           | 12        | 92%   | 100%                |
| Blast Furnace Wrestling         | 26.2           | 12        | 92%   | 100%                |
| Boreal Championship Wrestling   | 25.6           | 13        | 85%   | 100%                |
| Hardpan Pro Wrestling           | 20.0           | 8         | 50%   | 100%                |
| Hibari Pro Wrestling            | 18.0           | 8         | 88%   | 100%                |
| Wattle Pro Wrestling            | 18.0           | 8         | 63%   | 88%                 |

Overall 99% of wrestlers are within one card position. The test fails below
50%, so a change to the defaults or to the world that breaks the fit shows up
there. It also checks that a fixed worker expects a lower push from Altura than
from the smallest promotion, and never a higher push from a more popular
promotion than from a less popular one.
