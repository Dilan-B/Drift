#!/bin/bash
# Drift launcher — double-click me to run the app
cd "$(dirname "$0")"

echo "🔒 Drift — Work for your scroll"
echo ""

if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies (first run only)..."
  npm install
  echo ""
fi

echo "🚀 Starting Expo web..."
echo "   The app will open in your browser automatically."
echo "   Press Ctrl+C to stop."
echo ""

npx expo start --web
