const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const durableSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "terminal", "durable-process-manager.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
const terminalUiSource = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "features", "terminal", "terminal-controller.js"), "utf8");

test("Windows supervised processes stay attached so they cannot open a console window", () => {
  assert.match(durableSource, /const launchDetached = process\.platform !== "win32";/);
  assert.match(durableSource, /windowsHide: true, detached: launchDetached/);
  assert.doesNotMatch(durableSource, /process\.platform !== "win32" \|\| !isPowerShell/);
});

test("agent exec_command streams into Xekute's in-app terminal by default", () => {
  const hostSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "terminal", "agent-terminal-host.js"), "utf8");
  assert.match(hostSource, /const wantVisible = input\.show_in_terminal !== false;/);
  assert.match(hostSource, /createSupervisedTerminal/);
  assert.match(hostSource, /createHiddenCommandReveal/);
  assert.doesNotMatch(hostSource, /exposeTerminal = input\.show_in_terminal === true/);
  assert.doesNotMatch(mainSource, /const wantVisible = input\.show_in_terminal !== false;/);
  assert.doesNotMatch(mainSource, /function createAgentTerminalHost/);
});

test("AI command terminals stay after exit and user runCommand never targets them", () => {
  assert.match(terminalUiSource, /Command exited\. Press the trash icon to close this session/);
  assert.doesNotMatch(
    terminalUiSource.slice(terminalUiSource.indexOf("function onExit"), terminalUiSource.indexOf("function onExit") + 500),
    /if \(session\.agent\) \{\s*removeSession\(id\)/,
  );
  assert.match(terminalUiSource, /active\.exited \|\| active\.agent/);
  assert.match(terminalUiSource, /session\.exited \|\| session\.agent/);
  assert.match(mainSource, /record\.readOnly \|\| record\.agent/);
});

test("the window that is viewing an AI terminal can stop it without a false ownership error", () => {
  const hostSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "terminal", "agent-terminal-host.js"), "utf8");
  assert.match(mainSource, /require\("\.\.\/services\/terminal\/terminal-ownership\.js"\)/);
  assert.match(mainSource, /findLiveTerminal\(terminals, id\)/);
  assert.match(mainSource, /alreadyStopped: true/);
  assert.match(hostSource, /ownerId: options\.ownerId \|\| webContents\.id/);
  assert.doesNotMatch(mainSource, /ownerId: options\.ownerId \|\| String\(webContents\.id\)/);
  assert.doesNotMatch(hostSource, /ownerId: options\.ownerId \|\| String\(webContents\.id\)/);
  assert.doesNotMatch(
    mainSource.slice(mainSource.indexOf("ipcMain.handle(\"terminal:kill\""), mainSource.indexOf("ipcMain.handle(\"terminal:kill\"") + 900),
    /if \(!record \|\| record\.ownerId !== _event\.sender\.id\)/,
  );
  assert.match(terminalUiSource, /result\?\.alreadyStopped/);
  assert.match(terminalUiSource, /This command is no longer running/);
});

