"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSessionMemoryStore } = require("../src/app/storage/session-memory-store.js");

test("legacy migration pairs turns, retains incomplete transcripts, and is side-effect free", (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-migration-test-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  const store = createSessionMemoryStore({ fs, path, crypto, baseDir });
  const legacy = { activeSessionId: "legacy", sessions: [{ id: "legacy", title: "Old chat", messages: [
    { id: "u-1", role: "user", content: "inspect" },
    { id: "t-1", role: "tool", tool_name: "read_file", content: "file" },
    { id: "a-1", role: "assistant", content: "done" },
    { id: "u-2", role: "user", content: "continue" },
  ] }], closedSessions: [] };
  const projectId = store.resolveProject("legacy-workspace", { persist: true }).projectId;
  const migrated = store.migrateLegacy("legacy-workspace", projectId, legacy);
  const session = migrated[projectId][Object.keys(migrated[projectId]).find((key) => key !== "__meta")];
  assert.equal(session.block_1.user_prompt, "inspect");
  assert.equal(session.block_1.ai_prompt, "done");
  assert.equal(session.block_1.tool_usage[0], "read_file");
  assert.equal(session.block_2.outcome, "incomplete");
  assert.equal(session.block_2.__meta.transcript[0].content, "continue");
  assert.equal(fs.existsSync(store.projectFile(projectId)), false, "conversion alone must not write memory");
});

test("failure memory remains independent and structured", () => {
  const FailureMemory = require("../src/agent/memory/failure-memory.js");
  const record = FailureMemory.buildFailureRecord({ toolName: "read_file", signature: "read_file:{path:missing}", errorClass: "not_found", count: 2 });
  assert.equal(FailureMemory.normalizeRecord(record).toolName, "read_file");
  assert.equal(FailureMemory.pruneFailureRecords([{ ...record, expiresAt: new Date(Date.now() - 1).toISOString() }]).length, 0);
});
