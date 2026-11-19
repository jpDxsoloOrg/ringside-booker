#!/usr/bin/env bash
# Opens the Unity project in batch mode so every script compiles, then quits.
# Log: game/Logs/compile.log. Exit code: 0 clean, 1 compile errors or Unity failure.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/unity-common.sh"

LOG="$LOG_DIR/compile.log"
echo "Compiling $GAME_DIR_WIN with Unity $UNITY_VERSION (log: $LOG)"
run_unity "$LOG"
status=$?

if print_compile_errors "$LOG"; then
  echo "Compile FAILED (compiler errors above)" >&2
  exit 1
fi
if [[ $status -ne 0 ]]; then
  echo "Unity exited with $status; see $LOG" >&2
  tail -n 30 "$LOG" >&2
  exit 1
fi
echo "Compile clean"
