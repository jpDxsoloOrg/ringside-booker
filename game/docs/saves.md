# Saves on the desktop (UNITY-05)

Saves are files on disk. The engine writes the save bytes exactly as the web app does (a gzipped
canonical-JSON save document, built inside the bundle), and the game writes those bytes to a file.
A `.rbsave` exported from the web app imports here, and the other way round.

Code: `Assets/Scripts/Saves/` (asmdef `RingsideBooker.Saves`, references `RingsideBooker.Engine`;
auto-referenced, so Assembly-CSharp sees it). Title screen panels:
`Assets/Scripts/UI/Title/TitleSaves.cs` (+ `GameEntry.cs`), styles
`Assets/UI/Saves/Resources/Saves/SaveSlots.uss`. Test: `Assets/Tests/Saves/SaveStoreTests.cs`.

## Where the files are

`Application.persistentDataPath/Saves`, which on Windows is
`%USERPROFILE%\AppData\LocalLow\<company>\Ringside Booker\Saves`. One slot is:

| File                | What it is                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<slot>.rbsave`     | The save, the engine's bytes as they are.                                                                                                                                                                                                 |
| `<slot>.rbsave.bak` | The save before it (one rolling backup). "Load the backup" uses it.                                                                                                                                                                       |
| `<slot>.json`       | The slot's header (`SaveSlotInfo`): label, world, promotion, game date, days simulated, cash, real time saved, engine version, schema fingerprint, format version, size. The load list reads only these, so listing never builds a world. |

The slot id is a slug of the label plus the UTC time it was made (`new-career-20261119-142233`);
it never changes for the slot's life. A `.rbsave` copied into the folder by hand shows up too:
`SaveStore.ListAsync` reads its header with the engine's `inspectSave` (decode, parse, format and
version stages only, no world built) and writes the missing `.json`.

**Atomic writes** (`AtomicFile`): bytes go to `<file>.tmp`, are flushed with write-through, then
`File.Replace` swaps the temp file in and moves the old file to `.bak` in one step. If anything
fails part way, the old save and its backup are untouched and the temp file is removed.

## Saving

`GameSession` is the running game and its slot (one at a time, `GameSession.Current`). It saves:

- **after changes**: every new world revision the engine reports (`OnStateChanged`: an accepted
  command) starts a 750 ms timer (`AutosaveScheduler`, a port of the web's SAVE-01
  `SaveAfterChanges`); a burst of edits writes once. Never during an advance: the timer waits
  while `IsAdvancing`.
- **after an advance** that moved at least one day (`OnAdvanceFinished`), on the same timer.
- **on Main menu**: `ShellController.GoToMainMenu` calls `GameSession.EndCurrent()` before
  `ShellServices.Clear()`, so the final save is queued on the engine thread before the bridge
  unloads the world.
- **on quit**: `QuitGuard` hooks `Application.wantsToQuit`. With unsaved changes or a save still
  writing, it holds the quit (stopping a running advance after its current day), saves, then
  quits; at most 5 s (`QuitGuard.QuitSaveCapMs`). With nothing unsaved it quits at once.

The UI never waits: the engine's `save()` runs on the engine thread (about 0.5 s for a year-old
game), the file write runs on the thread pool, and file writes happen in the order the saves were
asked for.

## Title screen

- **Continue** loads the most recent slot (by real time saved). No slots: a note and New game.
- **Load** lists every slot: label, promotion and game date, saved time and size, with Load,
  Export and Delete (asks first; deletes the backup too). The toolbar has Import a save… and Open
  saves folder. Import and export use the Windows Open / Save As dialogs (`FileDialogs`,
  comdlg32); import checks the file with `inspectSave` and refuses anything that is not a save.
- **New game**: until the wizard (UNITY-09) exists, "Start a default-world game" makes a
  default-world game (a founded promotion in California), saves it to a new slot and enters the
  game. The demo game is still there.
- Entering a game goes through `GameEntry.Handler(client, seat)`; the shell bridge sets it.
  Without it the Game scene opens with the demo shell (the real game still autosaves).

## Made with an older build

The same rule as the web (engine `persistence/compat.ts`, `SaveCompat` here): a load that fails at
the `validate`, `build` or `integrity` stage, for a save whose header `schemaFingerprint` is not
this build's (none counts as different), was made with an older build. The "Made with an older
build" sheet says so in one sentence and offers the web's choices: Copy details (the report plus
both fingerprints), Export this save, Delete this save, Start a new game. Any other failure is a
real problem: the "Could not load" sheet shows the stage and issues, with Copy details, Load the
backup (when there is one), Export and Delete. The load list also tags a slot "Older build" when its
fingerprint differs from this build's (a hint; it may still load).

## History retention on the desktop

The web keeps `history.keepDetailDays` at 28 to stay inside the browser's storage budget. Saves are
files now, so the desktop keeps **90 days** (`DesktopSaveSettings.HistoryKeepDetailDays`): a full
quarter of shows, cards, money rows and rival decisions in detail for history screens and Why?
panels. It is a tunable, so it goes in at new game: `DesktopSaveSettings.ApplyTo(options)` adds
`tunableOverrides: { "history.keepDetailDays": 90 }` unless the options already set it. It is
stored in the world, so a save keeps the value it was made with (a web save loaded here stays at
28). Worlds made with 90 are not byte-identical to web worlds with the same seed (pruning runs on a
different window), which only matters for cross-runtime hash comparisons.

Measured with the same engine bundle on Node (V8), default world, a founded promotion, no player
shows, 365-day skip, gzipped save size and load time:

| Days played | keep 28 (web)             | keep 90 (desktop)         | keep 365              |
| ----------- | ------------------------- | ------------------------- | --------------------- |
| 30          | 0.77 MB                   | 0.78 MB                   | 0.78 MB               |
| 90          | 1.08 MB                   | 1.33 MB                   | 1.33 MB               |
| 180         | 1.21 MB                   | 1.50 MB                   | 1.71 MB               |
| 365         | **1.28 MB** (load 0.63 s) | **1.58 MB** (load 0.73 s) | 2.25 MB (load 0.99 s) |

90 days costs about 0.3 MB (+24 %) and 0.1 s of load time on a year-old save and then levels off,
because older detail is still rolled up into totals. Keeping a whole year would grow the save by
75 % and keep growing with the detail window, for history the screens rarely show.

## Tests

`Assets/Tests/Saves/SaveStoreTests.cs` (asmdef `RingsideBooker.Saves.Tests`, editor only): new game
→ slot file and header written → an advance autosaves → the list shows it (and a lost header is
rebuilt with `inspectSave`) → load → the world hash matches; import refuses a non-save; a write that
throws part way leaves the old file and its backup; the older-build rule. Needs the bundle
(`npm run build:engine-bundle`).

```bash
"$UNITY" -batchmode -nographics -projectPath "$(wslpath -w game)" -runTests -testPlatform EditMode \
  -testFilter RingsideBooker.Saves.Tests -testResults "<win path>.xml" -logFile "<win path>.log"
```
