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
  try {
    const manager = createDurableProcessManager({
      resolveWorkspaceTarget,
      foregroundWaitMs: 5_000,
      outputPollMs: 25,
      monitorIntervalMs: 100,
      reviewIntervalMs: 60_000,
    });
    const result = await manager.run(workspace, {
      command: "Set-Content -LiteralPath generated.txt -Value persisted; Write-Output persisted",
      shell: "powershell",
      timeout_ms: 10_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.value.status, "complete");
    assert.equal(result.value.exitCode, 0);
    assert.match(result.value.stdout, /persisted/);
    assert.equal(fs.readFileSync(path.join(workspace, "generated.txt"), "utf8").trim(), "persisted");
    assert.equal(result.value.detached, false);
    assert.equal(result.value.resumable, false);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      fs.rmSync(workspace, { recursive: true, force: true });
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
    }
  }
});
