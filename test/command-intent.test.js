"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inspectExecCommand,
  evaluateMutationSafety,
  isDestructiveWipeCommand,
} = require("../src/agent/authority/scope/command-intent.js");

test("inspectExecCommand treats local commands as unscoped and scanners as network-scoped", () => {
  assert.equal(inspectExecCommand({ command: "echo XEKUTE_CLI_OK", context: "print marker" }).requiresNetworkScope, false);
  assert.equal(inspectExecCommand({ command: "node src/math.js", context: "run math" }).requiresNetworkScope, false);
  assert.equal(inspectExecCommand({ command: "nmap --version", context: "check nmap" }).requiresNetworkScope, false);
  const scan = inspectExecCommand({ command: "nmap 8.8.8.8", context: "scan resolver" });
  assert.equal(scan.requiresNetworkScope, true);
  assert.ok(scan.networkTargets.includes("8.8.8.8"));
  const curl = inspectExecCommand({ command: "curl https://example.com/login", context: "fetch login" });
  assert.equal(curl.requiresNetworkScope, true);
  assert.ok(curl.networkTargets.some((target) => /example\.com/.test(target)));
});

test("mutation safety blocks wipes and mass deletes, not a single file delete", () => {
  assert.equal(isDestructiveWipeCommand("Remove-Item -Recurse -Force .\\notes, .\\src"), true);
  assert.equal(isDestructiveWipeCommand("rm -rf ."), true);
  assert.equal(isDestructiveWipeCommand("Remove-Item -Recurse -Force ."), true);
  assert.equal(isDestructiveWipeCommand("Remove-Item -Recurse -Force tmp\\build"), false);
  assert.equal(evaluateMutationSafety("apply_patch", { operations: [{ kind: "delete", path: "notes/hello.txt" }] }).ok, true);
  const mass = evaluateMutationSafety("apply_patch", {
    operations: [
      { kind: "delete", path: "a" },
      { kind: "delete", path: "b" },
      { kind: "delete", path: "c" },
      { kind: "delete", path: "d" },
    ],
  });
  assert.equal(mass.ok, false);
  assert.equal(mass.code, "MASS_DELETE_DENIED");
  assert.equal(evaluateMutationSafety("exec_command", { command: "Remove-Item -Recurse -Force ." }).code, "DESTRUCTIVE_WIPE_DENIED");
});
