#!/bin/bash
cd "$(dirname "$0")"

REPO_OWNER="Riri626"
REPO_NAME="home-buddy"
REPO_URL="https://github.com/$REPO_OWNER/$REPO_NAME.git"

echo "========================================"
echo "  Drift → GitHub push"
echo "========================================"
echo ""

# Clear any stale git locks
rm -f .git/index.lock .git/MERGE_HEAD 2>/dev/null

# Set identity + credential helper
git config user.name  "Riaan Sanghani"
git config user.email "riaan.sanghani@outlook.com"
git config credential.helper osxkeychain

# Set remote
git remote remove origin 2>/dev/null
git remote add origin "$REPO_URL"

# Stage + commit (idempotent — skips if nothing new)
git add -A
if ! git diff --cached --quiet; then
  git commit -m "Initial Drift app — Expo SDK 54 / React Native 0.81"
  echo "✅ Committed"
else
  echo "ℹ️  Nothing new to commit"
fi

git branch -M main

echo ""
echo "Opening GitHub Personal Access Token page in your browser..."
echo "  → Sign in to GitHub if needed"
echo "  → Click 'Generate new token (classic)'"
echo "  → Give it any name, tick the 'repo' checkbox, click Generate"
echo "  → COPY the token (starts with ghp_...)"
echo ""
open "https://github.com/settings/tokens/new?scopes=repo&description=drift-push"

echo ""
read -p "Paste your token here and press Enter: " TOKEN
echo ""

if [ -z "$TOKEN" ]; then
  echo "❌ No token entered. Aborting."
  read -p "Press Enter to close..."
  exit 1
fi

# Push using the token embedded in the URL (never echoed to screen)
PUSH_URL="https://$REPO_OWNER:$TOKEN@github.com/$REPO_OWNER/$REPO_NAME.git"
git push "$PUSH_URL" main

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Done! Your project is live at:"
  echo "   https://github.com/$REPO_OWNER/$REPO_NAME"
else
  echo ""
  echo "❌ Push failed. Double-check the token has 'repo' scope and try again."
fi

echo ""
read -p "Press Enter to close..."
