#!/usr/bin/env bash
# Builds the Windows 64-bit player via BuildScripts.BuildWindows in batch mode.
# Output: game/Builds/Windows/RingsideBooker.exe. Log: game/Logs/build.log.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/unity-common.sh"

LOG="$LOG_DIR/build.log"
EXE="$GAME_DIR/Builds/Windows/RingsideBooker.exe"
echo "Building Windows player with Unity $UNITY_VERSION (log: $LOG)"
run_unity "$LOG" -buildTarget Win64 -executeMethod BuildScripts.BuildWindows
status=$?

if print_compile_errors "$LOG"; then
  echo "Build FAILED: compiler errors above" >&2
  exit 1
fi
grep -E '^\[BuildScripts\]' "$LOG"
if [[ $status -ne 0 || ! -f "$EXE" ]]; then
  echo "Build FAILED (Unity exit $status); see $LOG" >&2
  tail -n 30 "$LOG" >&2
  exit 1
fi
echo "Built $EXE"
