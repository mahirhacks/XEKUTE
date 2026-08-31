"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createKnowledgeRelease, validateKnowledgeRelease, releaseHash } = require("../src/domain/memory/knowledge/knowledge-release.js");
const { createKnowledgeReleaseIngestor } = require("../src/app/services/assessment/knowledge/knowledge-release-ingestor.js");
const { createKnowledgeProcedureStore } = require("../src/app/services/memory/knowledge-procedure-store.js");
const { createNativeKagService } = require("../src/app/services/memory/native-kag-service.js");

const fixedNow = () => new Date("2026-08-27T10:00:00.000Z");

function procedure(overrides = {}) {
  return {
    title: "Authorization object access",
    objective: "Check object access across permitted identities.",
    target_features: ["endpoint", "data-object"],
    applicable_technologies: ["rest"],
    steps: [{ instruction: "Compare the baseline and authorized identity variants.", expected: "The server enforces the declared authorization boundary." }],
    verification_rule: { required: "A reproducible differential with source-linked evidence." },
    safety_constraints: ["Use only authorized identities."],
    classifications: ["authorization", "idor"],
    source_refs: ["fixture://authorization.md"],
    ...overrides,
  };
}

test("Knowledge releases are content-addressed, bounded, and deeply immutable", () => {
  const first = createKnowledgeRelease({ source: { type: "fixture", name: "fixture", version: "1" }, procedures: [procedure()] }, { crypto, now: fixedNow });
  const second = createKnowledgeRelease({ source: { type: "fixture", name: "fixture", version: "1" }, procedures: [procedure()] }, { crypto, now: fixedNow });
  assert.equal(first.release_id, second.release_id);
  assert.equal(first.content_hash, releaseHash(first, crypto));
  assert.match(first.release_id, /^kb_/);
  assert.match(first.procedures[0].procedure_id, /^procedure_/);
  assert.throws(() => { first.procedures[0].title = "changed"; }, TypeError);
  assert.equal(first.procedures[0].title, "Authorization object access");
  const invalid = validateKnowledgeRelease({ source: {}, procedures: [{ ...procedure(), authorization: "Bearer secret" }] }, { crypto, now: fixedNow });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "MEMORY_SECRET_FIELD");
});

test("V3 knowledge release IDs cannot escape or alias the release directory", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-kb-release-id-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = createKnowledgeProcedureStore({ fs, path, crypto, baseDir: root, now: fixedNow });
  const invalidIds = ["../escape", "nested/release", "nested\\release", ".", "..", " release", "release\nnext"];
  for (const release_id of invalidIds) {
    const invalid = store.validatePackage({
      release_id,
      version: "1",
      publisher: "fixture",
      license: "MIT",
      source_refs: ["fixture://release-id.md"],
      file_hashes: {},
      compatibility: {},
      procedures: [{
        title: "Release ID validation",
        objective: "Validate safe release identifiers.",
        prerequisites: [],
        target_features: [],
        steps: ["Use a bounded fixture."],
        expected_signals: [],
        rejecting_signals: [],
        stop_conditions: [],
        verification_rule_id: "fixture-rule",
        remediation: "None",
      }],
      chunks: [],
      concepts: [],
      aliases: {},
      applicability: {},
      proof_rules: {},
      signature: null,
    });
    assert.equal(invalid.ok, false, `expected ${JSON.stringify(release_id)} to be rejected`);
    assert.equal(invalid.code, "MEMORY_KNOWLEDGE_RELEASE_ID_INVALID");
  }
});

