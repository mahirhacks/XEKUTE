"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");

const MAX_ARTIFACT_BYTES = 12 * 1024 * 1024;
const fail = (code, message) => Object.assign(new Error(message), { code });
function createBrowserArtifactStore({ directory, protector }) {
  const projectDirectory = projectId => {
    if (typeof projectId !== "string" || !projectId) throw fail("BROWSER_ARTIFACT_INVALID", "A browser artifact requires its project.");
    return path.join(directory, createHash("sha256").update(projectId).digest("hex"));
  };
  const fileFor = (projectId, id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw fail("BROWSER_ARTIFACT_UNAVAILABLE", "The browser artifact is unavailable.");
    return path.join(projectDirectory(projectId), id + ".json");
  };
  const requireProtection = () => {
    if (!protector?.available()) throw fail("BROWSER_STORAGE_UNAVAILABLE", "Encrypted browser artifact storage is unavailable.");
  };
  return Object.freeze({
    async put({ projectId, kind, mimeType, data, metadata = {} }) {
      requireProtection();
      if (!Buffer.isBuffer(data) || !data.length || data.length > MAX_ARTIFACT_BYTES) throw fail("BROWSER_ARTIFACT_TOO_LARGE", "Browser artifacts must contain between 1 byte and 12 MiB.");
      if (!["screenshot", "observation", "download"].includes(kind)) throw fail("BROWSER_ARTIFACT_INVALID", "Unsupported browser artifact kind.");
      const record = { id: randomUUID(), projectId, kind, mimeType, metadata: structuredClone(metadata), byteLength: data.length };
      const file = fileFor(projectId, record.id), temporary = file + ".tmp";
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, payload: protector.encrypt(JSON.stringify({ ...record, data: data.toString("base64") })) }), { mode: 0o600, flag: "wx" });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
      return record;
    },
    async read({ projectId, artifactId }) {
      requireProtection();
      let envelope;
      try { envelope = JSON.parse(await fs.readFile(fileFor(projectId, artifactId), "utf8")); }
      catch (error) { if (error.code === "ENOENT") throw fail("BROWSER_ARTIFACT_UNAVAILABLE", "The browser artifact is unavailable in this project."); throw error; }
      if (envelope.version !== 1) throw fail("BROWSER_ARTIFACT_UNAVAILABLE", "Unsupported browser artifact version.");
      const record = JSON.parse(protector.decrypt(envelope.payload));
      if (record.projectId !== projectId || record.id !== artifactId) throw fail("BROWSER_ARTIFACT_UNAVAILABLE", "The browser artifact belongs to another project.");
      const data = Buffer.from(record.data, "base64");
      if (!data.length || data.length !== record.byteLength || data.length > MAX_ARTIFACT_BYTES) throw fail("BROWSER_ARTIFACT_UNAVAILABLE", "The browser artifact is damaged.");
      return { ...record, data };
    },
  });
}

module.exports = { createBrowserArtifactStore, MAX_ARTIFACT_BYTES };
