#!/usr/bin/env node
// tr() must never feed data: a query filter, a storage key, a comparison. This
// flags tr() calls inside calls that move data rather than show it.
const fs = require("fs"), path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const ROOT = path.resolve(__dirname, "../..");
const DATA = /^(or|eq|neq|in|is|like|ilike|filter|match|contains|select|order|from|rpc|insert|update|upsert|getItem|setItem|removeItem|channel|track|identify|startsWith|endsWith|includes|indexOf|test|localeCompare|getPublicUrl|upload|invoke|openURL)$/;
let n = 0;
for (const f of fs.readdirSync(ROOT).filter((f) => /\.(js|jsx)$/.test(f))) {
  const ast = parse(fs.readFileSync(path.join(ROOT, f), "utf8"), { sourceType: "module", plugins: ["jsx"] });
  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.name !== "tr") return;
      const outer = p.findParent((pp) => pp.isFunction() || ((pp.isCallExpression() || pp.isOptionalCallExpression()) && pp.node.callee.property && DATA.test(pp.node.callee.property.name)));
      const cmp = p.parentPath.isBinaryExpression() && /^(===|!==|==|!=)$/.test(p.parentPath.node.operator);
      if ((outer && !outer.isFunction()) || cmp) { n++; console.log(`${f}:${p.node.loc.start.line}  ${(outer && !outer.isFunction() ? outer.node.callee.property.name : "compare")}`); }
    },
  });
}
console.log(n ? `${n} suspicious` : "clean");
