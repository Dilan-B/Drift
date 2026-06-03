#!/bin/bash
OUTPUTS_DIR="$(dirname "$0")"
DEST=~/Desktop/Drift

echo "========================================"
echo "  Drift — deploy + push + run"
echo "========================================"
echo ""

# ── 1. Copy updated files into ~/Desktop/Drift ──────────────
echo "📋 Copying updated files to ~/Desktop/Drift..."
cp "$OUTPUTS_DIR/Drift.jsx"    "$DEST/Drift.jsx"    && echo "   ✓ Drift.jsx"
cp "$OUTPUTS_DIR/package.json" "$DEST/package.json" && echo "   ✓ package.json"
echo ""

# ── 2. Push to GitHub ────────────────────────────────────────
cd "$DEST" || { echo "❌ ~/Desktop/Drift not found"; read -p "Press Enter..."; exit 1; }

echo "🔓 Clearing git locks..."
find .git -name "*.lock" -delete 2>/dev/null
rm -f .git/MERGE_HEAD .git/CHERRY_PICK_HEAD 2>/dev/null

echo "📦 Staging all changes..."
git add -A

echo "💾 Committing..."
git commit -m "feat: accelerometer rep detection — replaces unreliable camera frame-diff" 2>/dev/null || echo "ℹ️  Nothing new to commit"

echo "⬆️  Pushing to GitHub..."
git push "https://Riri626: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@github.com/Riri626/home-buddy.git" main
echo ""

# ── 3. Reinstall + start ─────────────────────────────────────
echo "📦 Installing deps (expo-sensors added)..."
npm install --legacy-peer-deps
echo ""

echo "🚀 Starting Expo — scan QR with Expo Go..."
npx expo start

read -p "Press Enter to close..."