test("V3 knowledge signatures cannot bypass trust verification", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-v3-kb-signature-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const basePackage = {
    schema_version: 3,
    release_id: "fixture-signed-release",
    version: "1",
    publisher: "fixture",
    license: "MIT",
    source_refs: ["fixture://signed.md"],
    file_hashes: {},
    compatibility: {},
    procedures: [{
      title: "Signed procedure",
      objective: "Validate signed knowledge content.",
      prerequisites: [],
      target_features: ["web"],
      steps: ["Run the bounded fixture."],
      expected_signals: [],
      rejecting_signals: [],
      stop_conditions: [],
      verification_rule_id: "fixture-rule",
      remediation: "None",
    }],
    chunks: [],
    concepts: [],
    aliases: {},
    applicability: {},
    proof_rules: {},
    signature: null,
  };
  const untrusted = createKnowledgeProcedureStore({ fs, path, crypto, baseDir: root, now: fixedNow });
  const unsigned = untrusted.validatePackage(basePackage);
  assert.equal(unsigned.ok, true);
  const signed = { ...unsigned.package, signature: `sig:${unsigned.package.content_hash}` };
  assert.equal(untrusted.previewInstall(signed).code, "MEMORY_KNOWLEDGE_SIGNATURE_UNVERIFIED");
  assert.equal(untrusted.install(signed, { confirmation: signed.content_hash }).code, "MEMORY_KNOWLEDGE_SIGNATURE_UNVERIFIED");

  const trusted = createKnowledgeProcedureStore({
    fs,
    path,
    crypto,
    baseDir: path.join(root, "trusted"),
    now: fixedNow,
    signatureVerifier: ({ signature, content_hash }) => signature === `sig:${content_hash}`,
  });
  const preview = trusted.previewInstall(signed);
  assert.equal(preview.ok, true);
  assert.equal(preview.preview.signed, true);
  const installed = trusted.install(null, { previewId: preview.preview.preview_id, confirmation: preview.preview.preview_hash });
  assert.equal(installed.ok, true);
  assert.equal(installed.changed, true);
});

test("ingestor converts current skills and packaged WSTG catalogue into immutable releases", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-kb-ingestor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = [];
  const graph = {
    load: () => [{ id: "idor", aliases: ["object-access"], title: "IDOR", summary: "Object access checks", phase: "authorization", category: "authorization", level: "standard", signals: ["object"], technologies: ["rest"], body: "## Workflow\nCompare the baseline and variant.\n\n## Verification rules\nRequire evidence.", source: "libraries/idor.md", stableId: "skill:idor", sourceHash: "a".repeat(64), mcp: [] }],
  };
  const store = { install(release) { installed.push(release); return { ok: true, changed: true, releaseId: release.release_id }; } };
  const ingestor = createKnowledgeReleaseIngestor({ graph, releaseStore: store, crypto, now: fixedNow });
  const result = ingestor.installAll();
  assert.equal(result.ok, true);
  assert.equal(installed.length, 2);
  assert.equal(installed[0].source.type, "markdown-skill-library");
  assert.equal(installed[0].procedures[0].aliases.includes("idor"), true);
  assert.equal(installed[1].source.type, "wstg");
  assert.ok(installed[1].procedures.length >= 10);
});

test("V3 knowledge store exposes the immutable bundled WSTG release without writing user data", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-v3-bundled-kb-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundled = path.join(__dirname, "..", "resources", "memory-v3", "knowledge");
  const store = createKnowledgeProcedureStore({ fs, path, crypto, baseDir: root, bundledDir: bundled, now: fixedNow });
  const listed = store.list();
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.releases.map((entry) => entry.release_id), ["wstg-v3"]);
  assert.equal(listed.releases[0].bundled, true);
  assert.equal(fs.existsSync(path.join(root, "releases")), false);
  const loaded = store.get("wstg-v3");
  assert.equal(loaded.ok, true);
  assert.equal(loaded.bundled, true);
  assert.ok(loaded.package.procedures.length >= 100, `bundled WSTG should include chapter and scenario procedures, got ${loaded.package.procedures.length}`);
  assert.equal(loaded.package.version, "2026.2");
  assert.ok(loaded.package.procedures.every((entry) => entry.source_chunk_refs.length > 0));
});

