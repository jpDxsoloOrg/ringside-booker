# Health

The health system (`packages/engine/src/systems/health/`) looks after a
worker's body between shows: fatigue fading day by day, and damaged body parts
healing slowly, but only as far as their age allows. It is also the engine's
reference system, the layout other systems copy (see
[the worked example](calculation-traces.md#worked-example)).

WRK6-02 built fatigue recovery, the condition cap, condition recovery and
medical care. Injuries (WRK6-03), injury risk (WRK6-04) and the Health tab on
the profile (WRK6-05) add their sections here. How matches make people tired
and wear their bodies is the match system's (MTCH4).

| Piece        | Where            | What it does                                                                |
| ------------ | ---------------- | --------------------------------------------------------------------------- |
| Tunables     | `tunables.ts`    | Every `health.*` balance number, category `Health`                          |
| Stream       | `streams.ts`     | `health.recovery`: the extra rest roll                                      |
| Formulas     | `formulas/`      | `computeFatigueRecovery`, `computeConditionCap`, `computeConditionRecovery` |
| Medical care | `medical.ts`     | `medicalLevelOf`: the care level a person gets today                        |
| Talking days | `appearances.ts` | `talkedWithoutWrestling`: who cut a promo and did not wrestle               |
| Phases       | `phases.ts`      | `health.recovery` (daily) and `health.conditionRecovery` (Mondays)          |
| Event        | `events.ts`      | `fatigue.cleared { personId }`                                              |
| Query        | `queries.ts`     | `health.fatigue`: fatigue and the trace behind it                           |

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
future contracts do not count. Condition recovery uses it here; injury healing
(WRK6-03) and injury risk (WRK6-04) use the same helper. The policy itself and
what it costs are the finance system's ([finances.md](finances.md#medical)).

| Tunable                                    | Kind    | Default | Range | Unit       | What it does                                                   |
| ------------------------------------------ | ------- | ------- | ----- | ---------- | -------------------------------------------------------------- |
| `health.medical.recoveryMultiplier.level0` | number  | 0.8     | 0–3   | multiplier | Healing under medical care level 0 (none)                      |
| `health.medical.recoveryMultiplier.level1` | number  | 1       | 0–3   | multiplier | Healing under medical care level 1                             |
| `health.medical.recoveryMultiplier.level2` | number  | 1.15    | 0–3   | multiplier | Healing under medical care level 2                             |
| `health.medical.recoveryMultiplier.level3` | number  | 1.3     | 0–3   | multiplier | Healing under medical care level 3 (the best)                  |
| `health.medical.freeAgentLevel`            | integer | 1       | 0–3   | count      | The medical care level (0 to 3) a worker with no employer gets |
