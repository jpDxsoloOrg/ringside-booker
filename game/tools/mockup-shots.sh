#!/usr/bin/env bash
# Takes the UNITY-11 mockup screenshot tour with a built player (tools/unity-build-windows.sh first).
# Usage: tools/mockup-shots.sh <output dir> [WIDTHxHEIGHT ...]   (default sizes: 1920x1080 1280x720)
# Writes <output dir>/<WxH>/NN-<state>-<WxH>.png plus player.log; exit 1 if a run fails.
set -uo pipefail
GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXE="$GAME_DIR/Builds/Windows/RingsideBooker.exe"
OUT="${1:?usage: mockup-shots.sh <output dir> [WxH ...]}"
shift
SIZES=("$@")
[[ ${#SIZES[@]} -eq 0 ]] && SIZES=(1920x1080 1280x720)
[[ -f "$EXE" ]] || { echo "No player at $EXE (run tools/unity-build-windows.sh)" >&2; exit 2; }

status=0
for size in "${SIZES[@]}"; do
  width="${size%x*}"
  height="${size#*x}"
  dir="$OUT/$size"
  rm -rf "$dir"
  mkdir -p "$dir"
  win="$(wslpath -w "$dir")"
  echo "Mockup tour at ${width}x${height} -> $dir"
  timeout 300 "$EXE" -screen-width "$width" -screen-height "$height" -screen-fullscreen 0 \
    -rbMockupShots "$win" -logFile "$win\\player.log"
  if ! grep -q "\[MockupShots\] done" "$dir/player.log"; then
    echo "Tour at $size failed; see $dir/player.log" >&2
    status=1
  fi
  ls "$dir"/*.png 2>/dev/null | wc -l | xargs echo "  screenshots:"
done
exit $status
