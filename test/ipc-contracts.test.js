"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const IpcContracts = require("../src/contracts/ipc/IpcContracts");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("canonical IPC contracts validate bounded payloads and result envelopes", () => {
  assert.equal(IpcContracts.validateIpcRequest("terminal:resize", [{ cols: 120, rows: 40 }]), null);
  assert.equal(IpcContracts.validateIpcRequest("terminal:resize", [{ cols: 0, rows: 24 }])?.code, "INVALID_IPC_PAYLOAD");
  assert.equal(IpcContracts.validateIpcRequest("workspace:read", [{ value: "x".repeat(IpcContracts.DEFAULT_MAX_BYTES + 1) }])?.code, "IPC_PAYLOAD_TOO_LARGE");
  assert.deepEqual(IpcContracts.normalizeResult({ value: 1 }), { ok: true, value: { value: 1 } });
  assert.deepEqual(IpcContracts.normalizeResult({ error: "No access", code: "DENIED" }), { ok: false, error: { code: "DENIED", message: "No access", retryable: false } });
});

test("renderer sends prompts without model schemas and main owns registry catalog", () => {
  const renderer = read("src/ui/bootstrap.js");
  const main = read("src/app/electron/main.js");
  const agentRunPayload = renderer.match(/window\.api\.agentRun\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || "";
  assert.ok(agentRunPayload);
  assert.doesNotMatch(agentRunPayload, /tools\s*:/);
  assert.doesNotMatch(renderer, /window\.api\.chat\(/);
  assert.match(main, /toolCatalogFromRegistry\(container\.toolRegistry\)/);
  assert.match(main, /const runtimeTools = tier2MemoryMaintenance[\s\S]*?selectedCatalog\.tools/);
  assert.match(main, /tools: runtimeTools/);
});

test("active IPC handlers and preload methods include live channels and omit removed approval/chat APIs", () => {
  const main = read("src/app/electron/main.js");
  const projectIpc = read("src/app/ipc/project.js");
  const activeHandlers = `${main}\n${projectIpc}`;
  const preload = read("src/app/electron/preload.js");
  for (const channel of ["agent:run", "project:create", "chat-history:load", "chat-history:begin", "chat-history:event", "chat-history:delete", "chat-history:flush", "mcp:read", "mcp:ensure", "kali-access:get", "kali-access:save", "kali-access:test", "kali-access:pickIdentity", "settings:credentialsGet", "settings:credentialCreate", "settings:credentialSave", "settings:credentialDelete", "proxy:browserLaunch", "proxy:browserStatus"]) {
    assert.match(activeHandlers, new RegExp(channel.replace(/[-:]/g, "\\$&")), `active IPC modules must register ${channel}`);
    assert.match(preload, new RegExp(channel.replace(/[-:]/g, "\\$&")), `preload must bridge ${channel}`);
  }
  assert.doesNotMatch(main, /chat-sessions:|agent:resolveApproval/);
  assert.doesNotMatch(preload, /loadChatSessions|saveChatSessions|agentResolveApproval/);
  assert.match(activeHandlers, /tools:cancelWorkspaceSearch/);
  assert.match(preload, /onWorkspaceSearchBatch:[\s\S]*?tools:workspaceSearchBatch/);
});

test("renderer is a native ES-module entry and keeps the sandbox bridge boundary", () => {
  const html = read("src/ui/index.html");
  const preload = read("src/app/electron/preload.js");
  assert.match(html, /<script type="module" src="bootstrap\.js"><\/script>/);
  assert.match(read("src/ui/core/runtime-modules.js"), /\.\.\/features\/security\/security-inspector\.js/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("api"/);
  assert.deepEqual([...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]), ["electron"]);
  assert.doesNotMatch(html, /presentation\/ui|prompts\/instructs|src\/preload\.js/);
});
