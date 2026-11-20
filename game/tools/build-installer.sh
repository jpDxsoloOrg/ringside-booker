#!/usr/bin/env bash
# Builds the Windows installer (POL9-09): game/Builds/RingsideBooker-Setup-<version>.exe.
#   1. runs tools/package-windows.sh (bundle, player build, release folder and zip), unless
#      --package-dir points at a folder it already made;
#   2. reads the version from the build's StreamingAssets/version.json (falls back to the folder
#      name, RingsideBooker-<version>-win64);
#   3. checks that nothing in the build needs the Microsoft Visual C++ runtime (see
#      game/docs/installer.md, "Visual C++ runtime");
#   4. compiles game/installer/RingsideBooker.iss with Inno Setup 6 (ISCC.exe on Windows).
#
# Usage: game/tools/build-installer.sh [--skip-bundle] [--package-dir <folder>]
#   --skip-bundle          passed to package-windows.sh
#   --package-dir <folder> skip packaging and build the installer from this packaged folder
# Env: ISCC (path to ISCC.exe; found automatically in Program Files (x86) or %LOCALAPPDATA%\Programs);
#   RB_APP_ICON (an .ico for the installer; default game/installer/RingsideBooker.ico when present);
#   RB_SIGNTOOL (a signtool command with $f for the file to sign; see installer.md); plus everything
#   package-windows.sh reads.
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "$TOOLS_DIR/.." && pwd)"
BUILDS_DIR="$GAME_DIR/Builds"
ISS="$GAME_DIR/installer/RingsideBooker.iss"

package_args=()
package_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-bundle) package_args+=("$1") ;;
    --package-dir) package_dir="${2:?--package-dir needs a folder}"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# 1. Package --------------------------------------------------------------------------------------
if [[ -z "$package_dir" ]]; then
  mkdir -p "$BUILDS_DIR"
  log="$BUILDS_DIR/package-windows.log"
  "$TOOLS_DIR/package-windows.sh" "${package_args[@]}" | tee "$log"
  package_dir="$(sed -n 's/^Folder: \(.*\) ([^)]*)$/\1/p' "$log" | tail -1)"
fi
package_dir="$(cd "$package_dir" && pwd)"
if [[ ! -f "$package_dir/RingsideBooker.exe" ]]; then
  echo "Not a packaged game folder (no RingsideBooker.exe): $package_dir" >&2
  exit 1
fi

# 2. Version --------------------------------------------------------------------------------------
version=""
version_json="$package_dir/RingsideBooker_Data/StreamingAssets/version.json"
if [[ -f "$version_json" ]]; then
  version="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$version_json")"
fi
if [[ -z "$version" ]]; then
  base="$(basename "$package_dir")"
  version="${base#RingsideBooker-}"
  version="${version%-win64}"
fi
if [[ -z "$version" || "$version" == "$(basename "$package_dir")" ]]; then
  echo "Could not work out the version of $package_dir" >&2
  exit 1
fi
echo "== Installer for Ringside Booker $version"

# 3. Visual C++ runtime check -----------------------------------------------------------------------
# Every native file in the build links the C runtime statically today, so the installer ships no
# vc_redist. If a new plugin imports the runtime DLLs, stop here rather than ship a game that fails
# to start on a clean PC.
if command -v objdump >/dev/null 2>&1; then
  crt_users="$(find "$package_dir" -type f \( -iname '*.dll' -o -iname '*.exe' \) -print0 \
    | while IFS= read -r -d '' file; do
        if objdump -p "$file" 2>/dev/null | grep -i 'DLL Name' \
          | grep -q -i -E 'vcruntime|msvcp|ucrtbase|api-ms-win-crt|concrt|vcomp'; then
          echo "${file#"$package_dir"/}"
        fi
      done)"
  if [[ -n "$crt_users" ]]; then
    echo "These files need the Visual C++ runtime, which the installer does not ship yet:" >&2
    echo "$crt_users" >&2
    echo "See game/docs/installer.md, \"Visual C++ runtime\"." >&2
    exit 1
  fi
  echo "VC++ runtime check: no file in the build imports it"
else
  echo "warning: objdump not found; skipped the Visual C++ runtime check" >&2
fi

# 4. Inno Setup -----------------------------------------------------------------------------------
find_iscc() {
  if [[ -n "${ISCC:-}" ]]; then
    echo "$ISCC"
    return
  fi
  local candidates=("/mnt/c/Program Files (x86)/Inno Setup 6/ISCC.exe" "/mnt/c/Program Files/Inno Setup 6/ISCC.exe")
  local local_app_data
  local_app_data="$(cmd.exe /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
  if [[ -n "$local_app_data" ]]; then
    candidates+=("$(wslpath -u "$local_app_data")/Programs/Inno Setup 6/ISCC.exe")
  fi
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return
    fi
  done
}
iscc="$(find_iscc)"
if [[ -z "$iscc" || ! -f "$iscc" ]]; then
  echo "Inno Setup 6 not found. Install it (winget install JRSoftware.InnoSetup) or set ISCC." >&2
  exit 2
fi

iscc_args=(/Q "/DAppVersion=$version" "/DSourceDir=$(wslpath -w "$package_dir")" "/DOutputDir=$(wslpath -w "$BUILDS_DIR")")
icon="${RB_APP_ICON:-$GAME_DIR/installer/RingsideBooker.ico}"
if [[ -f "$icon" ]]; then
  iscc_args+=("/DSetupIcon=$(wslpath -w "$icon")")
else
  echo "No app icon ($icon): the installer uses Inno Setup's default icon"
fi
if [[ -n "${RB_SIGNTOOL:-}" ]]; then
  iscc_args+=("/DSignToolName=rbsign" "/Srbsign=$RB_SIGNTOOL")
  echo "Signing with RB_SIGNTOOL"
fi

setup="$BUILDS_DIR/RingsideBooker-Setup-$version.exe"
rm -f "$setup"
"$iscc" "${iscc_args[@]}" "$(wslpath -w "$ISS")"
if [[ ! -f "$setup" ]]; then
  echo "ISCC finished but $setup is missing" >&2
  exit 1
fi

setup_bytes="$(stat -c %s "$setup")"
echo "== Done"
echo "Installer: $setup ($(awk -v b="$setup_bytes" 'BEGIN { printf "%.1f MB", b / 1048576 }'), $setup_bytes bytes)"
