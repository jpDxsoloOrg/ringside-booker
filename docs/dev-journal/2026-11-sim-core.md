---
title: 'Simulation core: deterministic days and numbers that explain themselves'
date: 2026-11-08
epics: [SIM]
milestone: ''
tickets:
  [SIM-01, SIM-02, SIM-03, SIM-04, SIM-05, SIM-06, SIM-07, SIM-08, SIM-09, SIM-10, SIM-11, SIM-12]
blogCandidates:
  [
    'Why every number in my sim can explain itself',
    'Seeded RNG streams: changing one thing without moving everything else',
    'Every day is a transaction',
  ]
---

# Simulation core: deterministic days and numbers that explain themselves

## Summary

The Simulation core epic is done. The engine can now run a day: a seeded RNG split into named
streams, exact-odds helpers, typed tunables, calculation traces with a store that keeps the recent
ones and summarises the rest, a domain event bus, and a day pipeline where every step runs in its
own transaction and a broken step can't take the rest of the day with it. On top of that sit a
multi-day advance that stops at gates and yields between days, and one engine API of queries and
commands that the web app, the tools and later the multiplayer server all go through. A small
fatigue recovery system proves every piece works end to end, and a headless runner simulates a
year of a 300-person world in under a tenth of a second and checks that two runs from the same
start end with the same world hash.

## What I built

- **SIM-01: Seeded RNG with named streams.** A cyrb128-style string hash, an sfc32 generator with a
  twelve-draw warm-up, typed stream names checked at compile time and at run time, and an
  `RngRegistry` with lazy streams, snapshot and restore, and a zod-validated saved state that only
  holds the streams something has touched. Golden-value tests freeze the hash and the generator
  output. `packages/engine/src/core/rng/prng.ts`, `core/rng/registry.ts`, `core/rng/streams.ts`,
  `core/hash.ts`, `docs/design/determinism.md#randomness`
- **SIM-02: Exact-odds helpers, roll records and ID minting.** `chance`, `percent`, `oneIn`,
  `intBetween`, `floatBetween`, `pick`, `weightedPick`, `shuffle`, `normal` and `clampedNormal`,
  each with its odds, its ends and its draw count written down; recorded versions that return a
  JSON-safe `RollRecord` for traces; and a minter that gives every entity kind its own
  `ids.<prefix>` stream. `core/rng/odds.ts`, `core/rng/rolls.ts`, `core/rng/ids.ts`,
  `docs/design/determinism.md#odds-helpers`
- **SIM-03: Calendar cadences.** Daily, weekly, monthly and yearly cadences for scheduled phases,
  with monthly days above 28 and yearly 29 February rejected outright, plus `nextOccurrence` and
  plain-English descriptions. The cadence tests run again under two odd time zones after
  `npm test`. `core/calendar/cadence.ts`, `docs/design/day-pipeline.md#calendar`
- **SIM-04: Tunables registry.** `defineTunables` with definition checks, the `ALL_TUNABLES`
  aggregate whose keys form a type, an immutable typed reader, load-time and live validation of
  per-save overrides, and the `sim.*` engine tunables. `core/tunables/`,
  `systems/tunables.ts`, `docs/design/tunables.md`
- **SIM-05: Traced values.** `Traced<T>` and the `TraceNode` union, a fluent calculation builder
  that records inputs, tunables, modifiers, limits and rolls as it computes, a decision builder
  for choices that aren't numbers, node and depth caps that truncate with a note instead of
  throwing, and a replay check that recomputes a trace from its own steps.
  `core/trace/calc.ts`, `core/trace/decision.ts`, `core/trace/limits.ts`, `core/trace/replay.ts`,
  `docs/design/calculation-traces.md`
- **SIM-06: Trace store.** Full traces kept per kind up to a tunable limit, older ones demoted to
  summaries with their three biggest contributors, a cap on summaries, a sequence counter so
  "oldest" survives a save and load, and writes staged until the step commits.
  `core/trace/store.ts`, `core/trace/schema.ts`,
  `docs/design/calculation-traces.md#retention`
