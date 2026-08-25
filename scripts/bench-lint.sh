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
  # $mode is intentionally word-split: unquoted so an empty mode passes no
  # extra arg, and "--only drift" splits into two args.
  # shellcheck disable=SC2086
  "${vt_cmd[@]}" lint --quiet $mode >/dev/null 2>&1
  rc=$?
  # `vt lint` exits 1 when the vault simply has lint issues (normal on real
  # vaults — not a bench failure) and 2+ on real errors; a missing binary
  # gives 127. Only >1 is an actual failure worth aborting the bench for.
  if [ "$rc" -gt 1 ]; then
    echo "  ${mode:-full}: FAILED (exit $rc)" >&2
    exit "$rc"
  fi
  e=$(python3 -c 'import time;print(time.time())')
  echo "  ${mode:-full}: $(python3 -c "print(f'{$e-$s:.1f}s')")"
done
