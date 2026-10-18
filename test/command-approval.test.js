const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { formatCommandForApproval } = require("../src/app/services/approval/command-approval.js");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");

test("command approval preserves multiline shell commands verbatim", () => {
  const command = "$items = Get-ChildItem\n$items | Select-Object -First 2";
  assert.equal(formatCommandForApproval({ command, shell: "powershell" }), command);
});

test("command approval renders direct executable arguments safely", () => {
  assert.equal(
    formatCommandForApproval({ executable: "node", args: ["script with spaces.js", "--flag"] }),
    'node "script with spaces.js" --flag',
  );
});

test("command approval renders durable process operations", () => {
  assert.equal(
    formatCommandForApproval({ operation: "status", process_id: "proc-123", wait_ms: 5000 }),
    "exec_command status --process-id proc-123 --wait-ms 5000",
  );
});

test("exec_command approval sends a command-specific unselected decision card", () => {
  assert.match(mainSource, /if \(!\["exec_command", "browser_action"\]\.includes\(proposal\.toolName\)\)/);
  assert.match(mainSource, /Interactive approval is available only for commands and browser actions/);
  assert.match(mainSource, /kind: "command",\s*command: browser \? .+ : formatCommandForApproval\(proposal\.args\)/);
  assert.match(mainSource, /title: "Allow this browser action\?"/);
  assert.match(mainSource, /Allow the below command to be executed\?/);
  assert.match(mainSource, /id: "approve", label: "Approve", recommended: false/);
  assert.match(mainSource, /id: "deny", label: "Deny", recommended: false/);
  assert.doesNotMatch(mainSource, /Allow \$\{proposal\.toolName/);
});

test("browser approval cards hide typed secrets but show ordinary text", () => {
  const vm = require("node:vm");
  const start = mainSource.indexOf("function formatBrowserActionForApproval(");
  const end = mainSource.indexOf("\nasync function requestToolApproval(", start);
  const context = {};
  vm.runInNewContext(`${mainSource.slice(start, end)}\nthis.format = formatBrowserActionForApproval;`, context);
  const typed = { action: "type", target: { kind: "element", observationId: "o", ref: "frame-0-e4" }, text: "S3cr3t!" };
  assert.equal(context.format(typed, { secret: true }), "type (7 characters, hidden) → element frame-0-e4");
  assert.equal(context.format(typed), 'type "S3cr3t!" → element frame-0-e4');
});
