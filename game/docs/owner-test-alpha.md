# Owner test, Sprint 13: the Alpha installer

How to test the Alpha build (S13-alpha) before it goes to testers. It covers POL1-06 (crash
recovery and feedback), POL5-06 (help and first run) and POL9-06 (versions, installer, upgrade and
uninstall). Play it like a new tester would. Note anything that feels wrong, confusing or broken,
and the screen it was on.

## 1. Get the installer

- Installer: `F:\source\rb-wt\S13-alpha\game\Builds\RingsideBooker-Setup-<version>.exe` (about
  38 MB). `<version>` is `0.1.0-alpha.1+<commit>`.
- The app icon is the current flat one (`game/installer/RingsideBooker.ico`). The Blender icon can
  replace it later; nothing else changes.
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

The feedback address is a **placeholder** (`feedback@example.invalid`) until you set the real one
in `game/Assets/Scripts/Diagnostics/Feedback.cs` (`FeedbackConfig.Address`). Until then a mail
draft goes nowhere.

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

## Known gaps

- The feedback address is a placeholder until you set it.
- The Alpha licence text (`game/installer/LICENSE-alpha.txt`) is placeholder wording for you to
  review.
- The installer and the game aren't signed, so SmartScreen warns.
- Older tour runs left many "My career" slots in your saves folder. They're yours to keep or
  delete; tours now delete the slots they create.
