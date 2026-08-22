#!/bin/sh
# Strips AI/tool attribution trailers from the commit message.
# The commit history should record what changed and why, not which tool
# happened to type it. Runs on every commit, so nothing depends on a
# human or an agent remembering.
set -e

msg_file="$1"
[ -f "$msg_file" ] || exit 0

# -i '' is BSD/macOS; GNU sed needs a bare -i.
if sed --version >/dev/null 2>&1; then
  sed -i -E '/^[[:space:]]*(Co-[Aa]uthored-[Bb]y:.*(claude|anthropic|noreply@anthropic)|🤖[[:space:]]*Generated with|Generated with \[?Claude|Assisted-[Bb]y:.*claude).*$/Id' "$msg_file"
else
  sed -i '' -E '/^[[:space:]]*(Co-[Aa]uthored-[Bb]y:.*(claude|anthropic|noreply@anthropic)|🤖[[:space:]]*Generated with|Generated with \[?Claude|Assisted-[Bb]y:.*claude).*$/Id' "$msg_file"
fi

# Collapse any trailing blank lines the removal left behind.
awk 'BEGIN{n=0} {lines[NR]=$0} END{last=NR; while(last>0 && lines[last] ~ /^[[:space:]]*$/) last--; for(i=1;i<=last;i++) print lines[i]}' "$msg_file" > "$msg_file.tmp"
mv "$msg_file.tmp" "$msg_file"
