"use strict";

/*
 * One-time legacy chat migration. This command is intentionally outside the
 * production runtime: it reads old chat-sessions files, writes the canonical
 * encrypted session store when a protector is supplied, and never edits or
 * deletes the legacy files.
 *
 * Usage:
 *   node scripts/migrate-chat-memory.js --workspace C:\\project
 *   node scripts/migrate-chat-memory.js --workspace C:\\project --dry-run
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSessionMemoryStore } = require("../src/app/storage/session-memory-store.js");

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function has(name) {
  return process.argv.includes(name);
}

function legacyFile(legacyDirectory, scope) {
  const digest = crypto.createHash("sha256").update(String(scope || "global").trim() || "global").digest("hex");
  return path.join(legacyDirectory, "chat-sessions", `${digest}.json`);
}

function readLegacy(file) {
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  if (document?.encrypted) {
    throw new Error("The legacy file is safeStorage-encrypted; run this command from the Electron migration host or provide a decrypted export.");
  }
  return document;
}

function main() {
  const workspace = option("--workspace");
  if (!workspace) throw new Error("--workspace is required");
  const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
  const legacyDirectory = option("--legacy-dir", path.join(process.env.APPDATA || home, "xekute-app"));
  const dataDirectory = option("--data-dir", path.join(home, ".xekute", "data"));
  const file = legacyFile(legacyDirectory, workspace);
  if (!fs.existsSync(file)) {
    console.log(JSON.stringify({ ok: true, migrated: false, reason: "LEGACY_FILE_NOT_FOUND", file }, null, 2));
    return;
  }

  const legacy = readLegacy(file);
  const store = createSessionMemoryStore({ fs, path, crypto, baseDir: dataDirectory });
  const resolved = store.resolveProject(workspace, { persist: true });
  const existing = store.load(workspace, { migrate: false });
  const hasCanonicalSessions = (existing.sessions || []).length || (existing.closedSessions || []).length || (existing.archivedSessions || []).length;
  if (hasCanonicalSessions || existing.data?.[resolved.projectId]?.__meta?.migration_version) {
    console.log(JSON.stringify({ ok: true, migrated: false, reason: "ALREADY_MIGRATED", projectId: resolved.projectId, file }, null, 2));
    return;
  }

  const document = store.migrateLegacy(workspace, resolved.projectId, legacy);
  if (has("--dry-run")) {
    console.log(JSON.stringify({ ok: true, dryRun: true, projectId: resolved.projectId, legacyFile: file, sessionCount: Object.keys(document[resolved.projectId] || {}).filter((key) => key !== "__meta").length }, null, 2));
    return;
  }

  // The public store exposes atomic writes through begin/record, so import the
  // already-normalized document with its own migration event first. This keeps
  // the command idempotent while retaining the store's backup behavior.
  const target = store.projectFile(resolved.projectId);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
  fs.renameSync(temporary, target);
  console.log(JSON.stringify({ ok: true, migrated: true, projectId: resolved.projectId, legacyFile: file, target }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, code: error.code || "MIGRATION_FAILED" }, null, 2));
  process.exitCode = 1;
}
