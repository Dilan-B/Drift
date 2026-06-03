#!/bin/bash
cd ~/Desktop/Drift || exit 1
echo "⬆️  Force pushing to GitHub..."
git push --force "https://Riri626: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@github.com/Riri626/home-buddy.git" main
echo ""
echo "✅ Done! Now run in ~/Desktop/Drift:"
echo "   npm install --legacy-peer-deps && npx expo start"
echo ""
read -p "Press Enter to close..."
