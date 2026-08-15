"use strict";

const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const crypto = require("node:crypto");
const { spawn: spawnDefault } = require("node:child_process");
const { redactSecrets, redactStructuredValue } = require("../../../../shared/secret-redaction.js");
const { createKaliAccessService } = require("./kali-access-service.js");

const MCP_PROTOCOL_VERSION = "2024-11-05";
const MAX_RESULT_CHARS = 24_000;
const MAX_SCHEMA_CHARS = 12_000;

function clean(value, maximum = 8_000) { return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum); }
function boundedSchema(value) {
  const sanitized = redactStructuredValue(value && typeof value === "object" ? value : { type: "object", properties: {} });
  try {
    const serialized = JSON.stringify(sanitized);
    if (serialized.length <= MAX_SCHEMA_CHARS) return JSON.parse(serialized);
  } catch { /* Fall through to the empty safe schema. */ }
  return { type: "object", properties: {}, description: "The MCP schema was too large to expose safely." };
}
function dynamicName(server, tool) { return `mcp__${clean(server, 120).replace(/[^a-zA-Z0-9_-]/g, "_")}__${clean(tool, 160).replace(/[^a-zA-Z0-9_-]/g, "_")}`; }
function parseDynamicName(name) {
  const match = String(name || "").match(/^mcp__([^_][\s\S]*?)__(.+)$/);
  return match ? { server: match[1], tool: match[2] } : null;
}

