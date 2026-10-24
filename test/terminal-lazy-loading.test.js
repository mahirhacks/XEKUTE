"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

function fixture(t) {
  const dom = new JSDOM(`<div id="terminal-body"><div id="terminal-tabs-list"></div><div id="terminal-viewport"></div><div id="terminal-empty"></div></div><button id="btn-terminal-clear"></button><button id="btn-terminal-kill"></button>`, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const instances = [], imports = [], creates = [];
  let data, exit;
  class Terminal {
    constructor() { this.text = ""; this.buffer = { active: { cursorX: 0 } }; instances.push(this); }
    loadAddon() {} open() {} attachCustomKeyEventHandler() {} focus() {} onData() {}
    write(text, done) { this.text += text; done?.(); }
    writeln(text) { this.text += text + "\r\n"; }
  }
  class FitAddon {}
  window.requestAnimationFrame = () => 1;
  window.api = {
    onTerminalData: callback => { data = callback; }, onTerminalExit: callback => { exit = callback; },
    terminalWrite() {}, terminalSetActive() {},
    terminalCreate: async options => { creates.push(options); return { shell: "fixture" }; },
  };
  window.loadTerminalFixture = () => new Promise((resolve, reject) => imports.push({ resolve: () => resolve({ Terminal, FitAddon }), reject }));
  const source = fs.readFileSync(path.resolve(__dirname, "../src/ui/features/terminal/terminal-controller.js"), "utf8");
  // Only the external module transport is controlled; the production controller
  // still creates sessions, buffers IPC events, and renders the real DOM.
  assert.equal(source.split('import("./terminal-vendor.js")').length, 2);
  vm.runInContext(source.replace('import("./terminal-vendor.js")', "globalThis.loadTerminalFixture()"), dom.getInternalVMContext());
  return { window, manager: window.XekuteTerminalManager, instances, imports, creates, data: event => data(event), exit: event => exit(event) };
}

test("terminal loading is deferred, shared, and retains output and exit ordering", async t => {
  const f = fixture(t);
  assert.equal(f.imports.length, 0);
  const first = f.manager.attachAgentSession({ id: "agent-one", command: "first command", queued: true });
  const duplicate = f.manager.attachAgentSession({ id: "agent-one", queued: false });
  const second = f.manager.attachAgentSession({ id: "agent-two", command: "second command" });
  assert.equal(f.imports.length, 1);
  assert.equal(f.instances.length, 0);
  f.data({ id: "agent-one", data: "EARLY FIRST\r\n" });
  f.data({ id: "agent-two", data: "EARLY SECOND\r\n" });
  f.exit({ id: "agent-one" });
  f.imports[0].resolve();
  assert.deepEqual(await Promise.all([first, duplicate, second]), ["agent-one", "agent-one", "agent-two"]);
  assert.equal(f.instances.length, 2);
  assert.match(f.instances[0].text, /first command.*EARLY FIRST.*Agent terminal is observe only/s);
  assert.match(f.instances[1].text, /second command.*EARLY SECOND/s);
  assert.doesNotMatch(f.instances[1].text, /Agent terminal is observe only/);
  assert.equal(f.window.document.querySelectorAll('[data-terminal-id="agent-one"].terminal-instance').length, 1);
  assert.equal(f.window.document.querySelector(".terminal-tab-item").classList.contains("exited"), true);
  assert.equal(f.window.document.querySelectorAll(".terminal-tab-item .codicon-clock").length, 0);
  f.data({ id: "agent-two", data: "LATER OUTPUT" });
  assert.match(f.instances[1].text, /EARLY SECOND.*LATER OUTPUT/s);
  await f.manager.attachAgentSession({ id: "agent-one" });
  await f.manager.createTerminal();
  assert.equal(f.imports.length, 1, "later terminals reuse the loaded library");
  assert.equal(f.instances.length, 3);
  assert.equal(f.creates.length, 1, "attaching agent output does not start a new process");
});

test("failed terminal imports leave no duplicate session and the next request can retry", async t => {
  const f = fixture(t);
  f.window.console.error = () => {};
  const failed = f.manager.attachAgentSession({ id: "retry-agent", command: "fixture command" });
  f.data({ id: "retry-agent", data: "UNATTACHED OUTPUT" });
  f.imports[0].reject(new Error("Fixture module unavailable"));
  assert.equal(await failed, null);
  assert.equal(f.instances.length, 0);
  const retried = f.manager.attachAgentSession({ id: "retry-agent", command: "fixture command" });
  assert.equal(f.imports.length, 2);
  f.data({ id: "retry-agent", data: "RETRY OUTPUT" });
  f.imports[1].resolve();
  assert.equal(await retried, "retry-agent");
  assert.equal(f.instances.length, 1);
  assert.match(f.instances[0].text, /RETRY OUTPUT/);
  assert.equal(f.window.document.querySelectorAll(".terminal-instance").length, 1);
});
