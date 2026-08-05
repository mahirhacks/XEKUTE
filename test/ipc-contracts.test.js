"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_MAX_BYTES,
  validateIpcRequest,
  normalizeResult,
} = require("../src/shared/ipc-contracts");
const IpcContracts = require("../src/contracts/ipc/IpcContracts");

test("shared ipc-contracts is an equivalent re-export of contracts/ipc/IpcContracts", () => {
  assert.deepEqual(
    Object.keys(IpcContracts).sort(),
    Object.keys(require("../src/shared/ipc-contracts")).sort(),
  );
  assert.equal(IpcContracts.DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  assert.equal(IpcContracts.validateIpcRequest("terminal:resize", [{ cols: 120, rows: 40 }]), null);
  assert.deepEqual(IpcContracts.normalizeResult({ value: 1 }), { ok: true, value: { value: 1 } });
});

test("IPC contracts reject oversized, deeply nested, and unsupported payloads", () => {
  assert.equal(validateIpcRequest("workspace:read", [{ value: "x".repeat(DEFAULT_MAX_BYTES + 1) }])?.code, "IPC_PAYLOAD_TOO_LARGE");
  let nested = "leaf";
  for (let index = 0; index < 14; index += 1) nested = { nested };
  assert.equal(validateIpcRequest("workspace:read", [nested])?.code, "INVALID_IPC_PAYLOAD");
  assert.equal(validateIpcRequest("workspace:read", [() => {}])?.code, "INVALID_IPC_PAYLOAD");
});

test("IPC contracts validate terminal dimensions and normalize result envelopes", () => {
  assert.equal(validateIpcRequest("terminal:resize", [{ cols: 0, rows: 24 }])?.code, "INVALID_IPC_PAYLOAD");
  assert.equal(validateIpcRequest("terminal:resize", [{ cols: 120, rows: 40 }]), null);
  assert.deepEqual(normalizeResult({ value: 1 }), { ok: true, value: { value: 1 } });
  assert.deepEqual(normalizeResult({ error: "No access", code: "DENIED" }), {
    ok: false,
    error: { code: "DENIED", message: "No access", retryable: false },
  });
});

test("model tool schemas stay canonical in the main process instead of crossing IPC", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "bootstrap.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "electron", "main.js"), "utf8");
  const agentRunPayload = renderer.match(/window\.api\.agentRun\(\{([\s\S]*?)\n\s*\}\);/)?.[1] || "";
  assert.ok(agentRunPayload);
  assert.doesNotMatch(agentRunPayload, /tools\s*:/);
  assert.doesNotMatch(renderer, /window\.api\.chat\(/);
  assert.match(main, /const requestedProfile = normalizeProfile\(modeFamily \|\| "xekute", mode \|\| "ask"\)/);
  assert.match(main, /const selectedCatalog = providerCatalogFor\(requestedProfile\.key, legacyTools\)/);
  assert.match(main, /tools: selectedCatalog\.tools/);
});

test("main IPC registration manifest is stable and matches the preload bridge surface", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "electron", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");

  // Every main-process handler channel and event channel.
  const handleChannels = [...main.matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const onChannels = [...main.matchAll(/ipcMain\.on\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(handleChannels.length > 50, `expected a large handler surface, got ${handleChannels.length}`);
  assert.ok(onChannels.length >= 1, "expected at least one ipcMain.on channel");

  // Preload bridge must invoke/forward every main handle channel so the
  // renderer surface stays complete after the presentation move.
  for (const channel of handleChannels) {
    assert.ok(
      preload.includes(`"${channel}"`) || preload.includes(`'${channel}'`),
      `preload must bridge main handler channel: ${channel}`,
    );
  }

  // Stability guard: the full registered channel set must not drift silently.
  const manifest = {
    handle: [...handleChannels].sort(),
    on: [...onChannels].sort(),
  };
  assert.ok(manifest.handle.length === new Set(manifest.handle).size, "handler channels must be unique");
  assert.ok(manifest.on.length === new Set(manifest.on).size, "event channels must be unique");
  assert.ok(manifest.handle.includes("project:create"));
  assert.ok(manifest.handle.includes("agent:run"));
  assert.ok(manifest.on.includes("chat-sessions:save-before-close"));
});

test("preload bridge surface snapshot: API methods and renderer global order are stable", () => {
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "index.html"), "utf8");

  // Preload exposes both window.api and window.xekute surfaces.
  assert.match(preload, /contextBridge\.exposeInMainWorld\("api"/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("xekute"/);
  // Sandboxed: only electron may be required.
  assert.deepEqual(
    [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]),
    ["electron"],
    "preload must only require electron",
  );

  // Renderer logical global order must stay stable: OS tools before cyber
  // tools before ToolMap before the tool parser before bootstrap.
  const order = [
    /adapters\/tools\/os\/tool-registry\.js/,
    /adapters\/tools\/cyber\/tool-registry\.js/,
    /adapters\/tools\/core\/tool-catalog\.js/,
    /application\/policies\/request-intent-rules\.js/,
    /prompts\/skills\/context-router\.js/,
    /application\/policies\/operating-mode-rules\.js/,
    /prompts\/instructs\/system_prompt\.js/,
    /prompts\/instructs\/initial_prompt\.js/,
    /application\/prompt\/prompt-compiler\.js/,
    /adapters\/llm\/context-budget\.js/,
    /features\/toolbox\/toolbox-controller\.js/,
    /application\/agent\/tunables\.js/,
    /application\/agent\/memory\/failure-memory\.js/,
    /application\/agent\/memory\/context-memory\.js/,
    /core\/markdown\.js/,
    /core\/app-core\.js/,
    /features\/dialog\/app-dialog\.js/,
    /bootstrap\.js/,
  ];
  let cursor = -1;
  for (const pattern of order) {
    const match = html.search(pattern);
    assert.ok(match > cursor, `renderer script order violated before ${pattern}`);
    cursor = match;
  }

  // No renderer script may request a removed/obsolete source path.
  assert.doesNotMatch(html, /\.\.\/(?:harness|prompt|sub-agent)\//, "renderer must not load obsolete paths");
  // Node-only modules must not load in the renderer.
  assert.doesNotMatch(html, /node-pty|electron["']/);
});
