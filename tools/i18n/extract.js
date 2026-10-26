#!/usr/bin/env node
/**
 * tools/i18n/extract.js
 *
 *   node tools/i18n/extract.js            # dry run: report what would change
 *   node tools/i18n/extract.js --write    # rewrite sources to call tr()
 *   node tools/i18n/extract.js --keys     # (re)write i18n/keys.json only
 *
 * Finds user-visible English in the app's JS/JSX and wraps it in tr(). It is
 * deliberately conservative about WHERE it looks, because translating an
 * identifier breaks the app while missing a label only leaves it in English:
 *
 *   - JSX text, with sibling {expressions} folded into one parameterised
 *     string ("{{n}} min left") so translators see whole sentences
 *   - string / template literals in display props (title, placeholder, label…)
 *   - the same keys on object literals ({ label: "Work out" }); at module scope
 *     they become getters so the value is re-read after a language change
 *   - Alert.alert(...) title/message, and setError/setMsg-style setters
 *
 * Literals that look like ids, keys, URLs, colours or format strings are
 * skipped. Edits are spliced into the original text by offset, so formatting
 * and comments are untouched. i18n/keys.json lists every key with where it
 * came from — it is the input to translation.
 */
const fs = require("fs");
const path = require("path");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const ROOT = path.resolve(__dirname, "../..");
const WRITE = process.argv.includes("--write");
const KEYS_ONLY = process.argv.includes("--keys");

// Files that hold no user-facing copy (or whose strings are protocol, not UI).
const SKIP_FILES = new Set([
  "App.js", "index.js", "babel.config.js", "metro.config.js", "supabase.js",
  "analytics.js", "apiGuards.js", "theme.js", "Anim.jsx", "Skeleton.jsx",
  "Icons.jsx", "haptics.js", "sync.js", "screenTime.js", "blockedApps.js",
]);

const DISPLAY = new Set([
  "title", "subtitle", "sub", "label", "placeholder", "message", "text", "body",
  "cta", "ctaLabel", "kicker", "heading", "headline", "caption", "description",
  "desc", "hint", "emptyText", "buttonText", "buttonLabel", "confirmText",
  "cancelText", "question", "accessibilityLabel", "accessibilityHint", "tagline",
  "eyebrow", "note", "helper", "blurb", "detail", "lead", "line", "copy",
  "subLabel", "sublabel", "primaryLabel", "secondaryLabel", "doneLabel",
  "actionLabel", "titleText", "subtitleText", "short", "long", "tip", "why",
  "reason", "summary", "unit", "quote", "teaser", "prompt_ui", "badge", "chip",
  "button", "header", "footer", "empty", "success", "failure", "warning",
]);

// setX(...) calls whose argument is shown to the user.
const SETTER = /^set[A-Z]\w*(Err|Error|Msg|Message|Hint|Toast|Notice|Banner|Copy|Status)$/;
const SHOW_FN = new Set(["showToast", "toast", "flash", "notify", "showBanner"]);

function looksDisplayable(s) {
  if (!s || !/[A-Za-z]/.test(s)) return false;
  const t = s.trim();
  if (!t) return false;
  if (/^(https?:|mailto:|tel:|sms:|message:|itms|drift:|com\.|group\.|data:|file:|\.\/|\/)/.test(t)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(t) || /^rgba?\(/.test(t)) return false;
  if (/^[a-z0-9_.:\-\/]+$/.test(t)) return false;          // ids, keys, slugs
  if (/^[A-Z0-9_]+$/.test(t) && t.includes("_")) return false; // CONSTANT_IDS
  if (/^[A-Za-z]+[A-Z][a-z]+$/.test(t) && !t.includes(" ") && /[a-z][A-Z]/.test(t)) return false; // camelCase
  if (/^\W*$/.test(t)) return false;
  if (/^(ios|android|web|default|light|dark|cancel|destructive)$/i.test(t) && !/^Cancel$/.test(t)) {
    return /^(Cancel)$/.test(t);
  }
  return true;
}

// Babel's JSX whitespace rule (cleanJSXElementLiteralChild).
function cleanJSXText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let last = 0;
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i])) last = i;
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFirst = i === 0, isLast = i === lines.length - 1, isLastNonEmpty = i === last;
    let trimmed = line.replace(/\t/g, " ");
    if (!isFirst) trimmed = trimmed.replace(/^[ ]+/, "");
    if (!isLast) trimmed = trimmed.replace(/[ ]+$/, "");
    if (trimmed) {
      if (!isLastNonEmpty) trimmed += " ";
      out += trimmed;
    }
  }
  return out;
}

