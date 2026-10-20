#!/usr/bin/env node
// Codemod: hoist every top-level `let`/`var` of a module into one exported
// state object, so other modules can write that state after code moves out.
// Each reference `name` becomes `<object>.name` (scope-aware). A declaration
// with a side-effect-free initializer is folded into the object literal; any
// other initializer stays in place as an assignment to keep evaluation order.
// Usage: node scripts/refactor/lets-to-state.mjs <file> <state-module> <object-name>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");
const eslintScope = require("eslint-scope");

const [file, stateFile, objectName] = process.argv.slice(2);
const source = fs.readFileSync(file, "utf8");
const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module", ranges: true, locations: true });
const manager = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: "module" });
const moduleScope = manager.globalScope.childScopes.find(scope => scope.type === "module");

if (manager.scopes.some(scope => scope.set.has(objectName)) || moduleScope.through.some(ref => ref.identifier.name === objectName)) {
  throw new Error(`"${objectName}" is already bound or referenced in ${file}`);
}

function isPure(node) {
  if (!node) return true;
  switch (node.type) {
    case "Literal": return true;
    case "Identifier": return node.name === "undefined";
    case "TemplateLiteral": return node.expressions.length === 0;
    case "UnaryExpression": return isPure(node.argument);
    case "ArrayExpression": return node.elements.every(element => element && isPure(element));
    case "ObjectExpression": return node.properties.every(prop => prop.type === "Property" && !prop.computed && isPure(prop.value));
    case "NewExpression": return node.callee.type === "Identifier" && ["Map", "Set", "WeakMap", "WeakSet"].includes(node.callee.name) && node.arguments.length === 0;
    default: return false;
  }
}

const edits = [];
const fields = [];
const declared = new Set();
for (const node of ast.body) {
  if (node.type !== "VariableDeclaration" || node.kind === "const") continue;
  const [declarator] = node.declarations;
  if (node.declarations.length !== 1 || declarator.id.type !== "Identifier") throw new Error(`Unsupported declaration at line ${node.loc.start.line}`);
  const name = declarator.id.name;
  declared.add(name);
  const init = declarator.init;
  if (isPure(init)) {
    fields.push(`  ${name}: ${init ? source.slice(...init.range) : "undefined"},`);
    let end = node.range[1];
    while (source[end] === " " || source[end] === "\t") end++;
    if (source[end] === "\r") end++;
    if (source[end] === "\n") end++;
    let start = node.range[0];
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    edits.push({ start, end, text: "" });
  } else {
    fields.push(`  ${name}: undefined,`);
    edits.push({ start: node.range[0], end: init.range[0], text: `${objectName}.${name} = ` });
  }
}

const shorthand = new Map();
(function collect(node) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "Property" && node.shorthand) shorthand.set(node.value.range[0], node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach(collect);
    else if (child && typeof child.type === "string") collect(child);
  }
})(ast);

let rewritten = 0;
for (const variable of moduleScope.variables) {
  if (!declared.has(variable.name)) continue;
  for (const reference of variable.references) {
    if (reference.init) continue;
    const { range } = reference.identifier;
    const property = shorthand.get(range[0]);
    const value = property?.value.type === "AssignmentPattern" ? property.value.left : property?.value;
    if (property && value?.range[0] === range[0]) {
      edits.push({ start: property.range[0], end: range[1], text: `${variable.name}: ${objectName}.${variable.name}` });
    } else {
      edits.push({ start: range[0], end: range[1], text: `${objectName}.${variable.name}` });
    }
    rewritten++;
  }
}

edits.sort((a, b) => b.start - a.start);
for (let i = 1; i < edits.length; i++) {
  if (edits[i].end > edits[i - 1].start) throw new Error(`Overlapping edits near offset ${edits[i].start}`);
}
let output = source;
for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);

const lastImport = [...acorn.parse(output, { ecmaVersion: "latest", sourceType: "module", ranges: true }).body].filter(node => node.type === "ImportDeclaration").pop();
let specifier = path.relative(path.dirname(file), stateFile).replace(/\\/g, "/");
if (!specifier.startsWith(".")) specifier = `./${specifier}`;
const importLine = `\nimport { ${objectName} } from "${specifier}";`;
output = output.slice(0, lastImport.range[1]) + importLine + output.slice(lastImport.range[1]);

fs.writeFileSync(stateFile, `export const ${objectName} = {\n${fields.join("\n")}\n};\n`);
fs.writeFileSync(file, output);
console.log(`${declared.size} bindings moved to ${stateFile}, ${rewritten} references rewritten`);
