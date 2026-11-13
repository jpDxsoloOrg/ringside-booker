# Save format

A save is one JSON document. The engine owns its shape, how it is packed into
bytes, how old versions are upgraded and how a load is checked. The web app's
storage only keeps the bytes: save slots, autosave and file export never look
inside them, apart from reading the header for a slot list.

The goal is the determinism promise applied to persistence: a game that is
saved, loaded and played on ends **byte for byte** where the same game ends if
it had never been saved.

Code: `packages/engine/src/persistence/` (`save-document.ts`,
`world-document.ts`, `codec.ts`, `load.ts`, `inspect.ts`, `migrations/`).

## The document

```jsonc
{
  "engineVersion": "0.1.0", // the build that wrote it; informational only
  "format": "ringside-booker/save", // always this; anything else is not a save
  "formatVersion": 1, // the document layout version; migrations key off this
  "header": {
    // what a save-slot list shows, without unpacking the world
    "cash": 1000000000, // in cents, or null with no promotion
    "daysSimulated": 95,
    "gameDate": "2026-04-10",
    "label": "Before the big show", // 1-60 characters
    "schemaFingerprint": "ee11af26c283d020881b64555950d42c", // optional; see "Older builds"
    "promotionName": "Test Promotion A", // or null in a sandbox / observer game
    "promotionShortName": "TPA",
    "startDate": "2026-01-05",
    "worldName": "Test Tiny World",
  },
  "savedAt": "2026-11-08T12:00:00.000Z", // real-world time, passed in by the caller
  "state": {
    // the engine state
    "world": {
      "meta": {/* WorldMeta: dates, seed, players, packs, settings */},
      "tables": {
        "people": [/* rows in ascending ID order */],
        "promotions": [],
        // ...one array per table, every table present
      },
    },
    "rng": {}, // RNG stream state
    "tunableOverrides": {}, // per-save tunable overrides
    "traces": {}, // the trace store (bounded)
    "events": [], // the recent domain events
    "failureLog": [], // pipeline step failures
    "commandLog": [], // commands players and computer controllers issued
  },
}
```

- **The world** is the World store's metadata plus every table as an array of
  rows in canonical (ascending ID) order. The game seed is
  `state.world.meta.seed`; it is not repeated anywhere else.
  The metadata also carries `catalogs`, the match types, angle types, win
  methods and finishes snapshotted from the content packs at new game, so a save keeps the
  catalogs its game started with even after the bundled ones change. A save
  written before the field existed loads with `catalogs: {}` (it has no match
  types until a new game is started). Finishes (MTCH2) are an optional
  `catalogs.finishes` entry: a save started before them loads without one and
  has no finishes until a new game is started.
