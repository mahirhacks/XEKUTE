const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { createAgentTerminalRunner } = require("../src/app/services/terminal/terminal-runner.js");

class FakePty extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.killed = false;
  }

  write(data) {
    this.writes.push(String(data));
  }

  kill() {
    this.killed = true;
    this.emit("exit", { exitCode: 0, signal: 0 });
  }

  onData(callback) {
    this.on("data", callback);
  }

  onExit(callback) {
    this.on("exit", callback);
  }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 7731;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = false;
  }

  kill() {
    if (this.killed) return;
    this.killed = true;
    this.emit("close", 130, "SIGINT");
  }
}

function createHarness({ spawnProcess = null } = {}) {
  const terminals = new Map();
  const toolProcesses = new Map();
  const events = [];
  const webContents = {
    id: 42,
    isDestroyed: () => false,
    send(channel, payload) {
      events.push({ channel, payload });
    },
  };

  const runner = createAgentTerminalRunner({
    terminals,
    pty: { spawn: () => new FakePty() },
    resolveWorkspaceTarget: () => ({ root: "G:/project" }),
    resolveTerminalShell: () => ({ id: "powershell", label: "PowerShell", path: "powershell.exe" }),
    getShellArgs: () => [],
    takeLimited: (value, max) => String(value).slice(0, max),
    toolProcesses,
    terminateProcessTree: (child) => child?.kill?.(),
    ...(spawnProcess ? { spawnProcess } : {}),
  });

  return { runner, terminals, toolProcesses, events, webContents };
}

test("agent terminal runner announces start, streams output, and resolves when the pty exits", async () => {
  const { runner, terminals, events, webContents } = createHarness();
  const sendAgentEvent = (payload) => events.push({ channel: "agent:event", payload });

  const pending = runner.runCommand(webContents, "G:/project", "npm test", {
    timeoutMs: 5000,
    sendAgentEvent,
    toolName: "run_command",
  });

  assert.equal(terminals.size, 1);
  const [terminalId, record] = [...terminals.entries()][0];
  assert.match(terminalId, /^agent-/);
  assert.equal(record.command, "npm test");

  const startEvent = events.find((entry) => entry.payload?.type === "agent_terminal" && entry.payload?.phase === "start");
  assert.ok(startEvent);
  assert.equal(startEvent.payload.command, "npm test");

  record.pty.emit("data", "ok 1 test\r\n");
  const dataEvent = events.find((entry) => entry.channel === "terminal:data");
  assert.ok(dataEvent);
  assert.match(dataEvent.payload.data, /ok 1 test/);

  record.pty.emit("exit", { exitCode: 0, signal: 0 });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.match(result.stdout, /ok 1 test/);
  assert.equal(terminals.size, 0);
});

test("agent terminal runner can start a background process with a terminal id", () => {
  const { runner, terminals, toolProcesses, webContents } = createHarness();
  const result = runner.startProcess(webContents, "G:/project", "npm run dev", { sendAgentEvent: () => {} });
  assert.equal(result.ok, true);
  assert.match(result.id, /^proc-agent-/);
  assert.equal(terminals.size, 1);
  assert.equal(toolProcesses.size, 1);
});

test("typed exec commands remain hidden from the terminal UI while capturing output", async () => {
  const child = new FakeChild();
  const { runner, terminals, events, webContents } = createHarness({ spawnProcess: () => child });
  const pending = runner.runExecutable(webContents, "G:/project", "nmap.exe", ["-sV", "example.test"], {
    timeoutMs: 0,
    displayCommand: "nmap.exe -sV example.test",
    sendAgentEvent: (payload) => events.push({ channel: "agent:event", payload }),
  });

  assert.equal(terminals.size, 1);
  const [terminalId, record] = [...terminals.entries()][0];
  assert.equal(record.readOnly, true);
  assert.match(record.command, /nmap\.exe/);
  child.stdout.emit("data", Buffer.from("443/tcp open https\r\n"));
  assert.equal(events.some((entry) => entry.channel === "terminal:data"), false);
  assert.equal(events.some((entry) => entry.payload?.type === "agent_terminal"), false);

  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(child.killed, false);
  assert.match(result.stdout, /443\/tcp open https/);
  assert.equal(result.processId, 7731);
  assert.equal(terminals.has(terminalId), false);
});

test("shell exec preserves complete PowerShell syntax and remains hidden from the terminal UI", async () => {
  const child = new FakeChild();
  const calls = [];
  const { runner, terminals, events, webContents } = createHarness({
    spawnProcess: (executable, args, options) => {
      calls.push({ executable, args, options });
      return child;
    },
  });
  const command = "$files = Get-ChildItem\n$files | Where-Object Length -gt 0 | Select-Object -First 1";
  const pending = runner.runShellCommand(webContents, "G:/project", command, {
    shell: "powershell",
    timeoutMs: 0,
    exposeTerminal: false,
  });

  assert.equal(terminals.size, 1);
  assert.equal(calls[0].executable, "powershell.exe");
  assert.equal(calls[0].args.at(-1), command);
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(events.some((entry) => entry.channel === "terminal:data"), false);
  child.stdout.emit("data", Buffer.from("result.txt\r\n"));
  child.emit("close", 0, null);

  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.mode, "shell-command");
  assert.equal(result.command, command);
  assert.equal(result.shell, "powershell");
  assert.match(result.stdout, /result\.txt/);
});

test("typed exec accepts an absolute executable path", async () => {
  const child = new FakeChild();
  const calls = [];
  const { runner, webContents } = createHarness({
    spawnProcess: (executable, args, options) => {
      calls.push({ executable, args, options });
      return child;
    },
  });
  const pending = runner.runExecutable(webContents, "G:/project", "C:/Program Files/tool/tool.exe", ["--version"], { timeoutMs: 0 });
  child.emit("close", 0, null);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(calls[0].executable, "C:/Program Files/tool/tool.exe");
});

test("canonical agent exec projects terminal output only when explicitly requested", () => {
  const runner = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "terminal", "terminal-runner.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");

  assert.match(main, /runSupervisedCommand/);
  assert.match(main, /exposeTerminal:\s*args\.show_in_terminal === true/);
  assert.match(main, /const exposeTerminal = input\.show_in_terminal === true/);
  assert.match(main, /if \(exposeTerminal\) sendTerminalData/);
  assert.match(main, /if \(result\?\.value\) result\.value\.showInTerminal = terminal\.exposeTerminal/);
  assert.match(main, /terminalHost\.runExecutable/);
  assert.match(main, /terminalHost\.runShellCommand/);
  assert.match(runner, /function runShellCommand/);
  assert.match(runner, /exposeTerminal = false/);
  assert.match(runner, /if \(exposeTerminal\) sendTerminalData/);
  assert.match(runner, /if \(exposeTerminal\) \{[\s\S]*?announceAgentTerminal/);
});

test("typed exec cancellation settles cleanly and removes its AbortSignal listener", async () => {
  const child = new FakeChild();
  const { runner, terminals, webContents } = createHarness({ spawnProcess: () => child });
  const controller = new AbortController();
  const pending = runner.runExecutable(webContents, "G:/project", "nmap.exe", ["-sV", "example.test"], {
    timeoutMs: 0,
    signal: controller.signal,
  });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.status, "stopped");
  assert.equal(result.signal, "SIGINT");
  assert.equal(terminals.size, 0);
});
