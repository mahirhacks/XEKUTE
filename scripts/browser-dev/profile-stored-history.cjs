"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");
const { createTier1SensitiveStore } = require("../../src/app/storage/memory/tier1-sensitive-store.js");
const { createV3SessionStore } = require("../../src/app/storage/memory/v3-session-store.js");

// Read the original encrypted data in a separate process. Diagnostics contain
// sizes and timings, never prompts, tool results, HTML, or credential values.
function profileStoredHistory({ safeStorage, baseDir, projectId, passCount = 2 }) {
  const counters = { reads: 0, readMs: 0, decrypts: 0, decryptMs: 0 };
  const trackedFs = { ...fs, readFileSync(...args) {
    const started = performance.now();
    try { return fs.readFileSync(...args); }
    finally { counters.reads++; counters.readMs += performance.now() - started; }
  } };
  const sensitive = createTier1SensitiveStore({ baseDir, fs: trackedFs, protector: {
    available: () => safeStorage.isEncryptionAvailable(), encrypt: text => safeStorage.encryptString(text),
    decrypt(payload) {
      const started = performance.now();
      try { return safeStorage.decryptString(Buffer.from(payload, "base64")); }
      finally { counters.decrypts++; counters.decryptMs += performance.now() - started; }
    },
  } });
  const store = createV3SessionStore({ sensitiveStore: sensitive, projectIdentityStore: {
    resolveV3Project: () => ({ ok: true, projectId, canonical: "read-only startup fixture", workspace: "read-only startup fixture" }),
  } });
  const passes = [];
  let loaded;
  for (const mode of ["cold", "repeat"].slice(0, passCount)) {
    for (const key of Object.keys(counters)) counters[key] = 0;
    const started = performance.now();
    loaded = store.load("read-only startup fixture");
    const ms = performance.now() - started;
    if (!loaded.ok) throw new Error(loaded.code || "Stored history could not load");
    passes.push({ mode, ms, ...counters });
  }
  const sessions = [...loaded.sessions, ...loaded.closedSessions, ...loaded.archivedSessions];
  if (!sessions.length && loaded.warning) throw new Error(loaded.warning.slice(0, 300));
  const report = { projectId, passes, responseBytes: Buffer.byteLength(JSON.stringify(loaded)),
    groups: { open: loaded.sessions.length, closed: loaded.closedSessions.length, archived: loaded.archivedSessions.length },
    sessions: sessions.map(session => ({ id: session.id, status: session.status, messages: session.history.length,
      historyBytes: Buffer.byteLength(JSON.stringify(session.history)), hasDuplicateMessages: Array.isArray(session.messages),
      htmlBytes: Buffer.byteLength(session.messagesHtml), uiRuns: session.transcript?.runs?.length || 0,
      uiEvents: (session.transcript?.runs || []).reduce((sum, run) => sum + (run?.events?.length || 0), 0),
    })).sort((a, b) => b.historyBytes - a.historyBytes),
  };
  return report;
}

function copyStoredHistory({ audit, userData, workspace, projectId = audit.projects[0].projectId }) {
  const sourceState = JSON.parse(fs.readFileSync(path.join(audit.baseDir, "../..", "Local State"), "utf8"));
  fs.writeFileSync(path.join(userData, "Local State"), JSON.stringify({ os_crypt: sourceState.os_crypt }));
  const source = path.join(audit.baseDir, "projects", projectId, "sessions");
  let sessions = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(source, entry.name, "transcript.enc.json");
    if (!fs.existsSync(file)) continue;
    const target = path.join(userData, "memory-v3", "sensitive", "projects", projectId, "sessions", entry.name);
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(file, path.join(target, "transcript.enc.json"));
    sessions++;
  }
  const { createProjectIdentityStore } = require("../../src/app/storage/memory/project-identity-store.js");
  const bound = createProjectIdentityStore({ baseDir: path.join(userData, "memory-v3", "identity") })
    .bindWorkspace(workspace, projectId);
  if (!bound.ok) throw new Error(bound.code || "The disposable project could not be bound");
  return sessions;
}

async function run() {
  const { _electron } = require("playwright-core");
  const audit = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] || "tmp/live-startup-audit.json"), "utf8"));
  const projectId = process.argv[3] || audit.projects[0].projectId;
  const launch = createDevLaunch({ native: true, smoke: true });
  const sourceState = JSON.parse(fs.readFileSync(path.join(audit.baseDir, "../..", "Local State"), "utf8"));
  fs.writeFileSync(path.join(launch.userData, "Local State"), JSON.stringify({ os_crypt: sourceState.os_crypt }));
  let app;
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const report = await app.evaluate(({ safeStorage }, args) => process.mainModule.require(args.source).profileStoredHistory({ safeStorage, ...args }),
      { source: __filename, baseDir: audit.baseDir, projectId });
    const output = path.resolve(process.argv[4] || "tmp/stored-history-profile.json");
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { profileStoredHistory, copyStoredHistory };