- **SIM-07: Domain event bus.** A typed event map that systems extend by declaration merging,
  staged publishing with sequence numbers given at commit, priority-ordered reactions, read-only
  observers, a cascade depth limit, a bounded recent-event log, and a shared JSON value guard
  whose errors name the bad path. `core/events/`, `core/json.ts`,
  `docs/design/day-pipeline.md#domain-events`
- **SIM-08: Day pipeline.** Phase groups and the phase registry, the `SimRuntime` container,
  `runStep` (one transaction, RNG snapshot, event staging and trace staging per step), `runDay`
  (simulate D, then move the clock to D + 1), day and step reports and a saved failure log.
  `core/pipeline/runStep.ts`, `core/pipeline/runDay.ts`, `core/pipeline/registry.ts`,
  `core/pipeline/runtime.ts`, `docs/design/day-pipeline.md#running-a-day`
- **SIM-09: Multi-day advance.** The gate registry and a read-only `evaluateGates`, and
  `advanceDays`: a loop over `runDay` that stops at the first gate hit, yields to the host between
  days, honours a cancel signal and returns a JSON-safe result. Every advance adds its own
  repeated-failure gate, plus a stop-date gate when a stop date is given.
  `core/pipeline/gates.ts`, `core/pipeline/advance.ts`, `docs/design/day-pipeline.md#gates`
- **SIM-10: Engine API.** `createEngine` from an `EngineState` and a list of system bundles,
  queries that run for a viewer, commands that run for a controller as one pipeline step and land
  in a command log, the built-in `sim` system (clock, status, pending gates, reports, events,
  failures, traces, tunables), and the registration of the six state parts with the save format.
  `core/api/engine.ts`, `core/api/query.ts`, `core/api/command.ts`, `core/api/commandLog.ts`,
  `core/api/saveParts.ts`, `core/api/builtins.ts`, `docs/design/engine-api.md`
- **SIM-11: The first real system.** Daily fatigue recovery, wired through every part of the core:
  two tunables, the `condition.recovery` stream, a traced formula, a housekeeping phase that stores
  its traces and publishes `condition.fatigueCleared`, a "Why?"-ready query and a bundle registered
  through `defineSystem`. It is the layout later systems copy. `systems/condition/`,
  `docs/design/calculation-traces.md#worked-example`
- **SIM-12: Headless runner.** `tools/sim-runner` advances a fixture or an exported state through
  the public engine API and prints dates, days per second, failures by step, events by type and a
  world hash, as text or JSON. `--check-determinism` runs twice and compares; CI runs it on every
  pull request and times a year. `stableStringify` and `worldHash` came with it, along with a
  fixtures entry that doesn't pull in Vitest. `tools/sim-runner/`, `core/api/stateHash.ts`,
  `README.md#headless-runner`

All paths without a prefix are under `packages/engine/src/`.

## Decisions and why

### Named RNG streams, and one stream per ID prefix

- **Decision:** All randomness comes from one seed split into named streams. Each system draws
  from its own (`condition.recovery`, later `injury.roll` and so on), each stream has its own
  state, and ID minting gets a stream per entity kind (`ids.per`, `ids.pro`, ...). A stream starts
  from a hash of the seed and its name, and is only saved once something has drawn from it.
- **Alternatives:** One shared generator for the whole game; one ID stream for every kind.
- **Why:** With one generator, every roll takes the next number off a single line. Add one roll to
  the injury check and every later roll that day moves along by one, so contract talks, crowd
  reactions and computer decisions all come out differently even though none of that code changed.
  Comparing two balance runs would show noise everywhere. With named streams, a change to injuries
  can only move injury results, and a new system that creates titles can't change the IDs of the
  people created that day. Saving only touched streams keeps the save from growing with every name
  ever declared, because an untouched stream re-derives to exactly where it would have been.
- **Revisit if:** Profiles show stream lookups in long skips, or a system needs so many streams
  that the saved state stops being small.

### `chance` and `intBetween` always draw

- **Decision:** Every odds helper takes the same number of draws whatever its odds. `chance(0)`
  and `chance(1)` still draw once; `intBetween(5, 5)` still draws; `normal` throws away its spare
  value. Bad arguments throw before anything is drawn, and nothing is clamped or swapped.
