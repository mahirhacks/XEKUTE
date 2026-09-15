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

test("the in-app terminal uses a dense monospace face instead of the UI sans-serif", () => {
  assert.match(terminalUiSource, /"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace/);
  assert.match(terminalUiSource, /fontSize: 12/);
  assert.match(terminalUiSource, /lineHeight: 1/);
  assert.match(terminalUiSource, /function xtermOptions/);
  assert.match(terminalUiSource, /new globalThis\.Terminal\(xtermOptions\(\{ cursorBlink: true \}\)\)/);
  assert.match(terminalUiSource, /new globalThis\.Terminal\(xtermOptions\(\{ cursorBlink: false \}\)\)/);
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
  assert.match(terminalUiSource, /session\?\.agent\) return "codicon-sparkle"/);
  assert.match(terminalUiSource, /terminal-shell-icon \$\{sessionIconClass/);
  const chatCss = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
  assert.match(chatCss, /\.codicon-terminal-powershell[\s\S]{0,80}#5391fe/);
  assert.match(chatCss, /\.codicon-terminal-git-bash[\s\S]{0,80}#f05133/);
});
