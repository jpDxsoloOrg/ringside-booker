#!/usr/bin/env bash
# Cuts a release of the Windows game (POL9-01).
#
#   game/tools/release.sh [alpha|patch|minor|major] [--dry-run]
#
# The version of the build in progress is Unity's bundleVersion (game/ProjectSettings/
# ProjectSettings.asset), e.g. 0.1.0-alpha.1. The script:
#   1. checks it runs on a clean main equal to origin/main, with something under ## Unreleased
#      in CHANGELOG.md;
#   2. moves the Unreleased notes under "## [<version>] - <today>", commits
#      "chore(release): v<version>" and tags v<version>;
#   3. bumps bundleVersion to the next version (default alpha: 0.1.0-alpha.1 -> 0.1.0-alpha.2;
#      patch/minor/major start that version's alpha.1) with a fresh, empty ## Unreleased, and
#      commits "chore: start <next>";
#   4. writes the release notes to game/Builds/release-notes-v<version>.md and PRINTS the push,
#      package, draft-release and upload commands. It never pushes or publishes anything.
#
# --dry-run prints the versions and the notes and changes nothing.
# Env: RB_RELEASE_SKIP_GIT_CHECKS=1 skips the clean-main check (tests in a scratch clone);
#      RB_RELEASE_DATE=YYYY-MM-DD overrides today's date (SOURCE_DATE_EPOCH is also honoured).
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$(cd "$TOOLS_DIR/.." && pwd)"
REPO_DIR="$(cd "$GAME_DIR/.." && pwd)"
SETTINGS="$GAME_DIR/ProjectSettings/ProjectSettings.asset"
CHANGELOG="$REPO_DIR/CHANGELOG.md"

kind=alpha
dry_run=false
for arg in "$@"; do
  case "$arg" in
    alpha | patch | minor | major) kind="$arg" ;;
    --dry-run) dry_run=true ;;
    -h | --help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

version="$(sed -n 's/^  bundleVersion: //p' "$SETTINGS")"
if [[ ! "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-(alpha|beta)\.([0-9]+))?$ ]]; then
  echo "bundleVersion '$version' is not x.y.z or x.y.z-alpha.N" >&2
  exit 1
fi
major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
pre="${BASH_REMATCH[5]:-}" pre_n="${BASH_REMATCH[6]:-0}"
case "$kind" in
  alpha)
    if [[ -n "$pre" ]]; then next="$major.$minor.$patch-$pre.$((pre_n + 1))"
    else next="$major.$minor.$((patch + 1))-alpha.1"; fi ;;
  patch) next="$major.$minor.$((patch + 1))-alpha.1" ;;
  minor) next="$major.$((minor + 1)).0-alpha.1" ;;
  major) next="$((major + 1)).0.0-alpha.1" ;;
esac
tag="v$version"
if [[ -n "${RB_RELEASE_DATE:-}" ]]; then today="$RB_RELEASE_DATE"
elif [[ -n "${SOURCE_DATE_EPOCH:-}" ]]; then today="$(date -u -d "@$SOURCE_DATE_EPOCH" +%F)"
else today="$(date -u +%F)"; fi

# The Unreleased notes (everything between "## Unreleased" and the next "## ").
notes="$(awk '/^## /{ if (on) exit; if ($0 ~ /^## Unreleased/) { on=1; next } } on' "$CHANGELOG")"
if [[ -z "$(printf '%s' "$notes" | grep -E '^[-*] ' || true)" ]]; then
  echo "CHANGELOG.md has nothing under ## Unreleased; add the notes first" >&2
  exit 1
fi
if grep -q "^## \[$version\]" "$CHANGELOG"; then
  echo "CHANGELOG.md already has a section for $version" >&2
  exit 1
fi

echo "Release:  $version ($tag, $today)"
echo "Next:     $next"
echo "Notes:"
printf '%s\n' "$notes" | sed 's/^/  /'

if [[ "$dry_run" == true ]]; then
  echo "(dry run: nothing changed)"
  exit 0
fi

if [[ "${RB_RELEASE_SKIP_GIT_CHECKS:-}" != 1 ]]; then
  branch="$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)"
  [[ "$branch" == main ]] || { echo "Release from main (on $branch)" >&2; exit 1; }
  [[ -z "$(git -C "$REPO_DIR" status --porcelain)" ]] || { echo "The working tree is not clean" >&2; exit 1; }
  git -C "$REPO_DIR" fetch -q origin main
  [[ "$(git -C "$REPO_DIR" rev-parse HEAD)" == "$(git -C "$REPO_DIR" rev-parse origin/main)" ]] \
    || { echo "main is not equal to origin/main; pull or push first" >&2; exit 1; }
fi
if git -C "$REPO_DIR" rev-parse -q --verify "refs/tags/$tag" > /dev/null; then
  echo "Tag $tag already exists" >&2
  exit 1
fi

# 2. Date the Unreleased section and tag.
python3 - "$CHANGELOG" "$version" "$today" <<'PY'
import sys
path, version, today = sys.argv[1:4]
text = open(path, encoding="utf-8").read()
marker = "## Unreleased\n"
if marker not in text:
    sys.exit("CHANGELOG.md has no '## Unreleased' line")
text = text.replace(marker, f"## Unreleased\n\n## [{version}] - {today}\n", 1)
open(path, "w", encoding="utf-8", newline="\n").write(text)
PY
git -C "$REPO_DIR" add CHANGELOG.md
git -C "$REPO_DIR" commit -q -m "chore(release): $tag"
git -C "$REPO_DIR" tag -a "$tag" -m "Ringside Booker $tag"
echo "Committed and tagged $tag"

# 3. Start the next version.
sed -i "s/^  bundleVersion: .*/  bundleVersion: $next/" "$SETTINGS"
git -C "$REPO_DIR" add "$SETTINGS"
git -C "$REPO_DIR" commit -q -m "chore: start $next"
echo "bundleVersion is now $next"

# 4. Notes file and the commands (printed, never run).
mkdir -p "$GAME_DIR/Builds"
notes_file="$GAME_DIR/Builds/release-notes-$tag.md"
printf '%s\n' "$notes" | sed -e '/./,$!d' > "$notes_file"
zip="game/Builds/RingsideBooker-$version-win64.zip"
prerelease=""
[[ "$version" == *-* ]] && prerelease=" --prerelease"
cat <<EOF

Next steps (run them yourself):
  git push origin main $tag
  git checkout $tag && game/tools/package-windows.sh && git checkout main
  gh release create $tag --draft$prerelease --verify-tag --title "Ringside Booker $tag" --notes-file "${notes_file#"$REPO_DIR"/}"
  gh release upload $tag $zip
EOF
