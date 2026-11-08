---
title: 'Foundations: one World, deterministic days, numbers that explain themselves'
slug: ringside-booker-02-foundations
series: ringside-booker
part: 2
status: final
excerpt:
  'The plumbing under a booking sim where every number explains itself: one World of tables, days
  that run as transactions, seeded random streams and traced values.'
tags: [gamedev, typescript, simulation, architecture]
journal:
  [
    docs/dev-journal/2026-11-foundation.md,
    docs/dev-journal/2026-11-sim-core.md,
    docs/dev-journal/2026-11-foundation-and-engine-core.md,
  ]
publishedAt: 2026-11-08
---

In part 1 I made two promises: every number in Ringside Booker explains itself, and the same save
with the same seed plays out the same way every time. This post is about the plumbing that makes
them true. The first two big chunks of work are done, and there's still nothing to play. What there
is, though, is an engine that can run a day, roll back the part of it that broke, replay a year to
the same result on two machines, and tell you exactly how it worked out a number.

## One World, many tables

Everything the game knows lives in one object I call the World. It isn't a tree of nested objects.
It's a set of tables, one per kind of thing: people, promotions, contracts, titles, title reigns,
shows, segments, regions, money ledger rows and so on. Each row has an ID with a short prefix that
says what it is, `per_` for a person or `tit_` for a title, and the types know the difference, so
the compiler stops me passing a title's ID where a person's belongs.

The one rule that matters most is that rows point at each other by ID and nothing else. A title
reign doesn't hold a copy of the champion. It holds their person ID:

```ts
export const TitleReignSchema = z.strictObject({
  id: zId('titleReign'),
  titleId: zId('title'),
  holderIds: z.array(zId('person')).min(1).max(MAX_REIGN_HOLDERS),
  wonOn: zGameDate,
  /** Null while this is the current reign. */
  lostOn: zGameDate.nullable(),
  // ...
});
```

Why bother? Because copies drift. If a reign held a copy of the wrestler, a rename would update some
copies and miss others. Names make terrible keys too: they change, and two people can share one.
With IDs, a rename touches exactly one row.

I took the same idea one step further: if a fact can be worked out from other rows, I don't store
it. There's no "current champion" field on a title. The current champion is the open reign, the one
with no end date, and an index finds it quickly. There's no "current season" field either, and no
stored role for a segment on a card. Its role (opener, main event and so on, from D-10) comes from
where it sits, so it can never disagree with the card order after you move it. Every field I didn't
store is a field that can't go stale.

The few deliberate copies are there because history mustn't change: a reign keeps the ring names the
champions used when they won, so an old title history still reads the way it happened.

Nothing writes to the World directly. Every change goes through a transaction, which records the
"before" version of each row it touches in an undo journal. If something goes wrong, it replays that
journal backwards and the World is exactly as it was. Copying the World before each step would be
simpler, but a day only touches a small slice of it and failures are rare. Recording what changed is
far cheaper than copying thousands of rows to guard against something that almost never happens.

## Every day is a transaction

Time moves one day at a time. A day is an ordered list of steps the engine calls phases, grouped by
what they do: housekeeping first, then world events, rival promotions' turns, contracts, shows,
settling results, growth, money, and the weekly, monthly and yearly jobs. Each phase has a fixed
place in that order, so the order of a day never depends on which system happened to register first.

Two rules shape how a day runs.

First, the clock moves last. The engine simulates day D in full, and only the closing step moves the
date to D + 1. Plenty of day loops start the other way round: move the clock, then simulate
"yesterday". Then every system has to remember to subtract one, and a show and its ticket money can
end up stamped with different dates. With the clock moving last, every phase sees the same date.

Second, each step runs on its own. Every phase gets its own transaction, its own snapshot of the
random number state, and its own staging area for the events it publishes and the explanations it
records. This is the heart of the wrapper every step goes through, trimmed down:

```ts
const rngSnapshot = runtime.rng.snapshot();
const eventStaging = runtime.bus.stage(source, date);
const traceStaging = runtime.traces.stage();

const result = runtime.world.transact(label, (tx) => run({ date, tx /* , ... */ }));

if (result.ok) {
  traceStaging.commit();
  return { ok: true, events: eventStaging.commit(), traces: recordedRefs.size };
}
// The transaction has already undone the step's writes; put back everything else it touched.
runtime.rng.restore(rngSnapshot);
eventStaging.discard();
traceStaging.discard();
return { ok: false, error: result.error };
```