const q = (s) => JSON.stringify(s);

// Reads like UI copy: starts with a capital (after punctuation/quotes) and has
// a space, or ends like a sentence. Lowercase keyword lists ("fitness weights
// lifting") and identifiers don't qualify.
function isSentence(raw) {
  const t = (raw || "").trim();
  if (t.length < 4 || !/[a-z]{2,}/.test(t)) return false;
  if (/^(https?:|mailto:|\.\/|\/|[a-z]+:\/\/)/.test(t)) return false;
  if (/[{}<>;=]|\$\{|\\n?\s*select|^\s*(select|insert|update)\b/i.test(t)) return false;
  const startsCap = /^[^A-Za-z]*[A-Z][a-z]/.test(t);
  return (startsCap && /\s/.test(t)) || (/\s/.test(t) && /[.!?…]$/.test(t));
}

const EXCLUDED_CALLS = /^(require|getItem|setItem|removeItem|multiGet|multiSet|from|select|eq|neq|in|is|order|rpc|invoke|channel|on|track|trackScreen|identify|warn|log|error|info|debug|fetch|fetchWithTimeout|addEventListener|test|match|matchAll|replace|split|join|includes|startsWith|endsWith|indexOf|RegExp|openURL|canOpenURL|getPublicUrl|upload|insert|update|upsert|delete|send|postMessage|scheduleTask|defineTask|registerTaskAsync|tr|Symbol|localeCompare|createChannel|setNotificationChannelAsync)$/;

function excludedContext(p) {
  const par = p.parentPath;
  if (!par) return true;
  if (par.isImportDeclaration() || par.isExportAllDeclaration() || par.isExportNamedDeclaration()) return true;
  if (par.isObjectProperty() && par.node.key === p.node) return true;
  if (par.isObjectMethod() || par.isClassMethod()) return true;
  if (par.isBinaryExpression() && /^(===|!==|==|!=|in|instanceof)$/.test(par.node.operator)) return true;
  if (par.isSwitchCase()) return true;
  if (par.isMemberExpression() && par.node.property === p.node) return true;
  if (par.isTaggedTemplateExpression()) return true;
  if (par.isJSXAttribute()) return !DISPLAY.has(par.node.name.name);
  if (par.isNewExpression()) return true; // new Error("…"), new RegExp("…")
  // Nearest enclosing call, but stop at a function boundary: a literal inside
  // a callback belongs to that callback, not to whatever call received it.
  const call = p.findParent((pp) => pp.isFunction() || pp.isCallExpression() || pp.isOptionalCallExpression());
  if (call && call.isFunction()) return false;
  if (call) {
    const c = call.node.callee;
    const nm = c.type === "Identifier" ? c.name : (c.property && c.property.name) || "";
    const obj = c.type === "MemberExpression" && c.object.type === "Identifier" ? c.object.name : "";
    if (obj === "console" || obj === "AsyncStorage" || obj === "SecureStore" || EXCLUDED_CALLS.test(nm)) return true;
  }
  return false;
}

function paramName(node, used, src) {
  let base = null;
  if (node.type === "Identifier") base = node.name;
  else if (node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier") base = node.property.name;
  else if (node.type === "OptionalMemberExpression" && !node.computed && node.property.type === "Identifier") base = node.property.name;
  else if (node.type === "CallExpression" && node.callee.type === "Identifier") base = node.callee.name;
  else if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier") {
    base = node.callee.property.name === "toLocaleString" || node.callee.property.name === "toFixed"
      ? (node.callee.object.type === "Identifier" ? node.callee.object.name : null)
      : node.callee.property.name;
  }
  if (!base || !/^[A-Za-z_]\w*$/.test(base) || base.length > 24) base = "p";
  let name = base, i = 1;
  while (used.has(name) && used.get(name) !== src) name = `${base}${++i}`;
  used.set(name, src);
  return name;
}

function containsJSX(node) {
  let found = false;
  (function walk(n) {
    if (!n || found || typeof n !== "object") return;
    if (n.type === "JSXElement" || n.type === "JSXFragment") { found = true; return; }
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v);
    }
  })(node);
  return found;
}

