#!/usr/bin/env node
/**
 * tools/i18n/scan.js — rebuild i18n/keys.json from the source of truth: every
 * tr("literal") call in the app, plus i18n/server-keys.json (copy that edge
 * functions send), i18n/native-keys.json (shield / widget / notification
 * copy in the Swift extensions) and i18n/plist-keys.json (iOS permission
 * prompts → <lang>.lproj/InfoPlist.strings). Run after any copy change, then
 * `node tools/i18n/status.js` to see what each language is missing.
 */
const fs = require("fs"), path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const ROOT = path.resolve(__dirname, "../..");
const keys = {};
const add = (k, where) => { (keys[k] = keys[k] || []).length < 3 && keys[k].push(where); };
const files = fs.readdirSync(ROOT).filter((f) => /\.(js|jsx)$/.test(f)).map((f) => path.join(ROOT, f));
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const ast = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] });
  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.type !== "Identifier" || p.node.callee.name !== "tr") return;
      const a = p.node.arguments[0];
      if (a && a.type === "StringLiteral") add(a.value, `${rel}:${a.loc.start.line}`);
      else if (a && a.type === "TemplateLiteral" && a.expressions.length === 0) add(a.quasis[0].value.cooked, `${rel}:${a.loc.start.line}`);
    },
  });
}
for (const extra of ["server-keys.json", "native-keys.json", "plist-keys.json"]) {
  const p = path.join(ROOT, "i18n", extra);
  if (fs.existsSync(p)) for (const [k, w] of Object.entries(JSON.parse(fs.readFileSync(p, "utf8")))) add(k, w[0]);
}
const sorted = Object.fromEntries(Object.keys(keys).sort().map((k) => [k, keys[k]]));
fs.writeFileSync(path.join(ROOT, "i18n", "keys.json"), JSON.stringify(sorted, null, 1) + "\n");
const words = Object.keys(sorted).reduce((a, k) => a + k.split(/\s+/).length, 0);
console.log(`${Object.keys(sorted).length} keys, ~${words} words`);
