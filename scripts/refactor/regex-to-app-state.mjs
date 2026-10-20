#!/usr/bin/env node
// Codemod: rewrite renderer-source regex assertions after lets-to-state.mjs.
// A regex naming a state binding `x` becomes one naming `appState.x` only when
// it matched the old renderer, stopped matching, and the rewrite matches again.
// Patterns that never matched the renderer may target another file, so they
// are listed for review instead of rewritten.
// Usage: node scripts/refactor/regex-to-app-state.mjs <old-renderer.js> test/*.test.js
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");
const { rendererSource } = require("../../test/helpers/renderer-source.js");

const [oldFile, ...files] = process.argv.slice(2);
const oldSource = fs.readFileSync(oldFile, "utf8");
const newSource = rendererSource();
const stateText = fs.readFileSync(new URL("../../src/ui/core/app-state.js", import.meta.url), "utf8");
const fields = Object.keys(new Function(stateText.replace(/^export const appState = /m, "return "))());
const fieldPattern = new RegExp(`(?<![\\w$.]|\\\\\\.)(${fields.join("|")})(?![\\w$])(?!\\s*:)`, "g");

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach(item => walk(item, visit));
    else if (child && typeof child.type === "string") walk(child, visit);
  }
}

const unresolved = [];
const neverMatched = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes("rendererSource")) continue;
  const ast = acorn.parse(text, { ecmaVersion: "latest", ranges: true, locations: true, allowReturnOutsideFunction: true });
  const edits = [];
  walk(ast, node => {
    if (!node.regex) return;
    const { pattern, flags } = node.regex;
    const rewritten = pattern.replace(fieldPattern, "appState\\.$1");
    if (rewritten === pattern) return;
    const before = new RegExp(pattern, flags);
    const after = new RegExp(rewritten, flags);
    if (!before.test(oldSource)) {
      neverMatched.push(`${file}:${node.loc.start.line} /${pattern}/`);
      return;
    }
    if (before.test(newSource)) return;
    if (!after.test(newSource)) {
      unresolved.push(`${file}:${node.loc.start.line} /${pattern}/`);
      return;
    }
    edits.push({ start: node.range[0], end: node.range[1], text: `/${rewritten}/${flags}` });
  });
  edits.sort((a, b) => b.start - a.start);
  let output = text;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (edits.length) {
    fs.writeFileSync(file, output);
    console.log(`${file}: ${edits.length} regex(es) rewritten`);
  }
}
for (const line of unresolved) console.log(`UNRESOLVED ${line}`);
for (const line of neverMatched) console.log(`REVIEW (never matched renderer) ${line}`);
