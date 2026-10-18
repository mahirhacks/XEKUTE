"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

function createBrowserTabStore({ directory, protector }) {
  const fileFor = projectId => path.join(directory, createHash("sha256").update(projectId).digest("hex") + ".json");
  function requireProtector() {
    if (!protector?.available()) throw Object.assign(new Error("Encrypted browser tab storage is unavailable."), { code: "BROWSER_STORAGE_UNAVAILABLE" });
  }
  return Object.freeze({
    async load(projectId) {
      requireProtector();
      let data;
      try { data = await fs.readFile(fileFor(projectId), "utf8"); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
      const envelope = JSON.parse(data);
      if (envelope.version !== 1) throw new Error("Unsupported browser tab storage version.");
      const value = JSON.parse(protector.decrypt(envelope.payload));
      if (value.projectId !== projectId || !Array.isArray(value.tabs)) throw new Error("Browser tab storage belongs to another project.");
      return value.tabs;
    },
    async save(projectId, tabs) {
      requireProtector();
      const data = JSON.stringify({ version: 1, payload: protector.encrypt(JSON.stringify({ projectId, tabs })) });
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const file = fileFor(projectId), temporary = file + `.${randomUUID()}.tmp`;
      try { await fs.writeFile(temporary, data, { mode: 0o600, flag: "wx" }); await fs.rename(temporary, file); }
      finally { await fs.rm(temporary, { force: true }); }
    },
  });
}

module.exports = { createBrowserTabStore };
