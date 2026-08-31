"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { createMcpConfigService } = require("../src/app/services/assessment/knowledge/mcp-config-service.js");
const { createStdioConnection } = require("../src/app/services/assessment/knowledge/mcp-runtime.js");

function temporaryRoot(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

test("generic MCP configuration preserves Cursor-style project and global files", () => {
  const home = temporaryRoot("xekute-mcp-home-");
  const workspace = temporaryRoot("xekute-mcp-workspace-");
  try {
    const service = createMcpConfigService({ home: () => home });
    const global = service.ensure("global");
    const project = service.ensure("project", workspace);
    assert.equal(global.ok, true);
    assert.equal(project.ok, true);
    fs.writeFileSync(global.filePath, JSON.stringify({ mcpServers: { local: { command: "node", args: ["server.js"], env: { MODE: "stdio" } } } }));
    fs.writeFileSync(project.filePath, JSON.stringify({ mcpServers: { sqlmap: { command: "python3", args: ["server.py"], xekute: { transport: "kali", remoteCwd: "/opt/sqlmap-mcp" } } } }));
    const read = service.read(workspace);
    assert.equal(read.ok, true);
    assert.deepEqual(read.entries.map((entry) => [entry.name, entry.scope, entry.type]), [["local", "global", "stdio"], ["sqlmap", "project", "kali"]]);
    assert.match(read.entries[1].summary, /python3 on Kali/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("generic MCP ensure refuses to overwrite malformed existing JSON", () => {
  const home = temporaryRoot("xekute-mcp-invalid-");
  try {
    const service = createMcpConfigService({ home: () => home });
    const target = path.join(home, ".xekute", "mcp.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "{ broken JSON");
    const result = service.ensure("global");
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "MCP_CONFIG_INVALID");
    assert.equal(fs.readFileSync(target, "utf8"), "{ broken JSON");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("stdio connection diagnostics are bounded", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { writable: true, write() {} };
  child.kill = () => {};
  const connection = createStdioConnection({ config: { command: "ssh" }, spawn: () => child, timeoutMs: 100 });
  const initialized = connection.initialize();
  child.stderr.emit("data", "RPC password=hunter2 failed");
  child.emit("close", 1);
  await assert.rejects(initialized, (error) => {
    assert.equal(error.code, "MCP_SERVER_EXITED");
    assert.doesNotMatch(error.message, /hunter2/);
    assert.match(error.message, /password=\[REDACTED\]/);
    return true;
  });
});

test("MCP handshakes remain bounded while tool calls are unlimited and observable by default", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const writes = [];
  child.stdin = {
    writable: true,
    write(payload, _encoding, callback) {
      writes.push(JSON.parse(String(payload).trim()));
      callback?.();
    },
  };
  child.kill = () => {};
  const connection = createStdioConnection({
    config: { command: "long-running-mcp" },
    serverId: "scanner",
    spawn: () => child,
    connectTimeoutMs: 25,
  });
  const progress = [];
  const heartbeats = [];
  const pending = connection.request("tools/call", { name: "scan", arguments: {} }, {
    onProgress: (event) => progress.push(event),
    onHeartbeat: (event) => heartbeats.push(event),
  });
  const request = writes.at(-1);
  assert.equal(request.method, "tools/call");
  assert.match(request.params._meta.progressToken, /^xekute-scanner-/);
  await new Promise((resolve) => setTimeout(resolve, 40));
  child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: request.params._meta.progressToken, progress: 3, total: 10, message: "scanning" } })}\n`);
  child.stdout.emit("data", `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "done" }] } })}\n`);
  const result = await pending;
  assert.equal(result.content[0].text, "done");
  assert.equal(progress.length, 1);
  assert.equal(progress[0].progress, 3);
  assert.equal(heartbeats.length, 1);
});