function processFile(file, keys) {
  const code = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "objectRestSpread", "topLevelAwait"] });
  } catch (e) {
    console.error("parse failed", file, e.message);
    return null;
  }
  const rel = path.relative(ROOT, file);
  const edits = []; // { start, end, text }
  const claimed = []; // ranges already rewritten, to avoid nested double edits

  const isClaimed = (s, e) => claimed.some(([a, b]) => s >= a && e <= b);
  const claim = (s, e) => claimed.push([s, e]);
  const addKey = (k, line) => {
    if (!keys[k]) keys[k] = new Set();
    keys[k].add(`${rel}:${line}`);
  };

  /**
   * Source for an expression in display position, with display leaves
   * (string literals, templates, both arms of ternaries, the fallback side of
   * ||/??) rewritten to tr(...). Returns null when nothing in it is
   * translatable.
   */
  function displayExpr(node) {
    if (!node) return null;
    switch (node.type) {
      case "StringLiteral": {
        if (!looksDisplayable(node.value)) return null;
        addKey(node.value, node.loc.start.line);
        return `tr(${q(node.value)})`;
      }
      case "TemplateLiteral": {
        const raw = node.quasis.map((x) => x.value.cooked).join("");
        if (!/[A-Za-z]{2,}/.test(raw)) return null;
        const used = new Map();
        let key = "";
        const params = [];
        node.quasis.forEach((qq, i) => {
          key += qq.value.cooked;
          if (i < node.expressions.length) {
            const ex = node.expressions[i];
            const exSrc = code.slice(ex.start, ex.end);
            const name = paramName(ex, used, exSrc);
            key += `{{${name}}}`;
            const inner = displayExpr(ex);
            if (!params.some((p) => p.name === name)) params.push({ name, src: inner || exSrc });
          }
        });
        if (!looksDisplayable(key.replace(/\{\{\w+\}\}/g, ""))) return null;
        addKey(key, node.loc.start.line);
        if (!params.length) return `tr(${q(key)})`;
        return `tr(${q(key)}, { ${params.map((p) => (p.src === p.name ? p.name : `${p.name}: ${p.src}`)).join(", ")} })`;
      }
      case "ConditionalExpression": {
        const c = displayExpr(node.consequent), a = displayExpr(node.alternate);
        if (!c && !a) return null;
        return `${code.slice(node.test.start, node.test.end)} ? ${c || code.slice(node.consequent.start, node.consequent.end)} : ${a || code.slice(node.alternate.start, node.alternate.end)}`;
      }
      case "LogicalExpression": {
        const r = displayExpr(node.right);
        const l = node.operator === "&&" ? null : displayExpr(node.left);
        if (!r && !l) return null;
        return `${l || code.slice(node.left.start, node.left.end)} ${node.operator} ${r || code.slice(node.right.start, node.right.end)}`;
      }
      case "BinaryExpression": {
        if (node.operator !== "+") return null;
        // Flatten "a" + x + "b" into one template-style key.
        const parts = [];
        (function flat(n) {
          if (n.type === "BinaryExpression" && n.operator === "+") { flat(n.left); flat(n.right); } else parts.push(n);
        })(node);
        if (!parts.some((p) => p.type === "StringLiteral" && /[A-Za-z]{2,}/.test(p.value))) return null;
        const used = new Map();
        let key = "";
        const params = [];
        for (const p of parts) {
          if (p.type === "StringLiteral") key += p.value;
          else {
            const exSrc = code.slice(p.start, p.end);
            const name = paramName(p, used, exSrc);
            key += `{{${name}}}`;
            if (!params.some((x) => x.name === name)) params.push({ name, src: exSrc });
          }
        }
        if (!looksDisplayable(key.replace(/\{\{\w+\}\}/g, ""))) return null;
        addKey(key, node.loc.start.line);
        if (!params.length) return `tr(${q(key)})`;
        return `tr(${q(key)}, { ${params.map((p) => (p.src === p.name ? p.name : `${p.name}: ${p.src}`)).join(", ")} })`;
      }
      case "ParenthesizedExpression":
        return displayExpr(node.expression);
      default:
        return null;
    }
  }

  function rewrite(node, text) {
    if (isClaimed(node.start, node.end)) return;
    edits.push({ start: node.start, end: node.end, text });
    claim(node.start, node.end);
  }

  traverse(ast, {
    // 1. JSX children runs
    JSXElement(p) {
      const kids = p.node.children;
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const hasText = run.some((k) => k.type === "JSXText" && /[A-Za-z]{2,}/.test(k.value));
        if (!hasText) {
          // Bare {cond ? "A" : "B"} children: translate the leaves in place.
          for (const k of run) {
            if (k.type !== "JSXExpressionContainer") continue;
            const out = displayExpr(k.expression);
            if (out) rewrite(k.expression, out);
          }
          run = [];
          return;
        }
        const used = new Map();
        let key = "";
        const params = [];
        for (const k of run) {
          if (k.type === "JSXText") key += cleanJSXText(k.value);
          else {
            const ex = k.expression;
            const exSrc = code.slice(ex.start, ex.end);
            const name = paramName(ex, used, exSrc);
            key += `{{${name}}}`;
            const inner = displayExpr(ex);
            if (!params.some((x) => x.name === name)) params.push({ name, src: inner || exSrc });
          }
        }
        const lead = /^\s/.test(key), trail = /\s$/.test(key);
        key = key.trim();
        // Strip leading/trailing params so "{{n}} min" isn't forced on simple
        // label runs? No — keeping them gives translators word order.
        const words = key.replace(/\{\{\w+\}\}/g, "");
        // JSX text is shown by definition, so only require real words here —
        // lowercase connectives like "or" / "and" are copy too.
        if (!/[A-Za-z]{2,}/.test(words)) { run = []; return; }
        const first = run[0], last = run[run.length - 1];
        if (isClaimed(first.start, last.end)) { run = []; return; }
        addKey(key, first.loc.start.line);
        const idx0 = kids.indexOf(first), idx1 = kids.indexOf(last);
        const before = idx0 > 0 && kids[idx0 - 1].type !== "JSXText";
        const after = idx1 < kids.length - 1 && kids[idx1 + 1].type !== "JSXText";
        const call = params.length
          ? `tr(${q(key)}, { ${params.map((x) => (x.src === x.name ? x.name : `${x.name}: ${x.src}`)).join(", ")} })`
          : `tr(${q(key)})`;
        // Leading/trailing whitespace inside the original text: only
        // meaningful when it sits next to a sibling element.
        const text = `${lead && before ? '{" "}' : ""}{${call}}${trail && after ? '{" "}' : ""}`;
        // Keep surrounding newline/indent whitespace of the first/last JSXText.
        let s = first.start, e = last.end;
        if (first.type === "JSXText") s = first.start + (first.value.length - first.value.replace(/^\s+/, "").length);
        if (last.type === "JSXText") e = last.end - (last.value.length - last.value.replace(/\s+$/, "").length);
        edits.push({ start: s, end: e, text });
        claim(first.start, last.end);
        run = [];
      };
      for (const k of kids) {
        if (k.type === "JSXText") run.push(k);
        else if (k.type === "JSXExpressionContainer" && k.expression.type !== "JSXEmptyExpression" && !containsJSX(k.expression)) {
          // A lone expression with no text around it is not ours to own here;
          // its literals get handled by the expression visitor below.
          run.push(k);
        } else flush();
      }
      flush();
    },

    // 2. Display props: <X title="..." placeholder={cond ? "a" : "b"} />
    JSXAttribute(p) {
      const n = p.node;
      if (n.name.type !== "JSXIdentifier" || !DISPLAY.has(n.name.name) || !n.value) return;
      if (n.value.type === "StringLiteral") {
        if (!looksDisplayable(n.value.value)) return;
        addKey(n.value.value, n.loc.start.line);
        rewrite(n.value, `{tr(${q(n.value.value)})}`);
      } else if (n.value.type === "JSXExpressionContainer") {
        const out = displayExpr(n.value.expression);
        if (out) rewrite(n.value.expression, out);
      }
    },

    // 3. Object literal display keys
    ObjectProperty(p) {
      const n = p.node;
      if (n.computed || n.shorthand) return;
      const k = n.key.type === "Identifier" ? n.key.name : n.key.type === "StringLiteral" ? n.key.value : null;
      if (!k || !DISPLAY.has(k)) return;
      // Skip objects that are clearly data headed to the server.
      const call = p.findParent((pp) => pp.isCallExpression());
      if (call) {
        const cal = call.node.callee;
        const nm = cal.type === "MemberExpression" && cal.property.type === "Identifier" ? cal.property.name : "";
        if (/^(insert|update|upsert|invoke|rpc|eq|track|identify|send|post|fetch|stringify)$/.test(nm)) return;
        if (cal.type === "Identifier" && /^(track|fetch|fetchWithTimeout|invokeFamilyFn|logEvent)$/.test(cal.name)) return;
      }
      const out = displayExpr(n.value);
      if (!out) return;
      if (isClaimed(n.start, n.end)) return;
      const atModule = !p.getFunctionParent();
      if (atModule && p.parentPath.isObjectExpression()) {
        edits.push({ start: n.start, end: n.end, text: `get ${n.key.type === "Identifier" ? k : q(k)}() { return ${out}; }` });
        claim(n.start, n.end);
      } else {
        rewrite(n.value, out);
      }
    },

    // 5. Sentence pass: any literal that reads like copy ("Network error.
    //    Check your connection.") wherever it sits — error maps, validator
    //    returns, ternaries assigned to variables. Context exclusions keep
    //    protocol strings (storage keys, queries, comparisons) out.
    "StringLiteral|TemplateLiteral"(p) {
      const n = p.node;
      const raw = n.type === "StringLiteral" ? n.value : n.quasis.map((x) => x.value.cooked).join(" ");
      if (!isSentence(raw)) return;
      if (isClaimed(n.start, n.end)) return;
      if (excludedContext(p)) return;
      const out = displayExpr(n);
      if (out) rewrite(n, out);
    },

    // 4. Alert.alert(title, message, buttons) + display setters
    CallExpression(p) {
      const n = p.node, c = n.callee;
      const isAlert = c.type === "MemberExpression" && c.object.type === "Identifier" && c.object.name === "Alert"
        && c.property.type === "Identifier" && (c.property.name === "alert" || c.property.name === "prompt");
      const isSetter = c.type === "Identifier" && (SETTER.test(c.name) || SHOW_FN.has(c.name));
      if (!isAlert && !isSetter) return;
      const args = isAlert ? n.arguments.slice(0, 2) : n.arguments.slice(0, 1);
      for (const a of args) {
        const out = displayExpr(a);
        if (out) rewrite(a, out);
      }
    },
  });

  if (!edits.length) return { rel, count: 0 };
  edits.sort((a, b) => b.start - a.start);
  // Drop edits nested inside a later (outer) one.
  const kept = [];
  for (const e of edits) {
    if (kept.some((k) => e.start >= k.start && e.end <= k.end && !(e.start === k.start && e.end === k.end))) continue;
    if (kept.some((k) => e.start === k.start && e.end === k.end)) continue;
    kept.push(e);
  }
  let out = code;
  for (const e of kept.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // import { tr } from "./i18n"
  if (!/import\s*\{[^}]*\btr\b[^}]*\}\s*from\s*["'][./]*i18n["']/.test(out)) {
    const relImport = path.relative(path.dirname(file), path.join(ROOT, "i18n")).replace(/\\/g, "/");
    const spec = relImport.startsWith(".") ? relImport : `./${relImport}`;
    const lastImport = [...out.matchAll(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm)].pop();
    const line = `import { tr } from "${spec}";\n`;
    if (lastImport) {
      const at = lastImport.index + lastImport[0].length;
      out = out.slice(0, at) + "\n" + line.trimEnd() + out.slice(at);
    } else out = line + out;
  }
  if (WRITE) fs.writeFileSync(file, out);
  return { rel, count: kept.length };
}

