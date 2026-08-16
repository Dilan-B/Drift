#!/bin/sh
set -euo pipefail

# Retry a flaky network-bound step. Xcode Cloud runners hit npm and the
# CocoaPods CDN from a cold cache every run, and a single transient failure
# kills the whole build under `set -e` — builds 94 and 98 both died here while
# a sibling action on the same commit ran the identical script successfully.
retry() {
  attempt=1
  max=3
  while true; do
    if "$@"; then
      return 0
    fi
    if [ "$attempt" -ge "$max" ]; then
      echo "--- FAILED after $max attempts: $*"
      return 1
    fi
    echo "--- attempt $attempt failed, retrying in $((attempt * 10))s: $*"
    sleep $((attempt * 10))
    attempt=$((attempt + 1))
  done
}

# Node.js. Older Xcode Cloud images didn't ship it; newer ones do. `brew install`
# exits NON-ZERO when the formula is already present, and `set -e` turns that
# into a failed build before anything is even compiled — so only install when
# node is genuinely missing.
if ! command -v node >/dev/null 2>&1; then
  echo "--- node not found, installing via Homebrew"
  retry brew install node
else
  echo "--- node already present: $(node --version)"
fi

# Install JS dependencies from the repo root
echo "--- npm install"
cd "$CI_PRIMARY_REPOSITORY_PATH"
retry npm install

# Install CocoaPods dependencies
echo "--- pod install"
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
retry pod install

echo "--- ci_post_clone complete"
