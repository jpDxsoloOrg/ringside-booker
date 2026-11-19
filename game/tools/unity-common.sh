# Shared helpers for the Unity batch-mode scripts (sourced, not run).
# Override the editor with UNITY_EXE=/mnt/c/.../Unity.exe if it lives elsewhere.

UNITY_VERSION="6000.6.9f1"
UNITY_EXE="${UNITY_EXE:-/mnt/c/Program Files/Unity/Hub/Editor/${UNITY_VERSION}/Editor/Unity.exe}"

GAME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$GAME_DIR/Logs"

if [[ ! -x "$UNITY_EXE" && ! -f "$UNITY_EXE" ]]; then
  echo "Unity editor not found: $UNITY_EXE (set UNITY_EXE)" >&2
  exit 2
fi

if ! command -v wslpath >/dev/null 2>&1; then
  echo "wslpath not found: these scripts run from WSL against the Windows Unity editor" >&2
  exit 2
fi

case "$GAME_DIR" in
  /mnt/[a-z]/*) ;;
  *) echo "warning: $GAME_DIR is not on a Windows drive; Unity on Windows is slow or fails on \\\\wsl\$ paths" >&2 ;;
esac

mkdir -p "$LOG_DIR"
GAME_DIR_WIN="$(wslpath -w "$GAME_DIR")"

# run_unity <log file> <extra Unity args...>; returns Unity's exit code.
run_unity() {
  local log="$1"
  shift
  rm -f "$log"
  "$UNITY_EXE" -batchmode -nographics -quit \
    -projectPath "$GAME_DIR_WIN" \
    -logFile "$(wslpath -w "$log")" \
    "$@"
}

# print_compile_errors <log file>; prints C# compiler errors, returns 0 if there were any.
print_compile_errors() {
  local log="$1"
  grep -E 'error CS[0-9]+' "$log" | sort -u | grep . \
    || grep -E 'Scripts have compiler errors' "$log"
}
