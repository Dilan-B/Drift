#!/usr/bin/env node
// tr() calls that run at module load (not inside a function or getter). Those
// see the language that was active when the bundle evaluated, so they're only
// correct because App.js loads the language BEFORE requiring the app and a
// language change reloads the JS bundle. Files reached from index.js before
// that point (places.js) must not have any.
const fs = require("fs"), path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const ROOT = path.resolve(__dirname, "../..");
for (const f of fs.readdirSync(ROOT).filter((f) => /\.(js|jsx)$/.test(f))) {
  const ast = parse(fs.readFileSync(path.join(ROOT, f), "utf8"), { sourceType: "module", plugins: ["jsx"] });
  let n = 0;
  traverse(ast, { CallExpression(p) { if (p.node.callee.name === "tr" && !p.getFunctionParent()) n++; } });
  if (n) console.log(String(n).padStart(4), f);
}
