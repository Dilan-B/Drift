#!/bin/bash
set -e

echo "=== Rewrite ReanimatedMountHook.h with exact base-class signature ==="
H=$(find ~/Desktop/Drift/node_modules/react-native-reanimated -name "ReanimatedMountHook.h" 2>/dev/null | head -1)
CPP=$(find ~/Desktop/Drift/node_modules/react-native-reanimated -name "ReanimatedMountHook.cpp" 2>/dev/null | head -1)

# Rewrite header completely to ensure exact signature match
cat > "$H" << 'EOF'
#pragma once
#ifdef RCT_NEW_ARCH_ENABLED

#include <reanimated/Fabric/PropsRegistry.h>
#include <reanimated/Fabric/ShadowTreeCloner.h>

#include <react/renderer/uimanager/UIManagerMountHook.h>

#include <memory>

namespace reanimated {

using namespace facebook::react;

class ReanimatedMountHook : public UIManagerMountHook {
 public:
  ReanimatedMountHook(
      const std::shared_ptr<PropsRegistry> &propsRegistry,
      const std::shared_ptr<UIManager> &uiManager);
  ~ReanimatedMountHook() noexcept;

  void shadowTreeDidMount(
      const RootShadowNode::Shared &rootShadowNode,
      HighResTimeStamp mountTime) noexcept override;

 private:
  const std::shared_ptr<PropsRegistry> propsRegistry_;
  const std::shared_ptr<UIManager> uiManager_;
};

} // namespace reanimated

#endif // RCT_NEW_ARCH_ENABLED
EOF

echo "Rewrote header: $H"

# Fix the cpp to match the new header signature
python3 - "$CPP" << 'PYEOF'
import sys
path = sys.argv[1]
with open(path, 'r') as f:
    src = f.read()

# Replace any variant of the shadowTreeDidMount definition with the correct one
import re
src = re.sub(
    r'void ReanimatedMountHook::shadowTreeDidMount\([^{]+\) noexcept \{',
    'void ReanimatedMountHook::shadowTreeDidMount(\n    const RootShadowNode::Shared &rootShadowNode,\n    HighResTimeStamp /*mountTime*/) noexcept {',
    src,
    flags=re.DOTALL
)
with open(path, 'w') as f:
    f.write(src)
print(f"Fixed impl: {path}")
PYEOF

echo ""
echo "Done! Go back to Xcode and press Run."
