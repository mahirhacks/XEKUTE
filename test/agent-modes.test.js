const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeProfile } = require("../src/agent/policy/operating-modes");
const { evaluateAction, isPlanFilePath } = require("../src/agent/policy/policy-engine");
const { appendAgentAction } = require("../src/agent/memory/action-log");
const ToolMap = require("../src/harness/core/tool-map");

test("testing and assist profiles normalize with separate capabilities", () => {
  assert.equal(normalizeProfile("testing", "analyze").capability, "observe");
  assert.equal(normalizeProfile("testing", "planner").capability, "plan");
  assert.equal(normalizeProfile("testing", "agent").capability, "active");
  assert.equal(normalizeProfile("testing", "ask").capability, "observe");
  assert.equal(normalizeProfile("testing", "execution").legacyMode, "agent");
  assert.equal(normalizeProfile("testing:exploit").key, "agent");
  assert.equal(normalizeProfile("assist", "planner").legacyMode, "plan");
  assert.equal(normalizeProfile("assist", "agent").capability, "workspace");
  assert.equal(normalizeProfile("assist", "ask").capability, "observe");
  assert.equal(normalizeProfile("agent").key, "agent");
});

test("mode tool groups keep Agent broad, Ask read-only, and Planner plan-only", () => {
  const groups = ToolMap.MODE_TOOL_GROUPS;
  assert.ok(groups.agent.includes("patch_file"));
  assert.ok(groups.agent.includes("run_command"));
  assert.equal(groups.agent.includes("run_security_tool"), false);
  assert.ok(groups.ask.includes("read_file"));
  assert.ok(groups.ask.includes("search_web"));
  assert.equal(groups.ask.includes("patch_file"), false);
  assert.equal(groups.ask.includes("run_command"), false);
  assert.deepEqual(groups.planner, ["create_file"]);
  assert.equal(ToolMap.toolNamesForProfile("assist", "ask").includes("run_security_tool"), false);
  assert.equal(ToolMap.toolNamesForProfile("testing", "agent").includes("run_security_tool"), true);
});

test("policy engine blocks active and exploit actions until policy gates are enabled", () => {
  const active = { toolName: "run_security_tool", callId: "action-1", args: { adapter_id: "nmap", target: "https://example.com", technique_ids: ["service-discovery"] } };
  const analyze = evaluateAction({ tool: active, profile: normalizeProfile("testing", "analyze"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false } });
  assert.equal(analyze.allowed, false);
  assert.equal(analyze.code, "MODE_READ_ONLY");

  const executionBlocked = evaluateAction({ tool: active, profile: normalizeProfile("testing", "execution"), policy: { allowActiveTesting: false, allowAutomatedScanning: false, allowExploitValidation: false } });
  assert.equal(executionBlocked.allowed, false);
  assert.equal(executionBlocked.code, "POLICY_ACTIVE_DISABLED");

  const executionAllowed = evaluateAction({ tool: active, profile: normalizeProfile("testing", "execution"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false, authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true, targets: ["example.com"], authoritySuperMode: "approve" } });
  assert.equal(executionAllowed.allowed, true);

  const authorizationBlocked = evaluateAction({ tool: active, profile: normalizeProfile("testing", "execution"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false, authorizationConfirmed: false, scopeReviewed: true, rulesAccepted: true } });
  assert.equal(authorizationBlocked.allowed, false);
  assert.equal(authorizationBlocked.code, "AUTHORIZATION_REQUIRED");

  const exploit = { toolName: "run_security_tool", callId: "action-2", args: { adapter_id: "sqlmap", target: "https://example.com/item?id=1", technique_ids: ["sql-injection"] } };
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

test("planner mode only permits creating plan documents", () => {
  const profile = normalizeProfile("assist", "planner");
  assert.equal(isPlanFilePath("plans/refactor-plan.md"), true);
  assert.equal(isPlanFilePath("src/app.js"), false);
  assert.equal(evaluateAction({
    tool: { toolName: "create_file", file: "plans/refactor-plan.md", args: { path: "plans/refactor-plan.md" } },
    profile,
  }).allowed, true);
  const blocked = evaluateAction({
    tool: { toolName: "create_file", file: "src/app.js", args: { path: "src/app.js" } },
    profile,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, "PLAN_FILE_ONLY");
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
  assert.equal(ToolMap.TOOL_META.record_finding_candidate.capability, "evidence");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-agent-modes-"));
  const result = appendAgentAction(root, { runId: "run-1", type: "action_result", tool: "record_hypothesis", ok: true, output: '{"token":"top-secret"}', authorization: "Bearer secret" });
  assert.equal(result.ok, true);
  const log = fs.readFileSync(path.join(root, "logs", "agent-actions.jsonl"), "utf8");
  assert.match(log, /run-1/);
  assert.doesNotMatch(log, /top-secret|Bearer secret/);
  assert.match(log, /REDACTED/);
  fs.rmSync(root, { recursive: true, force: true });
});
