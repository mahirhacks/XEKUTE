"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createBrowserTabStore } = require("../src/app/storage/browser-tab-store.js");

test("browser tab metadata is encrypted, project-specific, atomic, and fails visibly", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "xekute-browser-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const protector = { available: () => true, encrypt(text) {
    const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]).toString("base64");
  }, decrypt(payload) {
    const bytes = Buffer.from(payload, "base64"), decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
  } };
  const store = createBrowserTabStore({ directory, protector });
  assert.deepEqual(await store.load("project-a"), []);
  const tabs = [{ id: "one", url: "https://fixture.test/?token=secret-fixture" }];
  await store.save("project-a", tabs);
  const files = await fs.readdir(directory);
  assert.equal(files.length, 1);
  assert.doesNotMatch(await fs.readFile(path.join(directory, files[0]), "utf8"), /secret-fixture|fixture\.test/);
  assert.deepEqual(await store.load("project-a"), tabs);
  assert.deepEqual(await store.load("project-b"), []);
  await store.save("project-a", []);
  assert.deepEqual(await store.load("project-a"), []);
  await fs.writeFile(path.join(directory, files[0]), "corrupt");
  await assert.rejects(store.load("project-a"));
  const unavailable = createBrowserTabStore({ directory, protector: { available: () => false } });
  await assert.rejects(unavailable.save("project-a", []), { code: "BROWSER_STORAGE_UNAVAILABLE" });
});
