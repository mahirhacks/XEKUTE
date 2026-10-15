"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createShellCommandTracker } = require("../src/app/services/terminal/shell-command-tracker.js");
const { createCommandReferences } = require("../src/app/services/terminal/command-references.js");
const { appendTerminalOutput } = require("../src/app/services/terminal/active-terminal-catalog.js");

test("shell signals survive chunk boundaries and never enter captured terminal output", () => {
  const tracker = createShellCommandTracker("powershell.exe", ["-NoLogo"]);
  const script = Buffer.from(tracker.args.at(-1), "base64").toString("utf16le");
  const nonce = script.match(/633;Xekute;([a-f0-9]+);/)[1];
  const record = { commandRunning: false };
  const info = Buffer.from(JSON.stringify({ id: 1, command: "Get-Content file", cwd: "G:/project" })).toString("base64");
  const start = `\u001b]633;Xekute;${nonce};start;${info}\u0007`;
  const end = `\u001b]633;Xekute;${nonce};end\u001b\\`;
  let visible = "";
  for (const character of "before" + start + "\u001b[31moutput\u001b[0m") visible += tracker.output(record, character);
  assert.equal(record.commandRunning, true);
  assert.equal(visible, "before\u001b[31moutput\u001b[0m");
  for (const character of end + "after") visible += tracker.output(record, character);
  assert.equal(record.commandRunning, false);
  assert.equal(visible, "before\u001b[31moutput\u001b[0mafter");
  tracker.output(record, start.replace(nonce, "untrusted"));
  assert.equal(record.commandRunning, false);
  tracker.output(record, start);
  tracker.flush(record);
  assert.equal(record.commandRunning, false);
});

test("shells without command detection do not report their lifetime as command activity", () => {
  const args = ["/D"];
  const tracker = createShellCommandTracker("cmd.exe", args);
  const record = { commandRunning: false };
  assert.deepEqual(tracker.args, args);
  assert.equal(tracker.output(record, "C:\\>"), "C:\\>");
  assert.equal(record.commandRunning, false);
});

test("real PowerShell cls, sleeping commands and Ctrl+C update the project picker correctly", { skip: process.platform !== "win32", timeout: 25000 }, async t => {
  const pty = require("node-pty");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-shell-command-"));
  const tracker = createShellCommandTracker("powershell.exe", ["-NoLogo", "-NoProfile"]);
  const script = Buffer.from(tracker.args.at(-1), "base64").toString("utf16le")
    + "\nSet-PSReadLineOption -HistorySaveStyle SaveNothing -HistorySavePath '" + path.join(workspace, "history.txt").replaceAll("'", "''") + "'";
  tracker.args[tracker.args.length - 1] = Buffer.from(script, "utf16le").toString("base64");
  const states = [];
  let running = false, output = "", rawOutput = "", exitInfo = null;
  const record = { agent: false, exited: false, outputTail: "", cwd: workspace, workspace, shell: "powershell" };
  Object.defineProperty(record, "commandRunning", { get: () => running, set: value => { running = value; states.push(value); } });
  const catalog = createCommandReferences({ terminals: new Map([["manual", record]]) });
  const term = pty.spawn("powershell.exe", tracker.args, { cwd: workspace, env: { ...process.env, TERM: "xterm-256color" }, cols: 120, rows: 24, useConpty: true });
  t.after(async () => {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      term.onExit(() => { clearTimeout(timer); resolve(); });
      term.kill();
    });
    record.exited = true;
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const waiters = new Set();
  const notify = () => { for (const wake of [...waiters]) wake(); };
  term.onData(data => {
    rawOutput += data;
    const visible = tracker.output(record, data);
    output += visible;
    appendTerminalOutput(record, visible);
    notify();
  });
  term.onExit(info => { exitInfo = info; tracker.flush(record); notify(); });
  function until(predicate) {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(wake); reject(new Error("Shell activity timed out. Output: " + rawOutput.slice(-3000))); }, 8000);
      function wake() {
        if (!predicate()) return;
        clearTimeout(timer); waiters.delete(wake); resolve();
      }
      waiters.add(wake);
    });
  }
  const pickerRunning = () => catalog.list({ workspace }).some(item => item.running);
  await until(() => states.length >= 1);
  assert.equal(pickerRunning(), false, "The initial prompt is idle");
  const beforeClear = states.length;
  term.write("cls\r");
  await until(() => states.length >= beforeClear + 2);
  assert.deepEqual(states.slice(beforeClear), [true, false]);
  assert.equal(pickerRunning(), false, "cls has finished without closing PowerShell");
  assert.equal(catalog.list({ workspace })[0].name, "powershell : cls");
  const beforeSleep = states.length;
  term.write("Start-Sleep -Milliseconds 600\r");
  await until(() => states.length > beforeSleep && running);
  assert.equal(pickerRunning(), true, "A silent command is still running");
  await until(() => states.length >= beforeSleep + 2 && !running);
  assert.equal(pickerRunning(), false);
  const beforeCancel = states.length;
  term.write("Start-Sleep -Seconds 20\r");
  await until(() => states.length > beforeCancel && running);
  term.write("\u0003");
  await until(() => states.length >= beforeCancel + 2 && !running);
  assert.equal(pickerRunning(), false, "Ctrl+C returned to an idle prompt");
  assert.equal(exitInfo, null, "Ctrl+C must leave PowerShell open");
  const beforeNext = states.length;
  term.write("Write-Output 'Still open'\r");
  await until(() => states.length >= beforeNext + 2 && !running);
  assert.equal(exitInfo, null);
  assert.doesNotMatch(output, /633;Xekute/);
  const rows = catalog.list({ workspace });
  assert.equal(rows.length, 4);
  assert.ok(rows.some(item => item.command === "Start-Sleep -Milliseconds 600"));
  assert.doesNotMatch(catalog.capture({ workspace, id: rows[0].id }).output, /633;Xekute/);
});
