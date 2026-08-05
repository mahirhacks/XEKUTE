const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { normalizeProfile } = require("../src/application/policies/operating-modes");
const { evaluateAction } = require("../src/application/policies/policy-engine");
const { appendAgentAction } = require("../src/application/agent/memory/action-log");
const ToolMap = require("../src/adapters/tools/core/tool-catalog");

const READ_ONLY_TOOLS = [
  "find_files",
  "list_files",
  "inspect_workspace",
  "read_file",
  "read_files",
  "request_operator_questions",
  "search_code",
  "search_web",
  "fetch_url",
  "get_file_outline",
  "read_process",
];

const PLANNER_WRITE_TOOLS = [
  "write_file",
  "create_file",
  "patch_file",
  "replace_in_file",
  "insert_in_file",
  "append_file",
];

test("flat modes normalize legacy families and aliases to flat ids", () => {
  assert.equal(normalizeProfile("agent").key, "agent");
  assert.equal(normalizeProfile("agent").id, "agent");
  assert.equal(normalizeProfile("testing", "agent").key, "agent");
  assert.equal(normalizeProfile("assist", "agent").key, "agent");
  assert.equal(normalizeProfile("assist:agent").key, "agent");
  assert.equal(normalizeProfile("testing", "hypothesis").capability, "assess");
  assert.equal(normalizeProfile("testing", "planner").capability, "plan");
  assert.equal(normalizeProfile("testing", "planner").label, "Plan");
  assert.equal(normalizeProfile("testing", "hypothesis").label, "Hypothesis");
  assert.equal(normalizeProfile("testing", "ask").capability, "observe");
  assert.equal(normalizeProfile("testing", "execution").legacyMode, "agent");
  assert.equal(normalizeProfile("testing:exploit").key, "agent");
  assert.equal(normalizeProfile("assist", "planner").legacyMode, "plan");
  assert.equal(normalizeProfile("assist", "agent").capability, "active");
});

test("mode tool groups expose read-only ask/hypothesis, planner writes, and full agent surface", () => {
  const groups = ToolMap.MODE_TOOL_GROUPS;
  assert.ok(groups.agent.includes("write_file"));
  assert.ok(groups.agent.includes("patch_file"));
  assert.ok(groups.agent.includes("run_command"));
  assert.ok(groups.agent.includes("run_security_tool"));
  assert.ok(groups.agent.includes("load_tool_schemas"));
  assert.ok(groups.agent.includes("run_traffsucker"));
  assert.ok(ToolMap.hotToolNamesForProfile("agent").includes("load_tool_schemas"));
  assert.equal(ToolMap.hotToolNamesForProfile("agent").includes("run_traffsucker"), false);
  for (const toolName of READ_ONLY_TOOLS) {
    assert.ok(groups.ask.includes(toolName), `ask missing ${toolName}`);
    assert.ok(groups.hypothesis.includes(toolName), `hypothesis missing ${toolName}`);
  }
  assert.equal(groups.ask.includes("patch_file"), false);
  assert.equal(groups.ask.includes("run_command"), false);
  for (const toolName of PLANNER_WRITE_TOOLS) {
    assert.ok(groups.planner.includes(toolName), `planner missing ${toolName}`);
  }
  assert.equal(groups.planner.includes("run_command"), false);
  assert.equal(ToolMap.toolNamesForProfile("ask").includes("run_security_tool"), false);
  assert.equal(ToolMap.toolNamesForProfile("agent").includes("run_security_tool"), true);
  assert.equal(ToolMap.toolNamesForProfile("hypothesis").includes("create_file"), false);
});

