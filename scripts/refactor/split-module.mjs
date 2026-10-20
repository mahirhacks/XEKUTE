#!/usr/bin/env node
// Codemod: move the top-level declarations in a line range of the renderer
// composition root into their own ES module, wiring imports both ways.
//
// Functions and classes always move. A `const` moves only when evaluating it
// earlier (as a dependency, before the root's body runs) cannot change what it
// computes: every name it reads at evaluation time must be a global, an import,
// or a declaration moved ahead of it, and its initializer may only call DOM
// lookups or plain constructors. Statements never move, so the root keeps its
// startup order. Moved code that still needs a root declaration imports it from
// the root, which re-exports it; other renderer modules that imported a moved
// name from the root are redirected to the new module.
//
// --names a,b,c selects declarations by name instead of by line range. An
// existing target module is extended, and its imports are merged.
//
// Usage: node scripts/refactor/split-module.mjs <root.js> <target.js> <fromLine> <toLine>
//        node scripts/refactor/split-module.mjs <root.js> <target.js> --names <name,name,...>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { analyzeSource } from "./analyze-module.mjs";

const require = createRequire(import.meta.url);
const acorn = require("acorn");

const args = process.argv.slice(2);
const [rootFile, targetFile] = args;
const byName = args[2] === "--names" ? new Set(args[3].split(",").map(name => name.trim()).filter(Boolean)) : null;
const fromLine = byName ? 1 : Number(args[2]);
const toLine = byName ? Infinity : Number(args[3]);
const readIfPresent = file => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const parse = text => acorn.parse(text, { ecmaVersion: "latest", sourceType: "module", ranges: true, locations: true });
const relative = (fromFile, toFile) => {
  const spec = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  return spec.startsWith(".") ? spec : `./${spec}`;
};
const lineStart = (text, offset) => {
  while (offset > 0 && text[offset - 1] !== "\n") offset--;
  return offset;
};
function namedList(keyword, names, tail) {
  const flat = `${keyword} { ${names.join(", ")} }${tail}`;
  if (flat.length <= 100) return flat;
  const rows = [];
  for (const name of names) {
    if (rows.length && rows.at(-1).length + name.length + 2 <= 98) rows[rows.length - 1] += ` ${name},`;
    else rows.push(`  ${name},`);
  }
  return `${keyword} {\n${rows.join("\n")}\n}${tail}`;
}
const lineEnd = (text, offset) => {
  while (offset < text.length && text[offset] !== "\n") offset++;
  return Math.min(text.length, offset + 1);
};

const rootSource = fs.readFileSync(rootFile, "utf8");
const rootAst = parse(rootSource);
const { units, unitOfName, globals } = analyzeSource(rootSource);
const astByStart = new Map(rootAst.body.map(node => [node.range[0], node]));

const importSource = new Map();
for (const node of rootAst.body) {
  if (node.type !== "ImportDeclaration") continue;
  for (const specifier of node.specifiers) {
    const imported = specifier.type === "ImportSpecifier" ? specifier.imported.name : specifier.type === "ImportDefaultSpecifier" ? "default" : "*";
    importSource.set(specifier.local.name, { from: path.resolve(path.dirname(rootFile), node.source.value), imported });
  }
}

const SAFE_CALLEES = new Set(["$", "document.getElementById", "document.querySelector", "document.querySelectorAll", "Object.freeze"]);
const SAFE_CONSTRUCTORS = new Set(["Set", "Map", "WeakMap", "WeakSet", "RegExp"]);
function calleeName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    const object = calleeName(node.object);
    return object && `${object}.${node.property.name}`;
  }
  return null;
}
function initializerIsInert(node) {
  let inert = true;
  (function visit(child, deferred) {
    if (!inert || !child || typeof child.type !== "string") return;
    if (child.type === "ArrowFunctionExpression" || child.type === "FunctionExpression" || child.type === "ClassExpression") deferred = true;
    if (!deferred && child.type === "CallExpression" && !SAFE_CALLEES.has(calleeName(child.callee))) inert = false;
    if (!deferred && child.type === "NewExpression" && !SAFE_CONSTRUCTORS.has(calleeName(child.callee))) inert = false;
    if (!deferred && (child.type === "TaggedTemplateExpression" || child.type === "AwaitExpression" || child.type === "YieldExpression")) inert = false;
    for (const key of Object.keys(child)) {
      const value = child[key];
      if (Array.isArray(value)) value.forEach(item => visit(item, deferred));
      else if (value && typeof value.type === "string") visit(value, deferred);
    }
  })(node, false);
  return inert;
}

