# Health

The health system (`packages/engine/src/systems/health/`) looks after a
worker's body between shows: fatigue fading day by day, and damaged body parts
healing slowly, but only as far as their age allows. It is also the engine's
reference system, the layout other systems copy (see
[the worked example](calculation-traces.md#worked-example)).

WRK6-02 built fatigue recovery, the condition cap, condition recovery and
medical care. WRK6-03 added [injuries](#injuries) and [returns](#returns).
Injury risk (WRK6-04) and [the Health tab](#the-health-profile) on the profile
(WRK6-05) add their sections here. How matches make people tired
and wear their bodies is the match system's (MTCH4).

| Piece        | Where              | What it does                                                                                         |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------------------- |
| Tunables     | `tunables.ts`      | Every `health.*` balance number, category `Health`                                                   |
| Streams      | `streams.ts`       | `health.recovery`: the extra rest roll; `health.injuries`: injury rolls                              |
| Formulas     | `formulas/`        | `computeFatigueRecovery`, `computeConditionCap`, `computeConditionRecovery`, and the injury formulas |
| Medical care | `medical.ts`       | `medicalLevelOf`: the care level a person gets today                                                 |
| Talking days | `appearances.ts`   | `talkedWithoutWrestling`: who cut a promo and did not wrestle                                        |
| Injuries     | `injure.ts`        | `injure` (`health.injure`): the one way anyone gets hurt                                             |
| Returns      | `returns.ts`       | `healInjuries` (inside `health.recovery`) and `health.pruneInjuryDetail`                             |
| Morning      | `morning.ts`       | the day's rest and healing, run early before a show the player runs ahead of its day                 |
| Policy lines | `policyEffects.ts` | the medical policy's health lines in the Finances preview (ECO1)                                     |
| Handler      | `injuryHandler.ts` | registers `health.injure` as MTCH4's injury handler                                                  |
| Phases       | `phases.ts`        | `health.recovery` (daily), `health.conditionRecovery` and `health.pruneInjuryDetail` (Mondays)       |
| Events       | `events.ts`        | `fatigue.cleared`, `injury.sustained`, `injury.healed`                                               |
| Query        | `queries.ts`       | `health.profile`: the worker profile's Health tab in one answer                                      |

## Fatigue recovery

Every morning, everyone with some fatigue sheds part of it. Code:
`formulas/fatigueRecovery.ts`.

```
fatigue after  = clamp(fatigue before − daily recovery − extra rest, 0, 100)
daily recovery = recoveryPerDay × stamina × age × trait × talking day
stamina        = 1 + (stamina − 50) / 50 × staminaWeight
age            = max(ageFactorMin, 1 − max(0, age − ageFrom) × agePenaltyPerYear)
trait          = workhorseMultiplier for a workhorse, coasterMultiplier for a coaster, else 1
talking day    = workedPromoRecovery after a show day spent talking and not wrestling, else 1
extra rest     = a whole number from 0 to recoveryBonusMax, both ends included
```

50 is the middle of the 0–100 attribute scale, so a worker with 50 stamina
recovers at the plain daily rate; 100 stamina recovers 40% faster and 0
stamina 40% slower at the default weight. With the defaults, a 43-year-old
recovers 80% as fast as a 30-year-old, and anyone 58 or older half as fast.

| Tunable                              | Kind    | Default | Range | Unit       | What it does                                                                    |
| ------------------------------------ | ------- | ------- | ----- | ---------- | ------------------------------------------------------------------------------- |
| `health.fatigue.recoveryPerDay`      | number  | 4       | 0–100 | points/day | Fatigue an average worker sheds each day, before stamina, age and traits        |
| `health.fatigue.recoveryBonusMax`    | integer | 1       | 0–10  | points/day | Largest random extra recovery per day; 0 turns the roll's effect off            |
| `health.fatigue.staminaWeight`       | number  | 0.4     | 0–1   | ratio      | How much stamina speeds up or slows down recovery; 0 ignores stamina            |
| `health.fatigue.ageFrom`             | integer | 33      | 18–60 | years      | Age from which fatigue fades more slowly                                        |
| `health.fatigue.agePenaltyPerYear`   | number  | 0.02    | 0–0.2 | ratio      | Recovery lost for each year past that age; 0 turns the age effect off           |
| `health.fatigue.ageFactorMin`        | number  | 0.5     | 0–1   | multiplier | The least of the daily recovery age can leave                                   |
| `health.fatigue.workhorseMultiplier` | number  | 1.2     | 0–3   | multiplier | Recovery for a workhorse, as a multiple of everyone else                        |
| `health.fatigue.coasterMultiplier`   | number  | 0.9     | 0–3   | multiplier | Recovery for a coaster, as a multiple of everyone else                          |
| `health.fatigue.workedPromoRecovery` | number  | 0.5     | 0–1   | multiplier | Recovery after a show spent talking (a promo or angle, no match); 1 rests fully |

**Whose Why? is kept.** Only the player's own workers (people a human's
promotion or brand employs that day) keep the full recovery trace. Everyone
else's is stored as a summary from the start (`summaryOnly`), because a long
skip would otherwise keep a full trace for every tired rival worker every day.

**The roll is always drawn**, even when `recoveryBonusMax` is 0, so every call
takes exactly one draw from `health.recovery` and tuning never shifts the
stream. Someone already at 0 fatigue is skipped and draws nothing.

**Aging off.** When the world's `agingEnabled` setting is off (WLD-13), the age
factor is 1 and the trace says "Aging is off in this world". The phase passes
the setting in as an input; the formula never reads the world.

**Talking days** (owner rule, Sprint 4). Promos, angles and interviews cost no
stamina (MTCH4 adds no fatigue for them), but a worker who spent a show day
talking rests less than one who stayed home. The morning after a show day, a
person who was a `speaker` in an angle on a completed show and a competitor in
no match that day has their daily recovery multiplied by `workedPromoRecovery`,
traced as "Worked a promo today". The extra rest roll is not reduced. A match
day already costs fatigue and earns no rest bonus, so talking and wrestling on
the same show never stack. Recovery looks at **yesterday's** shows because a
day's housekeeping runs before its shows: rival shows run in the `shows` group
and the player's when they press Run the show.

**The trace.** Each line has a name a player can read: "Fatigue before rest",
"Daily recovery" (with "Stamina", "Age", "Workhorse" or "Coaster" and "Worked a
promo today" beneath it, each opening onto its own small sum and the tunables
it read), "Extra rest" (the roll) and the clamp. It is stored under
`health.fatigueRecovery:<personId>`, replacing the person's previous one.

### The player's show nights

A rival's show runs inside its day, in the `shows` group, after the morning's
housekeeping, so its workers rest from it the next morning. The player's show
runs earlier: the day stops before it starts ("Tonight: <Show>") and the
player presses Run the show (`shows.runTonight`) before any of the day's
phases. Without help, that day's housekeeping would then rest the player's
workers from the show they had just wrestled, and on a Monday heal its wear,
while a rival's workers waited for the next morning.

So a show run ahead of its day runs the day's morning first (WRK6-07,
`morning.ts`): the before-a-show hook `health.morningBeforeShow` (order 0) sees
`beforeTheDay` on its input, set only by `shows.runTonight`, and runs
`runFatigueMorning` (returns, then fatigue recovery) and, on a Monday,
`recoverConditions`, exactly as the phases would. `health.recovery` and
`health.conditionRecovery` then skip the day: `morningRanEarly(read, date)` is
true when a show dated that day has already completed, which only a show run
ahead of its day can have done by the housekeeping. A second show of the
player's the same day finds the morning done and skips it too. The rule is
read from the world, so it holds across a save and load.

Running the show by command or inside the day now leaves the same world, random
streams and traces, tired workers or not (`runTonight.test.ts`), and a player's
worker and a rival's with the same match rest on the same morning
(`showNightRecovery.test.ts`). The one thing that still sees the player's show
first is the day's [off-screen injury](#off-screen-injuries) roll, which runs
after the morning and reads fatigue and condition as they are then.

## Condition cap

A body part can heal back only so far, and the limit falls with age. Code:
`formulas/conditionCap.ts`.

```
cap = clamp(max(capFloor, 100 − max(0, age − capAgeFrom) × capDropPerYear), 0, 100)
```

With the defaults the cap is 100 up to 30, 85 at 40, 70 at 50 and 55 from 60
on, so one bad injury does not end a 26-year-old's career while a 50-year-old
never gets back to perfect. With aging off the cap is 100 at any age.

| Tunable                           | Kind    | Default | Range | Unit   | What it does                                                                 |
| --------------------------------- | ------- | ------- | ----- | ------ | ---------------------------------------------------------------------------- |
| `health.condition.capAgeFrom`     | integer | 30      | 18–60 | years  | Age from which a body can no longer heal all the way back to 100             |
| `health.condition.capDropPerYear` | number  | 1.5     | 0–10  | points | How far the healing cap falls for each year past that age; 0 keeps it at 100 |
| `health.condition.capFloor`       | number  | 55      | 0–100 | points | The lowest the healing cap goes, however old the worker                      |

## Condition recovery

Every Monday, each damaged body part heals a little. Code:
`formulas/conditionRecovery.ts`, phase `health.conditionRecovery`.

```
after = min(cap, current + recoveryPerCheck × trait × medical)
```

- **An injured part does not heal** while the injury lasts: "Injured part: no
  recovery while it heals". The other parts still do.
- **A part at or above the cap stays where it is**: "Already at or above the
  cap for their age". Healing never lowers condition; decline with age is
  WRK4's.
- **Trait**: `durableMultiplier` for a durable worker, `injuryProneMultiplier`
  for an injury-prone one, otherwise 1.
- **Medical**: the multiplier for the care level from
  [medical care](#medical-care), labelled "Medical care: <promotion> (level N)"
  or "No employer: standard care".

At the defaults a part heals half a point a week: a 25-year-old's leg at 80 is
back to 100 in 40 weeks at standard care, 31 at level 3 and 50 at level 0.

| Tunable                                  | Kind   | Default | Range | Unit       | What it does                                                                      |
| ---------------------------------------- | ------ | ------- | ----- | ---------- | --------------------------------------------------------------------------------- |
| `health.condition.recoveryPerCheck`      | number | 0.5     | 0–10  | points     | Condition a damaged body part gets back each week, before traits and medical care |
| `health.condition.durableMultiplier`     | number | 1.25    | 0–3   | multiplier | Healing for a durable worker, as a multiple of everyone else                      |
| `health.condition.injuryProneMultiplier` | number | 0.75    | 0–3   | multiplier | Healing for an injury-prone worker, as a multiple of everyone else                |

The phase visits everyone not retired or deceased, in id order. A person whose
parts are all at or above their cap is skipped before anything else is read,
and only people whose condition changed are written, so a year costs about 52
light passes over the people table. It draws no random numbers, stores no
traces and publishes nothing: the formula has no roll, so the health profile
(WRK6-05) works out the cap and the next week's gain again for its Why?.

## Medical care

`medicalLevelOf(read, personId, date, tunables)` in `medical.ts` returns
`{ level: 0 | 1 | 2 | 3, promotionId }`: the highest `policies.medical` among
the person's **active** employments that have started by `date` (ties go to
the lower promotion id), or `health.medical.freeAgentLevel` with
`promotionId: null` when nobody employs them. Offered, signed, ended and
future contracts do not count. Condition recovery uses it here; an injury's time out
([injuries](#injuries), read on the day of the injury) and injury risk
(WRK6-04) use the same helper. The policy itself and
what it costs are the finance system's ([finances.md](finances.md#medical)).

| Tunable                                    | Kind    | Default | Range | Unit       | What it does                                                   |
| ------------------------------------------ | ------- | ------- | ----- | ---------- | -------------------------------------------------------------- |
| `health.medical.recoveryMultiplier.level0` | number  | 0.8     | 0–3   | multiplier | Healing under medical care level 0 (none)                      |
| `health.medical.recoveryMultiplier.level1` | number  | 1       | 0–3   | multiplier | Healing under medical care level 1                             |
| `health.medical.recoveryMultiplier.level2` | number  | 1.15    | 0–3   | multiplier | Healing under medical care level 2                             |
| `health.medical.recoveryMultiplier.level3` | number  | 1.3     | 0–3   | multiplier | Healing under medical care level 3 (the best)                  |
| `health.medical.freeAgentLevel`            | integer | 1       | 0–3   | count      | The medical care level (0 to 3) a worker with no employer gets |
| `health.medical.injuryMultiplier.level0`   | number  | 1.2     | 0–3   | multiplier | Injury time out under medical care level 0 (none)              |
| `health.medical.injuryMultiplier.level1`   | number  | 1       | 0–3   | multiplier | Injury time out under medical care level 1                     |
| `health.medical.injuryMultiplier.level2`   | number  | 0.9     | 0–3   | multiplier | Injury time out under medical care level 2                     |
| `health.medical.injuryMultiplier.level3`   | number  | 0.8     | 0–3   | multiplier | Injury time out under medical care level 3 (the best)          |

The Finances policy preview explains the level to the player (WRK6-07, through
ECO1's `registerPolicyEffect`, `policyEffects.ts`): each level has two lines
built from these tunables, "Injuries heal in ×0.8 of the time" and "Body
condition recovers ×1.3 per week" ("the usual time" and "the usual rate" at
×1), good news in green and bad in red, each with the tunable as its Why?. The
lines carry no cost; what the policy costs is ECO1's.

## Injuries

`injure(ctx, personId, options)` in `injure.ts` (the docs call it
`health.injure`) is the one way anyone gets hurt. MTCH4's in-match roll, DAY7's
world events and WRK6-04's off-screen injuries all call it; it is the only code
that inserts into the [`injuries` table](data-model.md#injuries-injuries-inj_)
or sets `person.injury`, and `test/systems/health/ownership.test.ts` fails if
anything else does. An injury never changes morale or causes anger: it is not
a result, so the story shield (D-09) is not involved.

**One current injury.** A person has at most one current injury: the row with
`returnedOn` null, mirrored on `person.injury` for everything that reads it
(availability, booking warnings, condition recovery). A second `injure` on
someone already hurt is refused with `alreadyInjured`; injuries never stack or
get "aggravated". Past injuries stay in the table as the worker's record.

**The outcome.** Every roll draws from `health.injuries`, in this order: the
kind (only when the caller named none), the severity (only when the caller did
not set one), the days out, and whether they can still work angles.

1. **Kind** (`formulas/injuryKindPick.ts`, `pickInjuryKind`): a decision that
   considers every catalog kind (sorted by key) with its `weight` and rolls
   one. With a body part hint (MTCH4's worst-worn part), only kinds on that part
   are considered, or every kind when the catalog has none there. An empty
   catalog picks nothing: the injury is refused with `noCatalog` and a line in
   the day's log.
2. **Severity** (`formulas/injurySeverity.ts`, `decideInjurySeverity`): minor,
   moderate or severe, rolled from the kind's `severityWeights`. A severity the
   caller sets is a rule, "Set by the match", and draws nothing.
3. **Days out** (`formulas/injuryOutcome.ts`, `computeInjuryDays`):

```
days = clamp(ceil(roll × severity × trait × medical), 1, maxDays)
roll     = a whole number in the kind's catalog range, both ends included
severity = severityMultiplier.minor / .moderate / .severe
trait    = durableMultiplier for a durable worker, injuryProneMultiplier for an
           injury-prone one, else 1 ("Neither durable nor injury prone")
medical  = medical.injuryMultiplier.level0..level3 for the care the person gets
           that day (medical care)
```

The Why? reads like this: "Sprained ankle: 7–21 days" with the roll, the
severity line with its decision under it, the trait line, "Medical care:
Apex Wrestling (level 2)" (or "No employer: standard care"), rounded up,
"At least a day" (fixed: an injury always costs at least a day) and the
`maxDays` cap. A multiplier tuned to 0 still costs a day. 4. **Angles**: `rollChance(kind.canWorkAnglesChance)`, added to the end of
the days-out trace with a note ("Can still work angles while out" or
"Cannot work angles while out").

**Condition loss** (`formulas/injuryConditionLoss.ts`,
`computeInjuryConditionLoss`): the hurt part loses
`days out / 7 × conditionLossPerWeek` points (7 is fixed: days per week), never
more than it has. The loss is permanent apart from the slow, age-capped
[condition recovery](#condition-recovery), which skips the injured part until
they return.

**What it writes.** One `injuries` row (`noticedOn` is null for the player's
own workers while `health.stopOnOwnInjury` is on, so the
[own-injury gate](#own-injury-gate) stops the day; the day itself for everyone
else), the `person.injury` pointer
(`expectedReturn = today + days`), the lower condition, three traces under the
injury id (`health.injury` for the days out, `health.injuryConditionLoss`, and
`health.injuryChance` when the caller passed the chance that led to it), and
the `injury.sustained` event. The traces are full for the player's own workers
and summaries from the start for everyone else, to keep saves small.

**The contract for callers.**

| Option        | Required              | What it does                                                               |
| ------------- | --------------------- | -------------------------------------------------------------------------- |
| `source`      | yes                   | `world` (off screen, DAY7, WRK6-04) or `segment` (on a show, MTCH4)        |
| `segmentId`   | exactly for `segment` | the segment they were hurt in; anything else throws `InvalidArgumentError` |
| `kindKey`     | no                    | the kind; an unknown key is refused with `unknownKind`                     |
| `severity`    | no                    | a severity the caller already knows                                        |
| `bodyPart`    | no                    | narrows the kind roll to that part when the catalog has a kind there       |
| `chanceTrace` | no                    | the chance that led to the injury, stored as `health.injuryChance`         |

It returns `{ ok: true, injuryId }`, or `{ ok: false, reason }` with
`alreadyInjured`, `notInjurable` (retired, deceased or unknown person),
`unknownKind` or `noCatalog`. A refusal writes nothing and draws nothing. A
world from before WRK6-01 has no catalog, so it has no injuries until a new
game.

**MTCH4's handler.** `injuryHandler.ts` registers `health.injure` as MTCH4's
built-in injury handler ([physical-toll.md](physical-toll.md#the-injury-roll))
when the health system loads. For each worker the match roll injures it calls
`injure` with `source: 'segment'`, the segment, the body part hint and the
injury chance, and returns the `health.injury` trace ref (null when the worker
was already injured). Tests of MTCH4's seam clear it with
`clearInjuryHandler()` and put it back with `restoreBuiltInInjuryHandler()`.

| Tunable                                     | Kind    | Default | Range | Unit       | What it does                                                               |
| ------------------------------------------- | ------- | ------- | ----- | ---------- | -------------------------------------------------------------------------- |
| `health.injury.severityMultiplier.minor`    | number  | 0.6     | 0–3   | multiplier | Time out for a minor injury, as a multiple of the rolled days              |
| `health.injury.severityMultiplier.moderate` | number  | 1       | 0–3   | multiplier | Time out for a moderate injury, as a multiple of the rolled days           |
| `health.injury.severityMultiplier.severe`   | number  | 1.8     | 0–3   | multiplier | Time out for a severe injury, as a multiple of the rolled days             |
| `health.injury.durableMultiplier`           | number  | 0.75    | 0–3   | multiplier | Time out for a durable worker, as a multiple of everyone else              |
| `health.injury.injuryProneMultiplier`       | number  | 1.35    | 0–3   | multiplier | Time out for an injury-prone worker, as a multiple of everyone else        |
| `health.injury.maxDays`                     | integer | 540     | 1–730 | days       | The longest any injury keeps someone out                                   |
| `health.injury.conditionLossPerWeek`        | number  | 1       | 0–10  | points     | Condition the hurt body part loses for each week out; 0 turns the loss off |

The medical level is read on the day of the injury: a better medical policy
later (ECO1) speeds up future injuries and condition healing, not an injury
already dated.

## Returns

Every morning, before fatigue recovery, `health.recovery` closes each current
injury whose `expectedReturn` is today or earlier (`healInjuries`,
`returns.ts`), in injury id order: the row gets `returnedOn = today`, the
person's `injury` pointer is cleared and `injury.healed { personId, injuryId,
kindKey, daysOut }` is published. A person is back on exactly their
`expectedReturn`, not the day before. It draws no random numbers, so the
recovery stream stays aligned, and it only looks at people with a pointer.

The rows stay for good: they are small and part of a worker's record, and the
history roll-up keeps any segment an injury row points at
([save-format.md](save-format.md#history-retention)). Their traces follow the
owner's history rule instead: `health.pruneInjuryDetail` (`periodic`, order
44, Mondays) slims the traces of every injury that started before
`history.keepDetailDays` to summaries, so the Why? says "Full breakdown is only
kept for recent results". The per-kind trace limit (`sim.traceRetentionPerKind`)
can summarise them sooner on a busy world.

## Off-screen injuries

Wrestlers get hurt away from the shows too: in training, travelling, in a
house-show bump nobody booked. Every day, first in the `worldEvents` group,
`health.offscreenInjuries` (`offscreen.ts`) gives every eligible wrestler in the
world a small chance of an injury. Free agents and the player's own workers
roll too, so the world keeps moving before any show runs. This is also how
rival wrestlers still get hurt while the rival rule skips their in-match
injuries ([D-01](design-decisions.md#d-01-rival-promotions-use-simplified-rules-2026-11-07), [rival-desk.md](rival-desk.md#shortcuts)).

**Who rolls.** `isOffscreenEligible(person, date)`: status `active`, the role
`wrestler` or `occasionalWrestler`, a debut on or before the day, and not
already injured. People are visited in id order (the `byStatus` index for
`active`).

**The chance** (`formulas/offscreenInjuryChance.ts`,
`computeOffscreenInjuryChance`), a probability for today:

```
chance = clamp(perYear / 365.25 × trait × fatigue × body × rival, 0, 1)
perYear = health.offscreen.injuriesPerYear
trait   = durableMultiplier for a durable wrestler, injuryProneMultiplier for an
          injury-prone one, else 1 ("Neither durable nor injury prone")
fatigue = 1 + fatigue / 100 × fatigueWeight                       ("Fatigue")
body    = 1 + (100 − worst part's condition) / 100 × conditionWeight
                                         ("Worst body part: Legs 42")
rival   = computerMultiplier while the rival rule applies to their employer,
          else 1
```

365.25 is fixed ("Days in a year"). The rival rule comes from AIP1's
`aiShortcutOn(read, tunables, promotionId, 'ai.skipInMatchInjuries', brandId)`
through `offscreenShortcutOf` (`rivalShortcut.ts`), for the worker's main
employer and brand: computer-run, the level playing field off and the shortcut
on. The Why? then reads "Rival rule: no in-match injuries, so more off-screen
ones (D-01)" with the shortcut's own decision under it; a free agent's reads
"No rival rule in this game", and a worker the rule does not cover reads "Rival
rule does not apply". WRK6 is listed as a consumer of the shortcut on the Rival
rules screen.

**The roll.** Each eligible wrestler draws exactly once from
`health.offscreen`, whatever the tunables say, so tuning never shifts the
stream. On a hit the phase calls [`injure`](#injuries) with `source: 'world'`
and the chance as `chanceTrace` (stored as `health.injuryChance`), inside a
savepoint of its own so one bad catalog entry cannot undo the day's other
injuries. A world with no injury catalog logs one line and rolls nothing.

**Cost.** With the fast paths on (`core/fastPaths.ts`) the chance is worked out
without its trace (`offscreenInjuryChanceValue`, the same steps in the same
order) and the Why? is built only for the people who get hurt; the fast-path
equivalence test checks the two agree. The employer's rival rule is worked out
once per employer per day. Traces are stored only for injuries, as summaries
for anyone the player does not employ, and are slimmed past
`history.keepDetailDays` by `health.pruneInjuryDetail` like every injury trace.

**Measured.** On a 228-wrestler world of free agents over 365 days
(`test/systems/health/offscreenRate.test.ts`), 66 off-screen injuries against
an expected 68.4 (228 × 0.3; people already out do not roll, so a little
under). On the default world, where the rival rule doubles the rate for
computer-run rosters, a 30-day skip gives 11 world-wide and a year 117 (seed of
the default game, 2026-11). Measured with MTCH4-04's show-night toll merged, a
365-day default-world save is 1.16 MB gzipped (1.59 MB with every show carded)
and the skip takes about the same time as before: the off-screen rolls cost
well under a second a year.

| Tunable                                  | Kind   | Default | Range | Unit       | What it does                                                                |
| ---------------------------------------- | ------ | ------- | ----- | ---------- | --------------------------------------------------------------------------- |
| `health.offscreen.injuriesPerYear`       | number | 0.3     | 0–5   | count      | Off-screen injuries an average wrestler has in a year; 0 turns them off     |
| `health.offscreen.durableMultiplier`     | number | 0.6     | 0–3   | multiplier | The chance for a durable wrestler, as a multiple of everyone else           |
| `health.offscreen.injuryProneMultiplier` | number | 1.6     | 0–3   | multiplier | The chance for an injury-prone wrestler, as a multiple of everyone else     |
| `health.offscreen.fatigueWeight`         | number | 0.5     | 0–2   | ratio      | How much more likely a fully tired wrestler is to get hurt (0.5 = 50% more) |
| `health.offscreen.conditionWeight`       | number | 0.5     | 0–2   | ratio      | How much more likely a wrestler with a worn-out body part (condition 0) is  |
| `health.offscreen.computerMultiplier`    | number | 2       | 0–10  | multiplier | The chance for rival wrestlers while the rival rule skips in-match injuries |

## Own-injury gate

When one of the player's own workers gets hurt, on a show or off it, the game
stops so they see it straight away instead of finding out weeks later.

**The notice rule.** When `injure` writes an injury, `noticedOn` is left null
when `health.stopOnOwnInjury` is on and a human runs one of the person's
employers that day (the brand's own controller when the brand has one, else
the promotion's: `needsNotice` / `worksForAHuman` in `notice.ts`). Every other
injury (rivals, free agents) is noticed on the day. The rule is decided when
the injury is written because a gate cannot read tunables.

**The gate.** `health.ownWorkerInjured` ("Your worker was injured", `gate.ts`)
reads the `awaitingNotice` index and stops the day while any injury waits:

- one waiting: "Big Joe was injured (Sprained ankle, out until Mar 14, 2031)",
  with the ring name from their main contract (or their own) and the injury's
  catalog label;
- several: "Big Joe and 2 others were injured".

The injury with the lowest id leads; `subject` is that person and `actionHint`
is `roster`. It works alongside show night: on a show day both gates hit and the
day control picks the leading one.

**Marking it seen.** `health.acknowledgeInjuries { injuryIds }` (1 to 50 ids,
`commands.ts`) sets `noticedOn` to today on each waiting one and publishes
`injury.noticed { injuryIds }`. The screens that show an injury (the roster's
Injuries tab and the health profile, WRK6-05/06) run it when they open. It
refuses an unknown id (`unknownInjury`) and another promotion's worker's
injury (`notYourWorker`). The player's own injuries already seen are skipped
without a reason and nothing is written, so a screen can send everything it
shows. An injury still waiting whose worker no human employs any more (their
contract ended while it waited) can be marked by the player, so a waiting
injury never blocks the day for good.

**Turning it off.** Set `health.stopOnOwnInjury` to off: new injuries are then
noticed on the day and never stop a skip. Injuries already waiting still need
marking as seen.

| Tunable                  | Kind    | Default | Unit | What it does                                        |
| ------------------------ | ------- | ------- | ---- | --------------------------------------------------- |
| `health.stopOnOwnInjury` | boolean | on      | flag | Stop the day when one of your own workers gets hurt |

## The health profile

`health.profile { personId }` (`queries.ts`, WRK6-05) is the worker profile's
Health tab in one answer, or `null` for an unknown person:

- `fatigue`: `{ value, band, traceRef }`. The band names a quarter of the
  0–100 scale (`FATIGUE_BANDS`: Fresh 0–24, Tired 25–49, Weary 50–74, Spent
  75–100). The bands are display constants, not tunables: nothing in the
  simulation reads them. `traceRef` is the latest stored fatigue recovery, or
  null.
- `condition`: one row per body part, in `BODY_PARTS` order:
  `{ part, value, cap, nextCheck, injured }`. `cap` is
  [the condition cap](#condition-cap) and `nextCheck` is
  [next week's healing](#condition-recovery), both worked out on read and
  returned inline as `Traced` values: neither has a roll, and storing them
  would cost six traces per person every week.
- `medical`: `{ level, promotionId, promotionName }`, from `medicalLevelOf`.
- `current`: the open injury, or null. `history`: closed injuries, newest
  first, the last 50 (`HEALTH_PROFILE_HISTORY_LIMIT`); older rows stay in the
  table.

Each injury is an `InjuryView`: the catalog label (or the raw key when a modded
catalog dropped the kind), body part, severity, `since`, `expectedReturn`,
`returnedOn`, `daysOut` (to the actual return once back), `daysRemaining` (open
only), whether they can work angles, the source and segment, the condition lost,
and references to the stored time out, condition loss and chance traces, each
null once the trace is gone. Past 28 days those traces are summaries
([Returns](#returns)); the rows are kept.

Health is public: injuries are world news and a promotion's medical level is
public policy, so a rival's worker shows the same tab. The one viewer-dependent
field is `pendingNotice`: true only while the injury waits to be noticed and
one of the viewer's promotions employs the worker. The Health tab runs
`health.acknowledgeInjuries` for each pending injury it shows, which clears the
[own-injury gate](#own-injury-gate).

The tab (`apps/web/src/screens/workers/health/`) is registered at order 50, after
the built-in Career tab, and opens with `?tab=health`.

## Show-night injuries

An injury rolled in a match (MTCH4's in-match roll, see
[physical-toll.md](physical-toll.md#the-injury-roll)) reaches this system
through the built-in injury handler `health.injure` (`injuryHandler.ts`): an
`injuries` row with `source: 'segment'` and the segment, the in-match chance
as its "How it happened" Why?, and the worker's `injury` pointer set. From then
on the worker is out like anyone hurt off screen: WRK1's `availabilityOf` says
"Injured (…) until <date>", so the booking checks refuse them in a match (and
let them talk only when they can work angles), the rival planner's card pool
(`buildCardPool`) leaves them out, and they are back on their expected return
day.

`test/systems/health/showNightInjuries.long.test.ts` (slow suite) follows a
year of the default world with every show carded and checks all of that every
evening. Measured on the WRK6-07 branch, 365 days:

| Injuries in a year | In a match | Off screen |
| ------------------ | ---------- | ---------- |
| The player's       | 11         | 15         |
| Rivals'            | 0          | 101        |

120 of them ended in the year, each on its expected return day, and no rival
match in 1,866 had a worker out with an earlier injury. Rivals have no
in-match injuries because the rival rule `ai.skipInMatchInjuries` is on by
default; their injuries come off screen, at `health.offscreen.computerMultiplier`
times the rate.

The same year saves at 1.16 MB gzipped with no rival cards added and 1.59 MB
with every show carded (budget 1.6 MB): WRK6-07 stores nothing new. A 365-day
skip took 15.5 s wall (no rival cards added) and 20.1 s (every show carded) on
a loaded dev machine, against 20.3 s and 20.6 s for the base branch in the same
session: the early morning costs nothing on the skip path, which never runs a
show ahead of its day.

## Works with

WRK6-07 wired health into the partner features that were on `main` (base
`wave-s9-3`). The others wire WRK6 from their own packs; nothing in WRK6 needs
them.

| Partner                      | State                    | Seam                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MTCH4 (physical toll)        | wired (WRK6-03, WRK6-07) | `registerInjuryHandler(healthInjuryHandler, { builtIn: true })`: a rolled in-match injury becomes a real one ([show-night injuries](#show-night-injuries)); MTCH4's fatigue and wear are rested from the next morning, for the player's shows too ([the player's show nights](#the-players-show-nights)). |
| EVT2 / EVT3 (show night)     | wired (WRK6-07)          | `registerBeforeShowRuns` hook `health.morningBeforeShow`, on the new `beforeTheDay` input ([show-night.md](show-night.md#before-a-show-runs)).                                                                                                                                                            |
| EVT2 (booking)               | wired, no code needed    | Injuries set and clear `person.injury`, which WRK1's `availabilityOf` reads: the picker's "Injured (…) until <date>", `personUnavailable` in a match and `injuredTalking` for someone who can still work angles ([booking.md](booking.md#validation)).                                                    |
| AIP1 (rival rules)           | wired (WRK6-04)          | `offscreenShortcutOf` reads `ai.skipInMatchInjuries` for the worker's employer (`aiShortcutOn`), so `health.offscreen.computerMultiplier` applies to computer-run rosters only, and not with the level playing field on.                                                                                  |
| AIP4 / AIP5 (rival cards)    | wired, no code needed    | `buildCardPool` reads `availabilityOf`, so an injured worker is left out of rival matches until their return day.                                                                                                                                                                                         |
| ECO1 (policies)              | wired (WRK6-07)          | `registerPolicyEffect` `health.medicalCare` (`policyEffects.ts`): the medical policy's preview lines ([medical care](#medical-care)).                                                                                                                                                                     |
| WRK2 (roster)                | wired, no code needed    | The roster's availability column comes from `availabilityOf`, so it marks injured workers. The roster's Injuries tab and the own-injury gate's route belong to WRK6-06.                                                                                                                                   |
| SOC1, WRK4, DAY7, MOD8, POL3 | wires from its own pack  | Not on `main` when WRK6-07 ran (no mail, snapshot-field, world-event-effect, hook or `defineFormula` seam). Each pack's integration ticket lists WRK6: injury mail, the health snapshot fields, the `health.injure` world-event effect, the recovery hook point, and the formula registry.                |

## Who is out

`health.report { promotionId? }` (`queries.ts`, WRK6-06) answers "who is out
right now?": `{ asOf, rows, waitingForViewer }`.

- `rows`: every open injury in the world, or only people with a working
  contract at `promotionId` when given (free agents only appear world-wide).
  Each row is an [`InjuryView`](#the-health-profile) plus `personId`, `name`
  (the ring name at that promotion, else at their main employer, else their
  own), `imageRef`, `employer` (`{ promotionId, name }` of the main employer,
  or `null`) and `roles`. Sorted by `expectedReturn`, then name, then id.
  Public like the profile; `pendingNotice` follows the same viewer rule.
- `waitingForViewer`: the ids of every injury still waiting to be noticed that
  the viewer may mark as seen (`mayAcknowledge` in `commands.ts`), whatever the
  scope: their own workers' and any whose worker no human employs any more.
  Empty for the computer and the omniscient viewer.

**The Injuries tab** (`apps/web/src/screens/roster/injuries/`) is Your
promotion > Roster > Injuries, registered with `registerRosterTab` at its
reserved order 70 (`?tab=injuries`). It lists the player's promotion's rows,
soonest back first: picture, name (opening the worker's Health tab), injury,
body part, severity, since, back on, days left with a Why? for the time out,
and whether they can work angles. On opening it runs
`health.acknowledgeInjuries` once for every id in `waitingForViewer` and every
row still `pendingNotice`, so the [own-injury gate](#own-injury-gate) is cleared
even when the injury that waits is not on the list.

**The day control's button.** The gate's `roster` hint reads "Roster" and goes
to the Injuries tab (`apps/web/src/app/AppShell/day/dayControlState.ts`). The
tab's registration tells the day control it exists
(`setRosterInjuriesTabAvailable`); without it the button opens the injured
worker's Health tab (`?tab=health`), or World > Workers with
`?availability=injured` when the gate names nobody. Decisions in the inbox and a
show night both outrank it. `health.stopOnOwnInjury` is on by default now that
the button clears the stop in one tap.
