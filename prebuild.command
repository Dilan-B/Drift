#!/bin/bash
cd ~/Desktop/Drift || exit 1

echo "🔨 Running Expo prebuild for iOS..."
echo "y" | npx expo prebuild --platform ios --clean

echo ""
echo "✅ Done! Opening Xcode..."
open ios/Drift.xcworkspace
