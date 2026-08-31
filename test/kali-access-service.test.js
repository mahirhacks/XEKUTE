"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createKaliAccessService } = require("../src/app/services/assessment/knowledge/kali-access-service.js");
const { createMcpRuntime } = require("../src/app/services/assessment/knowledge/mcp-runtime.js");

function temporaryRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "xekute-kali-access-")); }

test("Kali access is disabled by default and persists one reusable SSH profile", () => {
  const home = temporaryRoot();
  const key = path.join(home, "id_ed25519");
  fs.writeFileSync(key, "test-key");
  try {
    const service = createKaliAccessService({ home: () => home });
    assert.equal(service.read().value.enabled, false);
    const saved = service.save({ profile: { enabled: true, host: "192.168.56.20", port: 2222, username: "kali", identityFile: key, acceptNewHostKey: true } });
    assert.equal(saved.ok, true);
    assert.equal(service.read().value.host, "192.168.56.20");
    assert.equal(JSON.parse(fs.readFileSync(service.filePath(), "utf8")).identityFile, key);
    assert.doesNotMatch(fs.readFileSync(service.filePath(), "utf8"), /password|token|secret/i);
    assert.equal(service.save({ profile: { ...saved.value, host: "kali.local" } }).ok, true);
    assert.equal(fs.existsSync(`${service.filePath()}.bak`), true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("Kali access validates SSH fields and returns failed connection diagnostics", async () => {
  const home = temporaryRoot();
  try {
    const service = createKaliAccessService({
      home: () => home,
      execFile: (_command, _args, _options, callback) => callback(new Error("failed"), "", "password=hunter2 denied"),
    });
    assert.equal(service.save({ profile: { enabled: true, host: "bad;host", username: "kali" } }).error.code, "KALI_SSH_HOST_INVALID");
    const result = await service.test({ profile: { enabled: true, host: "kali.local", username: "kali" } });
    assert.equal(result.error.code, "KALI_SSH_CONNECTION_FAILED");
    assert.doesNotMatch(result.error.message, /hunter2/);
    assert.match(result.error.message, /password=\[REDACTED\] denied/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("Kali access test uses a fixed SSH handshake and generic MCP configs resolve through it", async () => {
  const home = temporaryRoot();
  let invocation = null;
  try {
    const service = createKaliAccessService({
      home: () => home,
      execFile: (command, args, _options, callback) => { invocation = { command, args }; callback(null, "XEKUTE_KALI_READY", ""); },
    });
    const profile = { enabled: true, host: "kali.local", port: 22, username: "tester", acceptNewHostKey: false };
    assert.equal(service.save({ profile }).ok, true);
    assert.equal((await service.test({ profile })).ok, true);
    assert.match(path.basename(invocation.command), /^ssh(?:\.exe)?$/i);
    assert.ok(invocation.args.includes("StrictHostKeyChecking=yes"));
    assert.equal(invocation.args.at(-1), "printf XEKUTE_KALI_READY");

    const resolved = service.resolveMcpConfig({
      command: "python3",
      args: ["server.py", "--stdio"],
      xekute: { transport: "kali", remoteCwd: "/opt/sqlmap-mcp" },
    });
    assert.equal(resolved.ok, true);
    assert.match(path.basename(resolved.config.command), /^ssh(?:\.exe)?$/i);
    assert.match(resolved.config.args.at(-1), /cd '\/opt\/sqlmap-mcp' && exec 'python3' 'server\.py' '--stdio'/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("Kali MCP transport fails closed when access is disabled or commands contain shell syntax", () => {
  const home = temporaryRoot();
  try {
    const service = createKaliAccessService({ home: () => home });
    const config = { command: "python3", args: ["server.py"], xekute: { transport: "kali", remoteCwd: "/opt/server" } };
    assert.equal(service.resolveMcpConfig(config).error.code, "KALI_ACCESS_DISABLED");
    service.save({ profile: { enabled: true, host: "kali.local", username: "kali" } });
    assert.equal(service.resolveMcpConfig({ ...config, command: "python3;id" }).error.code, "KALI_MCP_COMMAND_INVALID");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("MCP runtime resolves a generic Kali transport entry before connecting", async () => {
  const home = temporaryRoot();
  let connectedConfig = null;
  try {
    const access = createKaliAccessService({ home: () => home });
    assert.equal(access.save({ profile: { enabled: true, host: "kali.local", username: "kali" } }).ok, true);
    fs.writeFileSync(path.join(home, ".xekute", "mcp.json"), JSON.stringify({
      mcpServers: {
        sqlmap: { command: "python3", args: ["server.py"], xekute: { transport: "kali", remoteCwd: "/opt/sqlmap-mcp" } },
      },
    }));
    const runtime = createMcpRuntime({
      home: () => home,
      connect: async ({ config }) => {
        connectedConfig = config;
        return {
          initialize: async () => [{ name: "sqlmap_scan", description: "Run a bounded SQLMap assessment", inputSchema: { type: "object", properties: { url: { type: "string" } } } }],
          request: async () => ({ ok: true }),
          close() {},
        };
      },
    });
    const activated = await runtime.activate({
      sessionId: "chat-1",
      mode: "agent",
      mappings: [{ server: "sqlmap", tools: [{ name: "sqlmap_scan", modes: ["agent"], access: "mutate", target_types: ["network"], target_arguments: ["url"] }] }],
    });
    assert.equal(activated.tools.length, 1);
    assert.match(path.basename(connectedConfig.command), /^ssh(?:\.exe)?$/i);
    assert.match(connectedConfig.args.at(-1), /sqlmap-mcp.*python3.*server\.py/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
