#!/usr/bin/env bash
# Benchmark `vt lint` on a vault, across the three modes that matter:
# full (walk + checks + suggestions), --no-suggestions, and --only drift
# (walk + index only). Usage:
#
#   scripts/bench-lint.sh <vault-dir> <label> [vt-command...]
#
# The optional trailing args override the `vt` binary, e.g.
#   scripts/bench-lint.sh ~/vault dev node /path/to/dist/cli.js
# defaults to the installed `vt` on PATH.
set -u
repo="$1"; label="$2"; shift 2
if [ "$#" -gt 0 ]; then vt_cmd=("$@"); else vt_cmd=(vt); fi
cd "$repo" || exit 1
files=$(find . -name '*.md' -not -path './.git/*' | wc -l | tr -d ' ')
echo "== $label ($files md files on disk) =="
for mode in "" "--no-suggestions" "--only drift"; do
  s=$(python3 -c 'import time;print(time.time())')
  # shellcheck disable=SC2086 -- $mode is intentionally word-split
  "${vt_cmd[@]}" lint --quiet $mode >/dev/null 2>&1
  e=$(python3 -c 'import time;print(time.time())')
  echo "  ${mode:-full}: $(python3 -c "print(f'{$e-$s:.1f}s')")"
done