- **Alternatives:** Skipping the draw when the answer is already known, which is the obvious
  optimisation.
- **Why:** If `chance(0)` skipped its draw, setting a probability to 0 would shift every later roll
  on that stream, and a balance run that changed one number would differ from the baseline in
  places that number never touches. Fixed draw counts mean changing odds changes only the decisions
  those odds make. The same thinking made `intBetween` exact (rejecting the few draw values that
  would favour low numbers) and gave "1 in N" a single helper, so nobody writes "roll 0 to N and
  check for 1", which fires one time in N + 1.
- **Revisit if:** A hot loop shows the wasted draws in a profile, which seems unlikely next to
  everything else a day does.

### "0 means 0" for tunables

- **Decision:** A tunable override of `0`, `false` or `''` is a real value. The resolver checks
  whether a key is present, never whether its value is truthy. Formulas only read balance numbers
  through a typed reader, readers are immutable, and a bad override in a save is dropped with a
  load warning instead of failing the load.
- **Alternatives:** Treating falsy as "unset" (the bug most config code has by accident); letting
  formulas read definitions directly.
- **Why:** The first thing anyone does when testing a balance number is set it to 0 to see what
  happens. If 0 silently means "the default", that experiment lies. Immutable readers mean a
  tunable changed from the UI during a skip applies from the next day, never halfway through a
  step. The fatigue system's bonus roll shows both rules at once: setting its maximum to 0 turns
  the bonus off, and the roll still happens, so nothing else on the stream moves.
- **Revisit if:** Tunables need to change mid-day, which no planned feature does.

### Every result carries its trace, and old traces become summaries

- **Decision:** Every formula returns `Traced<T>`: the value plus a tree of its inputs, tunables,
  modifiers, limits and rolls. The trace store keeps the newest full traces per kind of result and
  demotes older ones to summaries (label, value, unit and the three steps that moved the value
  most). Traces are capped at 400 nodes and 12 levels, and a replay check recomputes each tested
  trace from its own steps.
- **Alternatives:** Logging, or rebuilding an explanation after the fact; keeping every trace
  forever; one global retention limit.
- **Why:** An explanation rebuilt later can drift from the maths that actually ran. Building the
  trace while computing means the "Why?" panel shows exactly what happened, and the replay check
  proves it. Keeping everything would fill saves within a season, and one global limit would let
  segment ratings, which arrive far more often, push out the rarer results like contract asks.
  Summaries are enough for history screens.
- **Revisit if:** The Why? panel needs full traces for older results than retention keeps.

### Day D is simulated in full before the clock moves

- **Decision:** `runDay` reads the date D, runs every phase for D, and only then does the closing
  step move the date to D + 1, in one metadata write.
- **Alternatives:** Move the date first and simulate "yesterday", which is how many day loops
  start out.
- **Why:** Every result has to be stamped with the day it happened. If the clock moves first, a
  show and its ticket money can end up on different dates, and every system has to remember to
  subtract one. With the clock moving last, every phase sees the same `ctx.date`, and the only thing
  that can make `runDay` throw is the closing step itself failing, because then the clock hasn't
  moved and carrying on would repeat the day.
- **Revisit if:** Something genuinely belongs between days, such as an overnight job, in which
  case it becomes an early phase of the next day.

### One transaction, one RNG snapshot and one staging per step

- **Decision:** Every step, the engine's own two, each phase, each reaction and each command,
  runs through one wrapper. Before it starts, the wrapper takes an RNG snapshot and opens an event
  staging and a trace staging, then runs the step inside a world transaction. If the step returns,
  its writes stay and its traces and events are committed. If it throws, the writes roll back, the
  RNG goes back to the snapshot, both stagings are thrown away, and the failure is reported. The
  rest of the day carries on.
- **Alternatives:** One `try` around the whole day; rolling back writes but not the RNG.
- **Why:** One `try` around several jobs means one broken job cancels all of them. One transaction
  per step keeps a bad step contained. Restoring the RNG matters as much as the writes: a step
  that draws three numbers and then crashes would otherwise use them up, the next phase on that
  stream would get different numbers, and fixing the crash would then change that phase's results
  too. With the restore, a failed step changes nothing but the report. Staging events and traces
  means nobody reacts to, or explains, something that was rolled back.
