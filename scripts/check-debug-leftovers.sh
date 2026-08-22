#!/bin/sh
# Blocks debug scaffolding and untracked TODOs from entering the history.
# Staged files only, so it never punishes you for pre-existing code.
set -e

staged=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.tsx?$' || true)
[ -z "$staged" ] && exit 0

fail=0

# Focused tests silently disable the rest of the suite.
if echo "$staged" | xargs grep -nE '\b(describe|it|test)\.only\b' 2>/dev/null; then
  echo "✖ Focused test (.only) found — it would silently skip the rest of the suite."
  fail=1
fi

if echo "$staged" | xargs grep -nE '^\s*debugger\s*;?\s*$' 2>/dev/null; then
  echo "✖ debugger statement found."
  fail=1
fi

# A TODO without a ticket reference is a TODO nobody will ever action.
if echo "$staged" | xargs grep -nE '(TODO|FIXME|HACK|XXX)' 2>/dev/null \
    | grep -vE '(TODO|FIXME|HACK|XXX)\([A-Z]+[0-9]*-[0-9]+\)' ; then
  echo "✖ Untracked TODO/FIXME. Reference a ticket, e.g. // TODO(S1-04): wire the scanner."
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Commit blocked. Override with --no-verify only if you know why."
  exit 1
fi
