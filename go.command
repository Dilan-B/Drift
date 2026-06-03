#!/bin/bash
# Kill any existing expo/metro on 8081 or 8082
kill $(lsof -t -i:8081) 2>/dev/null || true
kill $(lsof -t -i:8082) 2>/dev/null || true
sleep 1
cd ~/Desktop/Drift || exit 1
echo "Starting Expo..."
npx expo start --clear
