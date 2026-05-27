#!/bin/bash
cd "$(dirname "$0")"

echo "🔓 Clearing git locks..."
find .git -name "*.lock" -delete 2>/dev/null
rm -f .git/MERGE_HEAD .git/CHERRY_PICK_HEAD 2>/dev/null

echo "📦 Staging all changes..."
git add -A

echo "💾 Committing..."
git commit -m "feat: camera-based rep detection — frame-diff motion tracking" 2>/dev/null || echo "ℹ️  Nothing new to commit"

echo "⬆️  Pushing to GitHub..."
git push "https://Riri626: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@github.com/Riri626/home-buddy.git" main

echo ""
echo "✅ Done! In ~/Desktop/Drift run:"
echo "   npm install --legacy-peer-deps && npx expo start"
echo ""
read -p "Press Enter to close..."
