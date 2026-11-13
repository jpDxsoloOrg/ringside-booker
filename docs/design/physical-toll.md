# Physical toll

What a match costs the people who work it: the fatigue they pick up and the
body condition they lose (MTCH4). This page covers the two "load" formulas for
one worker in one match and the risk modifier seam (MTCH4-01), and the
in-match injury chance and roll (MTCH4-02), ring learning (MTCH4-03), and the
fixed order, the show-night applier that writes the results and the partner
wiring (MTCH4-04). The Match lab's Why? panels (MTCH4-05) build on it. Recovery belongs to
the health system (WRK6), not here.

The code lives inside the `match` system: the inputs, tunables, stream and
seam in `packages/engine/src/systems/match/physical/`, and the formulas in
`packages/engine/src/systems/match/formulas/` (`fatigueGain.ts`,
`conditionWear.ts`, `wearByPart.ts`), following the
[formula module conventions](calculation-traces.md). Nothing here writes to
the world.

Like the rating, the physical toll never uses minutes or a match length
([D-10](design-decisions.md#d-10-cards-are-built-from-segment-slots-not-minutes-2026-11-07)):
it starts from the slot's **duration class** (short, standard or long, from
`durationClassOf` in [match-rating.md](match-rating.md#duration-class)), and
the first line of every fatigue and wear trace names it, for example "Long
duration class". A test walks every trace label and fails on "minute" or
"length".

## Who carries load

`collectPhysicalInputs(read, spec)` turns a `PhysicalSegmentSpec` (promotion,
event importance, segment kind, duration class, the sides as
`{ personId, role }` lists, the producer, keep-it-safe, optional lab fatigue
overrides and optional card position) into one entry per worker who carries
load. These are fixed rules, not tunables:

- **Only competitors carry load.** `ringside`, `interferer`, `speaker` and
  `subject` participants gain no fatigue and lose no condition.
- **Talking segments cost nothing.** An angle gives no entries at all: promos
  and other talking segments cost no stamina (owner rule).
- **Workload counts every competitor**, across every side, so a tag match is
  lighter per person than a singles match.
- **Opponents** are every competitor on another side (all of them in a triple
  threat).
- **Order is fixed**: side by side, and by person id within a side.
- **Lab overrides** replace the fatigue going in only in the returned inputs;
  the world is untouched.
- **Repeat matches.** With a card position (show, section and slot), each
  worker gets the number of matches they work as a competitor _earlier_ on
  that card (`earlierMatchesOnCard`). A lab draft without a position counts
  as everyone's first match.

## Fatigue gain

`computeFatigueGain(inputs, { tunables })`, in fatigue points:

1. Start at `match.fatigue.base.<class>` ("Long duration class").
2. When more than two people work the match, multiply by their share of the
   workload: 2 ÷ workers, never below `match.fatigue.minShare` and never above
   1 (the 2 is fixed: a one-on-one match is the full workload). The trace adds
   a "Shared workload (N workers)" line.
3. Multiply by the stamina factor `1 − (stamina − 50) × match.fatigue.staminaRelief`
   (50 is the middle of the scale: higher stamina eases fatigue, lower adds to
   it).
4. Multiply by `match.fatigue.style.<style>`.
5. Multiply by `match.fatigue.workhorseFactor` for a workhorse, or
   `match.fatigue.coasterFactor` for a coaster.
6. Multiply by `match.fatigue.houseShowFactor` at a house show.
7. Multiply by each risk contribution's `fatigueMultiplier`, one line per
   source ("Stipulation: Ladder").
8. **Working more than once on one card** (owner rule): multiply by
   `match.fatigue.repeatMatch` once for each earlier match that night, so it
   compounds: "Second match tonight ×1.5", "Third match tonight ×2.25".
9. Multiply by `match.fatigue.keepItSafeFactor` when keep-it-safe is on, from
   the booker or from a contribution (then the line names it).
10. Keep the result between 0 and `match.fatigue.maxPerSegment`.

With default numbers a singles main event costs an average worker 12, the same
match as the opener 7.

## Wear

`computeConditionWear(inputs, { tunables, rng })` is the wear load: condition
points lost at a part weight of 1.

1. Start at `match.wear.base.<class>` ("Long duration class").
2. Multiply by `match.wear.selfStyle.<style>`: how hard the worker's own style
   is on their body.
3. Multiply by the roughest opponent's `match.wear.opponentStyle.<style>`: the
   highest factor among the opponents, ties to the lower person id, shown as
   "Roughest opponent: Rex Hale (Brawler)".
4. Multiply by the opponents' safety factor
   `1 + (50 − average opponent safety) × match.wear.safetyWeight`, kept between
   `match.wear.minSafetyFactor` and `match.wear.maxSafetyFactor`, shown as
   "Opponents' safety 42".
5. Multiply by `match.wear.durableFactor` (durable) or
   `match.wear.injuryProneFactor` (injury prone).
6. Multiply by `match.wear.houseShowFactor` at a house show.
7. Multiply by each contribution's `wearMultiplier`.
8. Multiply by the same repeat-match factor as fatigue
   (`match.fatigue.repeatMatch` per earlier match tonight).
9. Multiply by `match.wear.keepItSafeFactor` when keep-it-safe is on.
10. Multiply by the roughness roll `1 + match.wear.spread × (2u − 1)`, where `u`
    is one draw from the `match.wear` stream ("How rough the match was").
11. Keep the result between 0 and `match.wear.maxPerSegment`.

The roll is drawn **exactly once per call**, even when the spread is 0, so
retuning never shifts the stream. One roll per worker, not one per body part.

`computeWearByPart(load, { tunables })` then spreads the load over the body in
`BODY_PARTS` order: each part loses the load × `match.wear.part.<part>`, and
each part's trace starts from the load's trace. A part weighted 0 takes no
wear.

Wear is small per match by design (a few tenths of a point per part). Until
WRK6 brings recovery, condition only goes down; if that bites in playtesting,
lower `match.wear.base.*` rather than adding recovery here.

## Risk modifiers

`registerRiskModifier({ id, order, contribute })` is the seam later features
(MTCH7's stipulations and production notes) use to make a segment, or one
worker in it, more or less tiring and dangerous without touching these files.
It follows the setup step registry: the id must look like `system.camelName`,
a duplicate id is refused, and the call returns an unregister function for
tests. Modifiers run by `order`, then id.

`contribute(ctx)` gets the segment spec plus a read view and returns
contributions:

| Field               | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `source`            | Player text for the trace line, such as "Stipulation: Ladder" |
| `personIds`         | The workers it applies to, or null for every competitor       |
| `fatigueMultiplier` | Multiplies fatigue gain (0 or more)                           |
| `wearMultiplier`    | Multiplies the wear load (0 or more)                          |
| `injuryMultiplier`  | Multiplies the injury chance (MTCH4-02; 0 or more)            |
| `injuryAdd`         | Adds to the injury chance (MTCH4-02; 0 to 1)                  |
| `keepItSafe`        | Switches the keep-it-safe factors on for the workers it hits  |

`collectRiskContributions(ctx, personId)` validates every contribution and
returns those that reach the worker, in modifier order. A bad value (not a
finite number, a negative multiplier, an injury chance outside 0..1) throws a
`RegistryError` naming the modifier. With nothing registered there are no
contribution lines in the traces.

## Injury chance

`computeInjuryChance(inputs, { tunables })` in
`packages/engine/src/systems/match/formulas/injuryChance.ts` is the
probability (0..1) that one worker is hurt in one match. It reads the worker
**by the end of the match**: fatigue going in plus this match's fatigue gain,
and body condition after this match's wear. A long, hard match is riskier at
the end of it, and because the chance is built from those results, the roll
can only come after them.

1. Start at `match.injury.baseChance` (0.003).
2. Add **Fatigue by the end of the match** × `match.injury.perFatiguePoint`,
   where the fatigue is `min(100, fatigue going in + this match's gain)`.
3. Add (100 − the worst body part after this match's wear) ×
   `match.injury.perConditionPointLost`, labelled "Worst body part: Back 80".
   Ties go to the first part in `BODY_PARTS` order.
4. × `match.injury.duration.<class>` ("Long duration class"; short 0.7,
   standard 1, long 1.3).
5. × the least safe opponent's factor, labelled "Least safe opponent: <name>,
   safety <n>" (lowest safety, ties by id):
   `clamp(1 + (50 − safety) × opponentSafetyWeight, min, max)` with
   `minSafetyFactor` 0.5 and `maxSafetyFactor` 1.6. Wear uses the opponents'
   average safety; the injury chance uses the single least safe one, because
   one careless worker is enough to hurt someone.
6. × `match.injury.selfStyle.<own style>` (high flyer and hardcore 1.4).
7. × the riskiest opponent's `match.injury.opponentStyle.<style>` (highest
   factor, ties by id; hardcore 1.3, brawler and striker 1.2, powerhouse 1.15).
   With no opponents steps 5 and 7 are a "No opponents" note.
8. × `injuryProneFactor` (1.8) for an injury-prone worker, ×
   `durableFactor` (0.5) for a durable one.
9. \+ each risk contribution's `injuryAdd`, then × each `injuryMultiplier`,
   one line per contribution labelled by its `source`.
10. × `match.injury.repeatMatch` (1.4) once for each earlier match the worker
    works on the same card, compounding (owner rule: double-booking is
    allowed and raises the risk in each extra match). The line reads "Second
    match tonight ×1.4". Talking segments carry no load, so they never reach
    this formula and never count as an earlier match.
11. × `keepItSafeFactor` (0.5) when keep-it-safe applies (the booker or a
    contribution; the line names which).
12. Keep it between 0 and `match.injury.maxChance` (0.2).
13. The switches: × 0 with the branch "In-match injuries switched off" when
    `match.injury.enabled` is off, and × 0 with the branch "Rival rules: no
    in-match injuries" when the promotion's rating policy has
    `skipInMatchInjuries` ([D-01][d-01]). `injuryPolicyFor(read, tunables, id)`
    asks the one rating policy provider (AIP1's, from `ai.skipInMatchInjuries`)
    and returns the flag with a trace of the policy, which sits under that
    line. There is no promotion-kind branch anywhere: with no provider every
    promotion rolls like yours.

[d-01]: design-decisions.md#d-01-rival-promotions-use-simplified-rules-2026-11-07

Every key has a minimum of 0, so with the base and both per-point terms at 0
the chance is exactly 0.

Rough numbers with the defaults, so the Match lab's Run x100 owner test is not
a coin flip (the 0.3% and the 2–3% rows are checked by tests):

| Worker                                                                      | Chance |
| --------------------------------------------------------------------------- | ------ |
| Fresh all-rounder, standard match, ordinary opponent                        | 0.3%   |
| Fresh all-rounder, long match                                               | 0.4%   |
| Fresh high flyer against a hardcore opponent with safety 30                 | 0.7%   |
| Exhausted (fatigue 100 by the end), worst part 90, long, opponent safety 20 | 2.5%   |
| The same, opponent safety 0                                                 | 2.9%   |
| The same as the 2.5% worker, in their second match tonight                  | 3.5%   |

A long main event between two exhausted workers with careless opponents
injures someone in about 5 runs of 100.

## The injury roll

`rollSegmentInjuries(entries, { tunables, rng })` in
`packages/engine/src/systems/match/physical/injuries.ts` decides who, if
anyone, is hurt in one segment. Each entry is a worker with their chance, side,
entrance order and condition after wear.

- **It runs last.** Fatigue gain, wear and every risk contribution are worked
  out first and are part of the chance, so every line on the Why? panel took
  part in the roll. (A risk added after the roll would have no effect; a test
  registers a stand-in "major spot" modifier for one worker and checks the
  rolled odds include it.)
- **Fixed order:** side, then entrance order (workers without one after those
  with one), then person id.
- **One draw per worker** from the `match.injury` stream
  (`rollChance(rng, chance, 'Injury roll: <name>')`), even when the chance is
  0 or the segment's limit is already reached, so the stream stays aligned
  however things are tuned.
- **Per-segment limit:** at most `match.injury.maxPerSegment` (1) workers are
  hurt in one segment; 0 means nobody ever is. A later hit is not dropped: its
  trace carries the rule line "Already 1 injured in this segment (most per
  segment: 1)" and the result says `hit: true, injured: false`.
- Each result's `decision` is an "Injured in this match?" decision with the
  chance as a considered option, the roll, and the limit line when it applied.
  An injured worker also gets a `bodyPartHint`: the part with the lowest
  condition after this segment's wear (ties in `BODY_PARTS` order).

**Health belongs to WRK6.** MTCH4 rolls and hands each injury to the one
registered handler: `registerInjuryHandler({ id, apply(ctx, request) })`, where
`request` is `{ personId, segmentId, eventInstanceId, date, bodyPartHint,
chanceTrace }` and `ctx` is the phase context the segment result applier runs
in. The handler returns `{ injuryTraceRef }`. There is exactly one handler at a
time (a second registration throws a `RegistryError` naming both ids); the
call returns an unregister function and `getInjuryHandler()` returns it or
null. WRK6 registers `health.injure`, whose catalog roll decides the real
injury and may ignore the hint. With no handler nothing is written, and
callers can still read who would have been hurt from the results.

WRK6-03 registers `health.injure` on import as the **built-in** handler
(`registerInjuryHandler(spec, { builtIn: true })`), so it is there whenever the
health system loads. It rolls the kind among injuries on the hinted part when
the catalog has one there, and returns null for someone already injured
([health.md](health.md#injuries)). Tests that need the seam empty call
`clearInjuryHandler()` and put the built-in back with
`restoreBuiltInInjuryHandler()`.

MTCH4 never touches morale: an injury inside a hot angle has no morale effect
from this feature (D-09; WRK8 owns morale).

The traces are stored under refs from `physical/traceRefs.ts`, all keyed
`<segmentId>:<personId>`: `match.fatigue`, `match.wear`, `match.learning`,
`match.injuryChance` and `match.injuryRoll` (the show-night applier, MTCH4-04,
stores them; see [Stored traces](#stored-traces)).

## The order

`computePhysicalToll(read, spec, { tunables, policy, wearRng, injuryRng })` in
`physical/toll.ts` is the one place the pieces run, for the Match lab preview
(MTCH4-05) and for real shows alike. It always runs them in this order, and a
test pins it:

1. `collectPhysicalInputs`: who carries load (competitors in a match only);
2. `collectRiskContributions` for each worker;
3. fatigue gain for each worker;
4. the wear load and wear by body part for each worker, **in roll order**
   (side, entrance order with unset last, person id): one `match.wear` draw
   each;
5. ring learning for each worker and attribute (the hidden learning gate and
   the mentor on the card, with everyone on the show as "the card");
6. the injury chance for each worker, from fatigue and the worst body part
   **after** steps 3 and 4;
7. the injury roll, last: one `match.injury` draw each.

The result is plain JSON: per worker `{ personId, name, side, safety,
fatigueBefore, fatigueGain, fatigueAfter, wearLoad, wearByPart,
conditionAfter, worstPartAfter, learning, learningByAttribute, injuryChance,
injury: { injured, ignoredOverLimit, bodyPartHint, roll }, contributions }`,
workers in roll order. An angle gives no workers and draws nothing.

`deps.alreadyInjured` names workers who are already hurt (earlier on the same
show, or before it): they still take the load, but their chance is × 0 with
the line "Already injured tonight" (or "Already injured"), so nobody is hurt
twice. Their roll is still drawn, so the stream stays aligned.

## Show night

`physicalTollApplier` (`physical/showNight.ts`) is a
[segment result applier](show-night.md#segment-result-appliers):
`{ id: 'match.physicalToll', order: 40 }`, after the title outcome (10) and
MTCH3's aftermath (30), before MTCH6's chemistry (50). It never reads the
aftermath's output. It runs for every match on every show, the player's and
every rival's; an angle costs nothing (owner rule: promos cost no stamina).

`applyPhysicalToll(ctx, segmentId)` (`physical/apply.ts`):

- builds the segment's spec from the world with `segmentSpecFromWorld(read,
segmentId, { tunables })` (`physical/inputs.ts`): the participants side by
  side with their entrance order, the show's importance, the duration class
  from MTCH1's `slotRoleOf` and `durationClassOf`, the producer, and where the
  segment sits on the card (for the repeat-match factor). Nothing stored asks
  for keep-it-safe; a risk contribution can switch it on. An angle gives null;
- reads each person from `ctx.read` when the segment is applied, so a worker in
  two matches on one show starts the second from where the first left them;
- runs `computePhysicalToll` with `ctx.rng('match.wear')`,
  `ctx.rng('match.injury')` and the promotion's injury policy
  (`injuryPolicyFor`, AIP1's rival rules);
- writes each worker with **one** `people` update: `fatigue = min(100, before
  - gain)`, `condition[part] = max(0, condition[part] − wear)`, and each
in-match attribute `min(100, value + gain)`. There is no attribute door yet,
    so attributes are written directly; they are not held to the hidden
    ceilings (the learning gate closes the next match instead);
- hands each injured worker to the injury handler (above). With none
  registered it writes nothing about the injury and logs "In-match injury
  rolled but no injury handler is registered" once per step.

MTCH4 never touches morale (D-09).

### Stored traces

Every match stores up to four traces per worker, so they are kept small
(owner rules: save size and the 28-day history window):

| Kind                 | Player's shows                                        | Rival shows                              |
| -------------------- | ----------------------------------------------------- | ---------------------------------------- |
| `match.fatigue`      | Fatigue after the match, 4 levels                     | Summary                                  |
| `match.wear`         | Condition lost in total, 3 levels                     | Not stored                               |
| `match.learning`     | Learning in this match, 3 levels                      | Not stored                               |
| `match.injuryChance` | 3 levels for a worker who was hurt, otherwise summary | Summary, only when the chance is above 0 |
| `match.injuryRoll`   | Injured workers only, 3 levels                        | Summary, injured workers only            |

"Levels" is how deep the stored tree goes (`compactTrace` and `leanTrace` in
`core/trace/compact.ts`, `STORED_TRACE_DEPTH` in `apply.ts`): the lines the
Why? reads first, each with its number; the deeper working is in this page and
in the Match lab, which works the full trace out again. `match.fatigue` is
`startCalc` from fatigue going in, plus the gain trace, capped at 100;
`match.wear` is the wear load times the body part weights added up.

The player's traces are kept in full for `history.keepDetailDays` (28) days:
the daily `match.prunePhysicalDetail` (`periodic`, order 45) demotes those of
the shows dated 28 days ago to summaries, with a full sweep on the 1st of each
month, like `aip.pruneCardDetail`. Rival shows keep only summaries from the
start (POL4-06).

**Fast paths** ([day-pipeline.md](day-pipeline.md#fast-paths)): for a rival
show, which stores no full trace, the wear of each body part is worked out as
plain numbers, and under the rival-rules shortcut the injury chance is the 0
with its rival-rules line, without the formula. Values and draws are the same.

**Measured** (365 days, default world, `withMyShowsRun`, dev machine under
other load, 2026-11): the skip went from about 10.2 s to 12.2 s wall, of which
the physical toll is about 0.75 s and the health system's daily fatigue
recovery, which now has tired people to recover, about 0.5 s with its traces;
the rest is the extra traces and garbage collection. The 365-day save went
from 1.15 to 1.18 MB gzipped (no rival cards) and from 1.45 to 1.59 MB with
every show carded (budget 1.6 MB); about a third of the growth is
`health.fatigueRecovery` traces.

MTCH4-06 won some of that back: the injury chance of a worker who was not hurt
is stored as a summary (the chance and its largest lines; the injury's own Why?
keeps the full chance through `health.injure`), and a rival show no longer
stores wear (no screen reads a rival's wear; its fatigue is what carries into
the next match). The carded year went from 1.59 to 1.56 MB gzipped and the
year with no rival cards from 1.18 to 1.16 MB. The rest of the carded save's
growth is the per-kind limit on full traces (`sim.traceBytesPerKind`, 500 KB):
about a dozen kinds sit at it, so any new kind adds up to 500 KB of JSON.
Measured on the same save, a 400 KB limit would save about 100 KB gzipped and
300 KB about 210 KB.

### match.physicalForSegment

`match.physicalForSegment { segmentId }` (on the match system) gives, per
competitor (by side, then id), `fatigueGain`, `fatigueAfter`, `wearTotal`,
`learning`, `injuryChance` (each `{ value, traceRef }`) and `injured` (`{
value, traceRef }`), read back from the stored traces: a value and its ref are
null when the trace is gone or was never stored (a rival's wear or learning). The
fatigue gain is the "Fatigue from this match" step of the fatigue trace, which
a summary keeps too. `applied` is false until the match has run. Physical
numbers are not secret, so every viewer gets the same answer; learning is a
gain only, never potential or a ceiling.

### match.segmentInjuries

`match.segmentInjuries { eventInstanceId }` (MTCH4-06, on the match system)
lists every worker hurt in a match on the show, from WRK6's `injuries` rows with
`source: 'segment'`, in card order (pre-show first, then by slot, then person
id): `{ injuryId, segmentId, personId, name, bodyPart, kindLabel,
expectedReturn, weeksOut, chanceTraceRef, injuryTraceRef }`. `weeksOut` is
`ceil((expectedReturn − show date) / 7)`, never below 1 (`weeksOutOf`). The
rows are kept for good; each ref is null once the store no longer has its
trace. An injury on a rival's show is public news, so every viewer gets the
same answer. The results page draws it as the injury banner on the match's card.

## Match lab

After Simulate, the Match lab's **Physical** panel (MTCH4-05,
`apps/web/src/screens/match-lab/physical/`) shows what the drafted match does to
each competitor's body, and Run x100 counts how often it hurts someone. It is
the `physical` preview extension (`physical/preview.ts`, see
[match-rating.md](match-rating.md#preview-extensions)): `computePhysicalToll` on
a spec built from the lab draft, with `match.wear` and `match.injury` on
detached streams keyed by the run's seed. Nothing is written and the world RNG
never moves; the same seed gives the same toll.

The draft as the toll reads it: everyone on a side is a competitor, the
entrance order is the order they were added, the duration class comes from the
chosen slot role and match type (`durationClassOf`), the draft is on no card
(everyone is on their first match of the night), the producer is the lab's
optional Producer, and the injury rules are those of the promotion running the
show (the viewer's own unless "Rate as" picks a rival, whose rules then show
"Rival rules: no in-match injuries"). A worker already hurt keeps the load but
is not rolled again ("Already injured").

- **Arguments** `extensions.physical: { fatigueOverrides?: { [personId]: 0..100 } }`:
  the "Fatigue going in" what-if per worker. Outside 0..100 is refused with
  "Fatigue going in must be a whole number from 0 to 100". The injury chance
  trace then starts from "Fatigue going in (lab what-if)". Choosing a what-if
  plays the same nights again (same seed), so only the what-if changes.
- **Result** `{ durationClass, maxInjuriesPerSegment, workers }`: each worker is
  the `WorkerPhysicalToll` plus `fatigueNow` (stored fatigue, for "As now (n)"),
  `fatigueWhatIf` and `wearTotal` (the show-night "Condition lost in this match"
  trace: the wear load times the part weights added up).
- **Batch summary** `{ runs, injuredSegments, injuriesPer100, byPerson }`:
  `injuriesPer100` counts every worker hurt per 100 runs (0.1), `byPerson` gives
  each worker's injuries and average fatigue gain, wear (0.1) and learning
  (0.01), side by side in roll order. A batch uses the toll's summary-only fast
  paths, which give the same values. A 100-run batch of a singles match takes
  about 100 ms in Node (60 ms without the extension), 500 runs about 0.4 s.

The panel's `PhysicalTollTable` (`components/PhysicalTollTable/`) is a table
where it has room and one card per worker on a phone or in a column narrower
than 60rem (the lab's result column): the name, the injury chance, and the rest
under "Physical". No minutes, potential or ceilings appear on it.

## Tunables

All in `systems/match/physical/tunables.ts`, category `Physical toll`. Every
key has a minimum of 0, so 0 means 0.

| Key                                | Default | Range  | Unit       | What it does                                                                                                                |
| ---------------------------------- | ------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `match.fatigue.base.short`         | 4       | 0–100  | points     | Fatigue a short match costs one worker before anything moves it                                                             |
| `match.fatigue.base.standard`      | 7       | 0–100  | points     | Fatigue a standard match costs                                                                                              |
| `match.fatigue.base.long`          | 12      | 0–100  | points     | Fatigue a long match costs                                                                                                  |
| `match.fatigue.minShare`           | 0.35    | 0–1    | ratio      | Smallest share of the workload in a crowded match; 1 turns sharing off                                                      |
| `match.fatigue.staminaRelief`      | 0.006   | 0–0.02 | ratio      | Fatigue eased per point of stamina above 50 (added per point below)                                                         |
| `match.fatigue.style.<style>`      | 1       | 0–3    | multiplier | How tiring a style finds a match: high flyer and hardcore 1.15, powerhouse 1.1, striker 1.05, showman 0.9, non-wrestler 0.8 |
| `match.fatigue.workhorseFactor`    | 1.15    | 0–3    | multiplier | Extra fatigue for a workhorse                                                                                               |
| `match.fatigue.coasterFactor`      | 0.85    | 0–3    | multiplier | Less fatigue for a coaster                                                                                                  |
| `match.fatigue.houseShowFactor`    | 0.6     | 0–3    | multiplier | Fatigue at a house show                                                                                                     |
| `match.fatigue.keepItSafeFactor`   | 0.8     | 0–3    | multiplier | Fatigue when told to keep it safe                                                                                           |
| `match.fatigue.repeatMatch`        | 1.5     | 0–3    | multiplier | Fatigue and wear for each match after the first on the same card, compounding                                               |
| `match.fatigue.maxPerSegment`      | 40      | 0–100  | points     | Most fatigue one match can add                                                                                              |
| `match.wear.base.short`            | 0.2     | 0–5    | points     | Wear a short match costs one worker before anything moves it                                                                |
| `match.wear.base.standard`         | 0.35    | 0–5    | points     | Wear a standard match costs                                                                                                 |
| `match.wear.base.long`             | 0.6     | 0–5    | points     | Wear a long match costs                                                                                                     |
| `match.wear.selfStyle.<style>`     | 1       | 0–3    | multiplier | How hard a worker's own style is on them: high flyer and hardcore 1.5, powerhouse 1.2, non-wrestler 0.5                     |
| `match.wear.opponentStyle.<style>` | 1       | 0–3    | multiplier | How rough an opponent's style is: striker and hardcore 1.3, brawler and powerhouse 1.2, technician 1.1, grappler 0.85       |
| `match.wear.safetyWeight`          | 0.008   | 0–0.05 | ratio      | Wear added per point the opponents' average safety is below 50 (taken off above)                                            |
| `match.wear.minSafetyFactor`       | 0.6     | 0–3    | multiplier | Least wear safe opponents can bring it to                                                                                   |
| `match.wear.maxSafetyFactor`       | 1.4     | 0–3    | multiplier | Most wear careless opponents can bring it to                                                                                |
| `match.wear.durableFactor`         | 0.7     | 0–3    | multiplier | Wear for a durable worker                                                                                                   |
| `match.wear.injuryProneFactor`     | 1.3     | 0–3    | multiplier | Wear for an injury-prone worker                                                                                             |
| `match.wear.houseShowFactor`       | 0.6     | 0–3    | multiplier | Wear at a house show                                                                                                        |
| `match.wear.keepItSafeFactor`      | 0.5     | 0–3    | multiplier | Wear when told to keep it safe                                                                                              |
| `match.wear.spread`                | 0.5     | 0–1    | ratio      | How far the roughness roll moves wear either way; 0 means no randomness                                                     |
| `match.wear.maxPerSegment`         | 5       | 0–100  | points     | Most wear one match can cost, before it is spread over the body                                                             |
| `match.wear.part.<part>`           | 1       | 0–3    | multiplier | Share of the wear a body part takes: head 0.6, neck 0.8, back 1, arms 0.9, torso 0.8, legs 1                                |

`<style>` is each of the ten ring styles and `<part>` each of the six body
parts; the defaults not listed in a row are 1.
| `match.injury.enabled` | true | on/off | flag | Workers can get hurt in a match; off, nobody is ever injured in one |
| `match.injury.baseChance` | 0.003 | 0–0.2 | probability | Injury chance for a fresh worker in a standard match before anything moves it |
| `match.injury.perFatiguePoint` | 0.0001 | 0–0.01 | probability | Added per point of fatigue by the end of the match |
| `match.injury.perConditionPointLost` | 0.0001 | 0–0.01 | probability | Added per point the worst body part is below 100 |
| `match.injury.duration.<class>` | 1 | 0–3 | multiplier | Injury chance by duration class: short 0.7, standard 1, long 1.3 |
| `match.injury.opponentSafetyWeight` | 0.012 | 0–0.05 | ratio | Added per point the least safe opponent is below 50 safety (taken off above) |
| `match.injury.minSafetyFactor` | 0.5 | 0–3 | multiplier | Least a safe opponent can bring the chance to |
| `match.injury.maxSafetyFactor` | 1.6 | 0–3 | multiplier | Most a careless opponent can bring the chance to |
| `match.injury.selfStyle.<style>` | 1 | 0–3 | multiplier | How much a worker's own style raises their chance: high flyer and hardcore 1.4 |
| `match.injury.opponentStyle.<style>` | 1 | 0–3 | multiplier | How much an opponent's style raises it: hardcore 1.3, brawler and striker 1.2, powerhouse 1.15 |
| `match.injury.injuryProneFactor` | 1.8 | 0–3 | multiplier | Injury chance for an injury-prone worker |
| `match.injury.durableFactor` | 0.5 | 0–3 | multiplier | Injury chance for a durable worker |
| `match.injury.keepItSafeFactor` | 0.5 | 0–3 | multiplier | Injury chance when told to keep it safe |
| `match.injury.repeatMatch` | 1.4 | 0–3 | multiplier | Injury chance for each match after the first on the same card, compounding |
| `match.injury.maxChance` | 0.2 | 0–1 | probability | Highest injury chance one worker can have in one match |
| `match.injury.maxPerSegment` | 1 | 0–10 | count | Most workers injured in one segment; 0 means nobody is ever hurt |

## Ring learning

Matches also teach (MTCH4-03). Every competitor picks up a little ring skill
each time they work: more in a long match, more next to someone better or a
`teacher`, more when a skilled producer lays the match out, and more again
when their mentor is on the same show. The gains are small on purpose
(hundredths of a point per match); the long career arc of growth and decline
belongs to WRK4. Talking segments teach nothing here.

The code: the attribute list in `physical/learning.ts`, the hidden gate in
`physical/learningRoom.ts`, the mentor lookup in `physical/mentor.ts`, the
per-segment collector `collectRingLearning` in `physical/collectLearning.ts`
and the formula in `formulas/ringLearning.ts`. MTCH4's show-night applier
writes the gains after each match; nothing here writes to the world.

### What a match teaches

`IN_MATCH_LEARNING` is a constant rule, not a tunable:

| Attribute    | Taught | Why                                                               |
| ------------ | ------ | ----------------------------------------------------------------- |
| `ringwork`   | yes    | Craft: learned by doing and from the people you work with         |
| `psychology` | yes    | Craft, as ring work                                               |
| `safety`     | yes    | Craft, as ring work                                               |
| `stamina`    | no     | Conditioning: comes only from doing the work; nobody can teach it |

Crew attributes (`officiating`, `producing`, `broadcasting`) are learned on the
job in other roles and `mic` in talking segments; WRK4 and MTCH5 own those and
can call the same formula with their own list (`taught` is an input).

### The maths

For one worker and one attribute, in attribute points:

```text
learning = base
         × duration.<class>                              "Long duration class"
         × taughtFactor           (taught; someone else in the match is better
                                   by at least teachGap)  "Learned from a better worker: <name>"
         × min(1 + teacherBonus × teachers, maxTeacherFactor)
                                  (taught; other competitors or the producer
                                   hold `teacher`)        "Worked with a teacher: <names>"
         × producerFactor         (ring work and psychology; the producer's
                                   producing ≥ producerMinSkill)  "Produced by <name>"
         × fastLearnerFactor or slowLearnerFactor        "Fast learner" / "Slow learner"
         × (1 + mentorBonus)      (the mentor is on the card)     "Mentor on the card: <name>"
         × room factor            (1 when open; slowing or closed) "Limited by potential"
clamped to 0..maxPerSegment
```

An untaught attribute (stamina) skips the better-worker and teacher steps and
records the line "Learned by doing" instead. The better worker is the best one
in the match, on either side. A teacher helps the others, not themselves: a
teacher alone in a match gets no teacher line. A producer who also wrestles in
the match counts once, as a competitor.

`computeRingLearningTotal` adds the attributes into one "Learning in this
match" number with one line per attribute ("Ring work +0.06") that opens to
that attribute's own Why?.

With the defaults, a standard match against an equal opponent teaches 0.03 per
attribute; a young wrestler in a long match next to a much better teacher, laid
out by a skilled producer, learns `0.03 × 1.4 × 2 × 1.5 × 1.2 ≈ 0.15` ring
work.

### Mentor on the card

`mentorOnCard(read, personId, cardPersonIds)` reads the foundation
`relationships` table: a row for the pair (stored in either order) with the
`mentorship` bond and `mentorId` set to the other person, who must be on the
card. On a show the card is everyone on it in any role, the producer included;
in the Match lab it is everyone in the lab segment. With two mentors on the
card, the lowest id wins. Until the social system creates relationship rows
the default world has none, so the mentor line never appears.

### The hidden gate

`learningRoom(person, attribute, tunables)` reads the hidden development fields
(the potential number and the attribute's ceiling, see
[data-model.md](data-model.md)) and returns only a label:

- `closed` when potential is below 0 or the attribute is at or above its
  ceiling;
- `slowing` when the attribute is within `match.learning.slowingBand` of its
  ceiling or potential is below `match.learning.lowPotential`;
- `open` otherwise. An attribute without a ceiling is gated on potential only.

Only the label enters the formula. Player text never shows potential or a
ceiling: when the room is not open the Why? reads the fixed line "Limited by
potential" and nothing more. `potential` and `ceilings` never become trace
inputs, constants or notes, and `slowingBand` and `lowPotential` are never read
inside a trace. A leak test builds traces in every room for people with
distinctive hidden numbers and fails if a label mentions potential or a ceiling
(other than the fixed line) or the numbers appear anywhere in the trace.
`learningRoom` is not exported from the engine's public index.

The room factor is the last step before the clamp and nothing adds learning
after it, so no bonus can get past the gate (a growth floor that bypassed the
potential gate was a known bug in the genre).

**Overshoot.** An attribute can pass its ceiling by at most one match's gain,
because the applier does not clamp to the ceiling: a clamp would let the player
work the ceiling out from the arithmetic. The next match is then `closed`.

### With WRK4's growth

WRK4's daily growth and this per-match learning add up: the applier adds a
match's learning to the attribute after the match, and WRK4's growth moves the
attribute on its own schedule. Both read the same gate: WRK4 treats a value at
or above the ceiling as no growth, so the one-match overshoot never compounds.
When WRK4 lands, its growth-headroom reading of potential and ceilings and
`learningRoom` should agree on when an attribute is capped (WRK4 can call
`learningRoom` or share its rule).

### Ring learning tunables

All in `systems/match/physical/learningTunables.ts`, category `Physical toll`.
Every key has a minimum of 0, so 0 means 0.

| Key                                 | Default | Range  | Unit       | What it does                                                    |
| ----------------------------------- | ------- | ------ | ---------- | --------------------------------------------------------------- |
| `match.learning.base`               | 0.03    | 0–1    | points     | Ring skill one match teaches per attribute before anything else |
| `match.learning.duration.short`     | 0.6     | 0–3    | multiplier | How much a short match teaches against a standard one           |
| `match.learning.duration.standard`  | 1       | 0–3    | multiplier | A standard match                                                |
| `match.learning.duration.long`      | 1.4     | 0–3    | multiplier | A long match                                                    |
| `match.learning.teachGap`           | 5       | 0–50   | points     | How much better someone must be to teach the worker             |
| `match.learning.taughtFactor`       | 2       | 0–3    | multiplier | Learning next to someone better                                 |
| `match.learning.teacherBonus`       | 0.5     | 0–2    | ratio      | Extra learning per teacher in the match                         |
| `match.learning.maxTeacherFactor`   | 2       | 0–3    | multiplier | Most teachers can multiply learning by                          |
| `match.learning.producerMinSkill`   | 60      | 0–100  | points     | Producing skill a producer needs to help                        |
| `match.learning.producerFactor`     | 1.2     | 0–3    | multiplier | Learning under a skilled producer (ring work and psychology)    |
| `match.learning.fastLearnerFactor`  | 1.5     | 0–3    | multiplier | Learning for a fast learner                                     |
| `match.learning.slowLearnerFactor`  | 0.6     | 0–3    | multiplier | Learning for a slow learner                                     |
| `match.learning.mentorBonus`        | 0.25    | 0–2    | ratio      | Extra learning when the worker's mentor is on the same show     |
| `match.learning.roomFactor.slowing` | 0.4     | 0–3    | multiplier | Learning for a worker near their limit                          |
| `match.learning.roomFactor.closed`  | 0       | 0–3    | multiplier | Learning for a worker at their limit                            |
| `match.learning.slowingBand`        | 5       | 0–50   | points     | How close to their limit a worker is before learning slows      |
| `match.learning.lowPotential`       | 200     | 0–1000 | points     | Below this hidden score (−1000..1000), learning slows           |
| `match.learning.maxPerSegment`      | 0.2     | 0–5    | points     | Most one match can teach per attribute                          |

## Integration

Which partner features MTCH4 is wired to (MTCH4-04), and the one call an
unwired partner's pack makes:

| Partner                     | State                   | How                                                                                                                                                                                                                     |
| --------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVT3 (show night)           | wired (MTCH4-04)        | The match bundle registers `registerSegmentResultApplier(physicalTollApplier)` at module load (`physical/showNight.ts`).                                                                                                |
| AIP1 (rival rules)          | wired (MTCH4-04)        | The injury chance reads `skipInMatchInjuries` from the rating policy (`injuryPolicyFor`); the rival desk lists MTCH4 as the consumer of "No in-match injuries", and the Level playing field removes the line.           |
| WRK6 (injuries)             | wires from its own pack | `registerInjuryHandler({ id: 'health.injure', apply: (ctx, request) => ... })`, calling `health.injure` and returning its injury trace ref (WRK6-07). Until then injuries are rolled, traced and logged, never applied. |
| SOC2 (mentorships)          | wires from its own pack | Nothing to call: the mentor line reads `relationships` rows with the `mentorship` bond, so seeded mentorships show "Mentor on the card" as soon as SOC2 creates them.                                                   |
| MTCH7 (stipulations, notes) | wires from its own pack | `registerRiskModifier({ id, order, contribute })` for each stipulation and booking note: fatigue, wear and injury multipliers, an added injury chance, or keep-it-safe, each with its own labelled line.                |
| WRK4 (growth)               | wires from its own pack | Read potential and ceilings through the same helper as `learningRoom` (`physical/learningRoom.ts`), so an attribute WRK4 calls capped is "closed" here.                                                                 |
