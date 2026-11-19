# JavaScript runtime: ClearScript (V8)

The game runs the embedded engine bundle (`StreamingAssets/engine/engine.js`, see
[engine-host.md](engine-host.md)) in **Microsoft ClearScript 7.5.1.1 with V8 14.7.173.23**, on
Windows x64, Mono scripting backend. Chosen in UNITY-03 (#864).

## How the game uses it

- `Assets/Scripts/Engine/JsEngineHost.cs` (`RingsideBooker.Engine.JsEngineHost`): one V8 runtime
  holding one game. `JsEngineHost.LoadFromStreamingAssets()` (main thread) or
  `JsEngineHost.LoadFromFile(path)` evaluates the bundle. Then:
  - `string Call(string function, params string[] args)` for the synchronous host functions
    (`info`, `configure`, `listWorlds`, `previewWorld`, `newGame`, `query`, `command`,
    `cancelAdvance`, `exportState`, `worldHash`, `unload`). Arguments and results are the JSON
    strings engine-host.md defines; nothing is parsed here.
  - `string CallAsync(string function, string arg = null, Action<string> onProgress = null)` for
    `load`, `save`, `inspectSave`, `advanceDays`. It returns the settled result: V8 runs the promise
    jobs when the outermost call from C# returns, and a small helper script reads the settled
    value. `onProgress` gets each day's progress JSON synchronously on the calling thread; calling
    `Call("cancelAdvance")` or a query from it is fine.
  - Calls are serialised with a lock. Use one thread for a host (a dedicated engine thread; the
    benchmark runs on one). If the first host is created off the main thread, call
    `JsEngineHost.ConfigureNativeSearchPath(Application.dataPath)` on the main thread first (it is
    also done automatically at player start-up).
  - `EvaluateDiagnostic(expr)` evaluates raw JavaScript: diagnostics and tests only.
- Game code does not call `JsEngineHost` directly: it uses `EngineClient` (`EngineClient.cs`,
  types in `EngineTypes.cs`), which owns the host on a dedicated engine thread, queues calls, returns
  `Task<T>` results and raises progress, finished, state-changed and busy events on the main thread.
- Assembly definitions (UNITY-04): `Assets/Scripts/Engine/` is `RingsideBooker.Engine` (auto
  referenced, so `Assembly-CSharp` sees it; it references ClearScript and Newtonsoft explicitly and
  cannot see `Assembly-CSharp`), its `Editor/` folder `RingsideBooker.Engine.Editor`, and the
  EditMode test `Assets/Tests/Engine/` `RingsideBooker.Engine.Tests` (package
  `com.unity.test-framework`).

## Files

| Path                                                          | What                                                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Assets/Plugins/ClearScript/ClearScript.Core.dll`             | NuGet `Microsoft.ClearScript.Core` 7.5.1.1, `lib/netstandard2.1`                                                                                   |
| `Assets/Plugins/ClearScript/ClearScript.V8.dll`               | NuGet `Microsoft.ClearScript.V8` 7.5.1.1, `lib/netstandard2.1`                                                                                     |
| `Assets/Plugins/ClearScript/ClearScript.V8.ICUData.dll`       | NuGet `Microsoft.ClearScript.V8.ICUData` 7.5.1.1 (`lib/netstandard1.0`): ICU data, so `localeCompare(…, 'en')` collates like browsers and Node     |
| `Assets/Plugins/ClearScript/x86_64/ClearScriptV8.win-x64.dll` | NuGet `Microsoft.ClearScript.V8.Native.win-x64` 7.5.1.1 (`runtimes/win-x64/native`): V8 itself. Import settings: Editor (Windows x86_64) and Win64 |
| `Assets/Plugins/ClearScript/LICENSE-ClearScript.txt`          | The packages' licence file: ClearScript plus V8's third-party notices                                                                              |
| `Packages/manifest.json`: `com.unity.nuget.newtonsoft-json`   | Newtonsoft.Json 13, which ClearScript.V8 references (Unity's package, MIT)                                                                         |

The DLLs are in Git LFS (`game/.gitattributes`). The managed DLLs are enabled for the Editor and
Win64 only, like the native one. The player build pulls in `Microsoft.CSharp`,
`Microsoft.Win32.Registry` and `System.Runtime.CompilerServices.Unsafe` from Unity's Mono profile by
itself; the project stays on the .NET Standard 2.1 API level.

**Size:** about 42 MB more in a player build (native V8 29.9 MB, ICU data 10.8 MB, managed 1 MB).

**Updating ClearScript:** download the four `.nupkg` files of the new version from nuget.org (they
are zip files), copy the same four DLLs over these (keep the `.meta` files), replace the licence
file, run the benchmark below in the editor and the player, and update the versions here.

## Measured (UNITY-03, 2026-11-19)

The same bundle (engine 0.1.0) and the same scenario everywhere: default world, seed
`unity-03-runtime`, a founded small promotion with no starter shows, then 365 days, clearing the 28
news alerts that stop the advance (the engine-host test's rule). One run each, on the dev machine
(20 threads) while other Unity agents were working, so read ±10% (a player rerun on the engine thread took 18.9 s, same hashes).

| Runtime                                       | Load bundle | New game | 365-day advance | Hash after new game | Hash after a year  |
| --------------------------------------------- | ----------: | -------: | --------------: | ------------------- | ------------------ |
| **ClearScript V8 14.7, Unity editor (batch)** |      181 ms |   208 ms |      **16.7 s** | `52f6b8728aac6b8c`  | `63d975129dc14ab5` |
| **ClearScript V8 14.7, Windows player**       |      220 ms |   211 ms |      **16.8 s** | `52f6b8728aac6b8c`  | `63d975129dc14ab5` |
| Node 20.20 (V8 11.3), WSL                     |      180 ms |   249 ms |          24.9 s | `52f6b8728aac6b8c`  | `e6e5afe72f9672ae` |
| Node 23.11 (V8 12.9), Windows                 |      127 ms |   231 ms |          22.4 s | `52f6b8728aac6b8c`  | `e6e5afe72f9672ae` |
| Node 24.22 (V8 13.6), WSL                     |      142 ms |   246 ms |          25.5 s | `52f6b8728aac6b8c`  | `23182ba2319c3800` |
| Node 26.3 (V8 14.6), WSL                      |      198 ms |   245 ms |          22.3 s | `52f6b8728aac6b8c`  | `23182ba2319c3800` |
| PuerTS (V8)                                   |           – |        – |               – | not spiked¹         |                    |
| Jint 4                                        |           – |        – |               – | not spiked¹         |                    |

¹ See "Why ClearScript".

Other numbers from the Unity runs: about 46 ms per simulated day, a `save` of the year-old game
(1.37 MB) in about 465 ms, and the 365 progress callbacks into C# cost nothing measurable. The
advance runs on a dedicated thread with a 16 MB stack in the benchmark.

## Determinism

- **Within the game it is deterministic:** the editor and the player give the same hashes, run after
  run.
- **New games match Node exactly** (the exported state is byte-identical), so packs, the RNG, ICU
  collation and the save codec all agree.
- **Long runs drift between JavaScript engine builds, not because of ClearScript.** The engine uses
  `**` (`Math.pow`), and `Math.log`/`Math.cos` (normal draws). Those are not required to be
  correctly rounded, and V8 builds differ in the last bit: Node 20/23 and Node 24/26 already
  disagree (`Math.pow(0.56, 1.5)` is `0.41906562731868147` on V8 ≤ 12.9 and the correctly rounded
  `0.4190656273186815` on V8 ≥ 13.6); ClearScript's V8 also has a different `Math.cos` (V8's
  glibc-derived trig functions) and, for some inputs, `Math.pow`; Edge 157 on Windows differs from
  all of them in `sin`/`cos`/`log`/`exp`. One last-bit difference in a rating moves a later RNG
  draw and the worlds part ways (here between day 30 and day 60).
- So a save moved between the web app and the game loads fine and plays on deterministically in
  each, but the two will not simulate the same future. The fix belongs in the engine, not the
  runtime: deterministic replacements for `pow`/`log`/`cos` (or formulas without them). The C#
  port needs the same, since .NET's `Math.Pow` differs again. Suggested as a follow-up ticket.
- The benchmark prints a **runtime check** (collation plus fingerprints of `pow`, `cos`, `log`,
  `sqrt` over 20,000 inputs) so a runtime change shows up at once:

| Runtime             | collation | pow                | cos                | log                | sqrt               |
| ------------------- | --------- | ------------------ | ------------------ | ------------------ | ------------------ |
| ClearScript V8 14.7 | `aAbBeéZ` | `4809bd5345f9bdd`  | `129aaa028f660138` | `ca963da9441632c6` | `a28adbac1c69a2bb` |
| Node 20/23          | `aAbBeéZ` | `4809bd53c24872cc` | `129aaa028a3ef144` | `ca963da9441632c6` | `a28adbac1c69a2bb` |
| Node 24/26          | `aAbBeéZ` | `4809bd53b50b045`  | `129aaa028a3ef144` | `ca963da9441632c6` | `a28adbac1c69a2bb` |

## Why ClearScript

- **It works in the editor and in a Windows player** with no glue beyond copying DLLs: the bundle
  loads, promises settle when the call returns, delegates work as the progress callback, and it
  runs off the main thread.
- **Fast:** a year in 16.7 s against 22–25 s for Node on the same machine (newer V8, no `vm`
  context in the way).
- **V8 with full ICU**, so the engine's `localeCompare(…, 'en')` tie-breaks behave as in browsers
  (Jint has no full ICU collation).
- **Maintained by Microsoft**, on NuGet, with a `netstandard2.1` build that Unity's Mono takes as is.
- PuerTS (Tencent, V8, BSD-3) was next in line and was not spiked: ClearScript met every
  requirement first, and PuerTS would bring a second binding layer (its own JS loader, `Tick()` for
  the job queue, generated wrappers) for no gain we need today. It stays the fallback if we ever need
  IL2CPP or a console target, which ClearScript does not target. Jint (pure C#) was the fallback
  only if no V8 option worked; an interpreter would be expected to be many times slower on a year skip, and it lacks ICU collation.

**Limits:** Windows x64 only (ClearScript also ships Linux/macOS native packages if needed), Mono
backend only (IL2CPP is untested and not a configuration ClearScript supports).

## Licences

- **ClearScript:** MIT (© Microsoft). **V8:** BSD-3-Clause (© the V8 project authors).
- The native DLL also contains third-party code whose notices are in `LICENSE-ClearScript.txt`:
  FDLIBM, Strongtalk, the GNU C Library (LGPL 2.1, math routines inside V8), ICU (Unicode licence),
  Inspector Protocol, JsonCpp, ProtoBuf, the Wasm C/C++ API, zlib, SipHash, the DFA UTF-8 decoder,
  VTune and valgrind.h. Ship that file with the game (credits/notices screen or next to the exe).
  The LGPL part is satisfied by shipping the notice and keeping V8 in its own replaceable DLL, as it
  is.
- **Newtonsoft.Json:** MIT (Unity package `com.unity.nuget.newtonsoft-json`).

## Benchmark

```bash
npm run build:engine-bundle                       # the bundle, at the repo root
game/tools/engine-benchmark.sh [days]             # batch-mode editor (default 365 days)
game/tools/unity-build-windows.sh && game/tools/engine-benchmark.sh --player [days]
node game/tools/engine-benchmark-node.mjs [days]  # Node, same scenario, one JSON line
```

The Unity side is `RingsideBooker.Engine.EngineBenchmark` (runtime) and
`RingsideBooker.Engine.EditorTools.EngineBenchmarkBatch.Run` (editor entry point). A player started
with `-engineBenchmark [-engineBenchmarkDays N]` runs it before the first scene and quits; every line
it logs starts with `[EngineBenchmark]`. `-engineBenchmarkDump <folder>` also writes `exportState()`
after the new game and after the advance, for diffing against Node.