- **Revisit if:** A system needs a partial result from a step that later fails. I'd rather split
  the step.

### Phases are synchronous, and the loop yields between days

- **Decision:** Phases, gates and reactions are synchronous. A phase that returns a promise is
  refused and rolled back. The multi-day loop awaits a host-supplied `yieldToHost()` once after
  every whole day, and cancelling sets a signal the loop reads after each yield.
- **Alternatives:** Async phases; yielding inside a day.
- **Why:** The order of a day is part of determinism, and an `await` would let it depend on
  scheduling. The transaction's undo journal also only works if nothing else writes between an
  operation and its undo. The UI stays responsive because the engine runs in a Web Worker and the
  loop yields between days, so a cancel always lands on a whole day and never leaves half a day
  applied. The engine knows only the shape `{ readonly aborted: boolean }`, never a browser type,
  so the same loop runs in Node.
- **Revisit if:** One day gets slow enough on its own to freeze the progress bar, which would mean
  the phase needs to get cheaper, not async.

### Controllers, viewers and the command log before multiplayer exists (D-07)

- **Decision:** Every command names the controller that issued it, every query runs for a viewer
  (a controller, or an omniscient viewer for tools and tests), and every command is logged with
  its controller and outcome, rejected and failed ones included. Which promotion a human runs is
  only read from the promotion rows.
- **Alternatives:** Build single-player first and add controllers when multiplayer arrives.
- **Why:** D-07 says nothing in the engine may assume one player. Retrofitting that later would
  mean touching every query and command. Doing it now costs one extra argument per call, and the
  Web Worker host fills it in, so screens never pass it by hand. The command log is also the best
  bug report I can get: it shows what someone tried, not only what worked.
- **Revisit if:** Viewer filtering turns out to need engine-level help instead of each system
  deciding what a viewer may see of its own data.

### Save-state parts registered by the engine API, not imported by the save format

- **Decision:** The save format gives each simulation part (RNG, tunable overrides, traces,
  events, failure log, command log) a named slot and takes each slot's schema from the caller.
  SIM-10's `core/api/saveParts.ts` is the one place that knows all six schemas and hands them to
  the save format.
- **Alternatives:** The save format imports the simulation's schemas directly.
- **Why:** The simulation core builds on the save format, so importing its schemas would be a
  cycle. With injected schemas, `persistence/` imports no simulation code, the Foundation and
  Simulation epics could be built side by side, and a new state part is one entry in one file. An
  unknown or out-of-range tunable override is dropped with a warning on load, so removing a
  tunable never makes an old save unloadable.
- **Revisit if:** Systems need state parts of their own, at which point bundles could declare
  them.

### Gates are checked through a read-only `evaluateGates`

- **Decision:** A gate is a read-only check that runs before each day of a skip and says why the
  skip should stop (an unbooked show, a decision waiting, the date the player picked). One function,
  `evaluateGates`, runs them. The advance loop calls it before every day, and the status queries
  call the same function to say whether Next Day would stop right now. A gate that throws counts
  as a hit.
- **Alternatives:** Gates as pipeline phases that set a flag; separate logic for "would it stop"
  and "did it stop".
- **Why:** If the status screen and the loop used different code, sooner or later the screen would
  say "ready" and the button would refuse. One read-only function means they can't disagree. Gates
  get no transaction, no RNG and no events, so checking them can't change the world, and they use
  indexed lookups because they run up to 3,650 times in one skip. A broken gate stops the skip
  where the player can see it instead of letting the skip run past what it was meant to catch.
- **Revisit if:** A gate needs something too expensive for a daily check, in which case it should
  read a value a phase keeps up to date.

## How this differs from other games in the genre

- Every number the sim produces carries the working that made it, built while the maths runs, not
  pieced together afterwards. Rolls show their stream, their range and what came up.
- Changing one balance number moves only the results that depend on it. Other systems' dice don't
  shift, so two runs can be compared line by line.
- A bug in one part of a day costs that part of the day, not the whole day, and the save records
  exactly what failed and when.
- Long skips stop by themselves for a reason the player can read, and the screen that says why is
  using the same check as the skip.