function normalizeTimeout(value, fallback = 0, maximum = 2_147_000_000) {
  if (value === 0 || value === "0" || value === false || value === null) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

function createStdioConnection({
  config,
  serverId,
  spawn = spawnDefault,
  timeoutMs,
  connectTimeoutMs = timeoutMs === undefined ? 12_000 : timeoutMs,
  requestTimeoutMs = 0,
} = {}) {
  const command = clean(config?.command, 2_000);
  if (!command) return Promise.reject(Object.assign(new Error("MCP server has no stdio command."), { code: "MCP_COMMAND_MISSING" }));
  const args = Array.isArray(config.args) ? config.args.map((value) => String(value)) : [];
  const child = spawn(command, args, {
    cwd: config.cwd ? String(config.cwd) : undefined,
    env: { ...process.env, ...(config.env && typeof config.env === "object" ? config.env : {}) },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  const pending = new Map();
  let closed = false;
  let stderr = "";
  function rejectAll(error) { for (const item of pending.values()) item.reject(error); pending.clear(); }
  function handleMessage(message) {
    if (!message) return;
    if (message.id === undefined) {
      if (message.method !== "notifications/progress") return;
      const token = String(message.params?.progressToken ?? "");
      for (const item of pending.values()) {
        if (!token || item.progressToken !== token) continue;
        item.onProgress?.({
          source: "mcp",
          progress: message.params?.progress,
          total: message.params?.total,
          message: clean(message.params?.message || "MCP operation reported progress.", 1_000),
        });
        item.onHeartbeat?.({ source: "mcp", kind: "protocol_progress" });
      }
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(Object.assign(new Error(message.error.message || "MCP JSON-RPC error"), { code: message.error.code || "MCP_RPC_ERROR", data: message.error.data }));
    else item.resolve(message.result || {});
  }
  function parseBuffer() {
    while (buffer.length) {
      const header = buffer.indexOf(Buffer.from("\r\n\r\n"));
      if (header >= 0) {
        const headerText = buffer.slice(0, header).toString("utf8");
        const match = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!match) { buffer = buffer.slice(header + 4); continue; }
        const length = Number(match[1]);
        const start = header + 4;
        if (buffer.length < start + length) return;
        const body = buffer.slice(start, start + length).toString("utf8");
        buffer = buffer.slice(start + length);
        try { handleMessage(JSON.parse(body)); } catch { /* Ignore malformed server notifications. */ }
        continue;
      }
      const newline = buffer.indexOf(10);
      if (newline < 0) return;
      const line = buffer.slice(0, newline).toString("utf8").trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try { handleMessage(JSON.parse(line)); } catch { /* MCP servers may log non-JSON lines to stdout. */ }
    }
  }
  child.stdout?.on("data", (chunk) => { buffer = Buffer.concat([buffer, Buffer.from(chunk)]); parseBuffer(); });
  child.stderr?.on("data", (chunk) => { stderr = redactSecrets(`${stderr}${String(chunk || "")}`).slice(-4_000); });
  child.on("error", (error) => { closed = true; rejectAll(error); });
  child.on("close", (code) => {
    closed = true;
    const detail = stderr.trim() ? `: ${stderr.trim()}` : "";
    rejectAll(Object.assign(new Error(`MCP server exited with code ${code}${detail}`), { code: "MCP_SERVER_EXITED" }));
  });
  function request(method, params = {}, { signal = null, timeoutMs: requestTimeoutOverride, onProgress = null, onHeartbeat = null } = {}) {
    if (closed || !child.stdin?.writable) return Promise.reject(Object.assign(new Error("MCP server is not available."), { code: "MCP_SERVER_UNAVAILABLE" }));
    if (signal?.aborted) return Promise.reject(Object.assign(new Error("MCP request stopped by the operator."), { code: "MCP_REQUEST_STOPPED" }));
    const id = nextId++;
    const progressToken = `xekute-${serverId || "mcp"}-${id}-${crypto.randomUUID()}`;
    const requestParams = method === "tools/call"
      ? { ...(params || {}), _meta: { ...(params?._meta || {}), progressToken } }
      : params;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params: requestParams })}\n`;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const abortHandler = () => {
        pending.delete(id);
        settled = true;
        if (timer) clearTimeout(timer);
        reject(Object.assign(new Error("MCP request stopped by the operator."), { code: "MCP_REQUEST_STOPPED" }));
      };
      const finish = (callback) => (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", abortHandler);
        callback(value);
      };
      const effectiveTimeout = normalizeTimeout(requestTimeoutOverride, normalizeTimeout(requestTimeoutMs, 0));
      if (effectiveTimeout > 0) {
        timer = setTimeout(() => {
          pending.delete(id);
          finish(reject)(Object.assign(new Error(`MCP request timed out: ${method}`), { code: "MCP_REQUEST_TIMEOUT" }));
        }, effectiveTimeout);
      }
      pending.set(id, {
        resolve: finish(resolve),
        reject: finish(reject),
        progressToken,
        onProgress: typeof onProgress === "function" ? onProgress : null,
        onHeartbeat: typeof onHeartbeat === "function" ? onHeartbeat : null,
      });
      signal?.addEventListener("abort", abortHandler, { once: true });
      child.stdin.write(payload, "utf8", (error) => {
        if (!error) return;
        pending.delete(id);
        finish(reject)(error);
      });
    });
  }
  function notify(method, params = {}) { if (!closed && child.stdin?.writable) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, "utf8"); }
  async function initialize() {
    const handshakeTimeout = normalizeTimeout(connectTimeoutMs, 12_000, 120_000);
    await request("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "XEKUTE", version: "0.1.0" } }, { timeoutMs: handshakeTimeout });
    notify("notifications/initialized", {});
    const listed = await request("tools/list", {}, { timeoutMs: handshakeTimeout });
    return Array.isArray(listed?.tools) ? listed.tools : [];
  }
  return { serverId, child, initialize, request, close: () => { try { child.kill(); } catch {} } };
}

function createMcpRuntime({ fs = fsDefault, path = pathDefault, spawn = spawnDefault, home = () => process.env.USERPROFILE || process.env.HOME || process.cwd(), connect = null, kaliAccess = null } = {}) {
  const connections = new Map();
  const activeTools = new Map();
  const kaliAccessService = kaliAccess || createKaliAccessService({ fs, path, home });

  function workspaceKey(workspace) { return path.resolve(String(workspace || "")).toLowerCase(); }
  function activeKey(workspace, sessionId, name) { return `${workspaceKey(workspace)}::${String(sessionId || "")}::${String(name || "")}`; }

  function configFiles(workspace) {
    const files = [];
    if (workspace) files.push(path.join(path.resolve(String(workspace)), ".xekute", "mcp.json"));
    files.push(path.join(home(), ".xekute", "mcp.json"));
    return files;
  }
  function readServers(workspace) {
    const result = new Map();
    for (const filePath of configFiles(workspace).reverse()) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const configured = raw?.mcpServers || raw?.servers || {};
        for (const [name, config] of Object.entries(configured && typeof configured === "object" ? configured : {})) {
          if (config && typeof config === "object") result.set(String(name), { ...config, id: String(name), configPath: filePath });
        }
      } catch { /* A missing or malformed scope is reported when a skill requests it. */ }
    }
    for (const [name, config] of result.entries()) {
      const resolved = kaliAccessService.resolveMcpConfig(config);
      result.set(name, resolved.ok ? { ...resolved.config, id: name, configPath: config.configPath } : { ...config, id: name, configPath: config.configPath, resolutionError: resolved.error });
    }
    return result;
  }
  async function connectionFor(workspace, serverId, config) {
    if (config.resolutionError) return Promise.reject(Object.assign(new Error(config.resolutionError.message), { code: config.resolutionError.code }));
    const key = `${path.resolve(String(workspace || "")).toLowerCase()}::${serverId}`;
    if (connections.has(key)) return connections.get(key);
    const pending = (async () => {
      const connection = connect
        ? await connect({ workspace, serverId, config })
        : config.url
          ? Promise.reject(Object.assign(new Error("HTTP MCP transport is not configured for this server."), { code: "MCP_HTTP_TRANSPORT_UNAVAILABLE" }))
          : createStdioConnection({
            config,
            serverId,
            spawn,
            connectTimeoutMs: Math.max(1_000, Math.min(120_000, Number(config.connectTimeoutMs ?? config.timeoutMs) || 12_000)),
            requestTimeoutMs: normalizeTimeout(config.requestTimeoutMs, 0),
          });
      const tools = await connection.initialize();
      return { ...connection, tools };
    })();
    connections.set(key, pending);
    try { return await pending; } catch (error) { connections.delete(key); throw error; }
  }
  async function activate({ workspace, mode = "agent", mappings = [], sessionId = "" } = {}) {
    const servers = readServers(workspace);
    const tools = [];
    const unavailable = [];
    const chatSessionId = String(sessionId || "");
    if (!chatSessionId) {
      return {
        ok: true,
        tools,
        activeTools: tools,
        unavailable: [{ code: "MCP_SESSION_REQUIRED", reason: "MCP tools require a chat-local knowledge lease." }],
      };
    }
    for (const mapping of Array.isArray(mappings) ? mappings : []) {
      if (tools.length >= 50) { unavailable.push({ code: "MCP_TOOL_LIMIT_REACHED", reason: "The selected knowledge packet reached the dynamic tool limit." }); break; }
      const serverId = clean(mapping?.server, 160);
      const candidates = [];
      if (!serverId) {
        unavailable.push({ code: "MCP_MAPPING_INCOMPLETE", reason: "The skill mapping must declare a server id." });
        continue;
      }
      for (const spec of Array.isArray(mapping.tools) ? mapping.tools : []) {
        const name = clean(spec?.name, 160);
        if (!name) {
          unavailable.push({ server: serverId, code: "MCP_MAPPING_INCOMPLETE", reason: "The skill mapping must declare a tool name." });
          continue;
        }
        const metadata = {
          server: serverId,
          remoteName: name,
          modes: Array.isArray(spec.modes) ? spec.modes.map(String) : [],
          access: spec.access === "mutate" ? "mutate" : "read",
          accessDeclared: Object.prototype.hasOwnProperty.call(spec, "access_declared")
            ? spec.access_declared === true
            : spec.access === "read" || spec.access === "mutate",
          targetTypes: Array.isArray(spec.target_types) ? spec.target_types.map(String) : [],
          targetArguments: Array.isArray(spec.target_arguments) ? spec.target_arguments.map(String) : [],
          sessionId: chatSessionId,
          workspace: String(workspace || ""),
        };
        if (!metadata.modes.length || !metadata.accessDeclared || !metadata.targetTypes.length || !metadata.targetArguments.length) {
          unavailable.push({ server: serverId, tool: name, code: "MCP_MAPPING_INCOMPLETE", reason: "The skill mapping must declare modes, access, target_types, and target_arguments." });
          continue;
        }
        if (!metadata.modes.includes(String(mode))) {
          unavailable.push({ server: serverId, tool: name, code: "MCP_MODE_UNAVAILABLE" });
          continue;
        }
        candidates.push({ name, metadata });
      }
      if (!candidates.length) continue;
      const config = servers.get(serverId);
      if (!config) { unavailable.push({ server: serverId, code: "MCP_SERVER_NOT_CONFIGURED" }); continue; }
      let connection;
      try { connection = await connectionFor(workspace, serverId, config); }
      catch (error) { unavailable.push({ server: serverId, code: error.code || "MCP_SERVER_UNAVAILABLE", error: redactStructuredValue(clean(error.message || "MCP server unavailable", 800)) }); continue; }
      for (const candidate of candidates) {
        if (tools.length >= 50) break;
        const { name, metadata } = candidate;
        const remote = connection.tools.find((tool) => String(tool?.name || "") === name);
        if (!remote) { unavailable.push({ server: serverId, tool: name, code: "MCP_TOOL_NOT_FOUND" }); continue; }
        const exposedName = dynamicName(serverId, name);
        const key = activeKey(workspace, chatSessionId, exposedName);
        const existing = activeTools.get(key);
        if (existing && (existing.server !== serverId || existing.remoteName !== name)) {
          unavailable.push({ server: serverId, tool: name, code: "MCP_TOOL_NAME_COLLISION", exposedName });
          continue;
        }
        const definition = {
          type: "function",
          function: {
            name: exposedName,
            description: redactStructuredValue(clean(remote.description || `MCP ${serverId} tool ${name}`, 2_000)),
            parameters: boundedSchema(remote.inputSchema),
          },
        };
        activeTools.set(key, { ...metadata, connection, definition, exposedName });
        tools.push(definition);
      }
    }
    return { ok: true, tools, activeTools: tools, unavailable };
  }
  function matchingEntries(name, { workspace = "", sessionId = "", mode = "" } = {}) {
    const exposedName = String(name || "");
    const expectedWorkspace = workspace ? workspaceKey(workspace) : "";
    const expectedSession = String(sessionId || "");
    return [...activeTools.values()].filter((entry) => {
      if (entry.exposedName !== exposedName) return false;
      if (expectedWorkspace && workspaceKey(entry.workspace) !== expectedWorkspace) return false;
      if (expectedSession && entry.sessionId !== expectedSession) return false;
      if (mode && !entry.modes.includes(String(mode))) return false;
      return true;
    });
  }
  function metadata(name, context = {}) {
    // Dynamic tools are chat leases. Never resolve one from global state when
    // the caller has not supplied the complete execution identity.
    if (!context.workspace || !context.sessionId || !context.mode) return null;
    const entry = activeTools.get(activeKey(context.workspace, context.sessionId, name)) || null;
    if (entry && !entry.modes.includes(String(context.mode))) return null;
    return entry;
  }
  function has(name, context = {}) { return Boolean(metadata(name, context)); }
  async function execute(name, args = {}, context = {}, { signal = null, onProgress = null, onHeartbeat = null } = {}) {
    const entry = metadata(name, context);
    if (!entry) return { ok: false, error: `MCP tool '${name}' is not active for this chat.`, code: "MCP_TOOL_NOT_ACTIVE" };
    try {
      const result = await entry.connection.request("tools/call", { name: entry.remoteName, arguments: args || {} }, { signal, onProgress, onHeartbeat });
      const safe = redactStructuredValue(result);
      const serialized = JSON.stringify(safe);
      return { ok: !result?.isError, toolName: name, server: entry.server, result: serialized.slice(0, MAX_RESULT_CHARS), ...(result?.isError ? { code: "MCP_TOOL_REPORTED_ERROR" } : {}) };
    } catch (error) { return { ok: false, error: redactStructuredValue(clean(error.message || "MCP tool execution failed", 1_000)), code: error.code || "MCP_TOOL_EXECUTION_FAILED", retryable: false }; }
  }
  function clearSession(sessionId, workspace = "") {
    const expectedSession = String(sessionId || "");
    const expectedWorkspace = workspace ? workspaceKey(workspace) : "";
    for (const [key, entry] of activeTools.entries()) {
      if (entry.sessionId === expectedSession && (!expectedWorkspace || workspaceKey(entry.workspace) === expectedWorkspace)) activeTools.delete(key);
    }
  }
  function clearAll() { activeTools.clear(); for (const connection of connections.values()) Promise.resolve(connection).then((value) => value.close?.()).catch(() => {}); connections.clear(); }
  function activeForSession(sessionId, { workspace = "", mode = "" } = {}) {
    const expectedSession = String(sessionId || "");
    const expectedWorkspace = workspace ? workspaceKey(workspace) : "";
    return [...activeTools.values()].filter((entry) => entry.sessionId === expectedSession
      && (!expectedWorkspace || workspaceKey(entry.workspace) === expectedWorkspace)
      && (!mode || entry.modes.includes(String(mode))))
      .map((entry) => ({ name: entry.exposedName, definition: entry.definition, metadata: { server: entry.server, remoteName: entry.remoteName, access: entry.access, modes: entry.modes, targetTypes: entry.targetTypes, targetArguments: entry.targetArguments } }));
  }
  function definitionsForSession(sessionId, options = {}) { return activeForSession(sessionId, options).map((entry) => entry.definition); }
  return Object.freeze({ activate, execute, metadata, has, clearSession, clearAll, activeForSession, definitionsForSession, readServers, dynamicName, parseDynamicName });
}

module.exports = { MCP_PROTOCOL_VERSION, createMcpRuntime, createStdioConnection, dynamicName, normalizeTimeout, parseDynamicName };
