const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const durableSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "services", "terminal", "durable-process-manager.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");

test("Windows supervised processes stay attached so they cannot open a console window", () => {
  assert.match(durableSource, /const launchDetached = process\.platform !== "win32";/);
  assert.match(durableSource, /windowsHide: true, detached: launchDetached/);
  assert.doesNotMatch(durableSource, /process\.platform !== "win32" \|\| !isPowerShell/);
});

test("agent exec_command streams into Xekute's in-app terminal by default", () => {
  assert.match(mainSource, /const exposeTerminal = input\.show_in_terminal !== false;/);
  assert.match(mainSource, /exposeTerminal: args\.show_in_terminal !== false/);
  assert.doesNotMatch(mainSource, /exposeTerminal = input\.show_in_terminal === true/);
});
