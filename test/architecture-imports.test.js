"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(file));
    else if (file.endsWith(".js")) result.push(file);
  }
  return result;
}
function relative(file) { return path.relative(ROOT, file).replaceAll(path.sep, "/"); }

test("canonical top-level source boundaries exist and legacy layers are absent", () => {
  for (const directory of ["agent", "app", "interceptor", "prompts", "ui", "domain", "contracts", "infrastructure", "shared"]) {
    assert.equal(fs.existsSync(path.join(SRC, directory)), true, `src/${directory} must exist`);
  }
  for (const directory of ["application", "adapters", "presentation", "content", "automation"]) {
    assert.equal(fs.existsSync(path.join(SRC, directory)), false, `src/${directory} must stay removed`);
  }
});

test("production code has no references to removed compatibility or legacy authority paths", () => {
  const forbidden = /src[\\/]?(?:application|adapters|presentation|content|automation)|policy-engine|role-registry|GATES_DISABLED|requestAgentActionApproval|agentResolveApproval|approval-token/;
  const matches = [];
  for (const file of filesUnder(SRC)) {
    const source = fs.readFileSync(file, "utf8");
    if (forbidden.test(source)) matches.push(relative(file));
  }
  assert.deepEqual(matches, []);
});

test("raw adapters stay policy-free and scope is centralized", () => {
  for (const file of filesUnder(path.join(SRC, "agent", "tools"))) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /require\(["'][^"']*(?:authority|scope|policy|approval|gate)[^"']*["']\)/i, relative(file));
  }
  assert.match(fs.readFileSync(path.join(SRC, "agent", "authority", "scope", "scope-policy.js"), "utf8"), /evaluateToolScope/);
});

test("one DI composition root and native renderer entry are present", () => {
  const container = fs.readFileSync(path.join(SRC, "infrastructure", "di", "container.js"), "utf8");
  assert.match(container, /createToolRegistry/);
  assert.match(container, /createAuthorityComposition/);
  assert.match(container, /createInvocationPipeline/);
  assert.match(fs.readFileSync(path.join(SRC, "ui", "index.html"), "utf8"), /<script type="module" src="bootstrap\.js">/);
  assert.match(fs.readFileSync(path.join(SRC, "app", "electron", "preload.js"), "utf8"), /contextBridge\.exposeInMainWorld/);
});
