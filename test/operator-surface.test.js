"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  redactOperatorText,
  isProcessCheckupRequest,
  isLocalProcessProbe,
  shouldReadLiveCommandState,
} = require("../src/agent/runtime/operator-surface.js");

test("checkup requests are recognized and ordinary tasks are not", () => {
  assert.equal(isProcessCheckupRequest("check up on the scan"), true);
  assert.equal(isProcessCheckupRequest("how's the command going"), true);
  assert.equal(isProcessCheckupRequest("check if port 443 is open"), false);
});

test("local process probes are not treated as new work", () => {
  assert.equal(isLocalProcessProbe("Get-Process nmap"), true);
  assert.equal(isLocalProcessProbe("ps aux"), true);
  assert.equal(isLocalProcessProbe("nmap -sV 10.0.0.5"), false);
});

test("a checkup run is redirected only while a command is still live", () => {
  const running = [{ processId: "process-abc123", command: "nmap -sV 10.0.0.5" }];
  const probe = { toolName: "exec_command", args: { operation: "run", command: "Get-Process nmap", context: "check scan" } };
  assert.equal(shouldReadLiveCommandState({ userMessage: "check the process", tool: probe, running }), true);
  assert.equal(shouldReadLiveCommandState({ userMessage: "check the process", tool: probe, running: [] }), false);
  assert.equal(shouldReadLiveCommandState({
    userMessage: "scan the host",
    tool: { toolName: "exec_command", args: { operation: "run", command: "nmap -sV 10.0.0.5", context: "scan host" } },
    running,
  }), false);
  assert.equal(shouldReadLiveCommandState({
    userMessage: "scan the host",
    tool: { toolName: "exec_command", args: { operation: "status", process_id: "process-abc123" } },
    running,
  }), false);
});

test("operator text hides tool names, schemas, and process ids", () => {
  const leaked = "I'll call exec_command with operation status and process_id process-abc123.";
  const cleaned = redactOperatorText(leaked);
  assert.equal(cleaned, "I'll check the process.");
  assert.doesNotMatch(cleaned, /exec_command|process_id|process-abc123|operation/);
  const kept = redactOperatorText("The scan is still running and printed 3 open ports. process-abc123");
  assert.match(kept, /3 open ports/);
  assert.doesNotMatch(kept, /process-abc123/);
});
