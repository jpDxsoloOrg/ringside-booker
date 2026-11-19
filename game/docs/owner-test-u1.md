# Owner test, Sprint U1: the core loop on Windows

How to test the first Windows build of Ringside Booker (UNITY-10). Write down anything that feels
wrong, slow or missing; the findings become Sprint U2 tickets.

## 1. Get the build

- Zip: `F:\source\rb-wt\UNITY-10\game\Builds\RingsideBooker-<version>-win64.zip` (about 53 MB).
  The unzipped folder sits next to it: `RingsideBooker-<version>-win64\RingsideBooker.exe`.
- `<version>` is `0.1.0-u1+<commit>`, for example `0.1.0-u1+1bdfa3c4`. The title screen shows it
  bottom left, and `version.txt` in the folder says which commit it was built from.
- Unzip anywhere and run `RingsideBooker.exe`. Windows may ask about an unknown publisher: choose
  "More info" then "Run anyway" (the build is not signed).
- Saves go to `%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker\Saves`. Delete that folder
  to start from nothing.
- Rebuild it yourself from WSL with `game/tools/package-windows.sh` (Unity editor closed).

## 2. Title screen

- [ ] The title shows NEW GAME, CONTINUE, LOAD, SETTINGS, QUIT and the version.
- [ ] Settings: change the UI scale and the window mode; both apply at once.
- [ ] Settings › Credits & licences: the notice buttons open the third-party notices
      (THIRD-PARTY-NOTICES, ClearScript/V8, SQLite, the two fonts). The same files are in the
      `licenses` folder next to the exe.

## 3. New game from the default world

- [ ] New game: pick the bundled default world, then a promotion to run. Check the save name, the
      booker name, the seed, the season length and the other settings, including Show night
      Live or Auto.
- [ ] Start. The game opens on the Office with a first save made.

## 4. New game from a workshop world mod

Your workshop world mod is found in the Steam workshop folders automatically.

- [ ] New game: under "Workshop mods", pick the mod with **With pictures**. The import takes a
      second or two and shows a report (counts, anything not imported). Start the game.
- [ ] Roster shows the mod's people with their portraits.
- [ ] Back to the main menu, and the same again with **Roster only (no pictures)**: the same
      people, placeholders instead of portraits.
- [ ] Big worlds simulate slowly in this build (see "Known missing"); a few days is enough here.

## 5. Play a month (default world)

- [ ] **Office**: the key numbers, the next and last show, top stories. Press a "?" to open its
      Why? panel; Esc or the × closes it.
- [ ] **Roster**: the role tabs; Set push on a wrestler; the Injuries tab.
- [ ] **Calendar**: this month, mine and the world's shows; open a show.
- [ ] **Booking, with Auto-fill**: open the next show, press AUTO-FILL; every match gets an Auto
      result and the checklist turns green.
- [ ] **Booking, by hand**: clear the card (or take the next show) and build it yourself: add a
      match and a talking segment, pick the sides from the roster picker, set a result, a title
      or a time. Check the checklist and its Why? panels.
- [ ] **Go live** (Live shows): Run next segment, read the segment report, then Sim the rest. For
      Auto shows: Run the show.
- [ ] **Results**: score and stars with their Why? panels, crowd and money, popularity changes,
      segment reports, the physical toll.
- [ ] **Next day** (top right, or Shift+N) moves one day. When something waits, the button names
      it instead ("Go live", "Roster", "Contracts", "Open news").
- [ ] **Skip days** (the » button): 7, 30 or 90 days, or until the 1st of next month. The skip
      stops at each show night and at anything else that waits; the summary banner says why.
- [ ] Stops this build has no screen for (expiring contracts, a worker who wants to leave, a
      counter-offer, an answered offer, a news alert): the day button opens **Needs attention**,
      which lists each stop with its reason and a button that deals with it (Mark as seen, OK,
      Refuse / Let them go, End talks / Accept counter). The day must never get stuck: if it does,
      note the stop's words.
- [ ] Keep going until a month has passed: book and run every show, at least one by hand.

## 6. Save, quit, continue, load

- [ ] The game saves itself (shortly after each change, after every skip, and on quit).
- [ ] Sidebar › Main menu, then CONTINUE: you are back on the same day with the same card.
- [ ] Quit from the title (or close the window mid-game), start the exe again, CONTINUE.
- [ ] LOAD: the save slots list with their dates; open one. Try export and import of a save, and
      delete a slot you don't need.

## 7. Known missing in this build

Not bugs, already planned:

- **From UNITY-09 (Sprint U2):** founding a new promotion in the wizard; in Booking the full
  beats editor, stipulations, finishes, crew, tag teams and tag sides, the venue picker and
  dragging slots to reorder; news headline wording (the Office shows names only); sidebar badges
  (inbox, decisions, contracts); the Inbox, Contracts and News screens (until then their stops are
  cleared in Needs attention, and opening News marks news alerts seen).
- **Every other screen** in the sidebar shows a placeholder.
- **The look:** this is the first port of the web layout; the UI redesign is UNITY-11.
- **Speed in big worlds:** a large workshop world simulates slowly (about two days a second);
  that is POL4-12.
- No sound, no 3D, Windows only.

## What was checked before handing over

- `game/tools/unity-compile.sh` (clean) and `game/tools/package-windows.sh` (bundle, Windows
  build, zip).
- `RingsideBooker.exe -rbSkipCheck 90` on the packaged build (default world): 90 days with
  Skip days, stopping at every show night (booked with Auto-fill and run live) and clearing every
  other stop through the day button and Needs attention. It never got stuck.
- The `-rbLoopShots` screenshot tour on the packaged build (default world).
