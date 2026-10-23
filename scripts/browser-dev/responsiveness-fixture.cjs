"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");
const { createTier1SensitiveStore } = require("../../src/app/storage/memory/tier1-sensitive-store.js");
const { createV3SessionStore } = require("../../src/app/storage/memory/v3-session-store.js");
const { createTerminalOutputBatcher } = require("../../src/app/services/terminal/terminal-output-batcher.js");

async function startResponsivenessFixture({ app, safeStorage }) {
  const h = globalThis.xekuteNativeBrowserDevelopment, browser = h.browser, tab = await h.initial;
  await browser.navigate(tab.id, h.fixtures.origins.primary + "/form");
  const contents = browser.getContents(tab.id);
  await contents.executeJavaScript("globalThis.fixtureInputs = []; document.querySelector('#username').focus(); document.querySelector('#username').addEventListener('input', event => globalThis.fixtureInputs.push({ value: event.target.value, at: Date.now() }))");
  const root = path.join(app.getPath("userData"), "responsiveness-fixture");
  const projectId = "proj_00000000-0000-4000-8000-000000008741", sessionId = "session_00000000-0000-4000-8000-000000008742";
  const sensitiveOptions = { baseDir: root, protector: {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: text => safeStorage.encryptString(text),
    encryptAsync: text => safeStorage.encryptStringAsync(text),
    decrypt: text => safeStorage.decryptString(Buffer.from(text, "base64")),
  } };
  const projectIdentityStore = {
    resolveV3Project: () => ({ ok: true, projectId, canonical: root, workspace: root }),
  };
  const store = createV3SessionStore({ sensitiveStore: createTier1SensitiveStore(sensitiveOptions), projectIdentityStore });
  const opened = await store.begin(root, { sessionId, userPrompt: "Synthetic local investigation" });
  if (!opened.ok) throw new Error("Could not create synthetic session");
  const result = { saves: 0, outputBytes: 0, maxMainLoopGapMs: 0 };
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    result.maxMainLoopGapMs = Math.max(result.maxMainLoopGapMs, now - last);
    last = now;
  }, 5);
  const output = createTerminalOutputBatcher(text => { result.outputBytes += Buffer.byteLength(text); });
  const child = spawn(process.execPath, ["-e", "let n=0;const t=setInterval(()=>{process.stdout.write('synthetic output '.repeat(2048));if(++n===60)clearInterval(t)},5)"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true,
  });
  child.stdout.on("data", data => output.push(data.toString()));
  const finished = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error("Synthetic command failed")));
  });
  const dispatched = [];
  const typing = (async () => {
    for (const letter of "responsive") {
      await new Promise(resolve => setTimeout(resolve, 15));
      dispatched.push(Date.now());
      contents.sendInputEvent({ type: "char", keyCode: letter });
    }
  })();
  globalThis.xekuteResponsiveness = { tabId: tab.id, result, pending: (async () => {
    try {
      for (let index = 0; index < 30; index++) {
        const saved = await store.record(root, { type: "snapshot", sessionId, blockId: opened.blockId, displayHtml: "fixture history ".repeat(40000) });
        if (!saved.ok || !saved.durable) throw new Error("Synthetic snapshot was not durable");
        result.saves++;
      }
      await Promise.all([finished, typing]);
      output.flush();
      await store.flush();
      const reloaded = createV3SessionStore({ sensitiveStore: createTier1SensitiveStore(sensitiveOptions), projectIdentityStore });
      if (reloaded.load(root).sessions[0].messagesHtml !== "fixture history ".repeat(40000)) throw new Error("Snapshot did not restore from disk");
      const inputs = await contents.executeJavaScript("globalThis.fixtureInputs");
      return { ...result, maxInputDeliveryMs: Math.max(...inputs.map((input, index) => input.at - dispatched[index])) };
    } finally { clearInterval(ticker); child.kill(); }
  })() };
}

module.exports = { startResponsivenessFixture };
