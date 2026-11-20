# Windows installer (POL9-09)

The Alpha ships as `RingsideBooker-Setup-<version>.exe`, a normal Windows installer made with
[Inno Setup 6](https://jrsoftware.org/isinfo.php). The zip from `package-windows.sh` stays
available for people who don't want an installer.

| What               | Where                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Installer script   | `game/installer/RingsideBooker.iss`                                   |
| Alpha licence page | `game/installer/LICENSE-alpha.txt` (placeholder text for the owner)   |
| Build script       | `game/tools/build-installer.sh`                                       |
| Output             | `game/Builds/RingsideBooker-Setup-<version>.exe` (about 38 MB)        |
| Installs to        | `%LOCALAPPDATA%\Programs\Ringside Booker` (per user, no admin prompt) |
| Saves (kept)       | `%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker`             |
| Uninstall entry    | `HKCU\...\Uninstall\{56E79425-5C38-4649-9270-1D9D6D0497BE}_is1`       |

## Building it

From WSL, with the Unity editor closed:

```bash
game/tools/build-installer.sh                 # package-windows.sh, then ISCC
game/tools/build-installer.sh --skip-bundle   # keep the engine bundle already built
game/tools/build-installer.sh --package-dir game/Builds/RingsideBooker-<version>-win64
                                              # installer only, from a folder already packaged
```

The script:

1. runs `package-windows.sh`, which builds the player and the release folder and zip;
2. reads the version from the build's `StreamingAssets/version.json`, or from the folder name
   (`RingsideBooker-<version>-win64`) when the build has no version.json;
3. checks that no file in the build imports the Visual C++ runtime (see below);
4. compiles the `.iss` with `ISCC.exe` and prints the installer's path and size. ISCC takes about
   15 s.

**Inno Setup** is a one-off install on the build machine:
`winget install JRSoftware.InnoSetup --scope user`. That puts `ISCC.exe` in
`%LOCALAPPDATA%\Programs\Inno Setup 6`, and the script also looks in
`Program Files (x86)\Inno Setup 6`. Set `ISCC=/mnt/c/.../ISCC.exe` to use another copy.

Environment variables:

| Variable      | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `ISCC`        | Path to `ISCC.exe` (found automatically otherwise)                         |
| `RB_APP_ICON` | An `.ico` for the installer (default `game/installer/RingsideBooker.ico`)  |
| `RB_SIGNTOOL` | Signing command, see [Code signing](#code-signing)                         |
| others        | Whatever `package-windows.sh` reads (`RB_BUNDLE_TREE`, `RB_VERSION_BASE`…) |

## What the installer does

- **Pages:** the Alpha licence (must be accepted), the third-party notices
  (`licenses/THIRD-PARTY-NOTICES.txt` from the build), the folder, an unticked "Create a desktop
  shortcut", then install and "Launch Ringside Booker".
- **Per user by default.** A dialog first asks "Install for me only" (the default, no admin) or
  "Install for all users" (Program Files, asks for admin).
- **Shortcuts:** Start menu `Ringside Booker`; desktop shortcut only when ticked. Both use the
  game exe's icon.
- **Apps & features** lists "Ringside Booker" with the version, the publisher (jpDxsolo) and the
  game's icon.
- **Version:** the same string as the zip and the title screen (`0.1.0-u1+<sha>` now,
  `0.1.0-alpha.N+<sha>` once version.json lands). The installer's own file version is four numbers:
  `0.1.0.N` for `-alpha.N`, otherwise `0.1.0.0`.
- **Upgrade in place:** the AppId never changes, so a newer installer goes into the same folder.
  It closes a running game first (Windows Restart Manager, `CloseApplications=force`), removes the
  old `RingsideBooker_Data`, `MonoBleedingEdge`, `D3D12` and `licenses` folders so no stale files
  stay behind, and remembers the earlier choices (folder, desktop shortcut). Saves and settings are
  not in the install folder, so an upgrade never touches them.
- **Uninstall** (Apps & features, or `unins000.exe` in the game folder) removes the game folder
  and the shortcuts. A dialog first offers **Also delete my saves and imported worlds**, unticked.
  Ticked, it deletes `AppData\LocalLow\jpDxsolo\Ringside Booker` (saves, imported workshop worlds,
  logs). Settings (PlayerPrefs, `HKCU\Software\jpDxsolo\Ringside Booker`) are always kept.

## Silent install (testers and scripts)

```bat
RingsideBooker-Setup-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

Useful extras:

| Option                        | Effect                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `/DIR="C:\Games\Ringside"`    | Install somewhere else                                       |
| `/MERGETASKS="desktopicon"`   | Also make the desktop shortcut                               |
| `/ALLUSERS`                   | Install for all users (run from an admin prompt)             |
| `/LOG="C:\Temp\rb-setup.log"` | Write a setup log                                            |
| `/SILENT`                     | Show progress only, no questions                             |
| `/NOCLOSEAPPLICATIONS`        | Don't close a running game (the install then waits or fails) |

Silent uninstall keeps saves; add `/DELETESAVES` to delete them too:

```bat
"%LOCALAPPDATA%\Programs\Ringside Booker\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

## Visual C++ runtime

The installer does **not** ship `vc_redist.x64.exe`, because nothing in the build needs it. Every
native file links the C runtime statically. Checked with `objdump -p` on the packaged build
(2026-11-19):

| File                                            | Imports                                              |
| ----------------------------------------------- | ---------------------------------------------------- |
| `Plugins/x86_64/ClearScriptV8.win-x64.dll` (V8) | `WINMM`, `ADVAPI32`, `KERNEL32` only                 |
| `Plugins/x86_64/sqlite3.dll`                    | `KERNEL32` only                                      |
| `UnityPlayer.dll`, `mono-2.0-bdwgc.dll`         | Windows system DLLs and `api-ms-win-core-*` API sets |
| `RingsideBooker.exe`, crash handler, D3D12      | Windows system DLLs and `api-ms-win-core-*` API sets |

None of them imports `VCRUNTIME140`, `MSVCP140`, `ucrtbase` or `api-ms-win-crt-*`. The
`api-ms-win-core-*` names are Windows API sets that every Windows 10/11 has, not the VC++ runtime.

`build-installer.sh` repeats this check on every build and stops if a file starts importing the
runtime (for example a new native plugin). If that happens, the fix is:

1. Download the official `https://aka.ms/vs/17/release/vc_redist.x64.exe` at build time into
   `game/Builds/redist/` (ignored by git, like all of `Builds/`). Never commit it.
2. Add it to `[Files]` with `Flags: deleteafterinstall` into `{tmp}`, and to `[Run]` with
   `Parameters: "/install /quiet /norestart"` and a `Check:` function that reads
   `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64` `Installed` (run it only when
   missing). Installing it needs admin, so the per-user install would then prompt once.

The app-local alternative (copying `vcruntime140.dll` and friends next to the exe) is allowed by
Microsoft's redistribution terms but is no longer recommended by Microsoft, so prefer the
redistributable if it is ever needed.

## Code signing

Not signed yet, so Windows SmartScreen shows "Windows protected your PC" on first run of the
installer. Testers choose **More info**, then **Run anyway**. The game exe is not signed either.

The hook is ready. With a certificate, set `RB_SIGNTOOL` to a sign command where `$f` is the file;
`build-installer.sh` passes it to ISCC as a sign tool, and Inno Setup signs both the installer and
the uninstaller:

```bash
RB_SIGNTOOL='"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe" sign /f C:\certs\rb.pfx /p <password> /fd sha256 /tr http://timestamp.digicert.com /td sha256 $f' \
  game/tools/build-installer.sh
```

To sign the game exe and DLLs as well, sign them in the packaged folder before ISCC runs (a step
in `build-installer.sh` after packaging). Keep the certificate and password out of the repo.

## Owner test: clean Windows machine (Windows Sandbox)

This needs a Windows with nothing else installed, so it can't run in the build environment.
Windows Sandbox (Windows 10/11 Pro: "Turn Windows features on or off" › **Windows Sandbox**,
then restart) gives a fresh Windows every time it opens.

1. Build the installer (or take it from the release) and note its path.
2. Open **Windows Sandbox** from the Start menu.
3. Copy `RingsideBooker-Setup-<version>.exe` from your PC and paste it on the Sandbox desktop.
4. Double-click it. Check:
   - [ ] SmartScreen warns about an unknown publisher; **More info › Run anyway** works.
   - [ ] "Install for me only" is the default, and no admin prompt appears.
   - [ ] The licence page, then the third-party notices page show.
   - [ ] The folder is `C:\Users\WDAGUtilityAccount\AppData\Local\Programs\Ringside Booker`.
   - [ ] Tick "Create a desktop shortcut", install, leave "Launch Ringside Booker" ticked, Finish.
5. The game starts:
   - [ ] No "VCRUNTIME140.dll was not found" or other missing-DLL error.
   - [ ] The title screen shows the right version.
   - [ ] New game from the default world, play one day, and save. The Sandbox has no GPU, so the
         game may run slowly; that's fine.
6. Quit. Check:
   - [ ] The Start menu has "Ringside Booker", and so does the desktop.
   - [ ] Settings › Apps › Installed apps lists Ringside Booker with the version and jpDxsolo.
7. Uninstall from Installed apps, leaving "Also delete my saves and imported worlds" unticked:
   - [ ] The game folder and both shortcuts are gone.
   - [ ] `%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker\Saves` still has the save.
8. Install again, then uninstall with the box **ticked**:
   - [ ] `AppData\LocalLow\jpDxsolo\Ringside Booker` is gone.
9. Close the Sandbox (everything in it is thrown away).

## Owner test: your own PC (install, upgrade, uninstall)

1. Install an older installer, play, and save.
2. With the game still running, run a newer installer:
   - [ ] It closes the game (or asks to), installs into the same folder, and Apps & features shows
         the new version.
   - [ ] The save loads in the new version.
3. Uninstall with the box unticked: the save is still there.
