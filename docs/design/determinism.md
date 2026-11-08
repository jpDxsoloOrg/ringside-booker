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
(`condition.recovery`, `ids.per`, ...), and each stream has its own state.
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

Odds helpers such as `chance(0.15)` and `intBetween(1, 6)` sit on top of these
and get their own section here when they land.

Streams are created lazily. The first `rng.stream('condition.recovery')` call
derives the stream from the seed; later calls return the same object. A stream
object holds only its own state, never the registry or the world, so it can be
passed straight into a pure formula function.

### Adding a stream name

Stream names are typed. The registry accepts any name declared in the
`StreamNames` interface, plus `ids.<prefix>` for ID minting (one stream per
entity ID prefix, such as `ids.per` or `ids.pro`). A system declares its names
next to its own code:

```ts
// packages/engine/src/systems/condition/streams.ts
declare module '../../core/rng/streams' {
  interface StreamNames {
    'condition.recovery': true;
  }
}
```

After that, `rng.stream('condition.recovery')` type-checks and a typo doesn't.

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
    "condition.recovery": [1892409465, 677112609, 1486160498, 259642175],
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
