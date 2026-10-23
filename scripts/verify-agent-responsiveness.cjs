"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
const { createV3SessionStore } = require("../src/app/storage/memory/v3-session-store.js");

async function verify() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-responsive-"));
  const projectId = "proj_00000000-0000-4000-8000-000000008711";
  const sessionId = "session_00000000-0000-4000-8000-000000008712";
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  let encryptions = 0;
  const protector = {
    available: () => true,
    encrypt(text) { encryptions++; const cipher = crypto.createCipheriv("aes-256-gcm", key, iv); return Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]); },
    decrypt(payload) { const bytes = Buffer.from(payload, "base64"), cipher = crypto.createDecipheriv("aes-256-gcm", key, iv); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]).toString("utf8"); },
    async encryptAsync(text) { encryptions++; const keyObject = await crypto.webcrypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]); return Buffer.from(await crypto.webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, keyObject, Buffer.from(text))); },
  };
  const sensitive = createTier1SensitiveStore({ baseDir: root, protector });
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: sensitive });
  const history = Array.from({ length: 120 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `Observation ${index}: ${"synthetic investigation detail ".repeat(100)}` }));
  const input = { project_id: projectId, session_id: sessionId, active_conversation: history, effective_context_limit: 262144, system_prompt: "Fixture" };
  try {
    coordinator.assemble(input);
    encryptions = 0;
    let started = performance.now();
    for (let index = 0; index < 25; index++) coordinator.assemble(input);
    const repeatedAssembly = { ms: Math.round(performance.now() - started), encryptedWrites: encryptions };
    const store = createV3SessionStore({ sensitiveStore: sensitive, projectIdentityStore: { resolveV3Project: () => ({ ok: true, projectId, canonical: root, workspace: root }) } });
    const opened = await store.begin(root, { sessionId, userPrompt: "Synthetic workload" });
    assert.equal(opened.ok, true);
    let ticks = 0, last = performance.now(), maxGapMs = 0;
    const timer = setInterval(() => { const now = performance.now(); ticks++; maxGapMs = Math.max(maxGapMs, now - last); last = now; }, 5);
    await new Promise(resolve => setTimeout(resolve, 15));
    started = performance.now();
    for (let index = 0; index < 12; index++) {
      const saved = await store.record(root, { type: "snapshot", sessionId, blockId: opened.blockId, transcript: history, displayHtml: "synthetic chat ".repeat(30000) });
      assert.equal(saved.ok, true);
      assert.equal(saved.durable, true);
    }
    await new Promise(resolve => setTimeout(resolve, 10));
    clearInterval(timer);
    const persistence = { ms: Math.round(performance.now() - started), ticks, maxMainLoopGapMs: Math.round(maxGapMs) };
    await store.flush();
    const reloaded = createV3SessionStore({ sensitiveStore: createTier1SensitiveStore({ baseDir: root, protector }), projectIdentityStore: { resolveV3Project: () => ({ ok: true, projectId, canonical: root, workspace: root }) } });
    const restored = reloaded.load(root).sessions.find(session => session.id === sessionId);
    assert.equal(restored.history.at(-1).content, history.at(-1).content);
    const result = { repeatedAssembly, persistence, restored: true };
    console.log(JSON.stringify(result, null, 2));
    if (process.argv.includes("--assert")) assert.equal(repeatedAssembly.encryptedWrites, 0, "measuring unchanged context must not write it again");
    return result;
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
