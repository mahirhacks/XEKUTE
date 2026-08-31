"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDurableProcessManager } = require("../src/app/services/terminal/durable-process-manager.js");

function resolveWorkspaceTarget(workspace, relative = "") {
  const root = path.resolve(workspace);
  const target = path.resolve(root, relative || ".");
  const relation = path.relative(root, target);
  if (relation.startsWith("..") || path.isAbsolute(relation)) return { error: "Path escapes workspace" };
  return { root, target, relative: relation };
}

test("durable PowerShell runs persist workspace writes on Windows", { skip: process.platform !== "win32" }, async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-durable-"));
  const manager = createDurableProcessManager({
    resolveWorkspaceTarget,
    foregroundWaitMs: 20_000,
    outputPollMs: 25,
    monitorIntervalMs: 100,
    reviewIntervalMs: 60_000,
  });
  let processId = "";
  try {
    const started = await manager.run(workspace, {
      command: "Set-Content -LiteralPath generated.txt -Value persisted; Write-Output persisted",
      shell: "powershell",
      timeout_ms: 30_000,
    });
    assert.equal(started.ok, true);
    processId = started.value.processId || started.value.id || "";
    let value = started.value;
    const deadline = Date.now() + 20_000;
    while (value.status === "running" && Date.now() < deadline && processId) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const observed = await manager.status(workspace, { process_id: processId, wait_ms: 400 });
      if (observed.ok) value = observed.value;
    }

    assert.equal(value.status, "complete");
    assert.equal(value.exitCode, 0);
    assert.match(String(value.stdout || ""), /persisted/);
    assert.equal(fs.readFileSync(path.join(workspace, "generated.txt"), "utf8").trim(), "persisted");
  } finally {
    if (processId) {
      try { await manager.stop(workspace, { process_id: processId, reason: "test_teardown" }); } catch { /* already finished */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  }
});
