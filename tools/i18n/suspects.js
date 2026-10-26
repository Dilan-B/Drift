#!/usr/bin/env node
// Broader net than leftovers.js: capitalised English literals anywhere that
// aren't in tr(), console.*, imports, styles or obvious protocol calls. Noisy
// on purpose — read it, don't trust it.
const fs = require("fs"), path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const ROOT = path.resolve(__dirname, "../..");
const only = process.argv[2];
for (const f of fs.readdirSync(ROOT).filter((f) => /\.(js|jsx)$/.test(f))) {
  if (only && f !== only) continue;
  const code = fs.readFileSync(path.join(ROOT, f), "utf8");
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  traverse(ast, {
    "StringLiteral|TemplateLiteral"(p) {
      const v = p.node.type === "StringLiteral" ? p.node.value : p.node.quasis.map((q) => q.value.cooked).join("…");
      if (!/^[^a-z]*[A-Z][a-z]+/.test(v.trim()) && !/[a-z]+ [a-z]+/.test(v)) return;
      if (/^[A-Za-z]+$/.test(v) && v.length < 3) return;
      const par = p.parentPath;
      if (par.isImportDeclaration() || par.isExportAllDeclaration()) return;
      if (par.isObjectProperty() && par.node.key === p.node) return;
      if (par.isJSXAttribute()) { const n = par.node.name.name; if (/^(testID|nativeID|key|name|style|source|icon|kind|type|mode|variant|tone)$/.test(n)) return; }
      const call = p.findParent((pp) => pp.isCallExpression());
      if (call) {
        const c = call.node.callee;
        const nm = c.type === "Identifier" ? c.name : (c.property && c.property.name) || "";
        const obj = c.type === "MemberExpression" && c.object.type === "Identifier" ? c.object.name : "";
        if (nm === "tr" || obj === "console" || /^(require|getItem|setItem|removeItem|from|select|eq|rpc|invoke|channel|on|track|trackScreen|warn|log|error|fetch|addEventListener|Error|test|match|replace|split|join|includes|startsWith|endsWith|format)$/.test(nm)) return;
      }
      if (p.findParent((pp) => pp.isNewExpression() && pp.node.callee.name === "Error")) return;
      if (p.findParent((pp) => pp.isCallExpression() && pp.node.callee.object && pp.node.callee.object.name === "StyleSheet")) return;
      const line = p.node.loc.start.line;
      console.log(`${f}:${line}  ${v.replace(/\n/g, "⏎").slice(0, 100)}`);
    },
  });
}
