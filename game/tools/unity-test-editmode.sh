#!/usr/bin/env bash
# Runs the Unity EditMode tests in batch mode (Unity Test Framework).
#
#   game/tools/unity-test-editmode.sh [<test filter, e.g. RingsideBooker.Import.Tests>]
#
# Results: game/Logs/editmode-results.xml; log: game/Logs/editmode-tests.log. Exit 0 when all pass.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/unity-common.sh"

LOG="$LOG_DIR/editmode-tests.log"
RESULTS="$LOG_DIR/editmode-results.xml"
rm -f "$LOG" "$RESULTS"
filter=()
if [[ $# -gt 0 ]]; then filter=(-testFilter "$1"); fi
echo "Running EditMode tests with Unity $UNITY_VERSION (results: $RESULTS)"
# -runTests quits by itself; -quit would stop Unity before the tests run.
"$UNITY_EXE" -batchmode -nographics -projectPath "$GAME_DIR_WIN" -logFile "$(wslpath -w "$LOG")" \
  -runTests -testPlatform EditMode -testResults "$(wslpath -w "$RESULTS")" "${filter[@]}"
status=$?
if print_compile_errors "$LOG"; then
  echo "Compile FAILED" >&2
  exit 1
fi
if [[ -f "$RESULTS" ]]; then
  grep -o '<test-run [^>]*>' "$RESULTS" | grep -o 'total="[0-9]*"\|passed="[0-9]*"\|failed="[0-9]*"\|skipped="[0-9]*"' | tr '\n' ' '
  echo
  grep -o '<test-case [^>]*result="Failed"[^>]*>' "$RESULTS" | grep -o 'fullname="[^"]*"' | sed 's/^/FAILED /'
else
  echo "No results file; see $LOG" >&2
  tail -n 30 "$LOG" >&2
fi
exit $status
