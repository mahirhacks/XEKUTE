"use strict";

const fsDefault = require("node:fs");
const pathDefault = require("node:path");

function clean(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, "").trim().slice(0, maximum);
}

function structuredError(code, message, details = {}) {
  return { ok: false, error: { code, message, retryable: false, ...details } };
}

function createMcpConfigService({
  fs = fsDefault,
  path = pathDefault,
  home = () => process.env.USERPROFILE || process.env.HOME || process.cwd(),
} = {}) {
  function configTarget(scope = "global", workspace = "") {
    if (scope === "project") {
      const root = clean(workspace, 32_768);
      if (!root) return null;
      return { scope: "project", root: path.join(path.resolve(root), ".xekute"), filePath: path.join(path.resolve(root), ".xekute", "mcp.json") };
    }
    const root = path.join(home(), ".xekute");
    return { scope: "global", root, filePath: path.join(root, "mcp.json") };
  }

  function readDocument(target) {
    if (!target) return { mcpServers: {} };
    if (!fs.existsSync(target.filePath)) return { mcpServers: {} };
    const parsed = JSON.parse(fs.readFileSync(target.filePath, "utf8"));
    const configured = parsed?.mcpServers || parsed?.servers || {};
    if (!configured || typeof configured !== "object" || Array.isArray(configured)) throw new Error("mcp.json must contain an mcpServers object.");
    return { ...parsed, mcpServers: { ...configured }, servers: undefined };
  }

  function atomicWrite(target, document) {
    fs.mkdirSync(target.root, { recursive: true, mode: 0o700 });
    const temporary = `${target.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { if (fs.existsSync(target.filePath)) fs.copyFileSync(target.filePath, `${target.filePath}.bak`); } catch { /* The primary file remains authoritative. */ }
    try { fs.renameSync(temporary, target.filePath); }
    catch (error) {
      try { fs.copyFileSync(temporary, target.filePath); fs.rmSync(temporary, { force: true }); }
      catch { try { fs.rmSync(temporary, { force: true }); } catch {} throw error; }
    }
    try { fs.chmodSync(target.filePath, 0o600); } catch { /* Windows ACLs protect the user profile/workspace. */ }
  }

  function publicEntry(name, config, scope, filePath) {
    const metadata = config?.xekute && typeof config.xekute === "object" ? config.xekute : {};
    const managed = metadata.preset === "kali-ssh";
    const kaliTransport = metadata.transport === "kali";
    return {
      name,
      scope,
      filePath,
      type: kaliTransport ? "kali" : config?.url ? "http" : config?.command ? "stdio" : "unknown",
      summary: kaliTransport
        ? `${clean(config?.command || "MCP server", 500)} on Kali${metadata.remoteCwd ? ` · ${clean(metadata.remoteCwd, 500)}` : ""}`
        : managed
        ? `${metadata.username || "user"}@${metadata.host || "Kali"}:${metadata.port || 22} · ${metadata.remoteExecutable || "MCP server"}`
        : clean(config?.url || config?.command || "MCP server", 500),
      managed,
      preset: managed ? clean(metadata.serverPreset || "generic", 80) : "advanced",
      connection: managed ? {
        host: clean(metadata.host, 253),
        port: Number(metadata.port) || 22,
        username: clean(metadata.username, 64),
        identityFile: clean(metadata.identityFile, 32_768),
        remoteDirectory: clean(metadata.remoteDirectory, 1_000),
        remoteExecutable: clean(metadata.remoteExecutable, 1_000),
        dangerousActions: metadata.dangerousActions === true,
        acceptNewHostKey: metadata.acceptNewHostKey !== false,
      } : null,
    };
  }

  function readScope(scope, workspace) {
    const target = configTarget(scope, workspace);
    if (!target) return { entries: [], error: "Open a project to view project MCP servers.", code: "MCP_PROJECT_REQUIRED" };
    try {
      const document = readDocument(target);
      return {
        entries: Object.entries(document.mcpServers).filter(([, config]) => config && typeof config === "object")
          .map(([name, config]) => publicEntry(name, config, target.scope, target.filePath)),
        filePath: target.filePath,
      };
    } catch (error) {
      return { entries: [], filePath: target.filePath, error: error.message, code: "MCP_CONFIG_INVALID" };
    }
  }

  function read(workspace = "") {
    const global = readScope("global", workspace);
    const project = readScope("project", workspace);
    return {
      ok: !global.error && (!workspace || !project.error),
      entries: [...global.entries, ...project.entries],
      files: { global: global.filePath || "", project: project.filePath || "" },
      warnings: [global.error, workspace ? project.error : ""].filter(Boolean),
    };
  }

  function ensure(scope = "global", workspace = "") {
    const target = configTarget(scope, workspace);
    if (!target) return structuredError("MCP_PROJECT_REQUIRED", "Open a project before creating a project MCP configuration.");
    try {
      if (!fs.existsSync(target.filePath)) atomicWrite(target, { mcpServers: {} });
      else readDocument(target);
      return { ok: true, filePath: target.filePath, scope: target.scope };
    } catch (error) { return structuredError("MCP_CONFIG_INVALID", error.message, { filePath: target.filePath }); }
  }

  return Object.freeze({ configTarget, read, ensure });
}

module.exports = { createMcpConfigService };
