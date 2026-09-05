#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Auto-commit hook for the 804re.com site  (Stop event — fires when Claude
#  finishes a task, and on /clear, /compact and resume).
#
#  Commits whatever changed so nothing is left sitting uncommitted, then prints
#  a reminder saying how many commits are waiting to go out.
#
#  It deliberately does NOT push. On this repo a push to origin IS the deploy:
#  Cloudflare Pages rebuilds from GitHub (see push-live.bat), so pushing
#  automatically would put every half-finished edit on the live site. Say
#  "push" in chat, or run push-live.bat.
#
#  Every failure path exits 0 and silently. A hook that breaks the session is
#  worse than a hook that skipped a commit.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

status=$(git status --porcelain 2>/dev/null) || exit 0
[ -n "$status" ] || exit 0          # nothing changed: stay quiet

# Name up to 4 changed files in the commit message. A rename line reads
# "R  old -> new", and $NF picks the new name. paste -sd takes a LIST of
# delimiters that it cycles through, so it gets a single comma and the
# spaces are added afterwards.
count=$(printf '%s\n' "$status" | wc -l | tr -d ' ')
files=$(printf '%s\n' "$status" | awk '{print $NF}' | head -4 | paste -sd, -)
files=${files//,/, }
[ "$count" -gt 4 ] && files="$files, +$((count - 4)) more"
# Drop quotes and backslashes so the JSON at the bottom stays valid: git
# quotes unusual filenames and escapes their bytes as \357, which is not a
# legal JSON escape. (${files//\\/} looks like it would do this but does
# not actually strip backslashes in bash — tr does.) Backslash first in the
# tr set, or it reads as a dangling escape and warns.
files=$(printf %s "$files" | tr -d "\\\\\"")

git add -A >/dev/null 2>&1 || exit 0
git commit -q -m "Claude: $files" >/dev/null 2>&1 || exit 0

sha=$(git rev-parse --short HEAD 2>/dev/null)
ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "")
if [ -n "$ahead" ]; then
  note="$ahead unpushed"
else
  note="unpushed"
fi

printf '{"systemMessage":"Committed %s - %s (%s). Say \\"push\\" to send it live to 804re.com."}\n' \
  "$sha" "$files" "$note"
