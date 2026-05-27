#!/bin/bash
cd "$(dirname "$0")"

echo "========================================"
echo "  Drift — pull, open, run"
echo "========================================"
echo ""

# Clear any stale git locks
find .git -name "*.lock" -delete 2>/dev/null
echo "🔓 Git locks cleared"

# Pull latest from GitHub
echo "⬇️  Pulling latest from GitHub..."
git pull "https://Riri626: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@github.com/Riri626/home-buddy.git" main
echo ""

# Install deps if node_modules is missing or package.json changed
if [ ! -d "node_modules" ]; then
  echo "📦 node_modules missing — installing..."
  npm install --legacy-peer-deps
  echo ""
fi

# Open in Cursor
echo "🖥️  Opening in Cursor..."
open -a Cursor "$(pwd)"
sleep 1

# Start Expo
echo "🚀 Starting Expo (scan QR code with Expo Go)..."
echo "   Press Ctrl+C to stop."
echo ""
npx expo start
