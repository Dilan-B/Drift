#!/bin/bash
cd "$(dirname "$0")"

echo "🔄 Drift — fixing React Native version mismatch..."
echo ""
echo "🗑️  Removing old node_modules (required for major version change)..."
rm -rf node_modules package-lock.json

echo ""
echo "📦 Installing correct SDK 54 dependencies..."
npm install --legacy-peer-deps

echo ""
echo "🚀 Starting Expo (scan QR code with Expo Go)..."
echo "   Press Ctrl+C to stop."
echo ""
npx expo start
