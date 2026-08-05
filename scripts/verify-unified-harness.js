"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PUBLIC_TOOL_NAMES } = require("../src/contracts/tool/unified-catalog");
const { buildUnifiedProviderCatalog } = require("../src/application/tools/provider-catalog");
const { createUnifiedToolRouter } = require("../src/application/tools/unified-tool-router");
const { createCommandPort } = require("../src/application/tools/ports/command-port");
const { createWorkspacePort } = require("../src/application/tools/ports/workspace-port");
const { createBrowserPort } = require("../src/application/tools/ports/browser-port");
const { createScopePort } = require("../src/application/tools/ports/scope-port");

const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "test", "fixtures", "unified-harness", "protected-assessment-resource.json");
const fixtureBefore = fs.readFileSync(fixture, "utf8");

function fakeWorkspaceSearch() {
  return {
    listProjectFiles: () => ({ ok: true, files: ["test/fixtures/unified-harness/protected-assessment-resource.json"] }),
    findWorkspaceFiles: () => ({ ok: true, results: [] }),
    searchWorkspaceIndex: () => ({ ok: true, results: [] }),
    buildWorkspaceIndex: () => ({ ok: true, docs: [], graph: [] }),
  };
}

async function run() {
  const results = [];
  const record = (name, value) => { results.push({ name, status: value?.status || (value?.ok === false ? "denied" : "success"), code: value?.code || "OK" }); return value; };

  const catalog = buildUnifiedProviderCatalog("agent");
  assert.deepEqual(catalog.names, PUBLIC_TOOL_NAMES);
  record("1-catalog-exact-17", { ok: true });

  const workspacePort = createWorkspacePort({
    fs,
    path,
    workspaceSearch: fakeWorkspaceSearch(),
    resolveWorkspaceTarget: (workspace, file) => ({ root: workspace, target: path.resolve(workspace, file) }),
    editWorkspaceFile: async () => { throw new Error("protected fixture must not be edited"); },
  });
  const context = { workspace: root, actorId: "harness", operationId: "harness-op" };
  record("2-workspace-read", await workspacePort.execute({ action: "read", path: "test/fixtures/unified-harness/protected-assessment-resource.json" }, context));
  const protectedMutation = record("3-protected-mutation-denied", await workspacePort.execute({ action: "apply", path: "findings/findings.json", patches: [{ search: "x", replace: "y" }] }, context));
  assert.equal(protectedMutation.code, "TYPED_ASSESSMENT_MUTATION_REQUIRED");

  const commandPort = createCommandPort({});
  const safeCommand = record("4-safe-command", await commandPort.execute({ command: "node --version", network: "development-disabled" }, { ...context, abortSignal: new AbortController().signal }));
  assert.ok(["OK", "COMMAND_EXIT_NONZERO", "PROCESS_START_FAILED"].includes(safeCommand.code));
  record("5-security-command-denied", await commandPort.execute({ command: "nmap leadbondhuai.online" }, { ...context, abortSignal: new AbortController().signal }));
  record("6-network-capability-denied", await commandPort.execute({ command: "node --version", network: "assessment" }, { ...context, abortSignal: new AbortController().signal }));

  const browser = record("7-browser-capability-unavailable", await createBrowserPort().execute({ action: "navigate" }, context));
  assert.equal(browser.code, "DRIVER_UNAVAILABLE");

  const scopeRoot = path.join(root, "test", "fixtures", "unified-harness");
  const scopePort = createScopePort({ fs, path });
  const scopeDenied = record("8-authorized-target-scope-preflight", await scopePort.execute({ action: "evaluate", assessment_id: "harness-assessment", target: "https://leadbondhuai.online", operation_category: "replay", intensity: "read", authorization: true }, { ...context, workspace: scopeRoot }));
  assert.ok(["AUTHORIZATION_REQUIRED", "SCOPE_EMPTY", "TARGET_OUT_OF_SCOPE", "SETTINGS_READ_FAILED"].includes(scopeDenied.code));

  const router = createUnifiedToolRouter({ ports: { browser_action: createBrowserPort(), read_file: workspacePort }, policy: () => ({ allowed: true }) });
  const envelope = record("9-standard-envelope", await router.execute("browser_action", { action: "navigate", assessment_id: "harness-assessment", target: "https://leadbondhuai.online", scope_decision_id: "missing" }, { profile: "agent", actorId: "harness" }));
  assert.equal(envelope.status, "denied");
  assert.ok(envelope.operation_id && envelope.audit_id && envelope.redactions_applied === true);

  assert.equal(fs.readFileSync(fixture, "utf8"), fixtureBefore, "protected fixture was modified");
  console.log(JSON.stringify({ ok: true, target: "leadbondhuai.online", results }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
});