test("native KAG persists graph, records, FTS, and vectors and reuses a valid projection", async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = require("node:sqlite")); } catch { t.skip("node:sqlite is unavailable in this runtime"); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-native-kag-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundled = path.join(__dirname, "..", "resources", "memory-v3", "knowledge");
  const knowledge = createKnowledgeProcedureStore({ fs, path, crypto, baseDir: path.join(root, "knowledge"), bundledDir: bundled, now: fixedNow });
  const provider = {
    model: "fixture-embedding",
    dimension: 3,
    calls: 0,
    async embed(values) {
      this.calls += 1;
      return { ok: true, vectors: values.map(() => [1, 0, 0]), degraded: false };
    },
  };
  const create = () => createNativeKagService({ knowledgeStore: knowledge, cacheDirectory: path.join(root, "cache"), embeddingProvider: provider, now: fixedNow });
  const project = {
    project_id: "proj_fixture",
    revision: 1,
    entities: [{ record_id: "entity_host", entity_type: "hostname", canonical_key: "example.test", label: "example.test", aliases: ["example"], provenance: { source_refs: ["event_fixture"] } }],
    claims: [],
    relationships: [],
    conflicts: [],
  };
  const investigation = { project_id: "proj_fixture", revision: 2, procedures: [], coverage: [], attempts: [], assignments: [], candidates: [], blockers: [] };
  const firstKag = create();
  const first = await firstKag.retrieve("proj_fixture", "authentication", { projectState: project, investigationState: investigation, targetClass: "web" });
  assert.equal(first.ok, true);
  assert.ok(first.records.length > 0);
  const databaseFile = path.join(root, "cache", "projects", "proj_fixture", "index.sqlite");
  const database = new DatabaseSync(databaseFile, { readOnly: true });
  for (const table of ["chunks", "records", "vectors", "nodes", "aliases", "chunks_fts", "records_fts"]) {
    assert.ok(Number(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count) > 0, `${table} should be populated`);
  }
  database.close();
  const callsBeforeReload = provider.calls;
  const second = await create().retrieve("proj_fixture", "authentication", { projectState: project, investigationState: investigation, targetClass: "web" });
  assert.equal(second.ok, true);
  assert.equal(provider.calls - callsBeforeReload, 1, "a valid projection should reuse cached chunk vectors and embed only the query");
});

test("native KAG rejects secret-bearing releases and cross-release procedure collisions", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-native-kag-release-guards-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundled = path.join(__dirname, "..", "resources", "memory-v3", "knowledge");
  const knowledge = createKnowledgeProcedureStore({ fs, path, crypto, baseDir: path.join(root, "knowledge"), bundledDir: bundled, now: fixedNow });
  const loaded = knowledge.get("wstg-v3");
  assert.equal(loaded.ok, true);
  const service = createNativeKagService({ now: fixedNow });
  assert.equal(service.installRelease(loaded.package).ok, true);

  const secretPackage = { ...loaded.package, release_id: "wstg-secret", package_id: "kb_wstg_secret", compatibility: { ...loaded.package.compatibility, secret_value: "Bearer abcdefghijkl" } };
  const secretResult = service.installRelease(secretPackage);
  assert.equal(secretResult.ok, false);
  assert.match(secretResult.code, /^MEMORY_SECRET_/);

  const collisionPackage = {
    ...loaded.package,
    release_id: "wstg-collision",
    package_id: "kb_wstg_collision",
    procedures: loaded.package.procedures.map((entry, index) => index === 0 ? { ...entry, title: `${entry.title} altered` } : { ...entry }),
  };
  const collisionResult = service.installRelease(collisionPackage);
  assert.equal(collisionResult.ok, false);
  assert.equal(collisionResult.code, "MEMORY_KAG_PROCEDURE_ID_COLLISION");
});

test("native KAG rejects secret-bearing direct query state and search text", async () => {
  const service = createNativeKagService({ now: fixedNow });
  const project = {
    project_id: "proj_kag_secret_guard",
    revision: 1,
    entities: [{ record_id: "entity_secret", entity_type: "note", canonical_key: "safe", label: "Bearer abcdefghijkl" }],
    claims: [],
    relationships: [],
    conflicts: [],
  };
  const retrieval = await service.retrieve(project.project_id, "password=abcdefghijkl", { projectState: { ...project, entities: [] } });
  assert.equal(retrieval.ok, false);
  assert.match(retrieval.code, /^MEMORY_SECRET_/);
});
