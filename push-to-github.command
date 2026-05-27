#!/bin/bash
cd "$(dirname "$0")"

REPO="https://github.com/Riri626/home-buddy.git"

echo "🚀 Pushing Drift project to GitHub..."
echo "   Repo: $REPO"
echo ""

# Init git if needed
if [ ! -d ".git" ]; then
  git init
  echo "✅ Git repo initialised"
fi

# Set remote
if git remote get-url origin &>/dev/null; then
  git remote set-url origin "$REPO"
else
  git remote add origin "$REPO"
fi
echo "✅ Remote set to $REPO"

# Stage everything
git add -A
echo "✅ Files staged"

# Commit (skip if nothing to commit)
if git diff --cached --quiet; then
  echo "ℹ️  Nothing new to commit"
else
  git commit -m "Initial Drift app — Expo SDK 54 / React Native 0.81"
  echo "✅ Committed"
fi

# Push
echo ""
echo "📤 Pushing to GitHub (you may be prompted for credentials)..."
git branch -M main
git push -u origin main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Done! Your code is live at:"
  echo "   https://github.com/Riri626/home-buddy"
else
  echo ""
  echo "❌ Push failed. If you see an auth error, make sure you:"
  echo "   1. Have git configured: git config --global user.name / user.email"
  echo "   2. Or use a Personal Access Token as your password"
  echo "   3. Or set up SSH: https://docs.github.com/en/authentication/connecting-to-github-with-ssh"
fi

echo ""
read -p "Press Enter to close..."