function main() {
  const files = fs.readdirSync(ROOT)
    .filter((f) => /\.(js|jsx)$/.test(f) && !SKIP_FILES.has(f))
    .map((f) => path.join(ROOT, f));
  const keys = {};
  const report = [];
  for (const f of files) {
    const r = processFile(f, keys);
    if (r) report.push(r);
  }
  report.sort((a, b) => b.count - a.count);
  if (!KEYS_ONLY) for (const r of report) if (r.count) console.log(String(r.count).padStart(5), r.rel);
  const keyList = Object.keys(keys).sort();
  const outPath = path.join(ROOT, "i18n", "keys.json");
  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : {};
  const merged = {};
  for (const k of keyList) merged[k] = Array.from(keys[k]).slice(0, 3);
  // Keys already in tr() calls (from earlier runs / hand-written) are found by
  // scan.js; keep any we knew about so a re-run never drops them.
  for (const k of Object.keys(existing)) if (!merged[k]) merged[k] = existing[k];
  if (WRITE || KEYS_ONLY) fs.writeFileSync(outPath, JSON.stringify(merged, null, 1) + "\n");
  console.log(`\n${keyList.length} unique strings this pass, ${report.reduce((a, r) => a + r.count, 0)} edits${WRITE ? " (written)" : " (dry run)"}`);
}

main();
