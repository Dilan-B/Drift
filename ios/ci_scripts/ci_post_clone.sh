#!/bin/sh
set -euo pipefail

# Node.js. Older Xcode Cloud images didn't ship it; newer ones do. `brew install`
# exits NON-ZERO when the formula is already present, and `set -e` turns that
# into a failed build before anything is even compiled — so only install when
# node is genuinely missing.
if ! command -v node >/dev/null 2>&1; then
  echo "--- node not found, installing via Homebrew"
  brew install node
else
  echo "--- node already present: $(node --version)"
fi

# Install JS dependencies from the repo root
echo "--- npm install"
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

# Install CocoaPods dependencies
echo "--- pod install"
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
pod install

echo "--- ci_post_clone complete"
