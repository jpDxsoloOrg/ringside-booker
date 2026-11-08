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
[calculation-traces.md](calculation-traces.md)).

## Bytes: the codec

`encodeSave(doc)` writes **canonical JSON**: object keys sorted at every level,
no whitespace. The same document always gives the same bytes, however its
objects were built, so two runs that reach the same state save identical files.
Before writing, every value is checked to be plain JSON. The schemas already
refuse `NaN` and `Infinity`; the check guards documents built by code that
skipped validation, and names the first bad path (`save.state.rng.position is
not serialisable: it is NaN`).

The JSON is UTF-8 encoded and gzipped with `CompressionStream`. That exists in
browsers, Web Workers and Node 20, so headless tools read and write exactly the
files the game does.

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
yet, and a migration per schema tweak would only add noise.

**From the first public build on, every change to any schema bumps
`CURRENT_FORMAT_VERSION` and ships a migration and a fixture.** That covers
entity schemas, world metadata, the header and the simulation parts. The
framework and its tests exist now, so that day is routine.

A save is never partly loaded. A newer save is refused at the `version` stage
with a message saying so; an older one is upgraded first or not at all.

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
