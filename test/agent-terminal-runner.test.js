const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createAgentTerminalRunner } = require("../src/adapters/tools/os/terminal-runner");

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

function createHarness() {
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
    terminateProcessTree: () => {},
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
