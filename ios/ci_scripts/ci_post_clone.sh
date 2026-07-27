#!/bin/sh
set -euo pipefail

# Install Node.js via Homebrew (Xcode Cloud images don't include it)
brew install node

# Install JS dependencies from the repo root
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

# Install CocoaPods dependencies
cd "$CI_PRIMARY_REPOSITORY_PATH/ios"
pod install