- Nothing in the engine assumes one player, even though only single-player exists so far.
- The whole simulation runs headless, so a year of game time is a command away and its result is
  one hash you can paste into a bug report.

## Numbers

- **Engine tests:** 1,715 tests in 75 files, from `npx vitest run --project engine` on main at
  `6131c8d`. That covers the whole engine package, including Foundation and World generation work.
  Counting only the folders this epic owns (`core/rng/`, `core/tunables/`, `core/trace/`,
  `core/events/`, `core/pipeline/`, `core/api/`, `core/calendar/`, `systems/condition/` and the
  hash and JSON guard tests) from the JSON reporter gives 579 tests in 29 files. The runner adds 34
  tests in `tools/sim-runner`.
- **Coverage:** 95.4% of lines and 91.5% of branches across `packages/engine/src`, from
  `vitest run --project engine --coverage` at the same commit. Grouped by this epic's folders from
  the JSON summary: 96.0% of lines and 93.9% of branches. By folder: `core/rng/` 96.4% and 89.2%,
  `core/tunables/` 93.1% and 89.9%, `core/trace/` 98.5% and 96.8%, `core/events/` 92.6% and 94.4%,
  `core/pipeline/` 98.0% and 95.5%, `core/api/` 93.9% and 93.4%, `core/calendar/` 93.3% and
  92.6%, and `systems/condition/` 100% of both.
- **Headless runner speed:** `npm run sim -- --days 365` on the 300-person roster fixture, with
  only the built-in `sim` system and the condition system registered.

  | Where                                                            | Advance time | Days per second | Whole command |
  | ---------------------------------------------------------------- | ------------ | --------------- | ------------- |
  | My machine (Intel i5-13600KF, Node 20.20.1, WSL2), three runs    | 79–82 ms     | 4,462–4,614     | 0.71–0.85 s   |
  | CI (`ubuntu-latest`, "one-year timing" step), two wave 9 PR runs | 166–194 ms   | 1,883–2,199     | -             |

  The budget is 10 seconds for that run on CI hardware, so the core uses about 2% of it. Real
  systems will eat into that quickly.

- **Determinism:** `npm run sim -- --days 365 --check-determinism` on my machine:

  ```
  Determinism check
    Run 1 hash  6d2224a84ca62573
    Run 2 hash  6d2224a84ca62573
    Result      OK: both runs match
  ```

  The 60-day check CI runs (`--days 60 --check-determinism --strict`) ends on `c858bc1410e35042`
  both locally and on CI, and CI's one-year run printed the same `6d2224a84ca62573` as my
  machine. Same seed, same days, same world, on two different machines.

- **Save size:** Not measured this time. The state parts this epic added are small for now: the
  touched RNG streams, at most 500 recent events (`sim.eventLogSize`) and the latest fatigue
  traces.

### A trace from the runner

`npm run sim -- --days 30 --people 20 --trace condition.fatigueRecovery:per_0000000002` prints the
last stored trace for that person's fatigue recovery:

```
Trace condition.fatigueRecovery:per_0000000002 (recorded 2026-01-05)
  Fatigue after a day of rest: 0 points
    Fatigue before rest: 5 points
    Daily recovery: 1 points (5 - 4)
      Daily recovery: 4 points/day (tunable condition.fatigueRecoveryPerDay, default 4)
    Extra rest: rolled 1 in 0..1 (stream condition.recovery)
      Most extra rest: 1 points/day (tunable condition.fatigueRecoveryBonusMax, default 1)
    Extra rest: 0 points (1 - 1)
    Kept between 0 and 100: 0 points
```

Each arithmetic line shows the running value after the step, with the sum in brackets. The
tunable lines say which key was read and its default, and the roll says its range, its result and
its stream. The clamp line has no "was" because it didn't change anything. This person cleared
their fatigue on day one, so there is no later trace for them.

## What went wrong or surprised me

- **My first generator wasn't quite sfc32.** It added the counter after incrementing it, so the
  output didn't match the published algorithm. Nothing broke, which is the scary part. I fixed the
  step order, re-froze the golden values and checked them against an independent implementation.
  It had to happen before any save existed, because after that the generator is part of the save
  format.
