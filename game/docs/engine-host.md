# Engine host: the embedded engine's API

The game embeds the TypeScript engine (`packages/engine`) as **one JavaScript file** and talks to it
through a small JSON API on the global object, `RingsideEngine`. A C# port of the engine comes later;
until then this file is the boundary between Unity and the simulation.

- Source: `packages/engine-host/` (`src/host.ts` is the API, `src/entry.ts` installs it).
- Built file: `game/Assets/StreamingAssets/engine/engine.js` plus `engine.js.map`. **Generated and
  gitignored**: run `npm run build:engine-bundle` at the repo root (WSL or Windows Node) before
  opening the project or building the player. `--minify` (run the script directly:
  `node packages/engine-host/scripts/build-bundle.mjs --minify`) gives a smaller file.
- Size (engine 0.1.0): about **4.2 MB** unminified (2.5 MB minified), of which about 0.8 MB is the
  inlined content packs. Evaluating it takes about 0.15 s on V8.
- Test: `npm test -w @ringside/engine-host` builds the bundle into a temp folder, evaluates it in a
  bare Node `vm` context (only the language built-ins), starts a default-world game, plays 30 days,
  runs a query and a command, saves, reloads in a second runtime and checks the world hashes match.
  It takes about 20 s, so it is not part of the root `npm test`.

## What the bundle is

- An IIFE script, ES2020 syntax, no `import`/`export`, no `require`, no DOM, no Node APIs. Evaluating
  it once defines `globalThis.RingsideEngine` (frozen) and nothing else of note.
- The content packs (every JSON file under `content/`: `base` and `worlds/default`) are **inlined**,
  so a new game needs no file access. Workshop world mods will come in through a later API
  (a host-provided pack list or `readFile` callback); nothing from a real mod is ever bundled.
- Deterministic: the same seed and the same calls give the same world, byte for byte in the world
  hash, in every runtime that meets the requirements below.

## What the JavaScript runtime must provide

The language built-ins only. Concretely:

| Need                                                                    | Why                                                                                                                              | If missing                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ES2020 syntax and built-ins                                             | the bundle's target                                                                                                              | won't load                                                                                                                                                                                                                  |
| ES2022 built-ins `Array.prototype.at`, `Object.hasOwn`, `Error` `cause` | the engine calls them                                                                                                            | calls fail (Jint 3, ClearScript V8 and PuerTS have them)                                                                                                                                                                    |
| `BigInt`, `DataView.prototype.getBigUint64`                             | money rounding and odds                                                                                                          | calls fail                                                                                                                                                                                                                  |
| Promises and a job (microtask) queue                                    | `load`, `save`, `inspectSave`, `advanceDays` are async                                                                           | see "Async calls" below                                                                                                                                                                                                     |
| `String.prototype.localeCompare` with `'en'` collation                  | a few query sort orders, and two simulation tie-breaks (`boxOffice/formulas/showHeat.ts`, `storylines/formulas/startingHeat.ts`) | a runtime without ICU-style collation (e.g. Jint without full `Intl`) may order two equal-ranked names differently from the web build, so its worlds can drift from a V8 world with the same seed. V8-based runtimes match. |
| `Function` constructor (optional)                                       | zod compiles fast validators with it                                                                                             | zod falls back to its interpreter, a little slower                                                                                                                                                                          |
| `Date`                                                                  | only `save()`'s default `savedAt` (wall clock, header only)                                                                      | pass `savedAt`                                                                                                                                                                                                              |

Shimmed inside the bundle when the runtime lacks them (`info().shims` lists which were installed):

- `TextEncoder` / `TextDecoder` (UTF-8 only, `fatal` supported): the save codec.
- Gzip: the engine uses its bundled `fflate` when `CompressionStream` is missing, so **gzip is done
  inside the bundle**; the C# side never compresses or decompresses saves.
- Base64 for save bytes: written out in the host (no `atob`/`btoa`/`Buffer` needed).

Never needed: timers (`setTimeout`), `MessageChannel`, `performance`, `crypto`, `structuredClone`,
`console`, `fetch`, workers.

## Threading and call rules

- **Single-threaded.** One runtime instance holds one game. Make every call from the thread that
  owns the runtime (a dedicated engine thread is fine, and keeps a long advance off Unity's main
  thread), and **serialise calls**: do not start a call until the previous one has returned (for an
  async call, until its promise has settled).
- The host refuses overlapping work itself: a second `advanceDays`, or `newGame`/`load` during an
  advance, gets `{ ok: false, reasons: [{ code: "busy" }] }`. Queries still work during an advance
  (from the progress callback, for example); commands are refused by the engine while it runs.
