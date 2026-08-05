"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCommandPort } = require("../src/application/tools/ports/command-port");
const { buildAction } = require("../src/adapters/tools/cyber/security-tool-adapters");
const { createWorkspacePort } = require("../src/application/tools/ports/workspace-port");
const { createPlanPort } = require("../src/application/tools/ports/plan-port");
const { createStatePort } = require("../src/application/tools/ports/state-port");
const { createIdentityPort } = require("../src/application/tools/ports/identity-port");
const { createScopePort } = require("../src/application/tools/ports/scope-port");
const { createTrafficPort } = require("../src/application/tools/ports/traffic-port");

function workspaceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-unified-port-"));
  fs.writeFileSync(path.join(root, "README.md"), "hello unified tools\n", "utf8");
  return root;
}

test("command port rejects shell syntax, security CLIs, network, and disallowed executables", async () => {
  const port = createCommandPort({});
  const context = { workspace: process.cwd(), abortSignal: new AbortController().signal, operationId: "op" };
  assert.equal((await port.execute({ command: "node -e console.log(1); whoami" }, context)).code, "SHELL_SYNTAX_BLOCKED");
  assert.equal((await port.execute({ command: "nmap example.com" }, context)).code, "TYPED_VAPT_OPERATION_REQUIRED");
  assert.equal((await port.execute({ command: "node --version", network: "assessment" }, context)).code, "NETWORK_CAPABILITY_REQUIRED");
  assert.equal((await port.execute({ command: "curl example.com" }, context)).code, "EXECUTABLE_NOT_ALLOWED");
});

test("workspace port bounds paths and refuses protected assessment resources", async () => {
  const root = workspaceFixture();
  const port = createWorkspacePort({ fs, path, workspaceSearch: { listProjectFiles: () => ({ ok: true, files: ["README.md"] }), findWorkspaceFiles: () => ({ ok: true, results: [] }), searchWorkspaceIndex: () => ({ ok: true, results: [] }), buildWorkspaceIndex: () => ({ ok: true }) }, resolveWorkspaceTarget: (workspace, file) => ({ root: workspace, target: path.resolve(workspace, file) }), editWorkspaceFile: async () => ({ ok: true }) });
  const context = { workspace: root };
  assert.equal((await port.execute({ action: "read", path: "../secret" }, context)).code, "INVALID_PATH");
  assert.equal((await port.execute({ action: "apply", path: "findings/findings.json", patches: [{ search: "x", replace: "y" }] }, context)).code, "TYPED_ASSESSMENT_MUTATION_REQUIRED");
  assert.equal((await port.execute({ action: "read", path: "README.md" }, context)).content, "hello unified tools\n");
  fs.rmSync(root, { recursive: true, force: true });
});

test("plan and state ports persist durable data outside model context", async () => {
  const root = workspaceFixture();
  const context = { workspace: root };
  const plan = createPlanPort({ fs, path });
  const state = createStatePort({ fs, path });
  assert.equal((await plan.execute({ action: "create", title: "Scope review" }, context)).ok, true);
  assert.equal((await state.execute({ action: "set", key: "phase", value: "inventory" }, context)).ok, true);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "plans", "unified-plan.json")), true);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "state", "unified-state.json")), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("identity port stores encrypted host-only secrets and returns descriptors without secret fields", async () => {
  const root = workspaceFixture();
  const context = { workspace: root, assessmentId: "assessment-1", actorId: "operator" };
  const port = createIdentityPort({ fs, path, protector: { available: () => true, encrypt: (value) => `encrypted:${value}`, decrypt: (value) => value.slice(10) } });
  const imported = port.importSecret(context, { assessment_id: "assessment-1", role: "operator", capabilities: ["replay"] }, "super-secret");
  assert.equal(imported.ok, true);
  assert.equal(JSON.stringify(imported).includes("super-secret"), false);
  const listed = await port.execute({ action: "list", assessment_id: "assessment-1" }, context);
  assert.equal(listed.identities.length, 1);
  assert.equal(JSON.stringify(listed).includes("encrypted"), false);
  const stored = JSON.parse(fs.readFileSync(path.join(root, ".xekute", "identity-secrets.json"), "utf8"));
  assert.equal(stored.identities[imported.identity.identity_id].encrypted_secret_blob, "encrypted:super-secret");
  fs.rmSync(root, { recursive: true, force: true });
});

test("scope and traffic ports fail closed or preserve provenance", async () => {
  const root = workspaceFixture();
  const context = { workspace: root, actorId: "agent", operationId: "op", assessmentId: "assessment-1" };
  fs.mkdirSync(path.join(root, "scope"), { recursive: true });
  fs.writeFileSync(path.join(root, "scope", "configurations.json"), JSON.stringify({ authorizationGate: { authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true }, safety: {} }));
  fs.writeFileSync(path.join(root, "scope", "in-scope.json"), JSON.stringify({ targets: ["https://leadbondhuai.online"] }));
  fs.writeFileSync(path.join(root, "scope", "out-of-scope.json"), JSON.stringify({ assets: [] }));
  fs.writeFileSync(path.join(root, "settings.config"), JSON.stringify({ authority: { superMode: "full" } }));
  const scope = createScopePort({ fs, path });
  const denied = await scope.execute({ action: "evaluate", assessment_id: "assessment-1", target: "https://other.example", operation_category: "replay", intensity: "read", authorization: true }, context);
  assert.equal(denied.ok, false);
  const traffic = createTrafficPort({ assessmentWorkspace: { appendTrafficRecord: () => ({ ok: true, evidence: { id: "evidence-1" } }) } });
  const ingested = await traffic.execute({ action: "raw_http", assessment_id: "assessment-1", source: "fixture", content: "GET / HTTP/1.1\nHost: leadbondhuai.online\n\n" }, context);
  assert.equal(ingested.ok, true);
  assert.equal(ingested.provenance, "model-visible-ingest");
  fs.rmSync(root, { recursive: true, force: true });
});