const moved = new Set();
const skipped = [];
for (const unit of units) {
  if (unit.start < fromLine || unit.end > toLine || !unit.names.length || unit.kind === "ImportDeclaration") continue;
  if (byName && !unit.names.some(name => byName.has(name))) continue;
  const node = astByStart.get(unit.range[0]);
  const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
  if (unit.kind === "FunctionDeclaration" || unit.kind === "ClassDeclaration" || unit.kind === "ExportNamedDeclaration") {
    moved.add(unit);
    continue;
  }
  const ready = [...unit.evalReads].every(name => {
    if (globals.has(name) && !unitOfName.has(name)) return true;
    const owner = unitOfName.get(name);
    if (!owner) return true;
    if (owner.kind === "ImportDeclaration") return path.resolve(importSource.get(name).from) !== path.resolve(rootFile);
    return moved.has(owner) && owner.start < unit.start;
  });
  if (unit.kind === "const" && ready && declaration.declarations.every(item => initializerIsInert(item.init))) moved.add(unit);
  else skipped.push(`${unit.names.join(", ")} (line ${unit.start})`);
}
if (!moved.size) throw new Error("Nothing movable in that range.");
if (byName) {
  const found = new Set([...moved].flatMap(unit => unit.names).concat(skipped.map(entry => entry.split(" (")[0])));
  const missing = [...byName].filter(name => !found.has(name));
  if (missing.length) console.log(`not found in root: ${missing.join(", ")}`);
}

const movedNames = new Set([...moved].flatMap(unit => unit.names));
const needs = new Map();
const need = (from, imported, local) => {
  if (!needs.has(from)) needs.set(from, new Map());
  needs.get(from).set(local, imported);
};
for (const unit of moved) {
  for (const name of unit.reads) {
    if (movedNames.has(name)) continue;
    const owner = unitOfName.get(name);
    if (!owner) continue;
    if (owner.kind === "ImportDeclaration") {
      const { from, imported } = importSource.get(name);
      need(from, imported, name);
    } else need(path.resolve(rootFile), name, name);
  }
  for (const name of unit.writes) {
    if (!movedNames.has(name)) throw new Error(`${unit.names[0]} assigns root binding ${name}; move it into app state first.`);
  }
}

const rootPath = path.resolve(rootFile);
const targetPath = path.resolve(targetFile);
let targetBody = "";
const existing = readIfPresent(targetFile);
if (existing !== null) {
  const ast = parse(existing);
  const imports = ast.body.filter(node => node.type === "ImportDeclaration");
  for (const node of imports) {
    const from = path.resolve(path.dirname(targetFile), node.source.value);
    if (!node.specifiers.length) throw new Error(`${targetFile} has a side-effect import; extend it by hand.`);
    for (const spec of node.specifiers) {
      if (movedNames.has(spec.local.name)) continue;
      need(from, spec.type === "ImportSpecifier" ? spec.imported.name : spec.type === "ImportDefaultSpecifier" ? "default" : "*", spec.local.name);
    }
  }
  targetBody = imports.length ? existing.slice(lineEnd(existing, imports.at(-1).range[1] - 1)).replace(/^\s*\n/, "") : existing;
  targetBody = `${targetBody.replace(/\s*$/, "")}\n\n`;
}
needs.delete(targetPath);
const importLines = [...needs].map(([from, names]) => {
  const parts = [...names].map(([local, imported]) => (imported === local ? local : imported === "default" ? null : `${imported} as ${local}`));
  const defaultName = [...names].find(([, imported]) => imported === "default")?.[0];
  const namespace = [...names].find(([, imported]) => imported === "*")?.[0];
  const spec = relative(targetFile, from);
  if (namespace) return `import * as ${namespace} from "${spec}";`;
  const named = parts.filter(Boolean).filter(part => part !== namespace);
  if (!defaultName) return namedList("import", named, ` from "${spec}";`);
  return `import ${[defaultName, named.length ? `{ ${named.join(", ")} }` : null].filter(Boolean).join(", ")} from "${spec}";`;
});

