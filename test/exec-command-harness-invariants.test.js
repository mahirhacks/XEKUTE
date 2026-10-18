"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("exec_command harness invariants keep review timer, PTY channels, and checkpoint copy", () => {
  const durableSource = read("src/app/services/terminal/durable-process-manager.js");
  const bootstrap = read("src/ui/bootstrap.js");
  const main = read("src/app/electron/main.js");

  assert.match(durableSource, /DEFAULT_REVIEW_INTERVAL_MS = 15 \* 60 \* 1000/);
  assert.match(durableSource, /reviewTimer/);

  assert.match(main, /ipcMain\.handle\("terminal:create"/);
  assert.match(main, /ipcMain\.handle\("terminal:write"/);
  assert.match(main, /ipcMain\.handle\("terminal:resize"/);
  assert.match(main, /ipcMain\.handle\("terminal:kill"/);
  assert.match(main, /ipcMain\.handle\("terminal:setActive"/);
  assert.match(main, /ipcMain\.handle\("terminal:forget"/);

  const handleBackground = bootstrap.slice(
    bootstrap.indexOf("async function handleBackgroundWaitEvent"),
    bootstrap.indexOf("async function handleBackgroundWaitEvent") + 4_000,
  );
  assert.match(handleBackground, /stop_process/);
  const commandReport = main.slice(main.indexOf("async function deliverCommandReport"), main.indexOf("async function deliverCommandReport") + 2_000);
  assert.match(commandReport, /exec_command operation=stop/);
});
