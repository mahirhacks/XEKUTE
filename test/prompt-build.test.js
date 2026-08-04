"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const builder = require("../src/content/prompt_builder");
const loader = require("../src/content/content-loader");

const ROOT = path.resolve(__dirname, "..");
const BUILD_ROOT = path.join(ROOT, "src", "content", "build");
const MANIFEST = path.join(BUILD_ROOT, "manifest.json");

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("prompt build produces deterministic, content-addressed modules and a manifest", () => {
  const manifest = readJson(MANIFEST);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.buildVersion, 1);
  assert.ok(Array.isArray(manifest.modules));
  assert.ok(manifest.modules.length >= 12, "expected at least the generated prompt modules");

  const logical = new Set();
  for (const entry of manifest.modules) {
    assert.ok(entry.logicalName);
    assert.ok(!logical.has(entry.logicalName), `duplicate logical name ${entry.logicalName}`);
    logical.add(entry.logicalName);

    const file = path.join(BUILD_ROOT, entry.file);
    assert.ok(fs.existsSync(file), `generated module missing: ${entry.file}`);
    const content = fs.readFileSync(file, "utf8");
    const hash = builder.contentHash(content);
    assert.equal(entry.hash, hash, `manifest hash mismatch for ${entry.logicalName}`);
    assert.ok(entry.file.endsWith(`-${entry.hash}.js`), `file name must be content-addressed: ${entry.file}`);

    const source = path.join(ROOT, "src", "content", "prompts", entry.source);
    assert.ok(fs.existsSync(source), `markdown source missing: ${entry.source}`);
  }

  // Determinism: rebuilding with the same sources produces identical bytes.
  const before = new Map(manifest.modules.map((entry) => [entry.logicalName, sha256File(path.join(BUILD_ROOT, entry.file))]));
  const beforeManifest = sha256File(MANIFEST);
  builder.buildCandidates().forEach((candidate) => {
    const content = candidate.build();
    const hash = builder.contentHash(content);
    const file = path.join(BUILD_ROOT, candidate.outputRel.replace(/\.js$/, `-${hash}.js`));
    assert.ok(fs.existsSync(file), `rebuilt file missing for ${candidate.logicalName}`);
    assert.equal(before.get(candidate.logicalName), sha256File(file), `non-deterministic output for ${candidate.logicalName}`);
  });
  assert.equal(beforeManifest, sha256File(MANIFEST), "manifest must be byte-stable across rebuilds");
});

test("content loader resolves the canonical system prompt and manifest", () => {
  const manifest = readJson(MANIFEST);
  const system = loader.systemPrompt();
  assert.equal(typeof system.VERSION, "number");
  assert.ok(Array.isArray(system.MODULE_ORDER));
  assert.ok(Array.isArray(system.CLAIM_STATES));
  assert.equal(typeof system.COMPACT_ROLE, "string");
  assert.equal(typeof system.ROUTING_PROMPT, "string");
  assert.equal(typeof system.MODULES, "object");
  assert.equal(typeof system.MODE_OVERLAYS, "object");
  assert.equal(typeof system.COMPACT_MODE_OVERLAYS, "object");
  assert.equal(loader.loadManifest().schemaVersion, manifest.schemaVersion);

  const record = loader.moduleRecord("system_prompt");
  assert.equal(record.logicalName, "system_prompt");
  assert.equal(loader.resolvePath("system_prompt"), path.join(loader.BUILD_ROOT, record.file));
});

test("generated system prompt keeps its browser global and CommonJS export", () => {
  const manifest = readJson(MANIFEST);
  const entry = manifest.modules.find((item) => item.logicalName === "system_prompt");
  assert.equal(entry.exportKind, "global+XekuteSystemPrompt");
  const file = fs.readFileSync(path.join(BUILD_ROOT, entry.file), "utf8");
  assert.match(file, /XekuteSystemPrompt/);
  assert.match(file, /module\.exports = value/);
  const system = loader.systemPrompt();
  assert.equal(system.VERSION, 1);
});
