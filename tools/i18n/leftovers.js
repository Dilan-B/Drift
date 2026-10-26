#!/usr/bin/env node
// Lists English that is probably user-visible but not wrapped in tr():
// JSX text, and string literals sitting directly inside a <Text>'s children.
const fs = require("fs"), path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const ROOT = path.resolve(__dirname, "../..");
for (const f of fs.readdirSync(ROOT).filter((f) => /\.(js|jsx)$/.test(f))) {
  const code = fs.readFileSync(path.join(ROOT, f), "utf8");
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  traverse(ast, {
    JSXText(p) {
      if (/[A-Za-z]{2,}/.test(p.node.value)) console.log(`${f}:${p.node.loc.start.line}  TEXT  ${p.node.value.trim().slice(0, 90)}`);
    },
    StringLiteral(p) {
      const v = p.node.value;
      if (!/[A-Za-z]{3,}/.test(v) || !/\s/.test(v)) return;
      if (p.parentPath.isCallExpression() && p.parentPath.node.callee.name === "tr") return;
      if (p.parentPath.isImportDeclaration() || p.parentPath.isExportNamedDeclaration()) return;
      const inText = p.findParent((pp) => pp.isJSXElement() && /Text$/.test(pp.node.openingElement.name.name || ""));
      const ctx = p.findParent((pp) => pp.isJSXExpressionContainer());
      if (inText && ctx) console.log(`${f}:${p.node.loc.start.line}  LIT   ${v.slice(0, 90)}`);
    },
  });
}