- **An async phase slipped through.** `runStep` dropped whatever a phase's `run` returned, so the
  transaction never saw a promise. An `async` phase had its synchronous writes committed, was
  reported as fine, and ran the rest of its body after the transaction had closed. Now the result
  goes to the transaction, which refuses a promise and rolls the step back.
- **Traces that couldn't be loaded again.** A trace could hold `-0`, and an overflowing summary
  contributor became `Infinity`, which JSON turns into `null`. Both were fine in memory and broken
  after a save. The store now validates every trace with the same schema a load uses when it is
  recorded, so a trace that can't round-trip fails straight away, at the step that made it.
- **Off by one on the node cap.** A step that fitted into the last free slot came out as two nodes,
  so a trace could reach 401. Small, but a cap that isn't a cap is worse than no cap.
- **Half-frozen event payloads.** A payload frozen only at its top level kept its nested objects
  writable, because the freeze walk stopped at the first frozen object it met.
- **Code written before the lint rules landed needed a pass.** The RNG and tunables work ran under
  the strict lint config for the first time at the first merge, and the generic tunable casts had
  to become type guards. Later the tightened `Math.random` rule caught the trace builder reading a
  `Math` member by a computed key for rounding, which was harmless but now spells each mode out.
- **The runner couldn't use the test fixtures.** `@ringside/engine/testing` pulled in Vitest's
  assertion helpers, which a plain Node tool can't load, so the fixtures got their own entry point.
- **The speed figure flatters the core.** A 60-day run takes about as long as a 365-day one (78 ms
  against 80 ms), so its days-per-second figure looks five times worse. Both runs publish the same
  250 `condition.fatigueCleared` events: the fixture's fatigue is gone within the first few weeks,
  and after that a day has almost nothing to do. The year baseline is mostly empty days, and the
  real cost per busy day is higher than 4,500 days per second suggests.
- **Better than expected:** the world hash came out the same on my machine and on CI, for both the
  60-day and the one-year run, so determinism already holds across two different machines and not
  only between two runs on mine.

## Open questions

- **How the trace reads in words.** The runner prints "Daily recovery: 1 points (5 - 4)", where 1
  is the running value after the step, not the recovery. That's consistent, but it reads oddly,
  and "1 points" wants a singular. The Why? panel has the same data; the wording of step lines is
  worth one pass before players see it.
- **When a world hash should be frozen.** Nothing in a save depends on it, so it can change
  between engine builds. If bug reports start quoting hashes, I may want it stable for a release.
- **Where viewer filtering lives.** Each system decides what a viewer may see of its own data.
  That's simple now, with one system. I don't know yet whether rival finances and contract offers
  will want a shared helper.
- **Performance headroom.** The core leaves almost the whole 10-second budget for real systems.
  I don't know how much of it shows, booking and the computer's turns will take, and the runner's
  speed table is where I'll find out.

## Blog angle

This entry feeds part 2, "Foundations: one World, deterministic days, numbers that explain
themselves", together with the Foundation entry, and planned parts 3 and 4. For readers who
program but haven't built a sim:

- **Same seed, same show.** Named streams, why changing odds must never move other rolls, and the
  world hash that proves a year plays out the same on two machines.
- **Every number explains itself.** `Traced<T>`, the trace printed above, the replay check, and
  how old traces turn into summaries so saves stay small. The Why? panel has shipped, so the post
  can show it next to the raw tree.
- **Every day is a transaction.** Per-step rollback including the RNG, why a broken step must not
  cancel the day, and why the clock moves last.

## Raw notes

Nothing this time.

## Next

- **DAY** owns the real order of the day: it fills the phase groups with actual jobs and adds the
  `seasonEnd` phase that D-08's configurable seasons need.
- **WRK** replaces the placeholder fatigue system with the real one (gain from matches, effort,
  injuries) and can lift its layout straight from `systems/condition/`.
- **POL** builds the balance harness on top of the headless runner, for multi-year reports and
  comparing runs that differ by one tunable.
- **WLD** is still filling the default world. Once its people land, the runner can run the shipped
  world as well as the fixture.
- **BLOG-11** combines this entry with the Foundation entry into the milestone entry and part 2.
