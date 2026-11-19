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

| Source                            | Engine            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gameworld`                       | manifest          | name, `startDate` (else `currentDate`), version `<databaseVersion>.0.0`, description, author "Workshop world mod"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `countries`                       | country           | matched to a base country by name (plus aliases such as USA, UK, England); otherwise added with a generated unique code, economy × 0.75, only when some imported record uses it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `regions`                         | region            | in a matched country: same-name base region reused, others added, and the base regions they replace patched to population 0 (no double counting); in an added country: all added (or one whole-country region)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `workers`                         | person            | name split into given/family; type → role (Wrestler, Occasional Wrestler, Referee, Announcer, Staff → producer, Personality → manager); style → ring style (non-wrestlers get `nonWrestler`); status, gender, build, height/weight words → cm/kg (women shorter and lighter); skills → attributes (ringwork = wrestlingSkill, mic = entertainment, charisma = starPower, presence = max(intimidation, sexAppeal), athleticism = mean(ringwork, stamina), officiating/broadcasting/producing from refereeing/commentary/agent); conditions (0 = unset → 100); six continent popularities spread to every populated region of that continent; personality flags → traits (max 8, no clashing pairs); drink/drugs → vices; drive → motivation; canBeOwner/Booker → career |
| `workers` dates                   |                   | people born after the start date are left out; a debut after the start date is kept (the engine holds them back until then); a debut before age 14 moves to the 14th birthday                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `promotions`                      | promotion         | Active → active; Inactive → closed, or left out when it only opens after the start; style, prestige, money, owner/booker/parent; production levels and expense policies derived from prestige when the mod leaves them unset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `brands`                          | brand             | priority in source order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `contracts`                       | employment        | role from the person; Face/Heel → alignment; push words → push (crew `none`); PPA → per appearance, development and tour flags; a second exclusive contract becomes non-exclusive; an expiry already past is extended four weeks; "No Expiry" → open-ended                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `titles`, `titlehistory`          | title, titleReign | Singles/Tag/Trios → 1/2/3 holders; Men/Women → division; weight words → max kg; inactive → retired (on the last reign's end); current champions from `titles.currentChampion*`; reigns with missing holders, wrong holder counts or overlaps are left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tagteams`                        | team              | two-person tag teams; formed on the later debut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `venues`                          | venue             | kind from type and capacity; venues opening later or already closed are left out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `events`, `eventDates`            | eventDefinition   | Weekly (weekday flags), Monthly, Annual (week 5 → last), Tour/Specific → the listed dates on or after the start; importance Huge/High/Normal/Low/Unimportant → flagship/major/regular/minor/house; televised when a live TV deal names it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `networks`, `networkAvailability` | network           | type → tv/ppv/streaming; size → reach tier; coverage by continent, country and region                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `networkDeals`                    | deal              | live deals only; income per show/viewer, cost per show; airday → weekday                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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

## Known gaps

- Simulation is slower in a big imported world: the test mod (3,576 people) plays about 60 days in
  30 s in Node, against a year in about 20 s for the shipped world. Engine performance work, not
  import work.
- Stables have no engine record kind yet; relationships and chemistry are not imported.
- The UI (mod list, report screen, roster-only toggle, remembering the mod folder per save) is for
  the UI tickets; this ticket ships the importer and the smoke path.
