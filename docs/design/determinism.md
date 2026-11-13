# Determinism

Same save + same seed + same inputs = same result. That promise is what makes a
bug report reproducible and lets the balance harness run years of game time
twice and compare the runs. This doc covers the pieces that keep it.

## Randomness

All randomness in the engine comes from one seeded, serialisable RNG split into
**named streams**. Nothing in the engine calls `Math.random()`, reads the clock
or uses `crypto` for game outcomes.

Code: `packages/engine/src/core/rng/` and `packages/engine/src/core/hash.ts`.

### Why named streams

With one shared generator, every random call takes the next number off a single
sequence. Add one roll to the injury check and every later roll that day moves
along by one: contract talks, crowd reactions and AI decisions all come out
differently, even though none of that code changed. A balance tweak in one
system would make it impossible to compare two runs of another.

Named streams fix that. Each system draws from its own streams
(`health.recovery`, `ids.per`, ...), and each stream has its own state.
Drawing 500 numbers from one stream never changes what another stream produces.
A change to injuries can only move injury results.

### How a stream is derived

1. The game has one seed, a string chosen at new game.
2. A stream's starting state is
   `hashString128(seed + "\u0000" + streamName)`: four unsigned 32-bit words
   from a cyrb128-style string hash. The NUL separator can't appear in a stream
   name, so two different seed and name pairs never hash the same input.
3. If the hash happens to be all zeros, the first word is replaced with a fixed
   non-zero word.
4. The generator is stepped 12 times and those outputs are thrown away, so seeds
   that differ by one character still start far apart.

The generator is an sfc32-style counting generator: 128 bits of state as four
uint32 words, stepped with integer operations only (`+` with wrap, xor,
shifts). Integer maths gives the same bits in every JavaScript engine, and four
uint32s fit in JSON without losing precision or needing BigInt.

A stream gives you two things:

- `nextUint32()`: a whole number from 0 to 4,294,967,295, both ends included.
- `nextFloat()`: `nextUint32() / 2^32`, so 0 is possible and 1 never is.

Game code never reads these directly. The odds helpers below sit on top of
them and state the odds of every decision exactly.

Streams are created lazily. The first `rng.stream('health.recovery')` call
derives the stream from the seed; later calls return the same object. A stream
object holds only its own state, never the registry or the world, so it can be
passed straight into a pure formula function.

### Adding a stream name

Stream names are typed. The registry accepts any name declared in the
`StreamNames` interface, plus `ids.<prefix>` for ID minting (one stream per
entity ID prefix, such as `ids.per` or `ids.pro`). A system declares its names
next to its own code:

```ts
// packages/engine/src/systems/health/streams.ts
declare module '../../core/rng/streams' {
  interface StreamNames {
    'health.recovery': true;
  }
}
```

After that, `rng.stream('health.recovery')` type-checks and a typo doesn't.

Names follow `^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$`: a lowercase system segment and
at least one more dot-separated segment. The registry checks this at runtime
too, so a badly built dynamic name (an empty ID prefix, say) throws in tests
instead of quietly creating a new stream.

Pick a name once and keep it. Renaming a stream re-derives it from the seed,
which changes its future results in every existing save.

### What is saved

The RNG part of a save looks like this (the words are made up):

```json
{
  "version": 1,
  "seed": "my-new-game",
  "streams": {
    "health.recovery": [1892409465, 677112609, 1486160498, 259642175],
    "ids.per": [3021911417, 1844257009, 993215788, 2741190853]
  }
}
```

- `streams` holds the current four words of every stream **touched** so far,
  keyed by name in sorted order so the same state always serialises to the same
  text.
- Untouched streams are **not** saved. On load they re-derive from the seed,
  which gives exactly the state they would have had if they'd been saved: a
  stream nobody has drawn from is still at its seed-derived start. The save
  doesn't grow with every stream name ever declared.
- `rngStateSchema` (zod) validates the state on load. It rejects unknown
  versions, bad stream names and any word that isn't a whole number from 0 to
  2^32 − 1, and the error names the bad field, for example
  `streams["test.alpha"][2]: must be an unsigned 32-bit word`.

`RngRegistry.toState()` writes this shape and `RngRegistry.fromState()` reads
it back. A registry rebuilt from a saved state continues every stream's
sequence exactly where it left off.

Snapshots are the in-memory version, used to roll back a failed pipeline step:
`snapshot()` copies the touched streams, and `restore()` puts them back. A
stream first touched after the snapshot goes back to its seed-derived start and
stops counting as touched. Stream objects already handed out keep working and
follow the restored state.

### Frozen outputs

The hash, the generator step, the seeding and the warm-up count are part of the
save format. Change any of them and every existing save quietly plays out a
different future. Golden-value tests lock them:

- `test/core/hash.test.ts`: `hashString128` of `""`, `"a"` and `"ringside"`.
- `test/core/rng/prng.test.ts`: the first 10 outputs of seed `"rb-test"`,
  stream `"test.alpha"`.

