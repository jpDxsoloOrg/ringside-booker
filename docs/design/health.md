# Health

The health system (`packages/engine/src/systems/health/`) looks after a
worker's body between shows: fatigue fading day by day, and damaged body parts
healing slowly, but only as far as their age allows. It is also the engine's
reference system, the layout other systems copy (see
[the worked example](calculation-traces.md#worked-example)).

WRK6-02 built fatigue recovery, the condition cap, condition recovery and
medical care. WRK6-03 added [injuries](#injuries) and [returns](#returns).
Injury risk (WRK6-04) and the Health tab on the profile (WRK6-05) add their
sections here. How matches make people tired
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
| Handler      | `injuryHandler.ts` | registers `health.injure` as MTCH4's injury handler                                                  |
| Phases       | `phases.ts`        | `health.recovery` (daily), `health.conditionRecovery` and `health.pruneInjuryDetail` (Mondays)       |
| Events       | `events.ts`        | `fatigue.cleared`, `injury.sustained`, `injury.healed`                                               |
| Query        | `queries.ts`       | `health.fatigue`: fatigue and the trace behind it                                                    |

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

**What it writes.** One `injuries` row (`noticedOn` is the day itself until
WRK6-04's own-injury gate decides it), the `person.injury` pointer
(`expectedReturn = today + days`), the lower condition, three traces under the
injury id (`health.injury` for the days out, `health.injuryConditionLoss`, and
`health.injuryChance` when the caller passed the chance that led to it), and
the `injury.sustained` event.

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
