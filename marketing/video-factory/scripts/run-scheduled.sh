#!/bin/bash
# Scheduled entry point for the autopilot. Called by the launchd agent in
# ~/Library/LaunchAgents/com.drift.videofactory.plist
#
# launchd gives a job a near-empty environment — no PATH to speak of, no shell
# profile, no nvm. Everything the run needs has to be resolved here.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$REPO/autopilot.log"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"; }

# Keep the log from growing without bound.
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1000000 ]; then
  tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  log "[wrapper] log truncated to last 500 lines"
fi

# Node lives under nvm here, and that path carries the exact version number —
# it changes on every Node upgrade. Resolve it at run time rather than baking a
# path into the plist that will quietly stop existing.
resolve_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  if [ -f "$HOME/.nvm/alias/default" ]; then
    local alias_v candidate
    alias_v="$(cat "$HOME/.nvm/alias/default")"
    for candidate in "$HOME/.nvm/versions/node/v${alias_v}"*/bin/node; do
      [ -x "$candidate" ] && { echo "$candidate"; return; }
    done
  fi
  # Newest installed nvm version, then the usual system locations.
  local newest
  newest="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
  [ -x "${newest:-}" ] && { echo "$newest"; return; }
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
  return 1
}

NODE="$(resolve_node)" || {
  log "[wrapper] FATAL: could not find node. Install it or add it to a standard location."
  exit 1
}

export PATH="$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO" || { log "[wrapper] FATAL: cannot cd to $REPO"; exit 1; }

# launchd does not tell a job which StartCalendarInterval fired, so derive the
# slot from the clock. It only steers which theme the run picks, so the exact
# boundaries do not need to match the schedule precisely.
HOUR=$(date +%H)
if   [ "$HOUR" -lt 12 ]; then SLOT=0
elif [ "$HOUR" -lt 18 ]; then SLOT=1
else                          SLOT=2
fi

log "[wrapper] starting autopilot (slot $SLOT) with $NODE ($("$NODE" -v))"
"$NODE" scripts/autopilot.mjs --slot "$SLOT" "$@" >> "$LOG" 2>&1
STATUS=$?
log "[wrapper] finished with exit code $STATUS"
exit $STATUS
