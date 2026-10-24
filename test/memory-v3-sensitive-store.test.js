"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");

test("Tier 1 checks the encrypted plaintext hash before accepting changed content", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-sensitive-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createTier1SensitiveStore({ baseDir: root, protector: { available: () => true,
    encrypt: value => Buffer.from(value).toString("base64"),
    decrypt: value => Buffer.from(value, "base64").toString(),
  } });
  const file = store.transcriptFile("proj_integrity", "session_integrity");
  assert.equal(store.writeFile(file, { content: "Original content" }).ok, true);
  assert.deepEqual(store.readFile(file).value, { content: "Original content" });
  const envelope = JSON.parse(fs.readFileSync(file, "utf8"));
  envelope.payload = Buffer.from(JSON.stringify({ content: "Changed content" })).toString("base64");
  fs.writeFileSync(file, JSON.stringify(envelope));
  const loaded = store.readFile(file);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.code, "MEMORY_SENSITIVE_HASH_MISMATCH");
});

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

test("Tier 1 persists and restores the encrypted active conversation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-active-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const project = "proj_00000000-0000-4000-8000-000000009030";
  const session = "session_00000000-0000-4000-8000-000000009031";
  const messages = [{ role: "user", content: "Inspect the authorized target." }];
  try {
    const written = store.writeActive(project, session, messages);
    assert.equal(written.ok, true);
    assert.equal(written.encrypted, true);
    assert.equal(fs.existsSync(store.activeFile(project, session)), true);
    const loaded = store.readActive(project, session);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.exists, true);
    assert.deepEqual(loaded.value.active, messages);
    assert.equal(loaded.value.project_id, project);
    assert.equal(loaded.value.session_id, session);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Tier 1 rejects an active conversation bound to another session", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-active-binding-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const project = "proj_00000000-0000-4000-8000-000000009032";
  const sessionA = "session_00000000-0000-4000-8000-000000009033";
  const sessionB = "session_00000000-0000-4000-8000-000000009034";
  try {
    assert.equal(store.writeActive(project, sessionA, [{ role: "user", content: "exact" }]).ok, true);
    const fileA = store.activeFile(project, sessionA);
    const fileB = store.activeFile(project, sessionB);
    fs.mkdirSync(path.dirname(fileB), { recursive: true });
    fs.copyFileSync(fileA, fileB);
    const foreign = store.readActive(project, sessionB);
    assert.equal(foreign.ok, false);
    assert.equal(foreign.code, "MEMORY_ACTIVE_INVALID");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Tier 1 transcript reads never return a cached value after the file changes or disappears", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-transcript-cache-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const writer = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const other = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const project = "proj_00000000-0000-4000-8000-000000009030";
  const session = "session_00000000-0000-4000-8000-000000009031";
  const block = (content) => ({ blocks: [{ block_id: "block_00000000-0000-4000-8000-000000009032", messages: [{ role: "user", content }] }] });
  try {
    assert.equal(writer.writeTranscript(project, session, block("first")).ok, true);
    const read = writer.readTranscript(project, session);
    read.value.blocks[0].messages[0].content = "mutated by caller";
    assert.equal(writer.readTranscript(project, session).value.blocks[0].messages[0].content, "first");

    assert.equal(other.writeTranscript(project, session, block("second, written elsewhere")).ok, true);
    assert.equal(writer.readTranscript(project, session).value.blocks[0].messages[0].content, "second, written elsewhere");
    // Same-size rewrites in the same instant still invalidate the cached copy.
    for (let i = 0; i < 200; i += 1) {
      writer.writeTranscript(project, session, block(`aaaa${i % 10}`));
      writer.readTranscript(project, session);
      other.writeTranscript(project, session, block(`bbbb${i % 10}`));
      assert.equal(writer.readTranscript(project, session).value.blocks[0].messages[0].content, `bbbb${i % 10}`);
    }

    assert.equal(writer.deleteSession(project, session).ok, true);
    assert.equal(writer.readTranscript(project, session).exists, false);
    assert.equal(writer.writeTranscript(project, session, block("after delete")).ok, true);
    assert.equal(other.readTranscript(project, session).value.blocks[0].messages[0].content, "after delete");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("chat images are stored encrypted with their session at full quality and removed with it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-chat-images-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const projectId = "proj_00000000-0000-4000-8000-000000004151";
  const sessionId = "session_00000000-0000-4000-8000-000000004152";
  const data = Buffer.from("full quality image bytes").toString("base64");
  const written = store.writeChatImage(projectId, sessionId, { mediaType: "image/png", data });
  assert.equal(written.ok, true);
  assert.equal(written.imageId, crypto.createHash("sha256").update(data).digest("hex"));
  assert.doesNotMatch(fs.readFileSync(written.path, "utf8"), new RegExp(data), "the image is not stored in the clear");
  assert.equal(store.writeChatImage(projectId, sessionId, { mediaType: "image/png", data }).changed, false);

  const read = store.readChatImage(projectId, sessionId, written.imageId);
  assert.deepEqual({ exists: read.exists, mediaType: read.mediaType, data: read.data }, { exists: true, mediaType: "image/png", data });
  assert.equal(store.readChatImage(projectId, sessionId, "0".repeat(64)).exists, false);
  assert.equal(store.readChatImage(projectId, sessionId, "../escape").ok, false);
  assert.equal(store.writeChatImage(projectId, sessionId, { mediaType: "image/svg+xml", data }).ok, false);

  store.deleteSession(projectId, sessionId);
  assert.equal(store.readChatImage(projectId, sessionId, written.imageId).exists, false);
});
