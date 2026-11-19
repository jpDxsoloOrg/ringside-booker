#!/usr/bin/env bash
# Times the embedded engine (load bundle, new game, advance N days, world hashes) in Unity.
#   game/tools/engine-benchmark.sh [days]            batch-mode editor   (log: game/Logs/engine-benchmark-editor.log)
#   game/tools/engine-benchmark.sh --player [days]   built Windows player (log: game/Logs/engine-benchmark-player.log)
# Needs the engine bundle (npm run build:engine-bundle) and, for --player, a build
# (game/tools/unity-build-windows.sh). Compare the hashes with Node: see game/docs/runtime.md.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/unity-common.sh"

mode=editor
if [[ "${1:-}" == "--player" ]]; then
  mode=player
  shift
fi
days="${1:-365}"

if [[ ! -f "$GAME_DIR/Assets/StreamingAssets/engine/engine.js" ]]; then
  echo "Engine bundle missing: run npm run build:engine-bundle at the repo root" >&2
  exit 2
fi

LOG="$LOG_DIR/engine-benchmark-$mode.log"
if [[ $mode == editor ]]; then
  echo "Engine benchmark in the batch-mode editor, $days days (log: $LOG)"
  run_unity "$LOG" -executeMethod RingsideBooker.Engine.EditorTools.EngineBenchmarkBatch.Run -engineBenchmarkDays "$days"
  status=$?
else
  EXE="$GAME_DIR/Builds/Windows/RingsideBooker.exe"
  if [[ ! -f "$EXE" ]]; then
    echo "Player not built: run game/tools/unity-build-windows.sh" >&2
    exit 2
  fi
  echo "Engine benchmark in the Windows player, $days days (log: $LOG)"
  rm -f "$LOG"
  "$EXE" -batchmode -nographics -logFile "$(wslpath -w "$LOG")" -engineBenchmark -engineBenchmarkDays "$days" >/dev/null
  status=$?
fi

grep -F '[EngineBenchmark]' "$LOG" | sed 's/\r$//'
if [[ $status -ne 0 ]] || ! grep -qF '[EngineBenchmark] RESULT' "$LOG"; then
  echo "Engine benchmark FAILED (exit $status); see $LOG" >&2
  exit 1
fi