test("policy engine blocks active and exploit actions until policy gates are enabled", () => {
  const active = { toolName: "run_security_tool", callId: "action-1", args: { adapter_id: "nmap", target: "https://example.com", technique_ids: ["service-discovery"] } };
  const analyze = evaluateAction({ tool: active, profile: normalizeProfile("ask"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false } });
  assert.equal(analyze.allowed, false);
  assert.equal(analyze.code, "MODE_READ_ONLY");

  const executionBlocked = evaluateAction({ tool: active, profile: normalizeProfile("agent"), policy: { allowActiveTesting: false, allowAutomatedScanning: false, allowExploitValidation: false } });
  assert.equal(executionBlocked.allowed, false);
  assert.equal(executionBlocked.code, "POLICY_ACTIVE_DISABLED");

  const executionAllowed = evaluateAction({ tool: active, profile: normalizeProfile("agent"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false, authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true, targets: ["example.com"], authoritySuperMode: "approve" } });
  assert.equal(executionAllowed.allowed, true);

  const authorizationBlocked = evaluateAction({ tool: active, profile: normalizeProfile("agent"), policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false, authorizationConfirmed: false, scopeReviewed: true, rulesAccepted: true } });
  assert.equal(authorizationBlocked.allowed, false);
  assert.equal(authorizationBlocked.code, "AUTHORIZATION_REQUIRED");

  const exploit = { toolName: "run_security_tool", callId: "action-2", args: { adapter_id: "sqlmap", target: "https://example.com/item?id=1", technique_ids: ["sql-injection"] } };
  const exploitBlocked = evaluateAction({ tool: exploit, profile: normalizeProfile("agent"), approvalGranted: true, policy: { allowActiveTesting: true, allowAutomatedScanning: true, allowExploitValidation: false } });
  assert.equal(exploitBlocked.allowed, false);
  assert.equal(exploitBlocked.code, "POLICY_EXPLOIT_DISABLED");
});

test("planner mode permits workspace file writes but blocks active testing and evidence mutation", () => {
  const profile = normalizeProfile("planner");
  for (const toolName of ["create_file", "write_file", "patch_file"]) {
    assert.equal(evaluateAction({
      tool: { toolName, file: "src/app.js", args: { path: "src/app.js" } },
      profile,
    }).allowed, true);
    assert.equal(evaluateAction({
      tool: { toolName, file: "plans/refactor-plan.md", args: { path: "plans/refactor-plan.md" } },
      profile,
    }).allowed, true);
  }
  const activeBlocked = evaluateAction({
    tool: { toolName: "run_security_tool", callId: "action-3", args: { adapter_id: "nmap", target: "https://example.com", technique_ids: ["service-discovery"] } },
    profile,
    policy: { allowActiveTesting: true, allowAutomatedScanning: true, authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true, targets: ["example.com"] },
  });
  assert.equal(activeBlocked.allowed, false);
  assert.equal(activeBlocked.code, "MODE_PLAN_SCOPE");
  const evidenceBlocked = evaluateAction({
    tool: { toolName: "record_hypothesis", callId: "action-4", args: { id: "hyp-1", question: "Is exposure present?" } },
    profile,
  });
  assert.equal(evidenceBlocked.allowed, false);
  assert.equal(evidenceBlocked.code, "MODE_PLAN_SCOPE");
});

test("authority modes enforce detailed permissions and approval behavior", () => {
  const write = { toolName: "write_file", file: "notes.md", content: "evidence" };
  const profile = normalizeProfile("agent");
  const ask = evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "ask", authorityPermissions: { workspaceWrite: true } } });
  assert.equal(ask.allowed, true);
  assert.equal(ask.requiresApproval, false);
  const deleteFile = evaluateAction({ tool: { toolName: "delete_file", file: "notes.md" }, profile, policy: { authoritySuperMode: "ask", authorityPermissions: { workspaceDelete: true } } });
  assert.equal(deleteFile.allowed, true);
  assert.equal(deleteFile.requiresApproval, false);
  assert.equal(evaluateAction({ tool: write, profile, approvalGranted: true, policy: { authoritySuperMode: "ask", authorityPermissions: { workspaceWrite: true } } }).allowed, true);
  assert.equal(evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "approve", authorityPermissions: { workspaceWrite: true } } }).allowed, true);
  assert.equal(evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "approve", authorityPermissions: { workspaceWrite: false } } }).code, "AUTHORITY_PERMISSION_DISABLED");
  assert.equal(evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "full", authorityPermissions: { workspaceWrite: false } } }).allowed, true);
  assert.equal(evaluateAction({ tool: write, profile, policy: { authoritySuperMode: "unrestricted", authorityPermissions: { workspaceWrite: false } } }).allowed, true);
});

