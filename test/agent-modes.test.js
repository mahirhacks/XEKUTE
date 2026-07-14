const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeProfile } = require("../src/agent/operating-modes");
const { evaluateAction } = require("../src/agent/policy-engine");
const { appendAgentAction } = require("../src/agent/action-log");
const ToolMap = require("../src/tools/tool-map");

test("testing and assist profiles normalize with separate capabilities", () => {
  assert.equal(normalizeProfile("testing", "analyze").capability, "observe");
  assert.equal(normalizeProfile("testing", "planner").capability, "plan");
  assert.equal(normalizeProfile("testing", "agent").capability, "active");
  assert.equal(normalizeProfile("testing", "ask").capability, "observe");
  assert.equal(normalizeProfile("testing", "execution").legacyMode, "agent");
  assert.equal(normalizeProfile("testing:exploit").key, "exploit");
  assert.equal(normalizeProfile("assist", "planner").legacyMode, "plan");
  assert.equal(normalizeProfile("assist", "agent").capability, "workspace");
  assert.equal(normalizeProfile("assist", "ask").capability, "observe");
  assert.equal(normalizeProfile("agent").key, "executor");
});

test("policy engine blocks active and exploit actions until policy gates are enabled", () => {
  const active = { toolName: "run_command", command: "nmap -Pn example.com" };
  const analyze = evaluateAction({ tool: active, profile: normalizeProfile("testing", "analyze"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false } });
  assert.equal(analyze.allowed, false);
  assert.equal(analyze.code, "MODE_READ_ONLY");

  const executionBlocked = evaluateAction({ tool: active, profile: normalizeProfile("testing", "execution"), policy: { allowActiveTesting: false, allowAutomatedScanning: false, allowExploitValidation: false } });
  assert.equal(executionBlocked.allowed, false);
  assert.equal(executionBlocked.code, "POLICY_ACTIVE_DISABLED");

  const executionAllowed = evaluateAction({ tool: active, profile: normalizeProfile("testing", "execution"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false } });
  assert.equal(executionAllowed.allowed, true);

  const authorizationBlocked = evaluateAction({ tool: active, profile: normalizeProfile("testing", "execution"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false, authorizationConfirmed: false, scopeReviewed: true, rulesAccepted: true } });
  assert.equal(authorizationBlocked.allowed, false);
  assert.equal(authorizationBlocked.code, "AUTHORIZATION_REQUIRED");

  const exploit = { toolName: "run_command", command: "sqlmap -u https://example.com/item?id=1" };
  const exploitBlocked = evaluateAction({ tool: exploit, profile: normalizeProfile("testing", "exploit"), approvalGranted: true, policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false } });
  assert.equal(exploitBlocked.allowed, false);
  assert.equal(exploitBlocked.code, "POLICY_EXPLOIT_DISABLED");

  const safeBlocked = evaluateAction({ tool: active, profile: normalizeProfile("assist", "agent"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: true, authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true } });
  assert.equal(safeBlocked.allowed, false);
  assert.equal(safeBlocked.code, "SAFE_MODE_ACTIVE_BLOCK");
  const safeExploitBlocked = evaluateAction({ tool: exploit, profile: normalizeProfile("assist", "agent"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: true, authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true } });
  assert.equal(safeExploitBlocked.allowed, false);
  assert.equal(safeExploitBlocked.code, "SAFE_MODE_EXPLOIT_BLOCK");
});

test("authority modes enforce detailed permissions and approval behavior", () => {
  const write = { toolName: "write_file", file: "notes.md", content: "evidence" };
  const profile = normalizeProfile("assist", "agent");
  const ask = evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "ask", authorityPermissions: { workspaceWrite: true } } });
  assert.equal(ask.allowed, false);
  assert.equal(ask.code, "AUTHORITY_APPROVAL_REQUIRED");
  assert.equal(evaluateAction({ tool: write, profile, approvalGranted: true, policy: { authoritySuperMode: "ask", authorityPermissions: { workspaceWrite: true } } }).allowed, true);
  assert.equal(evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "approve", authorityPermissions: { workspaceWrite: true } } }).allowed, true);
  assert.equal(evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "approve", authorityPermissions: { workspaceWrite: false } } }).code, "AUTHORITY_PERMISSION_DISABLED");
  assert.equal(evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "full", authorityPermissions: { workspaceWrite: false } } }).allowed, true);
});

test("typed hypothesis adapter and action log preserve transparent metadata", () => {
  assert.equal(ToolMap.TOOL_META.record_hypothesis.typed, true);
  assert.equal(ToolMap.TOOL_META.record_hypothesis.capability, "evidence");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-agent-modes-"));
  const result = appendAgentAction(root, { runId: "run-1", type: "action_result", tool: "record_hypothesis", ok: true });
  assert.equal(result.ok, true);
  const log = fs.readFileSync(path.join(root, "logs", "agent-actions.jsonl"), "utf8");
  assert.match(log, /run-1/);
  fs.rmSync(root, { recursive: true, force: true });
});
