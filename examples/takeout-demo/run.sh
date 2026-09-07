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
preview_result=$(
  STILLPORT_HOME=$state "$binary" preview "$item_id" \
    --source takeout --out "$output" --json
)
printf '%s\n' "$preview_result"

if [ "$(uname -s)" = "Darwin" ]; then
  preview_file=$(
    printf '%s\n' "$preview_result" |
      sed -n 's/.*"files":\["\([^"]*\)"\].*/\1/p'
  )
  [ -n "$preview_file" ] || {
    echo "Stillport did not return the demo preview path." >&2
    exit 1
  }
  cmp -s "$preview_file" "$script_dir/../../brand/demo-preview.jpg" || {
    echo "The generated preview no longer matches brand/demo-preview.jpg." >&2
    exit 1
  }
  printf '%s\n' '{"ok":true,"demoAssetMatches":true,"asset":"brand/demo-preview.jpg"}'
fi
