#!/bin/bash
cd ~/Desktop/Drift/ios || exit 1

echo "🔧 Patching Podfile for C++20 (fixes folly/coro/Coroutine.h)..."

python3 - <<'PYEOF'
import re

with open('Podfile', 'r') as f:
    content = f.read()

cxx20_snippet = """
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
    end
  end"""

# Check if already patched
if "CLANG_CXX_LANGUAGE_STANDARD" in content:
    print("✅ Podfile already patched — skipping.")
elif "post_install do |installer|" in content:
    # Insert inside existing post_install block
    content = content.replace(
        "post_install do |installer|",
        "post_install do |installer|" + cxx20_snippet
    )
    with open('Podfile', 'w') as f:
        f.write(content)
    print("✅ Patched existing post_install block.")
else:
    # Append a new post_install block
    content += """
post_install do |installer|""" + cxx20_snippet + """
end
"""
    with open('Podfile', 'w') as f:
        f.write(content)
    print("✅ Added new post_install block.")
PYEOF

echo ""
echo "📦 Running pod install..."
pod install

echo ""
echo "✅ Done! Go back to Xcode and press ▶ Run."