The same frozen arrays must come out of every JavaScript engine, Node and the
browser's Web Worker alike, because the generator uses integer maths only. If
one of these ever has to change, it needs a save migration that re-seeds.

### Detached streams

Some code has to roll without the roll counting: the Match lab's previews
(`match.preview`, `match.previewBatch`, `match.simulate`, `match.simulateBatch`) rate a segment as often as the player
likes, and the next real show must come out the same however many previews ran.
They draw from `detachedStream(seed, name, key)` (`core/rng/registry.ts`), a
stream derived like any other but from `name + "#" + key` (the previews use
`match.preview` keyed by the preview seed) and owned by no registry. It is never
saved, snapshotted or restored, and drawing from it never touches the
registry. A preview must never call `rng.stream()`; the preview tests check
that the whole engine state, the RNG included, is byte-identical after a
500-run batch. MTCH6 reuses the helper for pair chemistry.

## Odds helpers

Code: `packages/engine/src/core/rng/odds.ts`.

Every random decision goes through a small set of free functions that take the
stream first: `chance(stream, 0.15)`, `intBetween(stream, 1, 6)`. Each one says
exactly what its odds are, which ends of a range can come up, and how many raw
draws it takes from the stream.

| Helper                                 | Odds                                                                                          | Ends                                                    | Draws consumed                                                  | Throws `InvalidOddsError` when                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `chance(s, p)`                         | true with `Math.round(p * 2^32) / 2^32` (exactly `p` to 2^-32); `p = 0` never, `p = 1` always | n/a                                                     | 1, always (also for 0 and 1)                                    | `p` is not finite or is outside [0, 1]                                               |
| `percent(s, k)`                        | `chance(s, k / 100)`, draw for draw                                                           | n/a                                                     | 1                                                               | `k` is not finite or is outside [0, 100]                                             |
| `oneIn(s, n)`                          | true with exactly `1 / n`                                                                     | n/a                                                     | as `intBetween(s, 1, n)`                                        | `n` is not a whole number, is below 1 or above 2^32                                  |
| `intBetween(s, min, max)`              | each whole number exactly `1 / (max - min + 1)`                                               | both included                                           | 1, plus a redraw with odds below `span / 2^32` (see below)      | a bound is not a whole number, `min > max`, or the range holds more than 2^32 values |
| `floatBetween(s, min, max)`            | uniform                                                                                       | `min` included, `max` excluded; `min = max` gives `min` | 1                                                               | a bound is not finite or `min > max`                                                 |
| `pick(s, items)`                       | each item `1 / items.length`                                                                  | first and last both reachable                           | as `intBetween(s, 0, length - 1)`                               | the list is empty                                                                    |
| `weightedPick(s, entries)`             | each item `weight / totalWeight` (to 2^-32); weight 0 is never picked                         | n/a                                                     | 1                                                               | the list is empty, a weight is negative or not finite, or every weight is 0          |
| `shuffle(s, items)`                    | every order equally likely (Fisher–Yates); returns a new array, input untouched               | n/a                                                     | `length - 1` `intBetween` calls; none for 0 or 1 items          | never                                                                                |
| `normal(s, mean, sd)`                  | normal distribution (Box–Muller)                                                              | unbounded                                               | 2, plus a redraw of the first when it is exactly 0 (odds 2^-32) | `mean` is not finite, or `sd` is not finite or is negative                           |
| `clampedNormal(s, mean, sd, min, max)` | `normal`, then clamped; the clipped tails land on the ends                                    | both included                                           | 2, as `normal`                                                  | as `normal`, plus a bound that is not finite or `min > max`                          |

Every error is an `InvalidOddsError`, a subclass of `EngineError` with the code
`INVALID_ODDS`, so a bad call is reported as a rule violation like any other
engine failure rather than as an unexpected crash. Every error message names
the bad value, for example
`intBetween: min (6) must not be greater than max (1)`. Arguments are checked
before anything is drawn, so a rejected call leaves the stream where it was.

### Rules behind the helpers

- **Bad input throws; nothing is clamped or swapped.** A helper that quietly
  accepts `intBetween(6, 1)` has to pick a meaning for it, and every meaning is
  an off-by-one waiting to happen: a reversed range that silently excludes both
  of its nominal ends shifts every result built on it by one. Throwing turns
  that whole class of bug into a failing test.
- **Draw counts don't depend on the odds.** `chance(0)` and `chance(1)` still
  draw. If they skipped the draw, tuning a probability to 0 would move every
  later roll in that stream, and comparing two balance runs that differ by one
  number would show noise everywhere. The same goes for `intBetween(5, 5)` and
  `oneIn(1)`.
- **`intBetween` is exact.** The usual `min + draw % span` shortcut favours the
  low values by up to `span / 2^32`. That's tiny, but it's still not the odds
  the code says. Instead the top `2^32 mod span` draw values are rejected and
  redrawn, so every value has exactly the same number of draw values behind it.
  For a six-sided die the redraw happens 4 times in 2^32 calls. A span that is
  a power of two never redraws.
