#!/usr/bin/env node
// Codemod: replace text-offset slices of the renderer source in tests with
// rendererDefinitions(...names), so a test keeps loading the same declarations
// after they move into separate modules. Reads the log written by
// record-renderer-slices.cjs. A call site is rewritten only when every slice it
// took was the same run of whole top-level declarations; anything else (spans
// with statements, partial bodies, call sites that slice different spans) is
// listed for review. Index variables left unused afterwards are removed.
// Usage: node scripts/refactor/tests-to-named-definitions.mjs <slices.json>
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");
const { rendererDefinitions } = require("../../test/helpers/renderer-source.js");

const records = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const sites = new Map();
for (const record of records) {
  const key = `${record.file}:${record.line}:${record.column}`;
  if (!sites.has(key)) sites.set(key, { ...record, texts: new Set() });
  sites.get(key).texts.add(record.text);
}

function declarationNames(text) {
  let ast;
  try {
    ast = acorn.parse(text, { ecmaVersion: "latest", sourceType: "script" });
  } catch {
    return null;
  }
  const names = [];
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") names.push(node.id.name);
    else if (node.type === "VariableDeclaration" && node.declarations.length === 1 && node.declarations[0].id.type === "Identifier") names.push(node.declarations[0].id.name);
    else return null;
  }
  if (!names.length) return null;
  try {
    const rebuilt = rendererDefinitions(...names).replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    return rebuilt === text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim() ? names : null;
  } catch {
    return null;
  }
}

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach(item => walk(item, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}

const review = [];
const byFile = new Map();
for (const site of sites.values()) {
  const names = site.texts.size === 1 ? declarationNames([...site.texts][0]) : null;
  if (!names) {
    review.push(`${site.file}:${site.line}:${site.column} (${site.texts.size} distinct slice${site.texts.size > 1 ? "s" : ""})`);
    continue;
  }
  if (!byFile.has(site.file)) byFile.set(site.file, []);
  byFile.get(site.file).push({ ...site, names });
}

for (const [file, fileSites] of byFile) {
  let text = fs.readFileSync(file, "utf8");
  const ast = acorn.parse(text, { ecmaVersion: "latest", locations: true, ranges: true, allowReturnOutsideFunction: true });
  const edits = [];
  for (const site of fileSites) {
    let call = null;
    walk(ast, node => {
      if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.property.name !== "slice") return;
      const { start, end } = node.loc;
      const inside = (site.line > start.line || (site.line === start.line && site.column - 1 >= start.column))
        && (site.line < end.line || (site.line === end.line && site.column - 1 <= end.column));
      if (inside && (!call || node.range[0] >= call.range[0])) call = node;
    });
    if (!call) {
      review.push(`${file}:${site.line}:${site.column} (call not found)`);
      continue;
    }
    edits.push({ start: call.range[0], end: call.range[1], text: `rendererDefinitions(${site.names.map(name => JSON.stringify(name)).join(", ")})` });
  }
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);

  for (let changed = true; changed;) {
    changed = false;
    const tree = acorn.parse(text, { ecmaVersion: "latest", ranges: true, allowReturnOutsideFunction: true });
    for (const node of tree.body) {
      if (node.type !== "VariableDeclaration" || node.declarations.length !== 1) continue;
      const [declarator] = node.declarations;
      const init = declarator.init && text.slice(...declarator.init.range);
      if (declarator.id.type !== "Identifier" || !init || !/^\w+\.indexOf\(/.test(init)) continue;
      const uses = text.match(new RegExp(`\\b${declarator.id.name}\\b`, "g")).length;
      if (uses > 1) continue;
      let end = node.range[1];
      if (text[end] === "\r") end++;
      if (text[end] === "\n") end++;
      text = text.slice(0, node.range[0]) + text.slice(end);
      changed = true;
      break;
    }
  }
  if (!/rendererDefinitions[,\s}]/.test(text.slice(0, text.indexOf("\n", text.indexOf("helpers/renderer-source.js"))))) {
    text = text.replace(/const \{ ([^}]*) \} = require\("(\.\/|\.\.\/)?helpers\/renderer-source\.js"\);|const \{ ([^}]*) \} = require\("\.\/renderer-source\.js"\);/, match => match.replace(/\{ ([^}]*) \}/, (_, names) => `{ ${names.split(", ").concat("rendererDefinitions").join(", ")} }`));
  }
  fs.writeFileSync(file, text);
  console.log(`${file}: ${edits.length} slice(s) now load declarations by name`);
}
for (const line of review) console.log(`REVIEW ${line}`);
