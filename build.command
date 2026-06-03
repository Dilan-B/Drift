#!/bin/bash
# build.command — copies latest code, installs EAS CLI, kicks off cloud build
OUTPUTS="$(dirname "$0")"
DEST=~/Desktop/Drift

echo "========================================"
echo "  Drift — EAS Build Setup"
echo "========================================"
echo ""

# Copy updated files
echo "📋 Copying updated files..."
cp "$OUTPUTS/Drift.jsx"          "$DEST/Drift.jsx"
cp "$OUTPUTS/PoseCamera.jsx"     "$DEST/PoseCamera.jsx"
cp "$OUTPUTS/SocialScreen.jsx"   "$DEST/SocialScreen.jsx"
cp "$OUTPUTS/ChallengeModal.jsx" "$DEST/ChallengeModal.jsx"
cp "$OUTPUTS/PaywallScreen.jsx"  "$DEST/PaywallScreen.jsx"
cp "$OUTPUTS/supabase.js"        "$DEST/supabase.js"
cp "$OUTPUTS/package.json"       "$DEST/package.json"
cp "$OUTPUTS/app.json"           "$DEST/app.json"
cp "$OUTPUTS/babel.config.js"    "$DEST/babel.config.js"
cp "$OUTPUTS/eas.json"           "$DEST/eas.json"
mkdir -p "$DEST/assets"
cp "$OUTPUTS/assets/movenet.tflite" "$DEST/assets/movenet.tflite"
echo "   ✓ All files copied"
echo ""

cd "$DEST" || exit 1

# Install EAS CLI globally
echo "📦 Installing EAS CLI..."
npm install -g eas-cli
echo ""

# Install new dependencies
echo "📦 Installing new packages (this takes a minute)..."
npm install --legacy-peer-deps
echo ""

# Push code to GitHub first
echo "⬆️  Pushing code to GitHub..."
find .git -name "*.lock" -delete 2>/dev/null
git add -A
git commit -m "feat: friends screen time, challenge system, paywall — Supabase social layer" 2>/dev/null || true
git push --force "https://Riri626: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@github.com/Riri626/home-buddy.git" main
echo ""

# Login to EAS (opens browser)
echo "🔐 Logging into Expo (browser will open)..."
eas login
echo ""

# Kick off the cloud build
echo "🏗️  Starting EAS Build (cloud build — takes ~15 min)..."
echo "    You'll get a QR code link to install when it's done."
eas build -p ios --profile development
echo ""

read -p "Press Enter to close..."
