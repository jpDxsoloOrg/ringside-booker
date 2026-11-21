# Owner test, Sprint 13: the Alpha installer

How to test the Alpha build (S13-alpha) before it goes to testers. It covers POL1-06 (crash
recovery and feedback), POL5-06 (help and first run), POL9-06 (versions, installer, upgrade and
uninstall) and POL9-11 (in-game update). Play it like a new tester would. Note anything that feels wrong, confusing or broken,
and the screen it was on.

## 1. Get the installer

- Installer: `F:\source\rb-wt\S13-alpha\game\Builds\RingsideBooker-Setup-<version>.exe` (about
  38 MB). `<version>` is `0.1.0-alpha.1+<commit>`.
- The app icon is the Blender ring icon B (`game/branding/ring-B.ico`). Check it on the
  installer, the Start menu and desktop shortcuts, the taskbar and Apps & features.
- Your saves live in `%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker\Saves`. **Copy that
  folder somewhere safe first** if you want to keep it exactly as it is. Nothing in this test
  deletes it unless you tick the box in step 8.

## 2. Install and the first run

- [ ] Double-click the installer. Windows SmartScreen may say "Windows protected your PC", because
      the build isn't signed. Choose **More info**, then **Run anyway**.
- [ ] Choose **Install for me only** (the default). No admin prompt appears.
- [ ] The Alpha licence page shows (its wording is placeholder text for you to review), then the
      third-party notices.
- [ ] The folder is `%LOCALAPPDATA%\Programs\Ringside Booker`. Tick **Create a desktop shortcut**,
      install, and leave **Launch Ringside Booker** ticked.
- [ ] The game starts, with no missing-DLL error.
- [ ] **New game** on the default world, and take over a promotion.
  - Good: the **welcome sheet** opens on the Office. It says "Welcome to <promotion>" and has the
    **Alpha notice** (an early test build, saves may need a fresh start, a Send feedback button).
  - [ ] Tick "Don't show the Alpha notice again", close it, start another new game: the welcome
        shows without the Alpha notice. **Settings › Help & tips** turns it back on.
- [ ] **Getting started** checklist: it is the Office's first block. Book your first show, run
      it, read the results, sign someone and read a help article. Each item ticks itself.
  - Good: the list hides once everything is done, or when you hide it.
- [ ] **Help**: the last item in the sidebar. Search for "booking", open an article, follow a link
      inside it and a "Go to <screen>" button.
- [ ] The **"?"** after a screen's title (Booking, Roster, Contracts and so on) opens a side sheet
      with that screen's article and "Open in Help".
- [ ] On the title screen, **Help** (in the menu) opens the same help without a game.

## 3. Version: the ALPHA badge, About and What's new

- [ ] The **ALPHA** badge shows under the brand in the sidebar and on the title screen, next to
      the version (bottom left).
- [ ] The window title says "Ringside Booker — Alpha 0.1.0 (1)".
- [ ] **Settings › About** shows the version, build (commit), build date and channel (Alpha), and
      a **What's new** button.
- [ ] **What's new** (the button, or the version on the title screen) lists the changes.
- [ ] After an upgrade to a new version number (for example `alpha.1` to `alpha.2`), What's new
      opens by itself once on the first start. A rebuild of the same number doesn't open it.

## 4. Saves: the Last saved chip and backups

- [ ] In a game, the top bar shows **Saved <game date>** before the scoreboard. Hover it: it says
      when, how (autosave, new game, on exit, loaded) and how many backups the save keeps.
- [ ] Play a few days. The chip follows each save.
- [ ] **Settings › Backups per save**: pick 1, 3, 5 or 10 (default 5).
- [ ] Main menu, then **Load**. The save has a quiet **Alpha** tag. Press its **Backups** button.
  - Good: the backups are listed newest first, with game dates. Loading one asks first.
- [ ] Back on the title screen, **Settings** shows no **Big world speed** (that's a world setting,
      only in a game), and the panel scrolls when the window is short.

