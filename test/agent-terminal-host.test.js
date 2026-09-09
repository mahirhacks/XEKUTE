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
  assert.match(mainSource, /const exposeTerminal = input\.show_in_terminal !== false;/);
  assert.match(mainSource, /createSupervisedTerminal/);
  assert.doesNotMatch(mainSource, /exposeTerminal = input\.show_in_terminal === true/);
});

test("the window that is viewing an AI terminal can stop it without a false ownership error", () => {
  assert.match(mainSource, /require\("\.\.\/services\/terminal\/terminal-ownership\.js"\)/);
  assert.match(mainSource, /findLiveTerminal\(terminals, id\)/);
  assert.match(mainSource, /alreadyStopped: true/);
  assert.match(mainSource, /ownerId: options\.ownerId \|\| webContents\.id/);
  assert.doesNotMatch(mainSource, /ownerId: options\.ownerId \|\| String\(webContents\.id\)/);
  assert.doesNotMatch(
    mainSource.slice(mainSource.indexOf("ipcMain.handle(\"terminal:kill\""), mainSource.indexOf("ipcMain.handle(\"terminal:kill\"") + 900),
    /if \(!record \|\| record\.ownerId !== _event\.sender\.id\)/,
  );
  assert.match(terminalUiSource, /result\?\.alreadyStopped/);
  assert.match(terminalUiSource, /This command is no longer running/);
});