If the step finishes, its writes stay and its events and explanations go out. If it throws, its
writes are rolled back, the random numbers go back to where they were, its events and explanations
are thrown away, and the failure goes into a report and a log in the save. Then the day carries on
with the next step.

Why not one `try` around the whole day? Because a game like this has a lot of systems, and some of
them will have bugs. If the contract system trips over one odd contract, that mustn't cancel the
shows, the money and everyone's recovery for the day, or crash a year-long skip. One broken step
costs that step. Everything else still happens, and the failure is on record with the date and the
step that failed.

Rolling back the random numbers matters as much as rolling back the writes. Imagine a step that
draws three random numbers and then crashes. Without the restore, those three numbers are used up,
so the next step on the same stream gets different ones. Then, when I fix the crash, that next
step's results change too, even though I never touched it. With the restore, a failed step changes
nothing except the report.

Multi-day skips are a loop over this. The loop checks a list of gates before each day (your show is
today and isn't booked, a decision is waiting for you), stops at the first one that fires, and hands
control back to the host between days, so the page stays responsive and a cancel always lands on a
whole day.

## Same seed, same show

There's no `Math.random()` anywhere in the engine. A lint rule bans it, along with every sneaky way
of spelling it I could think of. All randomness grows from one seed.

The obvious way is one seeded generator for the whole game, where every roll takes the next number
off a single line. Add one roll to the injury check and every later roll that day shifts along by
one, so contract talks, crowd reactions and rival decisions all come out differently even though
none of that code changed. Compare two balance runs and the differences are everywhere.

So the seed is split into named streams. Each system draws from its own, and each stream starts from
a hash of the seed and its name, so drawing from one can never move another. A system declares its
stream name once, and the phase passes the stream into the formula, which only knows it has a stream
to roll on:

```ts
// systems/condition/streams.ts
declare module '../../core/rng/streams' {
  interface StreamNames {
    'condition.recovery': true;
  }
}

// systems/condition/phases.ts
recoveryStream ??= ctx.rng(RECOVERY_STREAM);
const recovered = computeFatigueRecovery(
  { fatigue: person.fatigue },
  { tunables: ctx.tunables, rng: recoveryStream },
);

// systems/condition/formulas/fatigueRecovery.ts
const extraRest = rollInt(deps.rng, 0, bonusMax, 'Extra rest');
```

Stream names are typed, so a typo fails to compile. New IDs come from streams too, one per kind of
thing, so a new system that creates titles can't change the IDs of the people created the same day.
The save only stores streams that have been used. An untouched stream re-creates itself from the
seed exactly where it would have been.

One rule matters more than it looks: every random helper always draws the same number of times,
whatever its odds. `chance(0)` still draws once. It would be an easy optimisation to skip the draw
when the answer is already known, but then setting a probability to 0 to see what happens would
shift every later roll on that stream, and the experiment would lie to me. Balance numbers follow a
similar rule. Every one of them lives in a typed registry, and setting one to 0 means 0, never "use
the default".

Does it work? The headless runner, a command-line tool that runs the simulation with no UI, ends
every run with a hash of the whole game state. A year on the test world, 300 people with seed 1,
ends on `6d2224a84ca62573`. It does that on my machine and on the CI server, and it still did after
the next batch of work landed in the repo. Same seed, same days, same world.

## Numbers that explain themselves

This is the promise from part 1, and the reason for most of the above. Every formula in the game is
a plain function that takes its inputs and returns the answer together with the working that
produced it:

```ts
/** A result together with the trace that explains it. */
export interface Traced<T> {
  value: T;
  trace: TraceNode;
}

/** A balance number read from the tunables registry, with its default and override state. */
export interface TunableNode extends TraceNodeBase {
  readonly kind: 'tunable';
  readonly key: string;
  readonly value: TunableRawValue;
  readonly defaultValue: TunableRawValue;
  readonly overridden: boolean;
}

/** A random roll, with its stream, odds and result. */
export interface RollNode extends TraceNodeBase {
  readonly kind: 'roll';
  readonly value: number | boolean | string;
  readonly roll: RollRecord;
}
```

A trace is a tree. Its nodes are the inputs, the balance numbers that were read, each step of the
arithmetic, every limit that was checked, and every random roll with its stream, its range and what
came up. The labels are written for players, not for me: "Fatigue before rest", not `fat0`.

The trace isn't pieced together afterwards. A small builder records each step as the maths runs, so
the explanation can't drift from what actually happened. A replay check in the tests goes further:
it recomputes each trace from its own steps and fails if the answer doesn't match.

The only real system so far is a small one: wrestlers shed a little fatigue every day. Here's a real
trace for one person after one day, printed by the headless runner:

```sh
npm run sim -- --days 1 --people 20 --trace condition.fatigueRecovery:per_0000000005
```

- Fatigue after a day of rest: 15 points
  - Fatigue before rest: 20 points
  - Daily recovery: 16 points (20 - 4)
    - Daily recovery: 4 points/day (tunable, default 4)
  - Extra rest: rolled 1 in 0..1 (stream `condition.recovery`)
    - Most extra rest: 1 points/day (tunable, default 1)
  - Extra rest: 15 points (16 - 1)
  - Kept between 0 and 100: 15 points

The runner also prints the key of each tunable it read, `condition.fatigueRecoveryPerDay` and
`condition.fatigueRecoveryBonusMax`. I've left them out of the list so it fits on a phone screen.

Each arithmetic line shows the running value after that step, with the sum in brackets. Each tunable
line gives the setting's value and its default, and the roll says its range, its result and which
stream it came from. (Yes, "1 points". The wording gets a pass before players see it.) It's a dull
calculation on purpose. It's the template every later system copies, and a match rating will be the
same shape with a lot more lines.

In the game, this tree is what the Why? panel shows. The panel is built as a
[component](../../apps/web/src/components/Trace/TracePanel.tsx) that turns each node into a
sentence, with groups you can open and close and a "copy as text" button for bug reports. Right now
it lives in the app's component gallery, because no screen has a number worth explaining yet.

Traces have a cost: they take space. Keeping every one forever would fill a save within a season. So
the engine keeps the newest 200 full traces for each kind of result, and turns older ones into
summaries: the label, the value and the three steps that moved it most. History screens only need
that much, and both limits are settings.

Here's where things stood when I wrote this, on 2026-11-08, on my machine (an Intel i5-13600KF, Node
20, under WSL2):

