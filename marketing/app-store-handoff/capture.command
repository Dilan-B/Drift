#!/bin/bash
# capture.command — App Store media capture helper (macOS + Xcode required)
#
# Boots an iPhone 16 Pro Max simulator and gives you a menu for taking
# screenshots and recording clips. Everything is written at the simulator's
# native resolution — 1290 x 2796 — which is exactly Apple's 6.9" App Store
# requirement. No bezels, no cropping, no upscaling.
#
# Usage:  chmod +x capture.command  &&  ./capture.command
# Output: ./captures/

set -u

DEVICE="${DRIFT_SIM_DEVICE:-iPhone 16 Pro Max}"
OUT="$(cd "$(dirname "$0")" && pwd)/captures"

mkdir -p "$OUT"

if ! xcrun simctl help >/dev/null 2>&1; then
  echo "✗ Xcode command line tools not found."
  echo "  Install Xcode, then run: xcode-select --install"
  exit 1
fi

# Find the device. If the preferred one isn't installed, list what is and let
# the user pick via DRIFT_SIM_DEVICE rather than guessing wrong.
UDID="$(xcrun simctl list devices available | grep -F "$DEVICE (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"

if [ -z "$UDID" ]; then
  echo "✗ Simulator \"$DEVICE\" not available. Installed 6.9\"-class devices:"
  echo
  xcrun simctl list devices available | grep -E "iPhone (1[6-9]|[2-9][0-9]).*(Pro Max|Plus)" | sed 's/^/   /'
  echo
  echo "  Re-run with one of them, e.g.:"
  echo "    DRIFT_SIM_DEVICE=\"iPhone 17 Pro Max\" ./capture.command"
  echo
  echo "  Or add one in Xcode > Window > Devices and Simulators."
  exit 1
fi

echo "▸ Booting $DEVICE"
xcrun simctl boot "$UDID" 2>/dev/null   # already-booted is fine
open -a Simulator
echo "▸ Waiting for boot…"
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1

echo
echo "──────────────────────────────────────────────────"
echo "  Drift capture · $DEVICE"
echo "  Output: $OUT"
echo "──────────────────────────────────────────────────"
echo
echo "  BEFORE YOU START — set the stage in the app:"
echo "    · 3-4 realistic tasks queued (not 'test')"
echo "    · a streak with some history"
echo "    · some earned time on the clock"
echo "    · capture every screen in BOTH light and dark"
echo

REC_PID=""

cleanup() {
  if [ -n "$REC_PID" ] && kill -0 "$REC_PID" 2>/dev/null; then
    echo
    echo "▸ Stopping recording…"
    kill -INT "$REC_PID" 2>/dev/null
    wait "$REC_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

while true; do
  if [ -n "$REC_PID" ] && kill -0 "$REC_PID" 2>/dev/null; then
    STATUS="● RECORDING"
  else
    STATUS="○ idle"
    REC_PID=""
  fi

  echo "  [$STATUS]"
  echo "   s  screenshot          r  start recording"
  echo "   x  stop recording      o  open output folder"
  echo "   q  quit"
  printf "  > "
  read -r key

  case "$key" in
    s)
      printf "     name (enter for timestamp): "
      read -r name
      [ -z "$name" ] && name="shot-$(date +%H%M%S)"
      safe="$(echo "$name" | tr ' ' '-' | tr -cd '[:alnum:]-_')"
      file="$OUT/$safe.png"
      if xcrun simctl io "$UDID" screenshot "$file" 2>/dev/null; then
        dim="$(sips -g pixelWidth -g pixelHeight "$file" 2>/dev/null | awk '/pixel/{printf "%s ", $2}')"
        echo "     ✓ $safe.png  [${dim}]"
      else
        echo "     ✗ screenshot failed"
      fi
      ;;
    r)
      if [ -n "$REC_PID" ]; then
        echo "     already recording — press x to stop"
      else
        printf "     clip name (enter for timestamp): "
        read -r name
        [ -z "$name" ] && name="clip-$(date +%H%M%S)"
        safe="$(echo "$name" | tr ' ' '-' | tr -cd '[:alnum:]-_')"
        xcrun simctl io "$UDID" recordVideo --codec h264 --force "$OUT/$safe.mov" >/dev/null 2>&1 &
        REC_PID=$!
        sleep 1
        echo "     ● recording -> $safe.mov   (press x to stop)"
        echo "       keep it to 5-8s, one beat per clip"
      fi
      ;;
    x)
      if [ -z "$REC_PID" ]; then
        echo "     not recording"
      else
        kill -INT "$REC_PID" 2>/dev/null
        wait "$REC_PID" 2>/dev/null
        REC_PID=""
        sleep 1
        echo "     ✓ saved"
      fi
      ;;
    o) open "$OUT" ;;
    q)
      cleanup
      REC_PID=""
      echo
      echo "▸ Captures in: $OUT"
      echo "▸ Next: open screenshot-studio.html and drop the stills in."
      exit 0
      ;;
    *) ;;
  esac
  echo
done