const lineOwners = new Map();
for (const unit of units) {
  for (let line = unit.start; line <= unit.end; line++) {
    if (lineOwners.has(line) && moved.has(unit) !== moved.has(lineOwners.get(line))) {
      throw new Error(`Line ${line} holds both moved and kept code; split it first.`);
    }
    lineOwners.set(line, unit);
  }
}
const rootLines = rootSource.split("\n");
// A comment block directly above a declaration documents it, so it moves too.
function span(unit) {
  let start = lineStart(rootSource, unit.range[0]);
  let line = unit.start - 1;
  while (line >= 1 && !lineOwners.has(line) && /^\s*(\/\/|\/\*|\*)/.test(rootLines[line - 1])) {
    start -= rootLines[line - 1].length + 1;
    line--;
  }
  return [start, lineEnd(rootSource, unit.range[1] - 1)];
}
let previousEnd = -1;
const movedText = [...moved]
  .sort((a, b) => a.range[0] - b.range[0])
  .map(unit => {
    const [start, end] = span(unit);
    const gap = previousEnd < 0 ? "" : rootSource.slice(previousEnd, start);
    previousEnd = end;
    const separator = gap.trim() || /\n\s*\n/.test(`\n${gap}`) ? "\n" : "";
    const comment = rootSource.slice(start, lineStart(rootSource, unit.range[0]));
    const code = rootSource.slice(lineStart(rootSource, unit.range[0]), end);
    return separator + comment + (/^\s*export\s/.test(code) ? code : code.replace(/^(\s*)/, "$1export "));
  });
fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, `${importLines.length ? `${importLines.join("\n")}\n\n` : ""}${targetBody}${movedText.join("").replace(/^\s*\n/, "")}`);

let rootOutput = rootSource;
for (const unit of [...moved].sort((a, b) => b.range[0] - a.range[0])) {
  const [start, end] = span(unit);
  rootOutput = rootOutput.slice(0, start) + rootOutput.slice(end);
}
rootOutput = rootOutput.replace(/^export \{[^}]*\};\r?\n?/m, "");

const after = analyzeSource(rootOutput);
const stillUsed = new Set([...after.units.flatMap(unit => [...unit.reads]), ...after.globals]);
const fromTarget = [...movedNames].filter(name => stillUsed.has(name));

