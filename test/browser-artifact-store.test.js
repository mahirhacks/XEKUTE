"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createBrowserArtifactStore, MAX_ARTIFACT_BYTES } = require("../src/app/services/browser/browser-artifact-store.js");
const protector = { available: () => true, encrypt: text => Buffer.from(text).toString("base64"), decrypt: text => Buffer.from(text, "base64").toString() };
test("browser screenshots survive a reopened store and remain project-bound", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xekute-artifacts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createBrowserArtifactStore({ directory, protector });
  const saved = await store.put({ projectId: "one", kind: "screenshot", mimeType: "image/png", data: Buffer.from("synthetic image"), metadata: { pixelWidth: 100 } });
  const reopened = createBrowserArtifactStore({ directory, protector });
  const result = await reopened.read({ projectId: "one", artifactId: saved.id });
  assert.equal(result.data.toString(), "synthetic image"); assert.equal(result.metadata.pixelWidth, 100);
  await assert.rejects(reopened.read({ projectId: "two", artifactId: saved.id }), { code: "BROWSER_ARTIFACT_UNAVAILABLE" });
  await assert.rejects(reopened.read({ projectId: "one", artifactId: "../../outside" }), { code: "BROWSER_ARTIFACT_UNAVAILABLE" });
});
test("browser artifact writes require encryption and enforce payload limits", async () => {
  const directory = path.join(os.tmpdir(), "unused-browser-artifact-test");
  await assert.rejects(createBrowserArtifactStore({ directory }).put({ projectId: "one", kind: "screenshot", data: Buffer.from("x") }), { code: "BROWSER_STORAGE_UNAVAILABLE" });
  await assert.rejects(createBrowserArtifactStore({ directory, protector }).put({ projectId: "one", kind: "screenshot", data: Buffer.alloc(MAX_ARTIFACT_BYTES + 1) }), { code: "BROWSER_ARTIFACT_TOO_LARGE" });
});
