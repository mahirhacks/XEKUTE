"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("exec_command harness invariants keep review timer, PTY channels, and checkpoint copy", () => {
  const durableSource = read("src/app/services/terminal/durable-process-manager.js");
  const terminalIpc = read("src/app/ipc/terminal.js");
  const bootstrap = read("src/ui/bootstrap.js");

  assert.match(durableSource, /DEFAULT_REVIEW_INTERVAL_MS = 15 \* 60 \* 1000/);
  assert.match(durableSource, /reviewTimer/);

  assert.match(terminalIpc, /terminal:create/);
  assert.match(terminalIpc, /terminal:write/);
  assert.match(terminalIpc, /terminal:resize/);
  assert.match(terminalIpc, /terminal:kill/);
  assert.match(terminalIpc, /terminal:setActive/);
  assert.match(terminalIpc, /terminal:forget/);

  const handleBackground = bootstrap.slice(
    bootstrap.indexOf("async function handleBackgroundWaitEvent"),
    bootstrap.indexOf("async function handleBackgroundWaitEvent") + 4_000,
  );
  assert.match(handleBackground, /stop_process/);
  assert.match(handleBackground, /exec_command operation=stop/);
});