## 5. Crash screen and Start safe

The engine can be made to fail on purpose. Start the game from a command prompt or PowerShell:

```powershell
& "$env:LOCALAPPDATA\Programs\Ringside Booker\RingsideBooker.exe" -rbForceEngineFault 5
```

- [ ] Load (or start) a game and wait. About 5 seconds after the game is idle, the **engine
      stopped** screen covers everything.
  - Good: it says what happened in plain words and offers **Reload last save**, **Load a backup**
    (up to three), **Back to title**, **Start safe**, **Copy details**, **Error details** and Send
    feedback.
- [ ] **Reload last save**: the game comes back at its last save, and you can play on.
- [ ] Force it again (quit and start with the same command), and this time choose **Start safe**.
  - Good: the title opens on **Start safe**, offering the backups, "Open the last save anyway" and
    "Start a new game". Choose one and play on.
- [ ] Two bad endings in a row (for example, force the fault twice and close the window on the
      crash screen) make the next normal start open on Start safe by itself. Playing one day
      clears it.

## 6. Send feedback

Feedback goes to **jp@jpdxsolo.com** (`FeedbackConfig.Address` in
`game/Assets/Scripts/Diagnostics/Feedback.cs`).

- [ ] **Settings › Feedback & bug reports › Send feedback**: your mail app opens a new message with
      the version in the subject and a short template. The game shows the bug report's path.
  - Good: **Show the file** opens the folder, **Copy the path** copies it. The zip holds
    `report.txt`, the log, the save and `version.json`.