- **One way to write "1 in N".** `oneIn(s, n)` is `intBetween(s, 1, n) === 1`.
  The tempting version, "roll 0 to N and check for 1", has N + 1 outcomes and
  fires 1 time in N + 1, not N. Every 1-in-N check in the game uses `oneIn`.
- **`normal` keeps no spare.** Box–Muller makes two normal values per pair of
  draws. Caching the second one would make each call depend on whether the call
  before it used the cache, so the spare is thrown away and every call takes
  exactly two draws.
- **`weightedPick` walks the weights in order.** One `nextFloat()` draw is
  scaled by the total weight, and the first entry whose running total passes it
  wins. Reordering the entries changes which draw picks which entry, so data
  lists should keep a stable order.

### Recorded rolls

Code: `packages/engine/src/core/rng/rolls.ts`.

Formulas that need to explain their rolls in a Why? trace use the recorded
forms: `rollChance`, `rollInt`, `rollOneIn`, `rollFloat`, `rollNormal`,
`rollPick` and `rollWeighted`. Each returns `{ value, roll }`, where `roll` is a
`RollRecord`:

```json
{
  "stream": "health.injury",
  "kind": "chance",
  "label": "Injury check",
  "odds": 0.25,
  "result": false
}
```

- `kind` is one of `chance`, `oneIn`, `int`, `float`, `pick`, `weighted`,
  `normal`.
- `odds` is the stated odds, where they're exact. For a chance or a 1-in-N
  it's the probability of `true` (`p` or `1 / n`), whichever way the roll went.
  For an integer range or a pick list it's one value's share, and for a
  weighted pick it's the chosen entry's `weight / totalWeight`. Continuous
  rolls (`float`, `normal`) leave it out.
- `min` and `max` are the range ends, `options` the number of choices.
- `result` is the outcome. For picks it's a description from the caller's
  `describe(item)` function, so a record never holds an entity, only text.

Every field is a string, a boolean or a finite number, so a record survives
`JSON.stringify` unchanged and can be saved inside a trace.

A recorded helper calls the plain helper and only adds the record. It takes
exactly the same draws, so switching a call site between `chance` and
`rollChance` never changes a result.

## ID minting

Code: `packages/engine/src/core/rng/ids.ts`, on top of `packages/engine/src/core/ids.ts`.

New entity IDs come from the seeded RNG, so a replay creates the same IDs.
`core/ids.ts` is the only place that defines what an ID looks like (prefix,
body length, alphabet, collision retries) through `createIdFactory(entropy)`.
`createIdMinter(rng)` adds just one thing: it routes each entity kind to its
own stream, `ids.<prefix>`, so people come from `ids.per`, seasons from
`ids.sea`, and so on.

- **One stream per kind.** A new system that creates titles doesn't change the
  IDs of people created on the same day, for the same reason systems get their
  own streams.
- **Lazy.** The factory for a kind is built the first time that kind is minted.
  A kind that has never been minted never touches its stream, so it isn't
  saved.
- **Same seed, same order, same IDs.** IDs look random, so they don't leak
  creation order, and they're unlikely to collide when data packs are merged.

### Coupling with snapshots

The minter doesn't keep its own copy of a stream. Every draw asks the registry
for the live stream (`rng.stream('ids.per')`), which is the same object each
time. That gives two guarantees the pipeline relies on:

1. **A rollback rewinds minting.** When a pipeline step fails, the runtime
   restores the RNG snapshot taken before the step. The ID streams are part of
   that snapshot, so the step's retry, or the next step, mints the same IDs the
   failed step would have. No ID is skipped and none is handed out twice.
2. **A restored stream stays in the save.** If a step is the first to mint a
   kind and then fails, the restore resets that stream and marks it untouched.
   Because the minter goes through `rng.stream()` on each draw, the next mint
   marks it touched again, so `toState()` keeps saving it.

Anything else that holds on to a stream across steps must follow the same rule:
ask the registry, don't cache a copy of the state.

## World hash

`worldHash(state)` (`packages/engine/src/core/api/stateHash.ts`) turns a whole
`EngineState` into 16 hex digits. Two runs from the same state with the same
commands must end with the same hash. The headless runner prints it after
every run, and `--check-determinism` runs twice and compares the two, which CI
does on every PR.

- **Canonical text.** `stableStringify` (`core/hash.ts`) writes JSON with every
  object's keys sorted and arrays in their own order, so the order keys were
  inserted in never changes the hash. It refuses anything that isn't plain JSON
  through `assertJsonValue`, the same check the save writer uses.
- **Two passes.** The hash is two `hashString32` results over that text, the
  second one salted, joined into 64 bits. It isn't cryptographic; it only has
  to make an accidental match between two different worlds very unlikely.
- **Left out.** Every `timing` field (host wall-clock time) and the `stack` of
  every serialised error. Both differ between two identical runs. Everything
  else counts: the World, the touched RNG streams, tunable overrides, traces,
  the event log, the failure log and the command log.
- **Not frozen.** Unlike the seed hashes above, nothing in a save depends on
  the world hash, so changing how it is built only changes the hashes tools
  print. Compare hashes from the same engine build.
