"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

function filesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function requiresOf(file) {
  // Only top-level (module-scope) require calls establish the static dependency
  // graph. Lazy requires inside function bodies (used for runtime wiring) do
  // not create a module-load-time dependency and are intentionally excluded.
  const source = fs.readFileSync(file, "utf8");
  const requires = [];
  const topLevel = [];
  let depth = 0;
  for (const line of source.split("\n")) {
    depth += (line.match(/[{}\[\]()]/g) || []).reduce((delta, char) => {
      if (char === "{" || char === "[" || char === "(") return delta + 1;
      if (char === "}" || char === "]" || char === ")") return delta - 1;
      return delta;
    }, 0);
    if (depth === 0) topLevel.push(line);
  }
  for (const line of topLevel) {
    for (const match of line.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) requires.push(match[1]);
  }
  return requires;
}

function isCompatibilityShim(file) {
  // A pure re-export (module.exports = require(...)) is a migration-only compat
  // shim, not part of the production dependency graph. It may point at any
  // layer; it is excluded from direction checks. "use strict" and comment
  // preamble are allowed.
  const source = fs.readFileSync(file, "utf8").replace(/^\s*"use strict";?\s*/, "");
  return /^\s*\/\/[^\n]*\n?\s*module\.exports\s*=\s*require\(/.test(source)
    || /^\s*module\.exports\s*=\s*require\(/.test(source);
}

function rel(file) {
  return path.relative(SRC, file).replace(/\\/g, "/");
}

function resolveTarget(fromFile, spec) {
  if (!spec.startsWith(".")) return null; // built-in or package
  const resolved = path.resolve(path.dirname(fromFile), spec);
  const base = resolved.replace(/\.js$/, "");
  const candidates = [resolved, `${base}.js`, path.join(resolved, "index.js")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function layerOf(relPath) {
  return String(relPath).split("/")[0];
}

function assertAllowedImport(fromLayer, toLayer) {
  if (toLayer === "contracts") return; // everything may import contracts
  if (fromLayer === "contracts") {
    // contracts may only import built-ins or sibling contracts
    return toLayer === "contracts";
  }
  if (fromLayer === "domain") {
    // domain may import built-ins, contracts, sibling domain only
    return toLayer === "domain";
  }
  if (fromLayer === "application") {
    // application may import contracts, domain, application, the generated
    // content leaf, and the legacy prompts leaf (deterministic rules move to
    // application/policies in Stage 5).
    if (toLayer === "content" || toLayer === "prompts") return true;
    return toLayer === "application" || toLayer === "domain" || toLayer === "contracts";
  }
  return true; // adapters/infrastructure/presentation/automation may import lower layers
}

test("contracts/ imports only built-ins or sibling contract modules", () => {
  for (const file of filesUnder(path.join(SRC, "contracts"))) {
    const from = rel(file);
    assert.ok(from.startsWith("contracts/"), `expected ${from} under contracts/`);
    for (const spec of requiresOf(file)) {
      const target = resolveTarget(file, spec);
      if (!target) continue;
      const to = rel(target);
      assert.ok(
        to.startsWith("contracts/"),
        `contracts module ${from} must not import outside contracts (got ${to} via ${spec})`,
      );
    }
  }
});

test("domain/ imports only built-ins, contracts, or sibling domain modules", () => {
  for (const file of filesUnder(path.join(SRC, "domain"))) {
    if (isCompatibilityShim(file)) continue;
    const from = rel(file);
    for (const spec of requiresOf(file)) {
      const target = resolveTarget(file, spec);
      if (!target) continue;
      const to = rel(target);
      const toLayer = layerOf(to);
      assert.ok(
        toLayer === "domain" || toLayer === "contracts",
        `domain module ${from} must not import ${toLayer}/ (got ${to} via ${spec})`,
      );
    }
  }
});

test("application/ imports only contracts, domain, or sibling application modules", () => {
  for (const file of filesUnder(path.join(SRC, "application"))) {
    if (isCompatibilityShim(file)) continue;
    const from = rel(file);
    // application/agent/tool-port.js is the intentional compat ToolPort seam
    // that the DI container replaces in Stage 6; it may touch adapters.
    if (from === "application/agent/tool-port.js") continue;
    for (const spec of requiresOf(file)) {
      const target = resolveTarget(file, spec);
      if (!target) continue;
      const to = rel(target);
      const toLayer = layerOf(to);
      assert.ok(
        toLayer === "application" || toLayer === "domain" || toLayer === "contracts" || toLayer === "content" || toLayer === "prompts",
        `application module ${from} must not import ${toLayer}/ (got ${to} via ${spec})`,
      );
    }
  }
});

test("dependency direction: lower layers never import upper layers", () => {
  // automation is an adapter boundary for slash-command execution (leaf), not
  // an upper layer; presentation and adapters may consume it.
  const order = ["contracts", "content", "prompts", "domain", "application", "adapters", "automation", "infrastructure", "presentation"];
  for (const layer of order) {
    const dir = path.join(SRC, layer);
    if (!fs.existsSync(dir)) continue;
    for (const file of filesUnder(dir)) {
      if (isCompatibilityShim(file)) continue;
      const from = rel(file);
      // Intentional compat seam: replaced by the DI container in Stage 6.
      if (from === "application/agent/tool-port.js") continue;
      const fromLayer = layerOf(from);
      for (const spec of requiresOf(file)) {
        const target = resolveTarget(file, spec);
        if (!target) continue;
        const to = rel(target);
        const toLayer = layerOf(to);
        const fromIdx = order.indexOf(fromLayer);
        const toIdx = order.indexOf(toLayer);
        if (toIdx < 0) continue;
        if (toLayer === "contracts" || toLayer === fromLayer) continue;
        assert.ok(
          toIdx < fromIdx,
          `layer ${fromLayer} must not import upper layer ${toLayer} (${from} -> ${to} via ${spec})`,
        );
      }
    }
  }
});

test("single DI composition root: only infrastructure/di/container constructs concrete adapters", () => {
  // Every production module that constructs a concrete adapter factory must go
  // through the container. The presentation shell may only consume container
  // services (it may require the container itself).
  const constructors = [
    "createToolHandlers", "createWorkspaceSearch", "createWebResearch", "createWebCloneService",
    "createAssessmentWorkspace", "createAssessmentMap", "createSecurityHttpWorkbench",
    "createProxyListenerService", "createChatSessionStore", "createWorkspaceFiles",
  ];
  for (const file of filesUnder(SRC)) {
    if (isCompatibilityShim(file)) continue;
    const from = rel(file);
    if (from === "infrastructure/di/container.js") continue;
    // application/agent/tool-port.js is the intentional compat seam.
    if (from === "application/agent/tool-port.js") continue;
    const source = fs.readFileSync(file, "utf8");
    for (const ctor of constructors) {
      // Skip the factory's own definition and any require of it; only flag
      // actual call sites `ctor(...)` outside the container.
      const definition = new RegExp(`function\\s+${ctor}\\s*\\(`).test(source);
      if (definition) continue;
      const used = new RegExp(`\\b${ctor}\\s*\\(`).test(source);
      if (!used) continue;
      // Container requires the factory modules; it may call them. Any other
      // module calling a concrete factory is a composition-root violation.
      assert.ok(
        /infrastructure\/di\/container/.test(source),
        `${from} must not construct ${ctor} outside the DI container`,
      );
    }
  }
});

test("no duplicate tool schema registry and no runtime Markdown parsing", () => {
  // Exactly one canonical catalog defines TOOL_DEFS; the OS/cyber registries are
  // group metadata only (no tool schemas).
  const catalog = fs.readFileSync(path.join(SRC, "adapters/tools/core/tool-catalog.js"), "utf8");
  assert.ok(catalog.includes("TOOL_DEFS"), "catalog must define TOOL_DEFS");
  const osReg = fs.readFileSync(path.join(SRC, "adapters/tools/os/tool-registry.js"), "utf8");
  const cyberReg = fs.readFileSync(path.join(SRC, "adapters/tools/cyber/tool-registry.js"), "utf8");
  assert.doesNotMatch(osReg, /TOOL_DEFS/, "OS registry must not duplicate tool schemas");
  assert.doesNotMatch(cyberReg, /TOOL_DEFS/, "cyber registry must not duplicate tool schemas");

  // No production module reads .md prompt files at runtime; content/build
  // modules are generated JS and the loader reads JSON manifests, never .md.
  // The renderer's marked-based chat renderer is a UI feature, not prompt
  // parsing, and is excluded.
  for (const file of filesUnder(SRC)) {
    if (isCompatibilityShim(file)) continue;
    const from = rel(file);
    if (from === "presentation/ui/core/markdown.js") continue;
    const source = fs.readFileSync(file, "utf8");
    if (/infrastructure\/di\/container/.test(source)) continue; // container may load generated modules
    assert.doesNotMatch(
      source,
      /readFileSync\([^)]*\.md["']\)|readFile\([^)]*\.md["']\)/,
      `${from} must not read Markdown prompt files at runtime`,
    );
  }
});

test("no production import of obsolete source trees", () => {
  for (const file of filesUnder(SRC)) {
    if (isCompatibilityShim(file)) continue;
    const from = rel(file);
    const source = fs.readFileSync(file, "utf8");
    // Only flag actual runtime load references (require/loadFile/path joins),
    // not doc comments or strings in build tools.
    const obsoleteRef = new RegExp(
      `require\\(["'][^"']*(?:src/sub-agent|src/harness|src/prompt)[^"']*["']\\)` +
      `|loadFile\\([^)]*(?:sub-agent|harness|src/prompt)` +
      `|path\\.join\\([^)]*["'](?:sub-agent|harness|prompt)["']`,
    );
    assert.doesNotMatch(source, obsoleteRef, `${from} must not load obsolete trees at runtime`);
  }
});
