#!/bin/sh
# overlay-diff.sh <leaf-layer> <repo-path>
# Throwaway stand-in for `gauge plan`. Follows `parent` from the leaf
# layer to the root, overlays each layer's files/ root to leaf in a temp
# dir, and compares every managed path with the repo by class: owned and
# pointer byte for byte and by mode (git's index in a git checkout,
# else the file), merged by its rsb:containment region only,
# sample reported only. Prints path and class per difference.
# Exit 0: no difference. 1: differences. 2: usage or setup error.

usage() {
  echo "usage: overlay-diff.sh <leaf-layer> <repo-path>" >&2
  exit 2
}

[ $# -eq 2 ] || usage
leaf=$1
repo=$2
[ -d "$repo" ] || { echo "overlay-diff: $repo is not a directory" >&2; exit 2; }

profiles=$(cd "$(dirname "$0")/.." && pwd) || exit 2
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT

# One line per layer, root first: "layer <name>". Then one line per managed
# path, nearest layer to the leaf winning: "file <class>\t<path>".
python3 -I - "$profiles" "$leaf" >"$tmp/plan" <<'EOF' || exit 2
import sys, tomllib
from pathlib import Path

profiles, name = Path(sys.argv[1]), sys.argv[2]
classes = {"owned", "pointer", "merged", "sample"}
chain = []
while name:
    if name in [n for n, _ in chain]:
        sys.exit(f"overlay-diff: parent cycle at {name}")
    manifest = profiles / name / "profile.toml"
    try:
        with open(manifest, "rb") as f:
            data = tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError) as e:
        sys.exit(f"overlay-diff: {manifest}: {e}")
    if data.get("name") != name:
        sys.exit(f"overlay-diff: {manifest}: name is not {name}")
    layer_files = data.get("files", {})
    for path, cls in layer_files.items():
        if cls not in classes:
            sys.exit(f"overlay-diff: {manifest}: {path} has unknown class {cls}")
    chain.append((name, layer_files))
    name = data.get("parent", "")

files = {}
for layer, layer_files in reversed(chain):
    print(f"layer {layer}")
    files.update(layer_files)
for path, cls in sorted(files.items()):
    print(f"file {cls}\t{path}")
EOF

mkdir "$tmp/overlay" || exit 2
while read -r kind rest; do
  [ "$kind" = layer ] || continue
  if [ -d "$profiles/$rest/files" ]; then
    cp -pR "$profiles/$rest/files/." "$tmp/overlay/" || exit 2
  fi
done <"$tmp/plan"

region() {
  sed -n '/rsb:containment:begin/,/rsb:containment:end/p' "$1"
}

# A file's mode as git records it, 755 or 644, from the owner's execute bit.
stat_mode() {
  m=$(stat -c %a "$1") || return 1
  m=${m#"${m%???}"}
  case ${m%??} in
    1|3|5|7) echo 755 ;;
    *) echo 644 ;;
  esac
}

# The repo file's mode: from git's index when the repo is a git checkout
# and tracks the path, else from the file itself.
repo_mode() {
  if [ "$in_git" = yes ]; then
    m=$(git -C "$repo" ls-files -s -- "$1") || return 1
    if [ -n "$m" ]; then
      m=${m%% *}
      echo "${m#100}"
      return 0
    fi
  fi
  stat_mode "$repo/$1"
}

in_git=no
if [ "$(git -C "$repo" rev-parse --is-inside-work-tree 2>/dev/null)" = true ]; then in_git=yes; fi

tab=$(printf '\t')
diffs=0
while IFS="$tab" read -r head path; do
  case $head in file\ *) ;; *) continue ;; esac
  class=${head#file }
  want="$tmp/overlay/$path"
  have="$repo/$path"
  if [ ! -f "$want" ]; then
    echo "overlay-diff: $path ($class) has no template in any layer" >&2
    exit 2
  fi
  if [ ! -f "$have" ]; then
    echo "$path $class missing"
    diffs=1
    continue
  fi
  case $class in
    owned|pointer)
      cmp -s "$want" "$have"
      rc=$?
      [ $rc -le 1 ] || exit 2
      [ $rc -eq 0 ] || { echo "$path $class"; diffs=1; }
      want_mode=$(stat_mode "$want") || exit 2
      have_mode=$(repo_mode "$path") || exit 2
      [ "$want_mode" = "$have_mode" ] || { echo "$path $class mode"; diffs=1; }
      ;;
    merged)
      region "$want" >"$tmp/want.region" || exit 2
      region "$have" >"$tmp/have.region" || exit 2
      if [ ! -s "$tmp/want.region" ]; then
        echo "overlay-diff: $path template has no rsb:containment region" >&2
        exit 2
      fi
      cmp -s "$tmp/want.region" "$tmp/have.region"
      rc=$?
      [ $rc -le 1 ] || exit 2
      [ $rc -eq 0 ] || { echo "$path $class"; diffs=1; }
      ;;
    sample)
      cmp -s "$want" "$have" || echo "$path $class (reported only)"
      ;;
  esac
done <"$tmp/plan"

exit $diffs