| What                                        | Number                                |
| ------------------------------------------- | ------------------------------------- |
| Engine tests                                | 1,759                                 |
| A year on the 300-person test world         | 77–78 ms, about 4,700 days per second |
| That world as a gzipped save, start of year | 24,908 bytes                          |
| The same save after the year                | 34,513 bytes                          |
| Balance numbers in the registry             | 49                                    |

The speed figure flatters the engine: only one small system runs, and once everyone's fatigue is
gone, most days have nothing to do. Real systems will eat into it quickly, and that's what the
runner is for.

## What I got wrong

Plenty, and most of it was caught by tests or review before it could hurt anything.

**My random number generator wasn't quite the published algorithm.** It added a counter in the wrong
order, so the output was different from the reference version. Nothing broke, which is the scary
part: it was still random, just not the generator I thought I had. I fixed the order, froze the
expected outputs again and checked them against an independent implementation. It had to happen
before any save existed, because once saves exist, the generator is part of the save format.

**An async step slipped through.** The step wrapper ignored whatever a phase returned, so a phase
written as `async` got its first writes committed, was reported as fine, and then ran the rest of
its code after its transaction had closed. Now the transaction looks at what the step returns and
refuses a promise, rolling the step back.

**Traces that couldn't survive a save.** A trace could hold `-0`, and one summary value could become
`Infinity`, which JSON quietly turns into `null`. Both were fine in memory and broken after a save
and load. Now every trace is checked against the same schema a load uses at the moment it's
recorded, so a bad one fails straight away, in the step that made it.

**The `Math.random` ban had holes.** My first lint rule caught the obvious call. It missed
`globalThis.Math.random`, an alias of `Math`, and reading the function with a computed key. It took
two rounds to close them, and each spelling now has a test that proves the rule still catches it.

**I wrote code before its rules existed.** Some early work landed before the strict lint config, and
turning it on found 27 errors, mostly casts I'd used to make the typed IDs. Routing every one of
them through a proper type check was better anyway, but it was a cleanup I'd have avoided by doing
the boring setup first.

The [Foundation](../dev-journal/2026-11-foundation.md) and
[Simulation core](../dev-journal/2026-11-sim-core.md) journal entries have the full lists, with the
decisions behind each piece.

## What's next

The engine can run a world now, but the world it runs is still a test fixture. The world the game
will ship with is half built: the map, the promotions, their titles and venues exist as data, and
the people who fill their rosters are still being generated. That's the next part of the build: a
fictional world of countries and regions, wrestlers with names that sound like they belong
somewhere, promotions with their own styles, and the new game setup that puts it all together.

That's part 5 on the plan, and it'll be on the [series index](/blog/ringside-booker-series) when
it's ready. Parts 3 and 4, the deep dives on random streams and on the Why? panel, wait until
there's more to show than this post already does.
