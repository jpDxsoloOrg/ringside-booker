#!/usr/bin/env bash
# Packages the Windows game for testers (UNITY-10):
#   1. builds the engine bundle, minified, into game/Assets/StreamingAssets/engine/ (its source map
#      is moved to game/Builds/symbols/ and never ships);
#   2. runs the Windows player build (tools/unity-build-windows.sh) stamped with the version
#      0.1.0-u1+<git sha> (".dirty" appended when game/, packages/ or content/ have uncommitted
#      changes), shown on the title screen;
#   3. copies the player into game/Builds/RingsideBooker-<version>-win64/ with the third-party
#      notices in licenses/ and a version.txt, leaving out Unity's do-not-ship folders;
#   4. zips it to game/Builds/RingsideBooker-<version>-win64.zip and prints the size.
#
# Usage: game/tools/package-windows.sh [--skip-bundle]
#   --skip-bundle  keep the engine bundle already in StreamingAssets (still drops its source map)
# Env: RB_VERSION_BASE (default 0.1.0-u1); RB_BUNDLE_TREE, a scratch checkout used to build the
#   bundle when this repo has no node_modules (default ~/.cache/ringside-booker/bundle-tree);
#   UNITY_EXE as for the other scripts. The Unity editor must be closed.
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "$TOOLS_DIR/.." && pwd)"
REPO_DIR="$(cd "$GAME_DIR/.." && pwd)"
BUILDS_DIR="$GAME_DIR/Builds"
ENGINE_DIR="$GAME_DIR/Assets/StreamingAssets/engine"

skip_bundle=false
for arg in "$@"; do
  case "$arg" in
    --skip-bundle) skip_bundle=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

sha="$(git -C "$REPO_DIR" rev-parse --short=8 HEAD)"
version="${RB_VERSION_BASE:-0.1.0-u1}+$sha"
if [[ -n "$(git -C "$REPO_DIR" status --porcelain -- game packages content)" ]]; then
  version="$version.dirty"
fi
name="RingsideBooker-$version-win64"
echo "== Packaging $name"
mkdir -p "$BUILDS_DIR"

# 1. Engine bundle -----------------------------------------------------------------------------
build_bundle() {
  local tree="$REPO_DIR"
  if [[ ! -d "$REPO_DIR/node_modules/esbuild" ]]; then
    # No node_modules here (the F: drive clone): build in a scratch copy on the Linux file system,
    # with `npm ci` only when package-lock.json changed.
    tree="${RB_BUNDLE_TREE:-$HOME/.cache/ringside-booker/bundle-tree}"
    echo "Syncing sources to $tree"
    mkdir -p "$tree"
    rsync -a --delete \
      --exclude '/.git' --exclude '/game' --exclude 'node_modules' --exclude 'dist' \
      --exclude '/docs' --exclude '.lock-hash' \
      "$REPO_DIR/" "$tree/"
    local lock_hash
    lock_hash="$(sha256sum "$tree/package-lock.json" | cut -d' ' -f1)"
    if [[ ! -d "$tree/node_modules/esbuild" || "$(cat "$tree/.lock-hash" 2>/dev/null)" != "$lock_hash" ]]; then
      echo "npm ci in $tree"
      (cd "$tree" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error)
      echo "$lock_hash" > "$tree/.lock-hash"
    fi
  fi
  mkdir -p "$ENGINE_DIR"
  (cd "$tree" && node packages/engine-host/scripts/build-bundle.mjs --minify --outfile "$ENGINE_DIR/engine.js")
}

if [[ "$skip_bundle" == false ]]; then
  build_bundle
elif [[ ! -f "$ENGINE_DIR/engine.js" ]]; then
  echo "--skip-bundle: $ENGINE_DIR/engine.js is missing" >&2
  exit 1
fi
if [[ -f "$ENGINE_DIR/engine.js.map" ]]; then
  mkdir -p "$BUILDS_DIR/symbols"
  mv -f "$ENGINE_DIR/engine.js.map" "$BUILDS_DIR/symbols/engine-$sha.js.map"
  rm -f "$ENGINE_DIR/engine.js.map.meta"
  echo "Source map kept out of the build: Builds/symbols/engine-$sha.js.map"
fi

# 2. Player build --------------------------------------------------------------------------------
rm -rf "$BUILDS_DIR/Windows"
"$TOOLS_DIR/unity-build-windows.sh" -rbVersion "$version"

# 3. Release folder ------------------------------------------------------------------------------
out="$BUILDS_DIR/$name"
rm -rf "$out" "$out.zip"
rsync -a \
  --exclude '*_BurstDebugInformation_DoNotShip' \
  --exclude '*_BackUpThisFolder_ButDontShipItWithYourGame' \
  --exclude '*.map' --exclude '*.pdb' \
  "$BUILDS_DIR/Windows/" "$out/"
licenses="$out/RingsideBooker_Data/StreamingAssets/licenses"
if [[ ! -f "$licenses/THIRD-PARTY-NOTICES.txt" ]]; then
  echo "The build has no licence notices ($licenses)" >&2
  exit 1
fi
cp -r "$licenses" "$out/licenses"
if find "$out" -name '*.map' | grep -q .; then
  echo "A source map is still in the build" >&2
  exit 1
fi
cat > "$out/version.txt" <<EOF
Ringside Booker $version (Windows x64)
Built $(date -u +%Y-%m-%dT%H:%MZ) from commit $(git -C "$REPO_DIR" rev-parse HEAD)
Third-party notices: licenses/THIRD-PARTY-NOTICES.txt
EOF

# 4. Zip -----------------------------------------------------------------------------------------
python3 - "$out" "$out.zip" <<'PY'
import os, sys, zipfile
root, target = sys.argv[1], sys.argv[2]
base = os.path.basename(root)
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for folder, dirs, files in os.walk(root):
        dirs.sort()
        for file in sorted(files):
            path = os.path.join(folder, file)
            archive.write(path, os.path.join(base, os.path.relpath(path, root)))
PY

folder_size="$(du -sh "$out" | cut -f1)"
zip_bytes="$(stat -c %s "$out.zip")"
echo "== Done"
echo "Folder: $out ($folder_size)"
echo "Exe:    $out/RingsideBooker.exe"
echo "Zip:    $out.zip ($(awk -v b="$zip_bytes" 'BEGIN { printf "%.1f MB", b / 1048576 }'), $zip_bytes bytes)"
