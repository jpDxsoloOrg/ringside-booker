# Workshop world mod import (UNITY-06)

The Windows game imports the community **workshop world mods** straight from the player's Steam
folder: a mod is a folder holding one SQLite database (`<World>.db`) and a picture folder (plus a
`skin/` folder, which is never read). Nothing from a mod is ever copied into the repo or the build;
tests use generated fictional databases.

## Flow

```
Steam libraries ──► installed mods ──► temp copy of the .db ──► JSON rows ──► engine bundle
 (SteamLibraries)   (WorkshopModScanner)  (WorldModDatabase)    (SqliteJsonReader)  importWorldMod
                                                                                     │ convert + check
                                                                                     ▼
                                    PictureProvider ◄── imageRef "wm/…" ◄── world pack ──► newGame
                                    (reads files in place)
```

1. **Find Steam** (`Assets/Scripts/Import/Steam/SteamLibraries.cs`): the registry
   (`HKCU\Software\Valve\Steam\SteamPath`, then `HKLM\…\Valve\Steam\InstallPath`, through advapi32
   because `Microsoft.Win32.Registry` is not in Unity's profile), then
   `C:\Program Files (x86)\Steam`; every library in `steamapps\libraryfolders.vdf` (and the old
   `config\libraryfolders.vdf`), parsed by `VdfParser`.
2. **List mods** (`WorkshopModScanner`): `<library>\steamapps\workshop\content\1157700\<item id>\`
   folders with a `.db` at the top level. The world name, start date and picture folder name come
   from the database's `gameworld` row.
3. **Read the database** (`WorldModDatabase`): the `.db` and, when non-empty, its `-wal` journal
   are copied to a private temp folder and opened there, so SQLite replays the journal and the
   Steam folder is never locked or written. The 18 world tables plus about 30 counted-only tables
   are written as `{ "table": [ {column: value} ] }` JSON (`SqliteJsonReader`): integers and reals
   become numbers, text strings, NULL null; blobs are skipped. The test mod (3,822 people) reads in
   under 0.2 s and makes about 11 MB of JSON.
4. **Convert and check** in the engine bundle: `RingsideEngine.importWorldMod(json)`
   (`packages/engine-host/src/worldMod/`). It maps the rows to a `world` data pack that depends on
   the bundled `base` pack, then runs the same pack loader a new game runs (resolve, merge, record
   schemas, references, materialise) and returns a report. The pack is kept in the runtime for the
   session; `listWorlds` marks it `imported`. About 0.8 s in the editor for the test mod.
5. **New game**: `newGame({ rootPackId: "wm-<item id>", … })`, exactly like the bundled world. Saves
   are self-contained: a save of an imported world loads in a fresh runtime without the mod.

**SQLite library.** The official `sqlite3.dll` 3.54.1 (win-x64, public domain) in
`Assets/Plugins/Sqlite/x86_64/` (Git LFS, Editor + Win64 x86_64), called through a thin P/Invoke
wrapper (`Assets/Scripts/Import/Sqlite/`). Chosen over Microsoft.Data.Sqlite + SQLitePCLRaw: one
native file, no managed dependency chain, nothing that needs dynamic provider loading under Mono.

**Code layout.** `Assets/Scripts/Import/` is its own assembly (`RingsideBooker.Import`, no engine
dependency); `WorldModImporter.Import(mod, rosterOnly, json => host.Call("importWorldMod", json))`
takes the engine call as a delegate. EditMode tests: `Assets/Tests/Import/`.

## Pictures: read in place, roster-only option

Engine image references only allow `[A-Za-z0-9._-]` path segments, while mod file names hold
spaces, `%20` escapes and other characters. The converter writes `wm/` + a reversible encoding of
the path inside the picture folder (`_` → `__`, space → `_s`, any other character → `_x<hex>_`;
`%XX` escapes are decoded first): `people/Big Dog (2).png` → `wm/people/Big_sDog_s_x28_2_x29_.png`.
`PictureRef.Decode` (C#) undoes it and refuses anything that would leave the folder.

`PictureProvider(pictureFolder, rosterOnly)` maps a reference to a `Texture2D`, reading the file
from the mod folder the first time it is shown (no copy, no size budget), caching per reference,
and returning a grey placeholder for a missing or undecodable file. Folders referenced: `people/`
(the `workerpictures` alternate in force on the start date wins over `workers.picture`), `logos/`
(promotions and brands), `titles/`, `venues/`, `events/`, `network/`. **Roster only** passes
`rosterOnly: true`: the pack has no picture references at all and the provider never touches disk.
The game must remember the mod folder for a save (the save holds only the references).

## Mapping

Keys are stable per source id (`wm-w<workerID>`, `wm-p<promotionID>`, `wm-t<titleID>`,
`wm-th<titleHistoryID>`, `wm-k<contractID>`, …), so re-importing the same mod gives the same keys.
Display names are kept exactly; no name filtering runs on an imported world. Every enum table is in
`packages/engine-host/src/worldMod/mapping.ts`; an unknown value maps to a default and is reported
once as `unknown-<field>`.

| Source                            | Engine            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gameworld`                       | manifest          | name, `startDate` (else `currentDate`), version `<databaseVersion>.0.0`, description, author "Workshop world mod"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `countries`                       | country           | matched to a base country by name (plus aliases such as USA, UK, England); otherwise added with a generated unique code, economy × 0.75, only when some imported record uses it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `regions`                         | region            | in a matched country: same-name base region reused, others added, and the base regions they replace patched to population 0 (no double counting); in an added country: all added (or one whole-country region)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `workers`                         | person            | name split into given/family; type → role (Wrestler, Occasional Wrestler, Referee, Announcer, Staff → producer, Personality → manager; someone who wrestles in the mod is a wrestler whatever their type, see below); style → ring style (non-wrestlers get `nonWrestler`); status, gender, build, height/weight words → cm/kg (women shorter and lighter); skills → attributes (ringwork = wrestlingSkill, mic = entertainment, charisma = starPower, presence = max(intimidation, sexAppeal), athleticism = mean(ringwork, stamina), officiating/broadcasting/producing from refereeing/commentary/agent); conditions (0 = unset → 100); six continent popularities spread to every populated region of that continent; personality flags → traits (max 8, no clashing pairs); drink/drugs → vices; drive → motivation; canBeOwner/Booker → career |
| `workers` dates                   |                   | people born after the start date are left out; a debut after the start date is kept (the engine holds them back until then); a debut before age 14 moves to the 14th birthday                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `promotions`                      | promotion         | Active → active; Inactive → closed, or left out when it only opens after the start; style, prestige, money, owner/booker/parent; production levels and expense policies derived from prestige when the mod leaves them unset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `brands`                          | brand             | priority in source order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `contracts`                       | employment        | role from the person; Face/Heel → alignment; push words → push (crew `none`); PPA → per appearance, development and tour flags; a second exclusive contract becomes non-exclusive; an expiry already past is extended four weeks; "No Expiry" → open-ended                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `titles`, `titlehistory`          | title, titleReign | Singles/Tag/Trios → 1/2/3 holders; Men/Women → division; weight words → max kg; inactive → retired (on the last reign's end); current champions from `titles.currentChampion*`; reigns with missing holders, wrong holder counts or overlaps are left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tagteams`                        | team              | two-person tag teams; formed on the later debut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `venues`                          | venue             | kind from type and capacity; venues opening later or already closed are left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `events`, `eventDates`            | eventDefinition   | Weekly (weekday flags), Monthly, Annual (week 5 → last), Tour/Specific → the listed dates on or after the start (yearly ones, `repeatAnnually`, rolled forward to the coming 10 years); importance Huge/High/Normal/Low/Unimportant → flagship/major/regular/minor/house; televised when a live TV deal names it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `networks`, `networkAvailability` | network           | type → tv/ppv/streaming; size → reach tier; coverage by continent, country and region                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `networkDeals`                    | deal              | live deals only; income per show/viewer, cost per show; airday → weekday                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Places, shows and roles (UNITY-36, 37, 39).** The mods store places two ways: venues and the
map tables use numeric ids, while promotions, people and shows hold the country and region _names_
as text (empty text for none). Every location column is read as an id when it is a number and as a
name otherwise (`placeRef` in `geography.ts`; names matched to the mod's countries, with the
country aliases, and to regions inside that country). A record that ends up placed only by its
continent (the continent's most populous base region) is reported: `continent-fallback-no-place`
when it gives only a continent, `continent-fallback-unknown-place` when it names a country or
region the mod's map does not have. Each left-out show says why: `inactive-event` (the mod marks it
not running), `event-of-future-promotion` (its promotion opens after the start date; the engine
cannot open promotions later yet), `event-without-promotion` (its promotion is not in the mod at
all), `event-of-skipped-promotion`, `no-future-dates` (a one-off that is over) and
`unknown-recurrence`; yearly shows moved forward are listed as `yearly-dates-rolled-forward`.
Someone listed as Personality, Staff, Announcer or Referee who wrestles in the mod (a contract
with a wrestling push, a title held now, an active tag team, or a part-time personality with a
ring style) is imported as a wrestler (with a push) or an occasional wrestler, with the listed job
kept as a second role; each guess is reported as `role-guessed-<role>`.

**Rows the engine's checks refuse (UNITY-12).** Installed mods carry data the engine's
cross-record rules do not allow. The converter fixes the shapes seen so far, each reported as a
warning: a second contract between the same person and promotion is left out
(`duplicate-contract`); an exclusive contract held next to other contracts becomes non-exclusive
(`exclusive-alongside-other-contracts`); an active tag team with a member who has died is imported
inactive (`team-member-deceased`). Anything else the pack loader refuses is handled by the import
check (`packages/engine-host/src/worldMod/check.ts`): every error that names a record of the mod's
pack drops that record (warning `check-<rule>`, e.g. `check-teams.deceasedMember`, with
`kind:key` examples) and the pack is loaded again (up to 8 rounds, so records that pointed at a
dropped one fall out too). Only a problem not tied to a mod record (manifest, pack resolution, no
start date) fails the import; the failure carries `ruleCounts` (rule → count).

**Not imported** (listed once in the report): stables, relationships, chemistry, alter egos,
gimmicks, match gimmicks, angle templates, random events, future pictures and owners, promotion
relationships, worker descriptions and other fields with no engine home, and any saved-game state
tables that have rows.

## Commands

```bash
npm run build:engine-bundle                     # engine.js with importWorldMod into StreamingAssets
game/tools/world-mod-import.sh '<mod folder>'   # batch smoke: import, new game, 7 days, pictures
game/tools/world-mod-import.sh --roster-only    # first installed mod found, no pictures
game/tools/unity-test-editmode.sh RingsideBooker.Import.Tests
npx vitest run --config packages/engine-host/vitest.config.ts packages/engine-host/test/worldMod.test.ts
```

Editor menu: **Ringside Booker → Import Workshop World Mod…** (folder picker) and **List Installed
Workshop World Mods**. Logs from the smoke path carry counts and timings only.

## In the game (UNITY-12)

New game lists the bundled world and the workshop worlds imported this session (the engine keeps an
imported pack until the game quits), plus **Import a workshop world…**: a sub-screen with the
installed mods in a scrollable list (world name, start date, people and promotion counts, database
size; add-on mods with no people or promotions are shown greyed out as "not a world"), the
**Roster only (no pictures)** toggle, **Import** with progress (reading, then converting and
checking), and the report (what was skipped or adjusted, by count). **Use this world** goes back to
New game with it selected; **Back** and Esc return to the world list. A failed import shows a
readable reason and **Copy details** (outcome, reason codes, the engine's first problems, warning
codes, counts, timings) for the player's clipboard. Player.log gets one line per import:
`[WorkshopWorlds] import ok|failed (item <id>): <reason codes or warning codes>; counts…` — item
ids, codes and counts only, never names.

Dev flags on the player: `-rbImportCheck [all|<id>,<id>…] [-rbImportCheckShots <folder>]` imports
every installed world mod (logs `[ImportCheck]` per item, exit 0 when all import; with shots the
first goes through the real sub-screen and an add-on mod is forced through to capture the failure
screen); `-rbSkipCheck 30 -rbSkipCheckWorkshop <item id>` imports that mod and plays it, and
`-rbSkipCheckSpeed full|fast` starts that game with the Big world speed setting (POL4-13). Screenshots
and the skip check's log show mod names: keep them local.

## Kept across restarts (UNITY-14)

After an import the game stores the converted world: the engine's `exportImportedWorld` answer,
gzipped, at `persistentDataPath/Worlds/<pack id>/pack.json.gz`, plus `Worlds/index.json` (world name,
start date, workshop item id, mod folder, database and picture folder, roster only, import date, the
database's last write time, counts, the import summary). Code: `Saves/ImportedWorldStore.cs`
(`StoredWorld`, `List`, `Save`, `ReadPack`, `Remove`, `ModState`, `StoreFromEngineAsync`,
`RegisterAsync`) and `Screens/WorkshopWorlds.cs` (`Store`, `EnsureRegisteredAsync`,
`RemoveStoredAsync`, `StoredDetail`, `ModNote`).

- **Why the pack and not a silent re-import.** Measured on the owner's test mod (3,576 people) in the
  packaged player: re-importing reads the database in 185 ms and converts and checks it in 804 ms,
  needs the mod installed, and would silently change the world when the mod updates. The stored pack
  is 5.3 MB of JSON, 0.6 MB on disk (export 25 ms, gzip and write 115 ms after an import); putting it
  back takes 30 ms to read and 41 ms to register. Previewing the world (the full checks) takes about
  0.8 s either way.
- **Start-up does no work.** New game reads only the index; a stored world goes back into the engine
  when it is picked (Next / preview, or a new game), so the title screen never waits on it.
- New game lists stored worlds under "Imported workshop worlds" with "Imported <date> · starts … ·
  people · promotions · roster only" and the import summary as the notice.
- **Manage imported worlds…** (`import-manage` on the import sub-screen; elements
  `stored-world-list`, `stored-<item id>`, `stored-reimport-<item id>`, `stored-remove-<item id>`
  (press twice), `manage-back`): each kept world with its detail, a note when the mod has updated
  since the import (the database's last write time changed) or is no longer installed, **Re-import**
  (when the mod is installed: imports it again with the same roster-only choice and replaces the
  stored world) and **Remove** (deletes the files and forgets it in the engine; saves of it still
  load, a save carries its world).
- **Pictures** still load in place from the mod folder. When the mod moved to another library, the
  scan updates the stored folders (by item id) and saves follow them through the stored world. When
  it is gone, portraits and logos show placeholders, New game notes it and Roster shows a note
  (`roster-pictures-note`, `WorkshopWorlds.CurrentPicturesNote`).
- `WorkshopWorlds.ImportAsync(..., keep: false)` imports without storing (the import check uses it).
- Dev flag: `-rbSkipCheck 7 -rbSkipCheckStored <item id> [-rbSkipCheckShots <folder>]` plays a stored
  world after a restart without importing (with shots: the world list and Manage imported worlds).
- Test: `game/tools/unity-test-editmode.sh RingsideBooker.Saves.Tests.ImportedWorldStoreTests` (a
  generated fictional world mod, `Assets/Tests/Saves/Fixtures/fictional-world-mod.json`, from
  `packages/engine-host/test/worldModFixture.ts`).

## Your own folders (UNITY-34)

The import sub-screen has a quiet **Choose a folder…** button (`import-choose-folder`, next to
Manage imported worlds… in `import-extras`). It opens the Windows folder picker
(`Saves/FileDialogs.PickFolder`: the shell's file dialog in pick-folders mode, called through its
vtable, so it does not need the runtime's COM interop).

- **What qualifies** (`Import/ModFolders.cs`, `ModFolders.Inspect(folder)` → `FolderCheck {Folder,
Mods, Problem}`): a folder with the mod's database (the same top-level `.db` the Steam scan looks
  for); the picture folder is optional (the mod row then says "no picture folder"). A folder with no
  database of its own may hold several mods one level down, and each is listed. Otherwise the plain
  message `ModFolders.NoDatabaseProblem` (or `MissingFolderProblem`) shows under the button
  (`import-folder-problem`) and the folder is not remembered.
- **Ids.** A folder named by a workshop item id keeps it (`wm-<id>`, the same world as the scanned
  one). Any other folder gets `f` + 12 hex of a hash of its full path (`ModFolders.ItemIdFor`), so
  ids, logs and element names never carry a folder's name.
- **Import** is the same as for a scanned mod: `WorkshopWorlds.ImportAsync` with the `WorkshopMod`,
  the stored world keeps the chosen folder, and `PictureProvider` reads pictures in place.
- **Remembered** in the import settings, `persistentDataPath/import-settings.json`
  (`{"folders": [...]}`, `ImportFolderSettings`; never in a save). The list shows under **Your
  folders** (`your-folders`, heads `folder-<n>` with the path and a **Remove** link
  `folder-remove-<n>`; Remove only forgets the folder). A remembered folder that is gone or empty
  shows its problem under its path.
- API: `WorkshopWorlds.Folders`, `ScanFoldersAsync()`, `AddFolderAsync(folder)`, `RemoveFolder(folder)`,
  `SkipSteamScan` (tours); wizard `AddFolder(folder)`, `RemoveFolder(folder)`, `YourFolders`,
  `FolderProblem`.
- Tests: `game/tools/unity-test-editmode.sh RingsideBooker.Import.Tests.ModFoldersTests` (generated
  fictional databases in a temp folder).
- Tour: `python3 game/tools/make-fictional-mod-folders.py <dir>` writes fictional mod folders (one mod,
  a folder of two, a folder with no database) from the fictional test world; then
  `RingsideBooker.exe -screen-width W -screen-height H -screen-fullscreen 0 -rbFolderShots "<win dir>"
-rbFolderShotsMods "<win dir>"` (`Screens/Dev/FolderImportShots.cs`; Steam scan off, 6 PNGs, exit 0
  = PASSED). It forgets the folders it added and removes the world it stored.

## Known gaps

- Simulation is slower in a big imported world: the test mod (3,576 people) plays about 60 days in
  30 s in Node, against a year in about 20 s for the shipped world. Engine performance work, not
  import work.
- Stables have no engine record kind yet; relationships and chemistry are not imported.
- A stored world converted by an older build is not converted again when the converter improves;
  Re-import picks up converter fixes as well as mod updates.