const importEdits = [];
for (const node of parse(rootOutput).body) {
  if (node.type !== "ImportDeclaration" || !node.specifiers.length) continue;
  const used = node.specifiers.filter(spec => stillUsed.has(spec.local.name));
  if (used.length === node.specifiers.length) continue;
  const named = used.filter(spec => spec.type === "ImportSpecifier")
    .map(spec => (spec.imported.name === spec.local.name ? spec.local.name : `${spec.imported.name} as ${spec.local.name}`));
  const defaultSpec = used.find(spec => spec.type === "ImportDefaultSpecifier");
  const clause = [defaultSpec?.local.name, named.length ? `{ ${named.join(", ")} }` : null].filter(Boolean).join(", ");
  const text = !used.length ? "" : defaultSpec ? `import ${clause} from "${node.source.value}";` : namedList("import", named, ` from "${node.source.value}";`);
  const end = used.length ? node.range[1] : lineEnd(rootOutput, node.range[1] - 1);
  importEdits.push({ start: used.length ? node.range[0] : lineStart(rootOutput, node.range[0]), end, text });
}
for (const edit of importEdits.sort((a, b) => b.start - a.start)) rootOutput = rootOutput.slice(0, edit.start) + edit.text + rootOutput.slice(edit.end);
const rootImports = parse(rootOutput).body.filter(node => node.type === "ImportDeclaration");
const lastImport = rootImports.at(-1);
const existingTargetImport = rootImports.find(node => path.resolve(path.dirname(rootFile), node.source.value) === targetPath);
if (fromTarget.length && existingTargetImport) {
  const names = [...new Set([...existingTargetImport.specifiers.map(spec => spec.local.name), ...fromTarget])];
  rootOutput = rootOutput.slice(0, existingTargetImport.range[0])
    + namedList("import", names, ` from "${existingTargetImport.source.value}";`)
    + rootOutput.slice(existingTargetImport.range[1]);
} else if (fromTarget.length) {
  const line = `\n${namedList("import", fromTarget, ` from "${relative(rootFile, targetFile)}";`)}`;
  rootOutput = rootOutput.slice(0, lastImport.range[1]) + line + rootOutput.slice(lastImport.range[1]);
}

const uiRoot = path.dirname(rootPath);
const rendererModules = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !["dist", "react", "assets", "styles"].includes(entry.name)) collect(full);
    else if (entry.isFile() && /\.m?js$/.test(entry.name) && full !== rootPath) rendererModules.push(full);
  }
})(uiRoot);

const rootExports = new Set();
for (const file of rendererModules) {
  let text = fs.readFileSync(file, "utf8");
  if (!text.includes("bootstrap.js")) continue;
  const ast = parse(text);
  const edits = [];
  for (const node of ast.body) {
    if (node.type !== "ImportDeclaration" || path.resolve(path.dirname(file), node.source.value) !== rootPath) continue;
    const keep = node.specifiers.filter(spec => !movedNames.has(spec.imported?.name));
    const redirect = node.specifiers.filter(spec => movedNames.has(spec.imported?.name));
    keep.forEach(spec => rootExports.add(spec.imported.name));
    if (!redirect.length) continue;
    const lines = [];
    if (keep.length) lines.push(namedList("import", keep.map(spec => spec.local.name), ` from "${node.source.value}";`));
    lines.push(namedList("import", redirect.map(spec => spec.local.name), ` from "${relative(file, targetFile)}";`));
    edits.push({ start: node.range[0], end: node.range[1], text: lines.join("\n") });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  if (edits.length) fs.writeFileSync(file, text);
}
for (const [, names] of [...needs].filter(([from]) => from === rootPath)) for (const [local] of names) rootExports.add(local);
if (rootExports.size) rootOutput = `${rootOutput.replace(/\s*$/, "\n")}\n${namedList("export", [...rootExports].sort(), ";")}\n`;
fs.writeFileSync(rootFile, rootOutput);

const helperFile = path.join(uiRoot, "..", "..", "test", "helpers", "renderer-source.js");
const helper = readIfPresent(helperFile);
if (helper !== null) {
  const entry = path.relative(uiRoot, targetFile).replace(/\\/g, "/");
  if (!helper.includes(`"${entry}"`)) fs.writeFileSync(helperFile, helper.replace(/(const RENDERER_FILES = \[[\s\S]*?)(\r?\n\];)/, `$1\n  "${entry}",$2`));
}

console.log(`moved ${moved.size} declarations (${movedNames.size} names) to ${targetFile}`);
console.log(`root imports ${fromTarget.length} of them back; root now exports ${rootExports.size} names`);
if (skipped.length) console.log(`kept in root: ${skipped.join("; ")}`);
