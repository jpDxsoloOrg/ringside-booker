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

| File              | What it is                                                                                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<slot>.rbsave`   | The save, the engine's bytes as they are.                                                                                                                                                                                                                                           |
| `Backups/<slot>/` | The slot's rotating backups (UNITY-27): `<backup id>.rbsave` + `<backup id>.json` (the header it had). See "Backups".                                                                                                                                                               |
| `<slot>.json`     | The slot's header (`SaveSlotInfo`): label, world, promotion, game date, days simulated, cash, real time saved, engine version, schema fingerprint, format version, size, and the game build's version and channel. The load list reads only these, so listing never builds a world. |

The slot id is a slug of the label plus the UTC time it was made (`new-career-20261119-142233`);
it never changes for the slot's life. A `.rbsave` copied into the folder by hand shows up too:
`SaveStore.ListAsync` reads its header with the engine's `inspectSave` (decode, parse, format and
version stages only, no world built) and writes the missing `.json`.

**Atomic writes** (`AtomicFile`): bytes go to `<file>.tmp`, are flushed with write-through, read
back and compared byte for byte, then `File.Replace` swaps the temp file in and moves the old save
into the backups folder in one step. If anything fails part way, the old save and its backups are
untouched and the temp file is removed.

## Backups (UNITY-27)

Every save of a slot moves the save it replaces into `Backups/<slot>/<backup id>.rbsave` (the id is
the UTC time it became a backup, `20261119-142233-123`, so ids sort oldest first) and copies the
slot header it had to `<backup id>.json`. After the write, backups beyond the setting are deleted,
oldest first. The setting is **Backups per save** in Settings (1, 3, 5 or 10; default 5; PlayerPrefs
`rb.saves.backupsPerSlot`, `SaveSettings.BackupsPerSlot`). The single `<slot>.rbsave.bak` of older
builds is moved into the folder as the oldest backup the first time the slot is listed or written.

- **API:** `SaveStore.ListBackups(slotId)` → `SaveBackupInfo` newest first (`BackupId`, `GameDate`,
  `SavedAt`, `SizeBytes`, `Info` = the header, `NeedsInspect` when the header was lost);
  `ListBackupsAsync(client, slotId)` also reads lost headers with `inspectSave`;
  `SaveStore.LoadBackup(slotId, backupId)` → the bytes; `GameSession.OpenBackupAsync(client, slot,
backupId, store?)` → `OpenResult` (loads it as the running game of that slot). The slot's latest save
  stays until the game saves over it; then it becomes a backup itself.
- **Load screen:** each slot has **Backups (n)**: a side sheet with every backup, newest first (game
  date, real time saved, size), each with **Load this backup**, which asks first ("Load the backup
  from Jan 7, 2027? Your latest save stays in the slot until you save over it."). The "Could not
  load" sheet lists every backup the same way.

## Checked before and after writing (POL1-04)

- **Before:** `SaveVerifier.Check(bytes, header, fingerprint)` runs on the thread pool (never on the
  engine thread): the gzip unpacks to its end, the JSON reads to its end, `format` is
  `ringside-booker/save`, and the header's label, game date and schema fingerprint are the ones the
  engine reported and this build's. A save that fails is not written: "This save did not check out,
  so nothing was replaced. Your previous save and backups are untouched."
- **After:** the temp file is read back and compared with the bytes before it replaces the save
  (`SaveVerifyException`, same message).
- **"Last saved" chip:** in the top bar before the scoreboard, "Saved 11 Jan" (the game date of the
  last save), with when, how (autosave, new game, on exit, loaded, loaded from a backup) and how many
  backups the slot keeps on hover. A failed save shows "Not saved" in the warning colour with the
  reason. `GameSession.LastSaveKind`, `LastProblem`, `GameSession.CurrentChanged`.

## Build stamp (POL9-10)

Every slot header this build writes records `BuildVersion` and `BuildChannel` from `ReleaseInfo`
(`SaveBuild.Set`, called at start-up by `UI/SaveUi/SaveBuildHook.cs`, because the Saves assembly
cannot see the game's assembly). The Load list tags saves an Alpha build wrote with a quiet "Alpha".
The stamp lives in the slot header (`<slot>.json`), not inside the engine's save document: a new
header field there would change the save schema fingerprint. An imported or exported `.rbsave`
therefore carries no build stamp.

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
real problem: the "Could not load" sheet shows the stage and issues, with Copy details, every
backup (newest first), Export and Delete. The load list also tags a slot "Older build" when its
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

`Assets/Tests/Saves/SaveBackupsTests.cs` (Sprint 13): rotation keeps the newest N and prunes when N
drops, the old `.bak` becomes a backup, a write that does not read back replaces nothing,
`SaveVerifier` refuses cut-off, broken, relabelled or other-fingerprint bytes, the slot header keeps
the build's channel and version, and on a real game: the save carries the fingerprint, a save with
no fingerprint that fails `validate` opens as OlderBuild, the same failure with this build's
fingerprint is Failed, and a backup still loads. `Assets/Tests/Editor/SaveUi/LastSavedChipTests.cs`:
the chip's words.

Tour: `RingsideBooker.exe -screen-width W -screen-height H -screen-fullscreen 0 -rbSaveShots "<win
dir>"` (`Screens/Dev/SaveShots.cs`): chip, Load (Alpha tag when StreamingAssets has a version.json
with channel alpha), Backups sheet, confirm, Settings, could-not-load with backups. It deletes its
own slot at the end.

`Assets/Tests/Saves/SaveStoreTests.cs` (asmdef `RingsideBooker.Saves.Tests`, editor only): new game
→ slot file and header written → an advance autosaves → the list shows it (and a lost header is
rebuilt with `inspectSave`) → load → the world hash matches; import refuses a non-save; a write that
throws part way leaves the old file and its backup; the older-build rule. Needs the bundle
(`npm run build:engine-bundle`).

```bash
"$UNITY" -batchmode -nographics -projectPath "$(wslpath -w game)" -runTests -testPlatform EditMode \
  -testFilter RingsideBooker.Saves.Tests -testResults "<win path>.xml" -logFile "<win path>.log"
```