- **Async calls** (`load`, `save`, `inspectSave`, `advanceDays`) return a `Promise` that resolves to
  the JSON string and never rejects. They wait only on promise jobs, never on timers or I/O, so
  draining the runtime's job queue settles them:
  - ClearScript V8: the queue drains when the outermost call returns; read the result in a `.then`
    callback or await it with `ScriptObject.InvokeAsFunction` plus `ToTask()`.
  - Jint: `engine.Invoke(...)` then `JsValue.UnwrapIfPromise()` (runs the queue and returns the value).
  - PuerTS / other V8 or QuickJS hosts: run pending jobs (`JS_ExecutePendingJob` loop) after the call.
- **Progress**: `advanceDays(optionsJson, onProgress)` calls `onProgress(progressJson)`
  synchronously once after every simulated day, on the engine thread, before the next day starts.
  Keep the callback cheap (post the JSON to the UI thread). Cancel by calling
  `RingsideEngine.cancelAdvance()`, from the callback or between job-queue turns; the advance stops
  after the day it is on and reports `stoppedBy: { kind: "cancelled" }`.
- **Revision**: every result carries `revision`, a counter that goes up whenever the world changes
  (a day simulated, a command applied, a game installed or unloaded). Cache query results by it.

## Conventions

- Every argument is a JSON string (or omitted, meaning `{}`); every result is a JSON string.
- Nothing throws across the boundary. Bad JSON, a call before a game is loaded or an engine fault
  comes back as `{ "ok": false, "reasons": [Reason, ...], "revision": n }`.
- A `Reason` is `{ "code": string, "message": string, ... }`. Host codes: `noWorld` (no game loaded),
  `busy` (an advance is running), `invalidArgs` (bad JSON or a bad argument), `internal` (a bug).
  Engine queries and commands add their own codes.
- Dates are game dates, `"YYYY-MM-DD"`.

## Functions

### `info()` → JSON

```json
{
  "engineVersion": "0.1.0",
  "hostApiVersion": 1,
  "saveFormatVersion": 1,
  "schemaFingerprint": "0a9b98cd…",
  "shims": ["TextEncoder", "TextDecoder"],
  "debugChecks": false,
  "worldLoaded": false,
  "revision": 0
}
```

`hostApiVersion` goes up when a function, argument or result shape here changes.

### `configure(optionsJson)` → JSON

`{ "debugChecks": true }` turns on the engine's plain-JSON checks of every result (slower; for
development builds). Takes effect for the next `newGame` or `load`. Returns `{ "ok": true, "debugChecks": bool }`.

### `listWorlds()` → JSON

`{ "ok": true, "packs": [PackManifest, ...], "issues": [PackIssue, ...] }`: the manifests of the
bundled world packs (`kind: "world"`; today just `default-world`). `issues` lists bundled packs
that would not read (normally empty).

### `previewWorld(rootPackId)` → JSON

The new-game wizard's preview of a world pack: `{ "ok": true, "value": WorldPreview, "issues": [...] }`
(promotions you can take over, regions, settings, start date) or `{ "ok": false, "issues": [...] }`.
Same shape as the web app's wizard uses (`previewWorld` in the engine).

### `newGame(optionsJson)` → JSON

Builds a new world from the bundled packs and makes it the running game. Input is the engine's
new-game input (see `packages/engine/src/systems/newgame/input.ts`); `playerId` is optional and
defaults to `"local"`:

```json
{
  "rootPackId": "default-world",
  "seed": "any text, 1-64 characters",
  "playerName": "Alex Booker",
  "saveName": "My career",
  "seasonLength": { "preset": "12m" },
  "player": { "mode": "existing", "promotionKey": "pro-flagship" },
  "settings": {},
  "startDate": "2027-01-04",
  "tunableOverrides": {}
}
```

or `"player": { "mode": "found", "name": "...", "shortName": "BTW", "homeRegionKey": "us-california", "style": "traditional", "size": "small", "color": "#335577", "starterKit": true, "weeklyShowDay": 3 }`.

Result: `{ "ok": true, "summary": NewGameSummary, "seat": LocalSeat, "warnings": [string], "revision": n }`
or `{ "ok": false, "reasons": [...] }` (each reason may name the `field` it is about). A refused new
game leaves the running game (if any) as it was.

`LocalSeat` is who this machine plays as: `{ "viewer": Viewer, "controller": Controller, "promotionId": string | null }`.
The host resolves it whenever a game is installed (the lowest human player id in the world) and
passes it to every query and command, exactly like the web app's worker host.

### `load(save)` → Promise of JSON

`save` is **base64 text** of the save file's bytes (or a JS byte array / `Uint8Array`). The bytes are
the same save file the web app writes and exports: a gzipped canonical-JSON save document (plain
JSON starting with `{` also loads). The engine checks it stage by stage (decode, parse, format,
version, migrate, validate, build, integrity). Success:

```json
{
  "ok": true,
  "summary": {
    "label": "My career",
    "seat": LocalSeat,
    "promotionName": "Bundle Test Wrestling",
    "gameDate": "2027-02-03",
    "migrationsApplied": []
  },
  "warnings": [{ "path": "", "message": "..." }],
  "revision": 7
}
```