test("authority super modes: unrestricted bypasses scope, full/ask stay in scope, approve is semi-restricted", () => {
  const profile = normalizeProfile("agent");
  const active = { toolName: "run_command", callId: "action-out", args: { target: "https://outofscope.example", command: "nmap -p 80 outofscope.example" } };
  const gatesOpen = { allowActiveTesting: true, allowAutomatedScanning: true, authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true, targets: ["example.com"], testingWindows: [], authorizeAllOutOfScope: false };

  const blockedApprove = evaluateAction({ tool: active, profile, policy: { ...gatesOpen, authoritySuperMode: "approve", authorityPermissions: { activeRecon: true } } });
  assert.equal(blockedApprove.allowed, false);
  const blockedFull = evaluateAction({ tool: active, profile, policy: { ...gatesOpen, authoritySuperMode: "full", authorityPermissions: { activeRecon: true } } });
  assert.equal(blockedFull.allowed, false);
  assert.equal(blockedFull.code, "TARGET_OUT_OF_SCOPE");
  const blockedAsk = evaluateAction({ tool: active, profile, policy: { ...gatesOpen, authoritySuperMode: "ask", authorityPermissions: { activeRecon: true } } });
  assert.equal(blockedAsk.allowed, false);
  assert.equal(blockedAsk.code, "TARGET_OUT_OF_SCOPE");
  const allowedUnrestricted = evaluateAction({ tool: active, profile, policy: { ...gatesOpen, authoritySuperMode: "unrestricted", authorityPermissions: { activeRecon: false } } });
  assert.equal(allowedUnrestricted.allowed, true);

  const targetActive = { toolName: "run_command", callId: "action-in", args: { target: "https://example.com", command: "nmap -p 80 example.com" } };
  const askActive = evaluateAction({ tool: targetActive, profile, policy: { ...gatesOpen, authoritySuperMode: "ask", authorityPermissions: { activeRecon: true } } });
  assert.equal(askActive.allowed, false);
  assert.equal(askActive.requiresApproval, true);
  assert.equal(evaluateAction({ tool: targetActive, profile, policy: { ...gatesOpen, authoritySuperMode: "full", authorityPermissions: { activeRecon: true } } }).allowed, true);
  assert.equal(evaluateAction({ tool: targetActive, profile, policy: { ...gatesOpen, authoritySuperMode: "approve", authorityPermissions: { activeRecon: true } } }).allowed, true);
  assert.equal(evaluateAction({ tool: targetActive, profile, policy: { ...gatesOpen, authoritySuperMode: "unrestricted" } }).allowed, true);
});

test("typed hypothesis adapter and action log preserve transparent metadata", () => {
  assert.equal(ToolMap.TOOL_META.record_hypothesis.typed, true);
  assert.equal(ToolMap.TOOL_META.record_hypothesis.capability, "evidence");
  assert.equal(ToolMap.TOOL_META.record_finding_candidate.capability, "evidence");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-agent-modes-"));
  const result = appendAgentAction(root, { runId: "run-1", type: "action_result", tool: "record_hypothesis", ok: true, output: '{"token":"top-secret"}', authorization: "Bearer secret" });
  assert.equal(result.ok, true);
  const log = fs.readFileSync(path.join(root, ".xekute", "logs", "agent-actions.jsonl"), "utf8");
  assert.match(log, /run-1/);
  assert.doesNotMatch(log, /top-secret|Bearer secret/);
  assert.match(log, /REDACTED/);
  fs.rmSync(root, { recursive: true, force: true });
});
