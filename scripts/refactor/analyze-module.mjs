#!/usr/bin/env node
// Scope-accurate map of a module's top-level declarations: what each one reads
// and writes among its siblings, and what runs at module evaluation time.
// Usage: node scripts/refactor/analyze-module.mjs <file> [--json out.json]
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn");
const eslintScope = require("eslint-scope");

export function analyzeSource(source) {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true, ranges: true });
  const manager = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: "module" });
  const moduleScope = manager.globalScope.childScopes.find(scope => scope.type === "module");

  const units = [];
  const unitOfName = new Map();
  for (const node of ast.body) {
    const unit = { start: node.loc.start.line, end: node.loc.end.line, range: node.range, kind: node.type, names: [], reads: new Set(), writes: new Set(), evalReads: new Set() };
    const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (declaration?.type === "FunctionDeclaration" || declaration?.type === "ClassDeclaration") unit.names.push(declaration.id.name);
    else if (declaration?.type === "VariableDeclaration") {
      unit.kind = declaration.kind;
      for (const variable of manager.getDeclaredVariables(declaration)) unit.names.push(variable.name);
    } else if (node.type === "ImportDeclaration") {
      for (const variable of manager.getDeclaredVariables(node)) unit.names.push(variable.name);
    }
    for (const name of unit.names) unitOfName.set(name, unit);
    units.push(unit);
  }

  const unitAt = offset => units.find(unit => unit.range[0] <= offset && offset < unit.range[1]);
  const deferred = scope => {
    for (let current = scope; current && current !== moduleScope; current = current.upper) {
      if (current.type === "function" || current.type === "class-field-initializer") return true;
    }
    return false;
  };

  for (const variable of moduleScope.variables) {
    for (const reference of variable.references) {
      const unit = unitAt(reference.identifier.range[0]);
      if (!unit) continue;
      if (reference.isWrite() && !reference.init) unit.writes.add(variable.name);
      if (reference.isRead() || !reference.init) unit.reads.add(variable.name);
      if (reference.isRead() && !deferred(reference.from)) unit.evalReads.add(variable.name);
    }
  }
  const globals = new Set(moduleScope.through.map(reference => reference.identifier.name));
  return { units, unitOfName, globals };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [file, flag, out] = process.argv.slice(2);
  const { units, globals } = analyzeSource(fs.readFileSync(file, "utf8"));
  const plain = units.map(unit => ({ ...unit, range: undefined, reads: [...unit.reads], writes: [...unit.writes], evalReads: [...unit.evalReads] }));
  if (flag === "--json") fs.writeFileSync(out, JSON.stringify({ units: plain, globals: [...globals] }, null, 1));
  const lets = units.filter(unit => unit.kind === "let" || unit.kind === "var");
  console.log(`${units.length} top-level units, ${lets.length} let/var, ${globals.size} free globals`);
}
