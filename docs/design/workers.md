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
| Everything a profile shows, for one viewer | `workers.profile` (a query)                    | `WorkerProfile`        |
| Everyone in the world, filtered and sorted | `workers.list` (a query)                       | `WorkerList`           |
| Why is this number in a list what it is?   | `workers.explain` (a query)                    | `WorkerExplanation`    |

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

## The profile query

`workers.profile` (`systems/workers/queries/profile.ts`) is everything the
worker profile screen shows about one person, for one viewer:

| Part           | What is in it                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `header`       | Names, picture, age, height and weight with the weight class, style, places, employer, push, alignment, availability |
| `attributes`   | The twelve attributes in their three groups, each with its grade and the reason for the grade                        |
| `overall`      | The rating in every role (`RATING_ROLES`), each with its trace, and which one is the main role                       |
| `expectedPush` | The card position they would expect at the viewer's first promotion, or `null` for a viewer who runs none            |
| `popularity`   | The [roll-up](geography.md#popularity-roll-up) as a view, plus the country and continent they are best known in      |
| `traits`       | Trait keys with their labels                                                                                         |
| `vices`        | Only the vices that are `known` or `recovering`                                                                      |
| `career`       | Contracts, title reigns and teams, each newest first                                                                 |
| `hidden`       | What this viewer was not shown                                                                                       |

Every derived number carries its trace inline. Nothing on a profile is stored,
so there is no stored trace to point at, and one person's traces are small
enough to send whole (the popularity tree is the largest part).

An unknown person is refused with the reason `notFound` ("No such worker"),
through [`refuseQuery`](engine-api.md#refusing-a-query).

The web app has a test that reads all of these breakdowns for people across
the default world, in the words the "Why?" panel shows
(`apps/web/src/screens/workers/defaultWorldWhy.test.ts`): every rating line
names its `workers.rating.*` setting, the expected push and the weight class
read as words ("Main event", "Light heavyweight") with their settings named,
and every country lists its regions by population share.

### What a viewer may see

The rules are in the query and nowhere else, so no screen has to remember them:

- **Development is never returned.** Potential and the attribute ceilings are
  hidden from every viewer, the all-seeing one included. What the player learns
  about someone's future comes from scouting, not from this query.
- **Vices only once known.** A vice in the `hidden` state is left out, for
  everyone. `known` and `recovering` ones are listed with their state.
- **Contract terms and morale belong to the employer.** A contract's `terms`
  and `morale` are returned when the viewer runs that promotion (or is
  all-seeing). For any other promotion they are `null`, and `hidden` lists
  `contractTerms` and `morale` so the screen can write "Private" instead of
  leaving a gap. Employer, role, ring name, dates, push and alignment are public:
  anyone watching the shows knows them.
- **Momentum is public.** It is on-screen form, something the audience sees,
  so every viewer gets it.
- **Offers stay between the two sides.** An employment that is still `offered`,
  or was `declined` or `withdrawn`, is only listed for the promotion that made
  it. A rival's bid for one of your wrestlers is not on their profile.

"The viewer runs that promotion" means the promotion's own controller is the
same human (`viewerPromotionIds`). A computer controller and a human who runs
nothing see every contract's terms and morale as `null`.

## Workers list

`workers.list` (`systems/workers/queries/list.ts`) is everyone in the world as
one row each, for the World > Workers screen and for anything else that needs to
pick people out of the whole world (scouting, rival AI, a world editor).

### Arguments

Both parts are optional. With neither, the answer is every person, best
main-role overall first.

`filters`: a person must pass every filter that is set. A list filter passes
anyone who matches one of its entries, and an empty list is the same as leaving
the filter out.

| Filter         | Passes                                                                             |
| -------------- | ---------------------------------------------------------------------------------- |
| `roles`        | Anyone who holds one of these roles                                                |
| `statuses`     | Anyone whose status is one of these (`active`, `retired`, ...)                     |
| `availability` | Anyone whose [availability](#availability) today is one of these                   |
| `genders`      | Anyone of one of these genders                                                     |
| `styles`       | Anyone with one of these ring styles                                               |
| `employer`     | `{ kind: 'any' }`, `{ kind: 'freeAgent' }` or `{ kind: 'promotion', promotionId }` |
| `continentId`  | Anyone based in a region of this continent                                         |
| `countryId`    | Anyone based in a region of this country                                           |
| `ageMin`       | Anyone at least this old, in whole years                                           |
| `ageMax`       | Anyone at most this old                                                            |
| `attributeMin` | A list of `{ attribute, min }`; every one must hold                                |
| `overallMin`   | Anyone whose main-role overall is at least this                                    |

"Based in" follows `basedInRegionId` to its country and continent through
`geographyOf`. Age is `ageOn(person, today)`. Employer is
[`primaryEmploymentOf`](#employer-free-agent-and-main-role): a free agent is
someone with no working contract today, the same as everywhere else.

No status is left out by default. A retired person is in the list unless a
`statuses` filter excludes them.

`sort`: `{ key, direction }`. The keys are `overall`, `ringName`, `age`,
`popularity` (the top country's value), `employer` (its name) and each of the
twelve attribute keys. The default is `overall`, `desc`.

- Someone with no value for the key (a free agent's employer, the top popularity
  of someone unknown everywhere) goes last in both directions.
- Equal values are ordered by ring name, then by ID, ascending whatever the
  direction. Names compare lower-cased in plain code-unit order, so the order is
  the same on every machine.

An argument this build does not know is refused (`invalidArgs`). A filter nobody
passes is not a refusal: the answer has `rows: []`.

### The answer

`{ rows, total, freeAgents, facets }`:

- `rows`: the people who passed, sorted. Each row has `personId`, `ringName`
  (at the main employer, or the person's own default), `legalName`, `imageRef`,
  `gender`, `roles`, `mainRole`, `age`, `style`, `overall` (the main-role
  [rating](#role-ratings), not rounded), `grade`, `topPopularity`
  (`{ value, countryId, countryName }`, or `null` for someone unknown
  everywhere), `worldPopularity`, `employer` (`{ promotionId, name, shortName }`
  or `null`), `push`, `alignment` (both `null` for a free agent) and
  `availability` (`{ status, label, until }`), and `injury`
  (`{ label, bodyPart, expectedReturn, daysRemaining }` while the availability
  is `injured`, else `null`; WRK6-06).
- `total`: how many people the world holds, before any filter.
- `freeAgents`: how many of those have no employer, before any filter.
- `facets`: the promotions that employ someone, and the continents and countries
  someone is based in, each sorted by name. They are worked out before the
  filters, so a filter control never loses the option it is set to.

The screen's **Injured** quick filter (WRK6-06) is a toggle beside the filters
that sets `availability` to `injured` (`?availability=injured`, so it can be
linked to) and adds an Injury and a Back on column; on a phone the injury joins
the card's subtitle and the return date its small print.

The list shows the top country's popularity, not the world figure. A local hero
at 70 in one country would read as 3 worldwide, which hides exactly what a scout
wants to see.

### What is hidden

A row never has development (potential and ceilings), vices, morale or contract
terms, for any viewer, the all-seeing one included. Push and alignment are
public, as on the profile. Every viewer gets the same rows.

### No traces in rows

Rows carry numbers only, so a few hundred of them stay small. The list is built
in one pass over the people in ID order, with one
[`createPopularityRoller`](geography.md#popularity-roll-up) for the whole call
and each region's country and continent and each promotion's names looked up
once. On the default world (286 people) one call takes under 10 ms in Node.

Every number in a row can still explain itself. `workers.explain`
(`systems/workers/queries/explain.ts`) takes `{ personId, metric }` and returns
`{ value, trace }` for one number:

| `metric`          | What it explains                                                                 |
| ----------------- | -------------------------------------------------------------------------------- |
| `overall`         | The rating in the main role (`overallOf`)                                        |
| `topPopularity`   | The roll-up of the country the list named; the world roll-up for someone unknown |
| `worldPopularity` | The whole map's roll-up                                                          |

It runs the same `roleRating` and `popularityRollup` code as the profile, so a
list, its "Why?" and the profile cannot disagree. A test checks that every value
matches `workers.list` to within 1e-9 for everyone in the default world. An
unknown person is refused with `notFound`, like the profile.

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

**One delta per region (EVT5-02).** A show moves each region it reached by its
own amount, so the door has a second form: `regionDeltas`, a delta for each
region, instead of `regionWeights` and `delta`. Each region's delta lands at
weight 1 (promotions are never tapered; a person's gains still are), with the
same clamps, two decimals and sparse map. One call still records one parent
trace and publishes one `popularity.changed`, however many regions it names; a
traced delta is kept inside its own region's line. Passing `regionDeltas`
together with `regionWeights` or `delta` is refused by the types and throws
`InvalidArgumentError` at run time. Either form returns `byRegion`: each named
region's stored value before and after the call (0 when nothing is stored).

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

## Hooks for later features

Several features that are not built yet hang off this system. Each one plugs
into something that already exists, so none of them needs to edit the workers
code or the profile screen to arrive. This is the list, so a feature can check
what it is promised before it starts.

| Later feature                 | What it uses                                                                                              | Where                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Development and training      | A Development tab on the profile, through `registerProfileTab`                                            | `apps/web/src/screens/workers/profile/profileTabs.ts`                    |
| Popularity and momentum drift | `popularityAnchor`, `applyPopularityChange`, `applyMomentumChange`                                        | [Popularity door](#popularity-door), [Momentum door](#momentum-door)     |
| Injuries, rehab and health    | `availabilityOf` reading `injury` and `restrictions[]` by date; a Health tab through `registerProfileTab` | [Availability](#availability)                                            |
| Anything that shows a worker  | `WorkerLink` for the name, `gameEntityLink` inside "Why?" panels                                          | `apps/web/src/components/WorkerLink`, `apps/web/src/app/entityLinks.tsx` |
| Anything with a title rule    | `isEligibleForTitle`, never a local gender or weight check                                                | [Title eligibility](#title-eligibility)                                  |
| Anything that changes a role  | `setRole`, with `setRoleProblems` to check first                                                          | [Push, alignment and role](#push-alignment-and-role)                     |
| Anything that compares fame   | `createPopularityRoller(...).rollValues`, the one roll-up                                                 | [geography.md](geography.md#popularity-roll-up)                          |

### Profile tabs

The profile's tab strip is a registry. Overview (order 10), Attributes (20),
Popularity (30) and Career (40) are built in. A feature adds its own tab from
its own files:

```ts
registerProfileTab({
  id: 'health', // also the ?tab= value
  label: 'Health',
  order: 60, // 50 and up
  render: ({ profile, personId, viewerPromotionId }) => <HealthTab personId={personId} />,
  visible: ({ profile }) => profile.header.mainRole === 'wrestler', // optional
});
```

- `order` places the tab among the others, lowest first. Feature tabs use 50 and
  up (`FIRST_FEATURE_TAB_ORDER`), and each feature writes the number it took in
  its own doc so two features don't pick the same slot.
- `render` only runs while its tab is selected, so a tab can run its own
  queries without slowing the rest of the profile down.
- `visible` leaves the tab out for profiles it makes no sense on. A hidden tab
  named in the URL falls back to Overview.
- An id that is already taken throws, and the call returns a function that
  removes the tab again.

A tab gets the `workers.profile` answer, which already follows the
[viewer rules](#what-a-viewer-may-see). A tab that runs its own query has to
pass the same viewer, so it can't show a rival's private numbers by accident.

### Drift pulls towards the anchor

Drift is not written yet, but its two ends are. `popularityAnchor({ charisma })`
is the level a person's popularity settles around, and it is the same function
the [popularity door](#popularity-door) uses for its taper, so a gain slows
down towards the same number that drift later pulls back to. Drift works out
its own delta per region and hands it to `applyPopularityChange`, and does the
same for momentum with `applyMomentumChange`. It never writes the rows itself:
the [ownership test](#who-may-call-a-door) fails if it tries.

### Injuries only write dates

An injury system has nothing to switch on or off here. It writes
`person.injury` with an `expectedReturn`, or adds a `restrictions[]` entry with
an `until`, and [availability](#availability) reads them by date on every ask.
Both dates are the [first day back](#until-is-the-first-day-back). Healing
needs no clean-up step, because a date that has passed stops counting on its
own.
