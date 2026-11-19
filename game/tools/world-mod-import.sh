#!/usr/bin/env bash
# Imports a workshop world mod through the embedded engine in the Unity editor (batch mode), starts a
# new game in it and plays 7 days (RingsideBooker.EditorTools.WorldModImportSmoke). Logs counts and
# timings only. The engine bundle must be built first (npm run build:engine-bundle).
#
#   game/tools/world-mod-import.sh [<mod folder (Windows or WSL path)>] [--roster-only]
#
# With no folder, the first mod found in the Steam libraries is used. Log: game/Logs/world-mod-import.log.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/unity-common.sh"

args=()
for arg in "$@"; do
  case "$arg" in
    --roster-only) args+=(-rosterOnly) ;;
    /mnt/*) args+=(-worldModFolder "$(wslpath -w "$arg")") ;;
    *) args+=(-worldModFolder "$arg") ;;
  esac
done

LOG="$LOG_DIR/world-mod-import.log"
echo "Importing a workshop world mod with Unity $UNITY_VERSION (log: $LOG)"
run_unity "$LOG" -executeMethod RingsideBooker.EditorTools.WorldModImportSmoke.RunBatch "${args[@]}"
status=$?
grep -F '[WorldModImport]' "$LOG" | sed 's/^/  /'
if print_compile_errors "$LOG"; then
  echo "Compile FAILED" >&2
  exit 1
fi
exit $status
