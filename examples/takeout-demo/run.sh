#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
binary=${STILLPORT_BIN:-stillport}
output=${1:-"$PWD/stillport-demo-output"}
state=$(mktemp -d "${TMPDIR:-/tmp}/stillport-demo.XXXXXX")
trap 'rm -rf "$state"' EXIT HUP INT TERM

command -v "$binary" >/dev/null 2>&1 || {
  echo "Stillport is not on PATH. Set STILLPORT_BIN to its executable path." >&2
  exit 1
}

STILLPORT_HOME=$state "$binary" takeout import "$script_dir/Harbor" --json
search_result=$(
  STILLPORT_HOME=$state "$binary" search "fictional harbor" \
    --source takeout --limit 1 --json
)
printf '%s\n' "$search_result"
item_id=$(
  printf '%s\n' "$search_result" |
    sed -n 's/.*"id":"\([0-9a-f][0-9a-f]*\)".*/\1/p'
)
[ -n "$item_id" ] || {
  echo "The demo fixture was not found in its isolated index." >&2
  exit 1
}
STILLPORT_HOME=$state "$binary" preview "$item_id" \
  --source takeout --out "$output" --json
