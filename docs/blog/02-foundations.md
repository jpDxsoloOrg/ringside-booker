---
title: 'Foundations: one World, deterministic days, numbers that explain themselves'
slug: ringside-booker-02-foundations
series: ringside-booker
part: 2
status: outline
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
---

- Hook: part 1 promised every number explains itself and the same save plays the same way. This
  part is the plumbing that makes both true, now that the first two epics are done.

## One World, many tables

- One `World` object, one typed table per kind of thing, each row keyed by a branded ID.
- Rows point at each other by ID only: a title reign holds person IDs, not copies of people.
- Why no nested copies: renames, releases and saves. Nothing stored that could disagree (no
  current champion field, no stored slot role).
- The one write path: a transaction with an undo journal.

## Every day is a transaction

- A day is an ordered list of phases in groups (housekeeping, world events, rival turns, shows,
  money, periodic jobs), and the clock moves last.
- Each step runs in its own transaction with an RNG snapshot and staged events and traces.
- Why one broken step must not cancel the day, and why the RNG has to roll back too.
- Code: trimmed excerpt of the step wrapper.

## Same seed, same show

- One seed, many named streams. Adding a roll to injuries must not move contract talks.
- Fixed draw counts: `chance(0)` still draws.
- Code: the fatigue phase asking for its stream, and the roll in the formula.
- The world hash: a year on the fixture world ends on the same hash on my machine and on CI.

## Numbers that explain themselves

- The `Traced<T>` interface in a fenced block.
- A real trace from the headless runner, as an indented list.
- The Why? panel component exists; link it. Old traces become summaries so saves stay small.
- Numbers with their date and machine: tests, runner speed, save size, tunables.

## What I got wrong

- The generator that wasn't quite the published algorithm.
- An async phase slipped through and wrote after its transaction closed.
- Traces that couldn't survive a save (`-0`, `Infinity`).
- The `Math.random` ban had holes.

## What's next

- The fictional world (WLD): geography, names, promotions and their people.