- [ ] **Save a bug report** makes the zip without opening mail.
- [ ] The title screen has Send feedback under the menu, and the crash screen has it too.
- [ ] Note which mail app opened (this wasn't tested with a real mail client yet).

## 7. Upgrade with a newer installer

You need a second installer with a newer version: build one from a later commit
(`game/tools/build-installer.sh`) or take the next one from a release.

- [ ] Play, save, and leave the game running.
- [ ] Run the newer installer. It closes the game (or asks to), installs into the same folder, and
      doesn't ask for the folder again.
- [ ] **Settings › Apps › Installed apps** shows one Ringside Booker, with the new version and
      jpDxsolo.
- [ ] The game starts and your save loads (What's new opens once if the version number changed).

## 7b. In-game update (POL9-11)

The game looks for a newer release on GitHub once a day and offers it with a quiet chip. How it
works, and the installer flags it uses, are in
[installer.md › In-game updates](installer.md#in-game-updates-pol9-11).

**Quick look without a release** (no network, nothing is installed): run the tour, then look at
the PNGs in the folder you named.

```powershell
& "$env:LOCALAPPDATA\Programs\Ringside Booker\RingsideBooker.exe" -screen-width 1280 -screen-height 720 -screen-fullscreen 0 -rbUpdateShots "C:\Temp\rb-update-shots"
```

**For real, now** (uses the `v0.1.0-alpha.1` draft that is already on GitHub):

1. Build an installer from this branch that pretends to be older:
   `RB_VERSION_BASE=0.1.0-alpha.0 game/tools/build-installer.sh`. Install it, start it, and check
   that the title says Alpha 0.1.0 (0).
2. On GitHub, publish the `v0.1.0-alpha.1` draft as a **pre-release** (it already has
   `RingsideBooker-Setup-0.1.0-alpha.1+2a896c4f.exe`).
3. Start the game again. If it already checked today, use **Settings › About › Check now**.
   - [ ] The title screen shows **Update available: v0.1.0-alpha.1** above the version, and so does
         Settings › About. Nothing pops up by itself.
   - [ ] The chip opens a sheet with the release notes, **Download and install**, **Later** and
         **Skip this version**.
4. Start a game, play a day, then go to Settings › About, click the chip and **Download and
   install**.
   - [ ] A progress bar fills (about 38 MB). Then it says "Downloaded and checked" with **Save and
         install**.
   - [ ] **Save and install**: the game saves, closes, and the installer shows only a progress
         window (no licence or folder pages).
   - [ ] alpha.1's installer is older than this feature, so the game doesn't start again by
         itself. Start it: the title says Alpha 0.1.0 (1), and the save loads at the day you
         played.

**For real, the whole loop** (once this branch is in a release):

1. Release and publish `v0.1.0-alpha.2` (with its Setup exe) and install it.
2. Release and publish `v0.1.0-alpha.3`.
3. In alpha.2, the chip shows alpha.3. **Download and install** saves, closes, installs, and
   **starts the game again** by itself, now on Alpha 0.1.0 (3). What's new opens once.

Also check:

- [ ] **Skip this version** hides both chips. **Check now** brings it back.
- [ ] Untick **Check for updates automatically**: no chip on the next start (Check now still
      works).
- [ ] Offline (Wi-Fi off): the game starts normally with no error. Check now says "Couldn't check
      for updates. Try again later."
- [ ] With nothing newer published, Check now says "You have the newest version."

## 8. Uninstall (saves kept)

- [ ] Uninstall from **Installed apps**. Leave **Also delete my saves and imported worlds**
      unticked.
  - Good: the game folder and the Start menu and desktop shortcuts are gone.
  - Good: `%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker\Saves` still has your saves.
- [ ] Only in the Windows Sandbox (section 9): install again, then uninstall with the box
      **ticked**. `AppData\LocalLow\jpDxsolo\Ringside Booker` is gone. Don't tick it on your own
      PC unless you mean to delete your saves.

## 9. Clean machine: Windows Sandbox

This checks the installer on a Windows with nothing else installed. It's the "Owner test: clean
Windows machine" section of [installer.md](installer.md):

1. Turn on **Windows Sandbox** once ("Turn Windows features on or off", then restart).
2. Open Windows Sandbox from the Start menu.
3. Copy the installer from your PC and paste it on the Sandbox desktop.
4. Run it, and check:
   - [ ] SmartScreen's **More info › Run anyway** works.
   - [ ] "Install for me only" is the default, with no admin prompt.
   - [ ] The licence page, then the third-party notices page show.
   - [ ] The folder is `C:\Users\WDAGUtilityAccount\AppData\Local\Programs\Ringside Booker`.
   - [ ] Tick the desktop shortcut, install and launch.
5. The game starts:
   - [ ] No "VCRUNTIME140.dll was not found" or other missing-DLL error.
   - [ ] The title screen shows the right version and the ALPHA badge.
   - [ ] New game on the default world, play one day, and save. The Sandbox has no GPU, so it may
         be slow; that's fine.
6. Quit, and check the Start menu, the desktop shortcut and Installed apps (version, jpDxsolo).
7. Uninstall with the box unticked: the game folder and shortcuts are gone and the save is still
   in `AppData\LocalLow\jpDxsolo\Ringside Booker\Saves`.
8. Install again, uninstall with the box **ticked**: `AppData\LocalLow\jpDxsolo\Ringside Booker`
   is gone.
9. Close the Sandbox (everything in it is thrown away).

## 10. Draft start (Beta 01, DRF-02/03/06/07/10)

Start the game, **New game**, the default world, take over any promotion, then **Options**.

**Active promotions** (any game):

- [ ] **Promotions › Active promotions** says "All 12 promotions active, … wrestlers". **Choose…**
      opens the picker: your promotion has a lock and can't be turned off.
- [ ] Search, the country picker and the size chips narrow the list. Clicking a row turns it on
      or off, and the count at the top changes at once.
- [ ] **Only the biggest** 6 → **Apply** leaves six on (yours among them). **Select all** turns
      everything back on. **DONE** goes back to Options with the new count.

**The draft options:**

- [ ] **Draft › Start with a draft: On** shows Roster size, Negotiate contracts after the draft,
      Show schedule and **More draft options…** (Pool size, Draft order, Draft staff too). Off
      hides them again.
- [ ] **The draft plan** under them shows how many promotions draft how many wrestlers, the
      starting money and popularity, the pool, how many sit out, and the mix from Main event down
      to Enhancement. Changing Roster size or Pool size updates it.

**The draft room** (Start):

- [ ] The game opens on the draft room, not the Office. The day button says **Finish the draft**.
- [ ] The banner says who is on the clock, the round and pick, and how far away your pick is.
      **Sim to my pick** lets the rivals pick a few at a time; the recent picks tick by under it.
- [ ] On your pick, sort the pool by Value, Fit, Age, and filter by Men/Women, division and
      style, and by **card level** (the Card level column sorts main event first). Hover Value and
      Fit for the quiet Why?. The column button adds Skill and Popularity.
- [ ] **Draft** asks first, then your roster on the right fills. Click any promotion under
      **Every roster** to see its picks.
- [ ] Leave the room (Office), then press the day button: it brings you back.
- [ ] **Auto-pick the rest** makes every pick, then **Finish the draft**. The day button is back
      to normal. Play a few weeks: shows run, your draftees are on your roster with one-season
      contracts, and every title starts vacant.

**Negotiate after** (a second new game with **Negotiate contracts after the draft: On**):

- [ ] After Finish, **Sign your draftees** lists every pick as Unsigned, with **Offer contract**
      and **Release**. Offer contract opens the normal contract talks; Release puts them back in
      the pool.
- [ ] Answers come over the next days (Contracts › Offers); each "Offer answered" stop clears
      the first time the day button opens it. The first show is a week after the start, so it
      comes after they sign. (If too few sign, Booking says "Sign some wrestlers first" with
      **Call off this show**.)

**Picks paid up front** (DRF-10, a new game with the draft on):

- [ ] Options › Draft › **Starting cash** offers World median, $250k, $500k, $1M and $2M. The
      plan line says "(the world median)" for the default and shows the amount you pick.
- [ ] In the draft room the header shows **Cash left**, and the pool has a **Season cost**
      column (hover it: wages or appearances for the season). Drafting someone takes their cost off
      Cash left at once; the confirm says how much.
- [ ] Click a name in the pool: their profile opens, with no Offer contract or trade button and
      a quiet "The draft is on" line on the Contract tab. **Back** returns to the board with your
      filters and page as they were.
- [ ] Start a game with **Starting cash: $250k**. Wrestlers you can't afford are greyed with
      Draft off ("Costs $X; you have $Y"). When you can't afford anyone, the banner says your picks
      are over; nobody's cash goes below zero. After Finish, the draft room says how many wrestlers
      you are short, and **Free agents** opens Contracts, which suggests per-appearance deals.
      Rivals that ran out are full again with per-appearance signings.
- [ ] Play two weeks: Finances shows one "Season contract" Wages row per pick and no wages or
      appearance fees for your draftees afterwards.

Quick look without playing (PNGs in the folder; add `-rbDraftNegotiate` for the second mode):

```powershell
& "$env:LOCALAPPDATA\Programs\Ringside Booker\RingsideBooker.exe" -screen-width 1280 -screen-height 720 -screen-fullscreen 0 -rbDraftShots "C:\Temp\rb-draft-shots"
```

## 11. Tester access code (POL9-12)

Test builds ask for a tester code once per computer. How it works, the codes tool and the AWS
stack are in [access-codes.md](access-codes.md).

1. Make a code for yourself, from `services/access` (run `npm ci` there once):
   `npm run codes -- create --label "Owner test"`. It prints a code like `RB-XXXX-XXXX`.
2. Install this build and start it.
   - [ ] Before the title menu, **Enter your tester code** shows, with Start playing and Quit.
   - [ ] A made-up code (`RB-2222-2222`) says "That code isn't valid…".
   - [ ] Your code, typed in lower case or without dashes, is accepted and the title menu shows.
3. Play a little, quit, and start the game again.
   - [ ] No code is asked for. Settings › About shows **Tester access: active (RB-XXXX-••••)** and
         "Works offline until …".
4. Turn the network off (or unplug) and start the game again.
   - [ ] It starts without asking (offline grace).
5. **Settings › About › Remove this code**, then **Remove**.
   - [ ] On the title screen the code screen comes straight back; in a game it comes back at the
         next start. Entering the same code again works (the same computer doesn't use another
         slot).
6. Run `npm run codes -- list`: the code shows `1/2 computers`. Then revoke it with
   `npm run codes -- revoke RB-XXXX-XXXX`, use **Remove this code** again and re-enter it.
   - [ ] It says "This code has been turned off…". (A game that still holds the code stops at its
         weekly check when online, or when the 30-day offline grace runs out.)
7. Delete the test code when you're done: `npm run codes -- delete RB-XXXX-XXXX`.

Quick look with no typing (a packaged alpha build; it calls the real service):

````powershell
& "$env:LOCALAPPDATA\Programs\Ringside Booker\RingsideBooker.exe" -screen-width 1280 -screen-height 720 -screen-fullscreen 0 -rbAccessTour "C:\Temp\rb-access" -rbAccessCode RB-XXXX-XXXX

## 12. Trades (Beta 03, TRD-02/03/04)

Start a new game in the default world (no draft), then play a day or two so the first show is out
of the way.

**Build an offer:**

- [ ] **Promotions**, open a rival: **Propose a trade** sits top right. On any rival wrestler's
      profile (or quick look from their roster), **Offer in a trade** opens the trade sheet with
      the rival picked and that wrestler on **You get**. On one of your own, they go on **You give**.
- [ ] **Add one of theirs**: champions are greyed out with "Champion: drop or vacate the title
      first"; workers with a no-trade clause have a tag.
- [ ] As you add workers and cash, **How they'd take it** changes at once: Likely yes / Close /
      Far apart, a meter and plain lines. Hover the **?** for the rival's reasons. Each worker shows
      whether they're happy to move and the morale change, with their own **?**.
- [ ] **More terms** on a worker: a new wage or length. A pay rise can turn "doesn't want to move"
      round. A no-trade clause who won't go shows in red under them with **Take them out**, and
      **Send offer** stays off until every rule is fixed.

**Answers:**

- [ ] Offer a little cash for one of their best wrestlers and **Send offer**. Press Next day: the
      day button says **Trade answered** and opens Contracts › Trades on the answer: **They
      refuse**, with the lines and a **?**. The stop doesn't come back.
- [ ] **New offer to …**: offer one of your wrestlers for one of theirs until it reads **Close**,
      and send it. Next day: **Trade offer** opens their counter-offer (usually cash on top or one
      more worker). Try **Change and send back** (the meter reads the changed offer), then **Keep
      their offer** and **Accept**.

**After the trade:**

- [ ] The sheet says who moved. Your Roster has who you got, and the rival's page has who you gave.
      Contracts › Active has the new contract with the same pay (or your change).
- [ ] News has "… trades for …" stories. Titles are untouched.
- [ ] If the wrestler you gave was booked on one of your future shows, that card no longer has
      them (Booking).
- [ ] Contracts › Trades › **History** lists both trades.

**A rival's offer:** rivals offer now and then (Mondays, after the first two months, about one to
three a year). When **Trade offer** says a rival offered you a trade, it opens with **Accept**,
**Refuse** and **Counter**, and says when it lapses (a week).

Quick look without playing (it forces a rival offer with dev overrides; PNGs in the folder):

```powershell
& "$env:LOCALAPPDATA\Programs\Ringside Booker\RingsideBooker.exe" -screen-width 1280 -screen-height 720 -screen-fullscreen 0 -rbSeed trd -rbTradeShots "C:\Temp\rb-trade-shots"
````

## Known gaps

- The feedback address is a placeholder until you set it.
- The Alpha licence text (`game/installer/LICENSE-alpha.txt`) is placeholder wording for you to
  review.
- The installer and the game aren't signed, so SmartScreen warns.
- Older tour runs left many "My career" slots in your saves folder. They're yours to keep or
  delete; tours now delete the slots they create.