- **The simulation parts** (`rng`, `tunableOverrides`, `traces`, `events`,
  `failureLog`, `commandLog`) are named slots. The engine state that owns
  them supplies their schemas when it saves and loads. A slot without a
  schema accepts any plain JSON value, which is how the save format exists
  before every part of the simulation does. The engine API supplies all six
  (`engineStateParts`, `createEngineSaveDocumentSchema()` and
  `engineLoadOptions()`; see [engine-api.md](engine-api.md#registering-the-parts-with-the-save-format)).
- **The header** repeats a few facts from the world so a slot list never has to
  unpack it. It is rebuilt on every save. A world has no single "player
  promotion" (D-07), so the saver names the promotion shown in the header:
  the saving controller's own, or none in a sandbox or observer game.

`createSaveDocument(state, extras)` is the one way to build a document from an
engine state. `worldToDocument(world, extras)` does the same from a World and
a set of simulation parts.

### What is saved and what is not

| Saved                                          | Not saved                                     |
| ---------------------------------------------- | --------------------------------------------- |
| World metadata and every table row             | Table indexes: derived data, rebuilt on load  |
| Touched RNG streams (untouched ones re-derive) | The sorted-ID caches of each table            |
| Tunable overrides only (never the defaults)    | Tunable defaults: they come from the build    |
| Recent full traces and older trace summaries   | Traces past the store's retention limits      |
| Recent domain events and step failures         | Event subscribers, which register at start-up |

Traces are bounded by the trace store, so a long game doesn't grow its save
with every number ever explained (see
[calculation-traces.md](calculation-traces.md)): each kind keeps at most 200
full traces **and** at most `sim.traceBytesPerKind` (500,000) characters of
them, rivals' worker changes, match gains and ledger rows keep only summaries,
and at most 5,000 summaries are kept in all.

## Size budget

A year of play must stay small enough to save, load and export quickly
(POL4-06). The budget: a 365-day default-world game with **every show carded**
(what rival shows look like once AIP4 books them) saves under **10 MB on
disk**, and saving and loading each take under a second on a desktop.

`test/persistence/yearSaveBudget.test.ts` checks it. It simulates a year twice
(about a minute), so it only runs with `RB_SLOW_TESTS=1`, and prints a size
report by table and by trace kind (`test/support/save-size.ts`). The
per-commit check, `saveBudget.test.ts`, runs three carded months of the roster
world and checks every trace kind stays within its budget and rivals' ledger
rows are summaries.

Measured 2026-11 on a desktop, 365 days of the default world:

| Setup             | Before: JSON / on disk | Save / load   | After: JSON / on disk | Save / load   |
| ----------------- | ---------------------- | ------------- | --------------------- | ------------- |
| No rival cards    | 12.66 MB / 1.20 MB     | 0.45 / 0.52 s | 9.35 MB / 0.93 MB     | 0.43 / 0.48 s |
| Every show carded | 34.58 MB / 3.04 MB     | 1.20 / 1.32 s | 17.26 MB / 1.83 MB    | 0.77 / 0.71 s |

"On disk" is the gzipped bytes in IndexedDB and in an `.rbsave` file. "Save"
is building the document and encoding it; "load" is the whole staged
`loadSave`. With every show carded the rest is mostly tables (segments,
participants, aftermaths and the ledger, about 8 MB) and the full traces each
kind keeps (about 7 MB).

## Bytes: the codec

`encodeSave(doc)` writes **canonical JSON**: object keys sorted at every level,
no whitespace. The same document always gives the same bytes, however its
objects were built, so two runs that reach the same state save identical files.
Before writing, every value is checked to be plain JSON. The schemas already
refuse `NaN` and `Infinity`; the check guards documents built by code that
skipped validation, and names the first bad path (`save.state.rng.position is
not serialisable: it is NaN`).

The JSON is UTF-8 encoded and gzipped with `CompressionStream`, or with fflate
where the browser has no `CompressionStream` (iOS Safari before 16.4). That
exists in browsers, Web Workers and Node 20, so headless tools read and write
exactly the files the game does. Saves in IndexedDB are these same gzipped
bytes, so a slot, an autosave, a backup and an exported file are identical.
Gzip shrinks a save about ten times.

There is no separate version marker for compression: gzip's own first two
bytes (`1f 8b`) are the marker. Decoding reads gzip or plain JSON, so an
uncompressed save (a debug export, or one written before saves were
compressed) still loads.

An **`.rbsave` file is this gzipped document**, nothing more. Decoding also
accepts plain UTF-8 JSON starting with `{` (with an optional BOM), which is how
debug exports are written.

Anything over 128 MB once unpacked is refused. Decompression stops as soon as
it passes the limit, so a hostile or broken file can't fill memory.

## Loading

`loadSave(bytes, registry, options)` runs these stages in order and stops at
the first one that fails. It never throws: every problem comes back as a
report naming the stage, with up to 50 issues (a `truncated` count says how many
more there were), each with a path into the document and a message.

| Stage       | Checks                                                       | Example message                                                                                                                       |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `decode`    | Gzip or UTF-8 JSON, not empty, not truncated, within 128 MB  | "The save could not be unpacked; it is damaged or incomplete (unexpected end of file)."                                               |
| `parse`     | Valid JSON, and the top level is an object                   | "The save is not valid JSON (Unexpected token ...)."                                                                                  |
| `format`    | `format` is `ringside-booker/save`; `formatVersion` is whole | "This is not a Ringside Booker save: format is "other", expected "ringside-booker/save"."                                             |
| `version`   | Not newer than this build, not older than v1                 | "This save was made by a newer version of the game (save format v99; this version reads up to v1). Update the game to load it."       |
| `migrate`   | Each upgrade step runs cleanly                               | "Save migration v1 → v2 "Rename mic to talking" failed: ..."                                                                          |
| `validate`  | The document matches the current schema                      | `state.world.tables.people[12].attributes.mic`: "Too big: expected number to be <=100"                                                |
| `build`     | Rows go into a fresh World; indexes are rebuilt              | `state.world.tables.people[3]`: "repeats the ID per_0000000003, which an earlier row already has"                                     |
| `integrity` | `checkWorld`: references, IDs and invariants                 | `state.world.tables.employments[4].promotionId`: "employments emp_0000000005: promotionId points at missing promotion pro_0000000033" |

`build` comes before `integrity` because the integrity checks need a built
world (invariants read through indexes). The world is only handed out after
`integrity` passes, so the bulk insert that skips the transaction journal can't
leak an invalid state. Integrity warnings (legal but suspicious states) don't
fail the load; they come back in `warnings`.

A successful report carries the World, the validated (and, if it was old,
migrated) document, the migration steps that ran and any warnings.

### Things that warn instead of failing

Some stale data should never make a save unloadable:

- **Unknown or invalid tunable overrides.** A tunable that was removed or had
  its range narrowed would otherwise brick every save that overrides it. The
  `validateTunableOverrides` hook drops those keys; each becomes a warning
  (`state.tunableOverrides["retired.knob"]`) and the game uses the default.
- **Unreadable traces.** The `validateTraces` hook drops traces of a shape the
  build no longer knows. A missing explanation is better than a missing game.

Both hooks run in the `validate` stage, before the schema.

### Reading only the header

`inspectSave(bytes)` runs `decode`, `parse`, `format` and `version`, then checks
only the header and the engine version. Slot lists, file import and slot repair
use it, so they never build a world. It does not migrate, so the header's shape
must stay readable across format versions: add header fields as optional, and
never rename or remove one.

## Versioning

`formatVersion` is a single whole number, `CURRENT_FORMAT_VERSION` in
`migrations/registry.ts`. `engineVersion` is informational: loading never
branches on it.

**Until the first public build is tagged, format v1 is unfrozen.** Schema
changes edit v1 in place and the golden fixture
(`test/fixtures/saves/v1-tiny.json`) is regenerated with
`npm run fixtures:write -w @ringside/engine`. Nobody has saves worth keeping
yet, and a migration per schema tweak would only add noise. A save left behind
by such a change is explained instead of upgraded: see
[Older builds](#older-builds-until-the-format-freezes).

**From the first public build on, every change to any schema bumps
`CURRENT_FORMAT_VERSION` and ships a migration and a fixture.** That covers
entity schemas, world metadata, the header and the simulation parts. The
framework and its tests exist now, so that day is routine.

A save is never partly loaded. A newer save is refused at the `version` stage
with a message saying so; an older one is upgraded first or not at all.

## Older builds (until the format freezes)

While v1 is unfrozen, a build that changes a schema makes yesterday's saves
fail today's load. That is expected, but a list of paths such as
`state.world.tables.people[3]` reads like a bug. So a save says which shape of
data it was written with, and a failed load can tell "made with an older build"
from a real problem.

- **The fingerprint.** `engineSaveSchemaFingerprint()` (`core/api/saveFingerprint.ts`)
  hashes the JSON Schema of the whole save document, every simulation part
  included, to 32 hex characters. Any schema edit changes it. Every save the
  game writes stamps it in the optional header field `schemaFingerprint`. It is
  optional and never renamed, like every header field, and a save without it
  still loads when its data is valid.
- **The guarded stages.** `validate`, `build` and `integrity` are where a
  schema change shows up.
- **The rule.** A load that fails at a guarded stage with a fingerprint that is
  not this build's (a missing one counts as different) is reported as **"Made
  with an older build"**: one sentence, with Export, Delete and Start a new
  game, and no issue list. `classifyLoadFailure` in `persistence/compat.ts`
  decides. A failure with this build's own fingerprint is a real bug and keeps
  the detailed report. Failures at `decode`, `parse`, `format`, `version` and
  `migrate` are never reclassified, so a save from a newer build keeps its own
  message.
- **Only on failure.** A different fingerprint alone means nothing: a save
  from an older build that still passes every check just loads.

The fingerprint is a snapshot in the tests
(`test/fixtures/saves/schema-fingerprint.txt`), so a pull request that changes
any save schema shows it in its diff. `npm run fixtures:write -w @ringside/engine`
updates it with the golden save. The value is not frozen: a zod upgrade can
change the JSON Schema text and with it every fingerprint, which is harmless
because the fingerprint is only read after a load has already failed.

The web tests keep one frozen old save,
`apps/web/src/screens/saves/fixtures/older-build.rbsave` (no fingerprint, and
one row with a field the schema no longer knows). It is never regenerated; it
has to keep failing the same way as the schemas move on.

Once the format is frozen, new changes ship migrations instead and this guard
only covers saves from before the freeze.

## Writing a migration

1. Bump `CURRENT_FORMAT_VERSION`.
2. Add `migrations/vNNNN-to-vNNNN-<slug>.ts`, for example
   `v0001-to-v0002-rename-mic.ts`, exporting one `Migration`:

   ```ts
   export const renameMic: Migration = {
     from: 1,
     to: 2,
     title: 'Rename mic to talking',
     up: (doc) => {
       /* return the upgraded document, built from doc */
     },
   };
   ```

3. Append it to `MIGRATIONS`. The chain must be contiguous: v1 → v2 → v3 ...
   ending at the current version. `assertMigrationChain` checks this when the
   module loads and in a test.
4. Freeze the old fixture: keep `test/fixtures/saves/v1-tiny.json` as it is and
   let the golden test write the new version's fixture next to it. The
   convention test checks that every migration file has a fixture for the
   version it migrates from, and that the fixture loads.

The rules for `up`:

- **Work on plain JSON** (`JsonObject`), never on entity types or zod schemas.
  A v3 → v4 migration has to keep working after the v4 schema changes again
  in v5; importing live types into an old migration is how migrations rot.
  Never import the current schemas inside a migration.
- **Return the upgraded document.** The runner hands each step its own deep
  copy, so a step can never damage the caller's document, and it stamps the
  new `formatVersion` on the result.
- **Fill new fields with the value that keeps old games playing the same**,
  and say in the title what changed. The title shows up in load reports.
- **One step, one version.** Each step runs exactly once, in order. There are
  no "if this field is missing" guards that run on every load.

A step that throws, or returns something that is not a JSON object, stops the
load at the `migrate` stage with the step's title and its error.
