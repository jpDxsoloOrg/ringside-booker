# Ringside Booker: Unity game (`game/`)

The Windows game version of Ringside Booker, built with Unity. The TypeScript engine
(`packages/engine`) is embedded through a JavaScript runtime for now; a C# port comes later.
UI first (UI Toolkit), 3D later. Windows only.

## Workspace

| What | Where |
| --- | --- |
| Repo clone for Unity work | `F:\source\ringside-booker` = `/mnt/f/source/ringside-booker` in WSL |
| Unity project | `game/` in that clone |
| Unity editor | `C:\Program Files\Unity\Hub\Editor\6000.6.9f1\Editor\Unity.exe` |
| Web app / engine home | `/home/jpdev/source/ringside-booker` (WSL filesystem) |

Why F: and not the WSL filesystem: the Unity editor is a Windows program. It is slow and
unreliable on `\\wsl$\...` paths (file watching, the asset database, symlinks), so the
Unity project lives on a Windows drive. Both clones push to the same GitHub repo
(`jpDxsoloOrg/ringside-booker`); engine/TypeScript work can stay in the WSL clone.

Git settings for the F: clone: `core.autocrlf=false` (repo-local) plus the root
`.gitattributes` (`* text=auto eol=lf`), so WSL git and Windows git see the same files and
line endings never churn. Binary assets under `game/` go through Git LFS
(`game/.gitattributes`). Git LFS is installed for **Windows git** (`git-lfs` 3.4); WSL git
has no `git-lfs`, so commit binary assets with Windows git (`cmd.exe /c git ...`, or a
Windows Git client), or install `git-lfs` in WSL first. Text-only commits work from either.

## Unity version

Unity **6000.6.9f1**, pinned in `ProjectSettings/ProjectVersion.txt`. The project is
minimal: built-in render pipeline, built-in modules only (UI Toolkit is the
`com.unity.modules.uielements` module), plus the Rider and Visual Studio IDE packages.
Assets are serialized as text (`ProjectSettings/EditorSettings.asset`).

## Scripts (run from WSL)

Both scripts convert paths with `wslpath -w`, run Unity with `-batchmode -nographics -quit`,
and return a non-zero exit code on failure. Set `UNITY_EXE` to use another editor path.

| Script | What it does | Log |
| --- | --- | --- |
| `game/tools/unity-compile.sh` | Opens the project so every script compiles, prints any `error CS....` lines | `game/Logs/compile.log` |
| `game/tools/unity-build-windows.sh` | Runs `BuildScripts.BuildWindows` (StandaloneWindows64) | `game/Logs/build.log` |

The build writes `game/Builds/Windows/RingsideBooker.exe`. To smoke-test it headless:

```bash
cd /mnt/f/source/ringside-booker/game
./Builds/Windows/RingsideBooker.exe -batchmode -nographics -logFile "$(wslpath -w "$PWD/Logs")\\player.log"
grep "Ringside Booker boot" Logs/player.log
```

Unity cannot open the same project twice: close the editor before running the scripts.

## Layout

```
game/
  Assets/
    Editor/BuildScripts.cs     batch-mode entry points (BuildWindows, EnsureBootScene)
    Scenes/Boot.unity          bootstrap scene, first in the build settings
    Scripts/Boot.cs            placeholder MonoBehaviour: logs "Ringside Booker boot"
    StreamingAssets/engine/    engine bundle (UNITY-02): generated, gitignored
  Packages/                    manifest.json + packages-lock.json
  ProjectSettings/             project settings (committed)
  tools/                       WSL scripts (unity-compile.sh, unity-build-windows.sh)
  Builds/ Library/ Logs/ Temp/ Obj/ UserSettings/   generated, gitignored
```

Commit only `Assets/`, `Packages/`, `ProjectSettings/`, `tools/` and docs.

## Engine bundle

The engine bundle (UNITY-02) is built from `packages/` in the repo root and written to
`game/Assets/StreamingAssets/engine/`. It is generated and gitignored: build it before
building the player.

## Repo safety

Workshop world mods are read from the player's Steam workshop folders at runtime. Nothing
from a real mod (names, pictures, databases) is ever committed or bundled into a build;
tests use generated fictional databases.