test("the in-app terminal uses a dense monospace face instead of the UI sans-serif", () => {
  assert.match(terminalUiSource, /"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace/);
  assert.match(terminalUiSource, /fontSize: 12/);
  assert.match(terminalUiSource, /lineHeight: 1/);
  assert.match(terminalUiSource, /function xtermOptions/);
  assert.match(terminalUiSource, /new globalThis\.Terminal\(xtermOptions\(\{ cursorBlink: true \}\)\)/);
  assert.doesNotMatch(terminalUiSource, /cursorBlink: false/);
  const baseCss = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  const chatCss = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
  assert.match(baseCss, /\.terminal-instance \.xterm[\s\S]{0,280}Cascadia Mono/);
  assert.doesNotMatch(baseCss, /\.terminal-instance \.xterm[\s\S]{0,80}Arial, Helvetica, sans-serif/);
  assert.match(chatCss, /\.terminal-instance \{\s*padding: 8px 10px;/);
});

test("the terminal session list is a smaller resizable rail that collapses to icons", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "react", "AppShell.jsx"), "utf8");
  const baseCss = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  const chatCss = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
  assert.match(shell, /id="terminal-tabs-resize"[^>]*className="sash-v"/);
  assert.match(terminalUiSource, /const TABS_MIN_RATIO = 0\.02/);
  assert.match(terminalUiSource, /const TABS_MAX_RATIO = 0\.30/);
  assert.match(terminalUiSource, /const TABS_COMPACT_PX = 72/);
  assert.match(terminalUiSource, /function applyTabsWidth/);
  assert.match(terminalUiSource, /function bindTabsResize/);
  assert.match(terminalUiSource, /setTabsListVisible\(sessions\.size > 1\)/);
  assert.match(terminalUiSource, /applyTabsWidth\(rect\.right - event\.clientX\)/);
  assert.match(chatCss, /#terminal-tabs-list\.visible \{[\s\S]{0,80}width: 140px/);
  assert.match(chatCss, /min-height: 22px;[\s\S]{0,120}font-size: 12px;/);
  assert.match(baseCss, /#terminal-tabs-list\.compact \.terminal-tab-name/);
  assert.match(chatCss, /#terminal-tabs-list\.compact \.terminal-tab-name/);
});

test("terminal session icons distinguish powershell, command prompt, and git bash", () => {
  assert.match(terminalUiSource, /function shellIconClass/);
  assert.match(terminalUiSource, /function sessionIconClass/);
  assert.match(terminalUiSource, /codicon-terminal-powershell/);
  assert.match(terminalUiSource, /codicon-terminal-cmd/);
  assert.match(terminalUiSource, /codicon-terminal-git-bash/);
  assert.match(terminalUiSource, /session\?\.agent\) return "codicon-copilot"/);
  assert.doesNotMatch(terminalUiSource, /codicon-sparkle/);
  assert.doesNotMatch(terminalUiSource, /AI · \$\{label\}/);
  assert.doesNotMatch(terminalUiSource, /session\.agent \? "AI"/);
  assert.doesNotMatch(terminalUiSource, /XEKUTE AI Agent/);
  assert.match(terminalUiSource, /read-only output/);
  assert.match(terminalUiSource, /terminal-shell-icon \$\{sessionIconClass/);
  const chatCss = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
  assert.match(chatCss, /\.codicon-terminal-powershell[\s\S]{0,80}#5391fe/);
  assert.match(chatCss, /\.codicon-terminal-git-bash[\s\S]{0,80}#f05133/);
});

const { createAgentTerminalHost } = require("../src/app/services/terminal/agent-terminal-host.js");
const { createHiddenCommandReveal, HIDDEN_COMMAND_REVEAL_MS } = require("../src/app/services/terminal/agent-terminal-reveal.js");

function stubRunner() {
  return {
    runCommand() {},
    runExecutable() {},
    runShellCommand() {},
    startProcess() {},
    stopProcess() {},
  };
}

function createHostHarness(managerOverrides = {}, hostOverrides = {}) {
  const terminals = new Map();
  const events = [];
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    send(channel, payload) { events.push({ channel, payload }); },
  };
  const manager = {
    async run(_workspace, _input, runtime) {
      runtime.onStarted?.({ processId: "process-1", pid: 11 });
      runtime.onOutput?.({ data: "hello" });
      runtime.onComplete?.({ processId: "process-1", exitCode: 0, status: "complete" });
      return { ok: true, value: { processId: "process-1", status: "complete", exitCode: 0 } };
    },
    async start(_workspace, _input, runtime) {
      runtime.onStarted?.({ processId: "process-2", pid: 12 });
      return { ok: true, value: { processId: "process-2", status: "running" } };
    },
    async status() { return { ok: true, value: {} }; },
    async stop(_workspace, input) { return { ok: true, value: { status: "stopped", process_id: input.process_id } }; },
    async list() { return { ok: true, value: { processes: [] } }; },
    ...managerOverrides,
  };
  const host = createAgentTerminalHost({
    webContents,
    sendAgentEvent: (payload) => events.push({ channel: "agent:event", payload }),
    sessionId: "sess-1",
    durableProcessManager: manager,
    terminals,
    createHiddenCommandReveal,
    HIDDEN_COMMAND_REVEAL_MS,
    displayExecCommand: (exe, args = []) => [exe, ...args].join(" "),
    agentTerminalRunner: stubRunner(),
    ...hostOverrides,
  });
  return { host, terminals, events, webContents, manager };
}

test("visible reveal announces immediately and keeps terminalId", async () => {
  const { host, events } = createHostHarness();
  const result = await host.run("G:/w", { command: "echo hi", context: "echo hi" }, {});
  assert.equal(result.value.showInTerminal, true);
  assert.match(String(result.value.terminalId || ""), /^agent-/);
  assert.ok(events.some((entry) => entry.payload?.type === "agent_terminal" && entry.payload?.phase === "start"));
});

test("hidden commands that finish before the delay omit terminalId", async () => {
  const { host, events } = createHostHarness({}, { HIDDEN_COMMAND_REVEAL_MS: 80 });
  const result = await host.run("G:/w", { command: "echo hi", context: "echo hi", show_in_terminal: false }, {});
  assert.equal(result.value.showInTerminal, false);
  assert.equal(result.value.terminalId, undefined);
  assert.equal(events.some((entry) => entry.payload?.type === "agent_terminal" && entry.payload?.phase === "start"), false);
});

test("hidden commands that outlive the delay are revealed", async () => {
  let release;
  const hang = new Promise((resolve) => { release = resolve; });
  const { host, events } = createHostHarness({
    async run(_workspace, _input, runtime) {
      runtime.onStarted?.({ processId: "process-1", pid: 11 });
      await hang;
      runtime.onComplete?.({ processId: "process-1", exitCode: 0, status: "complete" });
      return { ok: true, value: { processId: "process-1", status: "complete", exitCode: 0 } };
    },
  }, { HIDDEN_COMMAND_REVEAL_MS: 25 });
  const pending = host.run("G:/w", { command: "sleep", context: "sleep job", show_in_terminal: false }, {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(events.some((entry) => entry.payload?.type === "agent_terminal" && entry.payload?.phase === "start"));
  release();
  const result = await pending;
  assert.equal(result.value.showInTerminal, true);
  assert.match(String(result.value.terminalId || ""), /^agent-/);
});

test("kill-while-hidden calls manager.stop because terminals.set runs at spawn", async () => {
  const stopCalls = [];
  let release;
  const hang = new Promise((resolve) => { release = resolve; });
  const { host, terminals } = createHostHarness({
    async run(_workspace, _input, runtime) {
      runtime.onStarted?.({ processId: "process-live", pid: 99 });
      await hang;
      return { ok: true, value: { processId: "process-live", status: "running" } };
    },
    async stop(_workspace, input) {
      stopCalls.push(input);
      return { ok: true, value: { status: "stopped" } };
    },
  }, { HIDDEN_COMMAND_REVEAL_MS: 5_000 });
  const pending = host.run("G:/w", { command: "sleep", context: "sleep job", show_in_terminal: false }, {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(terminals.size, 1);
  const record = [...terminals.values()][0];
  await record.pty.kill();
  assert.equal(stopCalls[0].process_id, "process-live");
  release();
  await pending;
});

test("background runs may overlap without a per-turn queue", async () => {
  let started = 0;
  const waits = [];
  const { host } = createHostHarness({
    async run() {
      started += 1;
      await new Promise((resolve) => waits.push(resolve));
      return { ok: true, value: { processId: `process-${started}`, status: "running" } };
    },
  });
  const first = host.run("G:/w", { command: "one", context: "one cmd", wait_ms: 0 }, {});
  const second = host.run("G:/w", { command: "two", context: "two cmd", wait_ms: 0 }, {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 2);
  waits.forEach((resolve) => resolve());
  await Promise.all([first, second]);
});

test("revealed agent terminals remain readable after the command exits", async () => {
  const { host, terminals } = createHostHarness();
  const result = await host.run("G:/w", { command: "echo hi", context: "echo hi" }, {});
  const terminalId = result.value.terminalId;
  assert.equal(terminals.has(terminalId), true);
  assert.equal(terminals.get(terminalId).exited, true);
  assert.equal(terminals.get(terminalId).sessionId, "sess-1");
  assert.match(String(terminals.get(terminalId).outputTail || ""), /hello/);
});

test("the renderer publishes the focused tab to user_active_terminal", () => {
  assert.match(terminalUiSource, /function publishUserActiveTerminal/);
  assert.match(terminalUiSource, /window\.api\?\.terminalSetActive/);
  assert.match(terminalUiSource, /user_active_terminal|terminalId: panelOpen && activeId \? activeId : null/);
  assert.match(terminalUiSource, /window\.api\?\.terminalForget/);
  assert.match(mainSource, /ipcMain\.handle\("terminal:setActive"/);
  assert.match(mainSource, /ipcMain\.handle\("terminal:forget"/);
});

test("host leftover runner methods exist and status/stop/list delegate", async () => {
  const { host } = createHostHarness();
  assert.equal(typeof host.runCommand, "function");
  assert.equal(typeof host.runExecutable, "function");
  assert.equal(typeof host.runShellCommand, "function");
  assert.equal(typeof host.startProcess, "function");
  assert.equal(typeof host.stopProcess, "function");
  assert.equal(typeof host.sendLifecycleEvent, "function");
  assert.equal((await host.status("G:/w", { process_id: "process-1" })).ok, true);
  assert.equal((await host.list("G:/w")).ok, true);
});

