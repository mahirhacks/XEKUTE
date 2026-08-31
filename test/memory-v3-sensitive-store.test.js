"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");

test("Tier 1 preserves an existing encrypted value when secure storage becomes unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-sensitive-store-"));
  const stateFile = path.join(root, "projects", "proj_fixture", "sessions", "session_fixture", "transcript.enc.json");
  const mode = { available: true };
  const protector = {
    available: () => mode.available,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  try {
    const first = store.writeFile(stateFile, { schema_version: 3, secret: "durable-value" });
    assert.equal(first.ok, true);
    const before = fs.readFileSync(stateFile, "utf8");

    mode.available = false;
    const rejected = store.writeFile(stateFile, { schema_version: 3, secret: "replacement-value" });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "MEMORY_SECURE_STORAGE_UNAVAILABLE");
    assert.equal(fs.readFileSync(stateFile, "utf8"), before);

    mode.available = true;
    const restored = store.readFile(stateFile);
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.value, { schema_version: 3, secret: "durable-value" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Tier 1 rejects a transcript or checkpoint that is bound to another session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-binding-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const project = "proj_00000000-0000-4000-8000-000000009020";
  const sessionA = "session_00000000-0000-4000-8000-000000009021";
  const sessionB = "session_00000000-0000-4000-8000-000000009022";
  try {
    assert.equal(store.writeTranscript(project, sessionA, {
      blocks: [{
        block_id: "block_00000000-0000-4000-8000-000000009023",
        messages: [{ role: "user", content: "exact" }],
      }],
    }).ok, true);
    const transcriptA = store.transcriptFile(project, sessionA);
    const transcriptB = store.transcriptFile(project, sessionB);
    fs.mkdirSync(path.dirname(transcriptB), { recursive: true });
    fs.copyFileSync(transcriptA, transcriptB);
    const foreignTranscript = store.readTranscript(project, sessionB);
    assert.equal(foreignTranscript.ok, false);
    assert.equal(foreignTranscript.code, "MEMORY_TRANSCRIPT_INVALID");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Tier 1 checkpoint read recovers the previous valid checkpoint after current corruption", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-checkpoint-recovery-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const project = "proj_00000000-0000-4000-8000-000000009024";
  const session = "session_00000000-0000-4000-8000-000000009025";
  const workflow = {
    schema_version: 3,
    workflow_id: "block_00000000-0000-4000-8000-000000009026",
    project_id: project,
    session_id: session,
    state: "completed",
    objective: "fixture",
    steps: [],
    continuation_point: null,
    blockers: [],
    memory_refs: [],
    artifact_refs: [],
    updated_at: "2026-08-29T00:00:00.000Z",
  };
  const checkpoint = (id, boundary) => ({
    schema_version: 3,
    checkpoint_id: id,
    project_id: project,
    session_id: session,
    previous_checkpoint_id: null,
    transcript_boundary: boundary,
    objective: "fixture",
    constraints: [],
    decisions: [],
    grounded_facts: [],
    significant_events: [],
    unverified_claims: [],
    unresolved_work: [],
    workflow_continuity: workflow,
    protected_refs: [],
    source_block_refs: [],
    content_hash: "a".repeat(64),
    generated_by: "deterministic",
    created_at: "2026-08-29T00:00:00.000Z",
  });
  try {
    const first = checkpoint("checkpoint_00000000-0000-4000-8000-000000009027", 1);
    const second = checkpoint("checkpoint_00000000-0000-4000-8000-000000009028", 2);
    assert.equal(store.writeCheckpoint(project, session, first).ok, true);
    assert.equal(store.writeCheckpoint(project, session, second).ok, true);
    fs.writeFileSync(store.checkpointFile(project, session, "current"), "{not-json", "utf8");
    const recovered = store.readCheckpoint(project, session, "current");
    assert.equal(recovered.ok, true);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.value.checkpoint_id, first.checkpoint_id);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