Failure: `{ "ok": false, "stage": "decode" | "parse" | "format" | "version" | "migrate" | "validate" | "build" | "integrity", "issues": [{ "path", "message" }], "truncated": n, "revision": n }`.
A failed load leaves the running game as it was.

### `save(optionsJson?)` → Promise of JSON

Options: `{ "label"?: string, "savedAt"?: ISO date-time }`. `label` defaults to the world's name and
goes in the save header (cut to the header's limit); `savedAt` defaults to the runtime's clock.
Result:

```json
{ "ok": true, "base64": "H4sI…", "byteLength": 807361, "header": SaveHeader, "revision": 31 }
```

Decode `base64` and write the bytes to disk as they are; that file loads in `load` and in the web
app. The same game and options always give the same bytes. A 30-day default-world game is about
0.8 MB.

### `inspectSave(save)` → Promise of JSON

Reads a save's header without loading it (for a load screen): the engine's `InspectReport`,
`{ "ok": true, "header": SaveHeader, ... }` or `{ "ok": false, "stage", "issues", ... }`.

### `query(name, argsJson?, viewerJson?)` → JSON

Runs an engine query, by default for the local seat's viewer; pass a `Viewer` JSON to ask as
someone else (`{ "kind": "omniscient" }` for debugging tools). Result:
`{ "revision": n, "result": { "ok": true, "data": ... } | { "ok": false, "reasons": [...] } }`.
Example: `query("clock.get", "{}")` → `{"revision":31,"result":{"ok":true,"data":{"date":"2027-02-03","weekday":2,"dayNumber":31}}}`.
Query names and shapes are the engine's (`QueryMap`, see `docs/design/engine-api.md`), the same the
web screens use.

### `command(name, argsJson?)` → JSON

Runs an engine command as the local seat's controller, all or nothing. Result:
`{ "revision": n, "result": { "ok": true, "data": ..., "events": [{ "type", "seq" }] } | { "ok": false, "reasons": [...] } }`.
`revision` goes up only when the command was applied. Example: `command("news.ackAlerts", "{}")`
clears a pending news alert so the next advance can run.

### `advanceDays(optionsJson, onProgress?)` → Promise of JSON

Options: `{ "maxDays": 1..3650, "stopAtDate"?: "YYYY-MM-DD" }`. Simulates up to `maxDays` days,
stopping early at a gate (a decision the player must make first), at `stopAtDate` or on cancel.

Each progress call gets:

```json
{
  "daysDone": 3,
  "daysRequested": 30,
  "date": "2027-01-06",
  "currentDate": "2027-01-07",
  "revision": 4
}
```

(`date` is the day just simulated, `currentDate` the world's date now.) The result is the engine's
advance report plus `ok` and `revision`:

```json
{
  "ok": true,
  "startDate": "2027-01-04",
  "endDate": "2027-01-09",
  "daysAdvanced": 5,
  "stoppedBy": {
    "kind": "gate",
    "hits": [
      {
        "gateId": "news.alert",
        "reason": "News: Title change – …",
        "subject": { "kind": "news", "id": "nws_…" },
        "actionHint": "news"
      }
    ]
  },
  "failures": [],
  "eventsPublished": 316,
  "timing": { "ms": 0 },
  "revision": 6
}
```

`stoppedBy.kind` is `completed`, `gate` (with the gates that stopped the day: e.g. `shows.tonight`
when the player's show has no card, `news.alert` for an alert the player has not cleared) or
`cancelled`. `failures` lists steps that failed (the day still ran). `timing` is not deterministic.
Bad options come back as `invalidArgs`.

### `cancelAdvance()` → JSON

`{ "ok": true, "cancelled": bool }`: asks the running advance to stop after its current day.

### `exportState()` → JSON

`{ "ok": true, "state": EngineState, "revision": n }`: the whole game as plain JSON (debugging,
tools). Large (several MB); prefer queries for UI.

### `worldHash()` → JSON

`{ "ok": true, "hash": "16 hex digits", "revision": n }`: the engine's world hash, the same value the
web app and the headless runner print for the same game. Two runtimes that made the same calls agree.

### `unload()` → JSON

Stops the running game: every world call after it gets `noWorld` until `newGame` or `load`.
Returns `{ "ok": true, "revision": n }`.

## Example (C#, ClearScript V8 shape)

```csharp
engine.Execute(File.ReadAllText(Path.Combine(Application.streamingAssetsPath, "engine/engine.js")));
dynamic api = engine.Script.RingsideEngine;
string created = api.newGame(JsonUtility.ToJson(options));
dynamic pending = api.advanceDays("{\"maxDays\":7}", new Action<string>(p => progressQueue.Enqueue(p)));
string report = await ((object)pending).ToTask() as string;   // settles when the job queue drains
string saveJson = await ((object)api.save("{}")).ToTask() as string;
// parse saveJson, Convert.FromBase64String(base64), File.WriteAllBytes(path, bytes)
```
