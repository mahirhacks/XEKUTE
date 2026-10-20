#!/usr/bin/env node
// Codemod: point renderer source-reading tests at test/helpers/renderer-source.js.
// Every read of src/ui/bootstrap.js becomes rendererSource(), and every vm
// context in those files is wrapped with withAppState(). Safe to rerun.
// Usage: node scripts/refactor/tests-to-renderer-source.mjs test/*.test.js
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");

const isBootstrapRead = (node, text) =>
  node.type === "CallExpression" &&
  /bootstrap\.js["']/.test(text.slice(...node.range)) &&
  ((node.callee.type === "MemberExpression" && node.callee.property.name === "readFileSync") ||
    (node.callee.type === "Identifier" && node.callee.name === "read" && node.arguments.length === 1));

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach(item => walk(item, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}

for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, "utf8");
  const ast = acorn.parse(text, { ecmaVersion: "latest", sourceType: "script", ranges: true, allowHashBang: true, allowReturnOutsideFunction: true });
  const edits = [];
  let reads = 0;
  walk(ast, node => {
    if (isBootstrapRead(node, text)) {
      edits.push({ start: node.range[0], end: node.range[1], text: "rendererSource()" });
      reads++;
    }
  });
  if (!reads) continue;
  walk(ast, node => {
    if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression") return;
    const method = node.callee.property.name;
    const index = method === "createContext" ? 0 : method === "runInNewContext" ? 1 : -1;
    const arg = node.arguments[index];
    if (index < 0 || !arg || text.slice(...arg.range).startsWith("withAppState(")) return;
    edits.push({ start: arg.range[0], end: arg.range[0], text: "withAppState(" });
    edits.push({ start: arg.range[1], end: arg.range[1], text: ")" });
  });
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let output = text;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (!output.includes("helpers/renderer-source.js")) {
    let helper = path.relative(path.dirname(file), "test/helpers/renderer-source.js").replace(/\\/g, "/");
    if (!helper.startsWith(".")) helper = `./${helper}`;
    const names = output.includes("withAppState(") ? "rendererSource, withAppState" : "rendererSource";
    const line = `const { ${names} } = require("${helper}");\n`;
    const anchor = output.match(/^(?:"use strict";\r?\n)?(?:\r?\n)?/)[0].length;
    output = output.slice(0, anchor) + line + output.slice(anchor);
  }
  fs.writeFileSync(file, output);
  console.log(`${file}: ${reads} read(s)`);
}
