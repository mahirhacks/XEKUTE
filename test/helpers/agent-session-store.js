"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { createTier1SensitiveStore } = require("../../src/app/storage/memory/tier1-sensitive-store.js");
const { createV3SessionStore } = require("../../src/app/storage/memory/v3-session-store.js");
const { createSessionSupervisor } = require("../../src/agent/runtime/session-supervisor.js");

function sessionFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-session-input-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const mode = { available: true };
  const protector = {
    available: () => mode.available,
    encrypt(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    decrypt(value) {
      const encoded = Buffer.from(value, "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, encoded.subarray(0, 12));
      decipher.setAuthTag(encoded.subarray(12, 28));
      return Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
  const events = [];
  const projectIdentityStore = { resolveV3Project: (workspace) => ({ ok: true, projectId: `proj_${crypto.createHash("sha256").update(workspace).digest("hex")}`, canonical: workspace, workspace }) };
  const open = () => {
    const sensitiveStore = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
    const store = createV3SessionStore({ sensitiveStore, projectIdentityStore, crypto });
    return { store, sensitiveStore, supervisor: createSessionSupervisor({ store, emit: (event) => events.push(event) }) };
  };
  return { root, mode, events, open, workspace: "G:/workspace", sessionId: "session_fixture", ...open() };
}
module.exports = { sessionFixture };
