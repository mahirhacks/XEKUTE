const crypto = require("crypto");
const ToolMap = require("./tool-port");
const { deriveErrorClass } = ToolMap;
const {
  buildSystemContext,
  buildUntrustedContext,
  contextLimits,
  inferEditTarget,
  isEditRequest,
  normalizeMode,
  normalizeProfile,
  profileKey,
  parseProjectFiles,
  resolveTools,
} = require("./prompt");
const { evaluateAction, evaluateStopConditions, loadPolicy, isPlanFilePath } = require("../policies/policy-engine");
const ScopeEngine = require("../../domain/assessment/scope-engine");
const { appendAgentAction, appendAgentApproval, appendAgentRun, appendToolOutput } = require("./memory/action-log");
const AgentRuntime = require("./runtime");
const AgentRecords = require("./memory/records");
const InitialPrompts = require("../../prompts/instructs/initial_prompt");
const DecisionSupport = require("../../prompts/skills/decision-support");
const CommandGuardrails = require("../policies/command-guardrails");
const { redactSecrets } = require("../policies/data-guardrails");
const RequestIntentRules = require("../policies/request-intent-rules");
const ContextRouter = require("../../prompts/skills/context-router");
const CyberLibrary = require("../../prompts/skills/cyber-library");
const ModeSkills = require("../../prompts/skills/mode-skills");
const VaptSkillLibrary = require("../../prompts/skills/vapt-skill-library");
const { loadWorkspaceGuidance } = require("../planning/custom-guidance");
const EngagementContext = require("../planning/engagement-context");
const PlanDocument = require("../planning/plan-document");
const OperatorQuestions = require("../clarification/operator-questions");
const ContextMemory = require("./memory/context-memory");
const FailureMemory = require("./memory/failure-memory");
const Tunables = require("./tunables");
const { estimateTokenCount } = require("./tool-port");

function buildEngagementPromptContext({ workspace = null, projectProfile = null } = {}) {
  return EngagementContext.mergeEngagementContext({ workspace, projectProfile });
}

const {
  MAX_AGENT_ROUNDS,
  MAX_EDIT_RETRIES_WITHOUT_TOOLS,
  MAX_PLAN_RETRIES_WITHOUT_FILE,
  MAX_VERIFICATION_REMINDERS,
  MAX_FAILED_VERIFICATION_REMINDERS,
  REPEAT_CLASS_LIMIT,
} = Tunables;
const {
  MULTI_FILE_WEB_REQUEST_RE,
  FILE_PATH_RE,
  SKIP_VERIFICATION_RE,
  VERIFICATION_FILE_RE,
  EXPLICIT_DELETE_RE,
} = RequestIntentRules;
const { PROTECTED_ASSESSMENT_PATH_RE } = CommandGuardrails;
const FILE_COUNT_WORDS = new Map(Object.entries(RequestIntentRules.FILE_COUNT_WORDS));
const READ_ONLY_TOOL_NAMES = new Set(ToolMap.MODE_TOOL_GROUPS.ask);
const NEVER_PARALLEL_TOOL_NAMES = new Set([
  "run_command",
  "start_process",
  "run_security_tool",
  "run_traffsucker",
  "run_custom_script",
  "request_operator_questions",
  "record_hypothesis",
  "record_finding_candidate",
  "verify_finding_candidate",
  "ingest_assessment_records",
  "write_file",
  "create_file",
  "patch_file",
  "replace_in_file",
  "insert_in_file",
  "append_file",
  "delete_file",
  "create_guidance",
]);
const ASK_MODE_BOUNDARY_RESPONSE = "Ask mode is read-only. I won't turn a confirmation into a shell or HTTP command or run reconnaissance here. I can explain the approach or use the available read-only discovery/research tools; switch to Agent for an authorized action.";
const ASSIST_AGENT_BOUNDARY_RESPONSE = "I stopped this turn because the model returned a raw command instead of a native workspace tool. No command was run. Agent mode can perform only routed workspace and Authority-approved actions.";
const TESTING_AGENT_BOUNDARY_RESPONSE = "I stopped this turn because the model returned a raw shell command instead of a typed security tool. No command was run. Agent actions must use an approved adapter with reviewed scope, a hypothesis, and policy approval.";
const PLANNER_BOUNDARY_RESPONSE = "Plan mode does not execute commands. I stopped the raw action payload; no command was run. Switch to Agent for execution or Hypothesis for read-only analysis.";
const HYPOTHESIS_BOUNDARY_RESPONSE = "Hypothesis mode is read-only. I stopped the raw action payload; no command was run. Use Plan mode to save plan documents or Agent to execute.";
const RESPONSE_EVIDENCE_RE = /\b(?:evidence|finding|hypothesis|false\s+positive|verify\s+finding|retest|coverage|vulnerabilit(?:y|ies)|security\s+report|scan\s+result|assessment\s+result|observed|verified)\b/i;
const PLAN_UPDATE_REQUEST_RE = /\b(?:update|edit|modify|change|fix|patch|revise|rewrite|refresh|extend|expand|append|add|remove)\w*\b/i;

function classifyEvidenceRequirement({ profile, contextRoute = {}, userMessage = "", actionResults = [], assessmentRequested = false } = {}) {
  const routeEvidence = contextRoute?.responseRequirements?.evidence === true;
  const cyberRoute = contextRoute?.kind === "cyber" || contextRoute?.kind === "hybrid" || contextRoute?.toolCategories?.includes?.("cyber");
  const explicitEvidence = RESPONSE_EVIDENCE_RE.test(String(userMessage || ""));
  const evidenceIds = AgentRuntime.evidenceIdsFromResults(actionResults);
  const producedEvidence = evidenceIds.length > 0;
  const required = Boolean(
    routeEvidence
    || producedEvidence
    || assessmentRequested
    || (explicitEvidence && (cyberRoute || profile?.key === "agent")),
  );
  let reason = "ordinary-response";
  if (producedEvidence) reason = "evidence-produced";
  else if (assessmentRequested) reason = "assessment-request";
  else if (routeEvidence || (explicitEvidence && (cyberRoute || profile?.key === "agent"))) reason = "security-or-evidence-request";
  return {
    required,
    mode: required ? "evidence_required" : "evidence_not_required",
    interactionType: contextRoute?.interactionType || (required ? "hypothesis" : "conversation"),
    reason,
    evidenceIds,
  };
}

function buildTaskBrief({ profile, contextRoute = {}, editContext = {}, availableTools = [], userMessage = "" } = {}) {
  if (!profile || contextRoute.kind === "conversation" || (contextRoute.interactionType && contextRoute.interactionType !== "workflow")) return null;

  const isTestingAgent = profile.key === "agent";
  const isPlan = profile.capability === "plan";
  const isMutation = Boolean(editContext.requiresMutation || editContext.isEditRequest);
  const toolCategories = new Set(Array.isArray(contextRoute.toolCategories) ? contextRoute.toolCategories : []);
  const targetFile = String(editContext.targetFile || "").trim();
  const toolNames = availableTools
    .map((tool) => String(tool?.function?.name || "").trim())
    .filter(Boolean);
  const steps = [];

  if (isTestingAgent) {
    steps.push({
      id: "preflight",
      label: "Check scope and policy",
      detail: "Confirm the authorized workspace, limits, and action gates before testing.",
    });
  }

  if (contextRoute.includeWorkspaceDiscovery || toolCategories.has("os") || toolCategories.has("cyber")) {
    steps.push({
      id: "inspect",
      label: "Inspect relevant context",
      detail: targetFile
        ? `Read ${targetFile} and the smallest surrounding context needed.`
        : "Locate the relevant files, evidence, or target context before acting.",
    });
  }

  if (isPlan) {
    steps.push({
      id: "plan",
      label: "Save the hypothesis plan",
      detail: "Write the full WSTG-aligned plan to plans/plan-<topic>_<date>_<time>.md — not in chat.",
    });
  } else if (isTestingAgent) {
    steps.push({
      id: "plan",
      label: "Set the hypothesis and action",
      detail: "Choose the smallest useful test, expected signals, and a clear completion gate.",
    });
    steps.push({
      id: "execute",
      label: "Run the approved action",
      detail: "Execute only after the runtime policy and approval gates allow it.",
    });
  } else if (isMutation) {
    steps.push({
      id: "plan",
      label: "Choose the smallest change",
      detail: "Keep the change focused on the request and preserve the current project conventions.",
    });
    steps.push({
      id: "execute",
      label: "Apply the change",
      detail: "Use the routed workspace tools and show each file or action as it happens.",
    });
  } else if (toolNames.length) {
    steps.push({
      id: "execute",
      label: isTestingAgent ? "Run the approved action" : "Gather the needed evidence",
      detail: isTestingAgent
        ? "Execute only after the runtime policy and approval gates allow it."
        : "Use read-only, scoped tools and keep the source of each result visible.",
    });
  }

  if (!isPlan) {
    steps.push({
      id: "verify",
      label: "Verify and report",
      detail: "Run the smallest relevant check, call out limitations, and summarize what changed.",
    });
  }

  if (!steps.length) return null;

  return {
    title: isPlan ? "Here’s the hypothesis" : "Here’s how I’ll handle this",
    summary: isTestingAgent
      ? "I’ll keep the work scoped, evidence-backed, and approval-aware."
      : isMutation
        ? "I’ll inspect the current state, make a focused change, and verify the result."
        : "I’ll gather the relevant context first, then show the result and any limits.",
    steps,
    transparency: [
      { label: "Profile", value: profileKey(profile) },
      { label: "Route", value: contextRoute.reason || contextRoute.kind || "request" },
      { label: "Tools", value: toolNames.length ? toolNames.join(", ") : "No tools for this mode" },
      ...(targetFile ? [{ label: "Target", value: targetFile }] : []),
    ],
    objective: String(userMessage || "").trim().slice(0, 240),
  };
}

function filterToolsForMode(tools, mode, modeFamily = "xekute") {
  const profile = normalizeProfile(modeFamily, mode);
  return ToolMap.toolsForProfile(profile, undefined, tools);
}

function filterToolsForRoute(tools, _route = {}) {
  // Kept for callers/tests: tool exposure is mode-owned, not route-classified.
  return Array.isArray(tools) ? tools : [];
}

function estimateMessagesTokens(messages = []) {
  return (Array.isArray(messages) ? messages : []).reduce((sum, message) => {
    let count = estimateTokenCount(message?.content || "") + 4;
    if (message?.tool_calls?.length) count += estimateTokenCount(JSON.stringify(message.tool_calls));
    if (message?.tool_name) count += estimateTokenCount(message.tool_name) + 2;
    return sum + count;
  }, 0);
}

function buildContextUsageSnapshot({ buckets, conversation, tools, route, contextWindow, round, contextPlan = null, model = "" }) {
  const sections = [
    { key: "system", label: "System instructions", color: "#a7a7ab", tokens: estimateMessagesTokens(buckets.system) },
    { key: "project", label: "Project & authority", color: "#4cb27a", tokens: estimateMessagesTokens(buckets.project) },
    { key: "memory", label: "Saved memory", color: "#d58dbc", tokens: estimateMessagesTokens(buckets.memory) },
    { key: "conversation", label: "Conversation & results", color: "#7ea9d8", tokens: estimateMessagesTokens(conversation) },
    { key: "tools", label: "Routed tool definitions", color: "#a879d6", tokens: tools?.length ? estimateTokenCount(JSON.stringify(tools)) : 0 },
  ];
  const estimatedTokens = sections.reduce((sum, section) => sum + section.tokens, 0);
  return {
    version: 2,
    source: "estimate",
    provider: contextPlan?.provider || "ollama",
    model: String(model || contextPlan?.model || ""),
    promptTokens: estimatedTokens,
    completionTokens: null,
    contextWindow: Number(contextWindow) || null,
    modelMaxTokens: Number(contextPlan?.modelMaxTokens) || null,
    effectiveLimitTokens: Number(contextPlan?.effectiveLimitTokens || contextWindow) || null,
    promptBudgetTokens: Number(contextPlan?.promptBudgetTokens) || null,
    responseReserveTokens: Number(contextPlan?.responseReserveTokens) || null,
    safetyMarginTokens: Number(contextPlan?.safetyMarginTokens) || null,
    contextWindowSource: contextPlan?.source || "fallback",
    approximate: Boolean(contextPlan?.approximate),
    estimatedTokens,
    sections,
    toolNames: (Array.isArray(tools) ? tools : []).map((tool) => tool?.function?.name).filter(Boolean),
    route: {
      kind: route?.kind || "conversation",
      promptDepth: route?.promptDepth || "compact",
      toolCategories: [...(route?.toolCategories || [])],
    },
    round,
    measuredAt: new Date().toISOString(),
  };
}

function groupHistoryMessages(history) {
  const groups = [];
  for (const message of Array.isArray(history) ? history : []) {
    const copy = { ...message };
    if (copy.role === "tool" && groups.length) {
      const previous = groups[groups.length - 1];
      const startsWithToolCall = previous[0]?.role === "assistant" && previous[0]?.tool_calls?.length;
      if (startsWithToolCall) {
        previous.push(copy);
        continue;
      }
    }
    groups.push([copy]);
  }
  return groups;
}

function indexHistoryGroups(groups, anchorOptions = {}) {
  return (Array.isArray(groups) ? groups : []).map((group, index) => ({
    index,
    group,
    tokens: estimateMessagesTokens(group),
    anchor: isAnchorHistoryGroup(group, anchorOptions),
    mandatory: isMandatoryAnchorHistoryGroup(group, anchorOptions),
  }));
}

const RUNTIME_USER_ANCHOR_RE = /Your previous response did not use valid tool calls|Before summarizing, verify|The latest verification failed|continue until every requested file|Hypothesis mode — create or update/i;

function isMandatoryAnchorHistoryGroup(group, { objectiveMessage = "" } = {}) {
  const objective = String(objectiveMessage || "").trim();
  if (!objective) return false;
  const messages = Array.isArray(group) ? group : [];
  if (messages.some((message) => message.role === "user" && String(message.content || "").trim() === objective)) return true;
  return messages.some((message) => message.role === "user" && RUNTIME_USER_ANCHOR_RE.test(String(message.content || "")));
}

function selectHistoryGroups(groups, { budget, anchorOptions = {} } = {}) {
  const tokenBudget = Math.max(0, Number(budget) || 0);
  const indexed = (Array.isArray(groups) ? groups : []).map((group, index) => ({
    index,
    group,
    tokens: estimateMessagesTokens(group),
    anchor: isAnchorHistoryGroup(group, anchorOptions),
    mandatory: isMandatoryAnchorHistoryGroup(group, anchorOptions),
  }));
  const mandatory = indexed.filter((entry) => entry.mandatory);
  const optionalAnchors = indexed.filter((entry) => entry.anchor && !entry.mandatory);
  const rest = indexed.filter((entry) => !entry.anchor);
  const mandatoryTokens = mandatory.reduce((sum, entry) => sum + entry.tokens, 0);
  if (mandatoryTokens > tokenBudget) {
    return { ok: false, overflow: true, selected: [], truncated: true, estimatedTokens: mandatoryTokens };
  }

  const selected = new Set(mandatory.map((entry) => entry.index));
  let used = mandatoryTokens;
  let truncated = false;

  for (const entry of optionalAnchors) {
    if (used + entry.tokens > tokenBudget) {
      truncated = true;
      continue;
    }
    selected.add(entry.index);
    used += entry.tokens;
  }

  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const entry = rest[index];
    if (used + entry.tokens > tokenBudget) {
      truncated = true;
      break;
    }
    selected.add(entry.index);
    used += entry.tokens;
  }

  const ordered = [...selected].sort((left, right) => left - right).map((index) => indexed.find((entry) => entry.index === index)?.group).filter(Boolean);
  return {
    ok: true,
    overflow: false,
    selected: ordered,
    truncated,
    estimatedTokens: used,
  };
}

function trimHistoryForContext(history, numCtx, anchorOptions = {}) {
  const tokenBudget = Number.isFinite(Number(numCtx)) ? Number(numCtx) : 8192;
  const historyBudget = Math.max(512, Math.floor(tokenBudget * Tunables.HISTORY_BUDGET_RATIO));
  const selection = selectHistoryGroups(groupHistoryMessages(history), { budget: historyBudget, anchorOptions });
  if (!selection.ok) return [];
  const flattened = selection.selected.flat();
  while (flattened[0]?.role === "tool") flattened.shift();
  return flattened;
}

function fitMessagesToContext({ baseMessages = [], history = [], summaryMessages = [], tools = [], promptBudget = 8192, anchorOptions = {} } = {}) {
  const fixed = [...baseMessages, ...summaryMessages];
  const fixedTokens = estimateMessagesTokens(fixed) + (tools?.length ? estimateTokenCount(JSON.stringify(tools)) : 0);
  const budget = Math.max(512, Number(promptBudget) || 8192);
  if (fixedTokens > budget) {
    return {
      ok: false,
      overflow: true,
      fixedTokens,
      estimatedTokens: fixedTokens,
      messages: fixed,
      history: [],
      truncated: true,
    };
  }
  const available = budget - fixedTokens;
  const selection = selectHistoryGroups(groupHistoryMessages(history), { budget: available, anchorOptions });
  if (!selection.ok) {
    return {
      ok: false,
      overflow: true,
      fixedTokens,
      estimatedTokens: fixedTokens + selection.estimatedTokens,
      messages: fixed,
      history: [],
      truncated: true,
    };
  }
  const selectedHistory = selection.selected.flat();
  while (selectedHistory[0]?.role === "tool") selectedHistory.shift();
  const messages = [...baseMessages, ...selectedHistory, ...summaryMessages];
  return {
    ok: true,
    overflow: false,
    fixedTokens,
    historyTokens: estimateMessagesTokens(selectedHistory),
    estimatedTokens: estimateMessagesTokens(messages) + (tools?.length ? estimateTokenCount(JSON.stringify(tools)) : 0),
    messages,
    history: selectedHistory,
    truncated: selection.truncated,
  };
}

function clipMemorySummary(summary, numCtx) {
  const maxChars = contextLimits(numCtx).memoryChars;
  const value = String(summary || "").trim();
  if (value.length <= maxChars) return value;
  return `... older memory omitted ...\n${value.slice(-maxChars)}`;
}

function canonicalizeSignatureValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeSignatureValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((output, key) => {
      const normalized = canonicalizeSignatureValue(value[key]);
      if (normalized !== undefined) output[key] = normalized;
      return output;
    }, {});
}

function toolCallSignature(tool) {
  const toolCall = buildToolCallForExecution(tool);
  const toolName = toolCall?.function?.name || tool?.toolName || tool?.action || "unknown";
  const args = canonicalizeSignatureValue(toolCall?.function?.arguments || {});
  return `${toolName}:${JSON.stringify(args)}`;
}

// Block further calls to a tool once the SAME failure class has accumulated
// REPEAT_CLASS_LIMIT consecutive strikes, even with different arguments.

function classBlockedForTool(signature, failedToolClasses) {
  const rec = failedToolClasses.get(signature);
  return Boolean(rec?.errorClass && rec.count >= REPEAT_CLASS_LIMIT);
}

function classBlockedGlobally(errorClass, failedErrorClassesGlobal) {
  if (!errorClass) return false;
  return (failedErrorClassesGlobal.get(errorClass) || 0) >= REPEAT_CLASS_LIMIT;
}

function classBlockedForToolActive(failedToolClasses, failedErrorClassesGlobal) {
  for (const toolName of failedToolClasses.keys()) {
    if (classBlockedForTool(toolName, failedToolClasses)) return true;
  }
  for (const count of failedErrorClassesGlobal.values()) {
    if (count >= REPEAT_CLASS_LIMIT) return true;
  }
  return false;
}

function isParallelSafeTool(tool) {
  const toolName = tool?.toolName || tool?.action || "";
  if (!toolName || NEVER_PARALLEL_TOOL_NAMES.has(toolName)) return false;
  return READ_ONLY_TOOL_NAMES.has(toolName);
}

function messageHasEvidenceIds(message) {
  if (message?.role !== "tool") return false;
  try {
    const parsed = JSON.parse(String(message.content || ""));
    return Array.isArray(parsed?.evidenceIds) && parsed.evidenceIds.length > 0;
  } catch {
    return false;
  }
}

function isAnchorHistoryGroup(group, { objectiveMessage = "" } = {}) {
  const messages = Array.isArray(group) ? group : [];
  if (!messages.length) return false;
  const objective = String(objectiveMessage || "").trim();
  if (objective && messages.some((message) => message.role === "user" && String(message.content || "").trim() === objective)) return true;
  if (messages.some((message) => message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.some((call) => {
    const name = call?.function?.name || "";
    return name === "record_hypothesis" || name === "record_finding_candidate";
  }))) return true;
  return messages.some(messageHasEvidenceIds);
}

function partitionHistoryGroups(groups, anchorOptions = {}) {
  const anchors = [];
  const rest = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    if (isAnchorHistoryGroup(group, anchorOptions)) anchors.push(group);
    else rest.push(group);
  }
  return { anchors, rest };
}

async function awaitWithTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function advanceTowardPhase(runState, targetPhase, { reason = "Agent turn progression", profile = null, operatorApproved = false, enforceAssessmentPhases = null, cyberAction = false } = {}) {
  const target = String(targetPhase || "").trim();
  if (!target || runState?.phase === target) return { ok: true, state: runState };
  const testing = enforceAssessmentPhases == null
    ? Boolean(profile?.key === "agent" && cyberAction)
    : Boolean(enforceAssessmentPhases);
  let currentIdx = AgentRuntime.PHASES.indexOf(String(runState.phase || ""));
  const targetIdx = AgentRuntime.PHASES.indexOf(target);
  if (currentIdx < 0 || targetIdx < 0) {
    runState.substate = "";
    return AgentRuntime.advancePhase(runState, target, { reason, approvedBy: testing && !operatorApproved ? "" : "runtime" });
  }
  if (targetIdx < currentIdx) {
    const regression = AgentRuntime.transition(runState, target, {
      reason,
      approvedBy: operatorApproved ? "operator" : "",
    });
    if (testing) {
      return {
        ok: false,
        blocked: true,
        code: "PHASE_TRANSITION_BLOCKED",
        error: regression.error || regression.code || "Assessment phases cannot regress.",
        state: runState,
      };
    }
    return { ok: true, state: runState, ignoredRegression: true };
  }
  if (testing && targetIdx > currentIdx + 1 && !operatorApproved) {
    return {
      ok: false,
      blocked: true,
      code: "PHASE_TRANSITION_BLOCKED",
      error: "Skipping assessment phases requires operator approval in testing workflows.",
      state: runState,
    };
  }
  if (testing && targetIdx > currentIdx + 1 && operatorApproved) {
    return AgentRuntime.transition(runState, target, {
      reason,
      approvedBy: "operator",
      limitations: [`Operator-approved phase jump from ${runState.phase} to ${target}.`],
    });
  }
  while (currentIdx < targetIdx) {
    const nextPhase = AgentRuntime.PHASES[currentIdx + 1];
    const approvedBy = operatorApproved ? "operator" : "runtime";
    const step = AgentRuntime.transition(runState, nextPhase, { reason, approvedBy });
    if (!step.ok) {
      if (testing) return { ok: false, blocked: true, code: "PHASE_TRANSITION_BLOCKED", error: step.error || step.code, state: runState };
      return AgentRuntime.advancePhase(runState, target, { reason, approvedBy: "runtime" });
    }
    currentIdx = AgentRuntime.PHASES.indexOf(runState.phase);
  }
  runState.substate = "";
  return { ok: true, state: runState };
}

function extractToolResultHighlights(raw, limit = 8) {
  const lines = String(raw || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const interesting = lines.filter((line) => /\b(?:error|vuln|finding|critical|high|medium|cve-|exploit|injection|xss|open port|unauthorized)\b/i.test(line));
  return interesting.slice(0, limit).map((line) => line.slice(0, 240));
}

function applyPersistedFailureRecords(failedToolCalls, failedToolClasses, failedErrorClassesGlobal, records = []) {
  FailureMemory.applyFailureRecordsToRuntime(records, failedToolCalls, failedToolClasses, failedErrorClassesGlobal);
}

function recordFailureMemoryEntry(failedToolClasses, toolName, signature, errorClass) {
  const rec = failedToolClasses.get(signature);
  if (!rec || rec.count < REPEAT_CLASS_LIMIT) return null;
  return FailureMemory.buildFailureRecord({
    toolName,
    signature,
    errorClass,
    count: rec.count,
    ttlMs: Tunables.FAILURE_MEMORY_TTL_MS,
  });
}

function updateTaskBriefProgress(brief, { executedTools = false, completedEdit = false, planDocumentSaved = false, round = 0 } = {}) {
  if (!brief || !Array.isArray(brief.steps)) return brief;
  const copy = { ...brief, steps: brief.steps.map((step) => ({ ...step })) };
  if (round >= Tunables.TASK_BRIEF_UPDATE_AFTER_ROUND && executedTools) {
    const inspect = copy.steps.find((step) => step.id === "inspect");
    if (inspect) inspect.detail = `${inspect.detail} (round ${round + 1}: context gathered)`;
  }
  if (completedEdit || planDocumentSaved) {
    const execute = copy.steps.find((step) => step.id === "execute");
    if (execute) execute.detail = `${execute.detail} (completed)`;
  }
  return copy;
}

function buildGrantedToolsMessage(grantedNames) {
  const names = [...grantedNames].sort();
  if (!names.length) return "Runtime grants: no tools granted for this request.";
  return `Runtime grants (${names.length}): ${names.join(", ")}. Only call tools in this list; use list_datasets before ingest_assessment_records when dataset names are uncertain.`;
}

function buildRoeCapabilitiesMessage(policy = {}) {
  const flags = {
    allow_passive_recon: policy.authorityPermissions?.passiveRecon !== false,
    allow_reachability_check: Boolean(policy.allowActiveTesting),
    allow_active_recon: Boolean(policy.allowActiveTesting),
    allow_scan: Boolean(policy.allowAutomatedScanning),
    allow_exploit: Boolean(policy.allowExploitValidation),
  };
  return `RoE capability flags: ${JSON.stringify(flags)}. Respect these when choosing tools; do not call active scanners or exploit validation when the flag is false.`;
}

function buildNotGrantedToolResult(tool, grantedNames) {
  const toolName = tool.toolName || tool.action || "unknown";
  const granted = grantedNames.size ? [...grantedNames].join(", ") : "none";
  return {
    ok: false,
    toolName,
    error: `${toolName} is not granted for this request. Granted: ${granted}. Use list_datasets or another granted tool instead.`,
    errorCode: "NOT_GRANTED",
    errorClass: "not_authorized",
    retryable: false,
  };
}

function commandGuardReason(command) {
  return CommandGuardrails.commandGuardReason(command, { isSecurityCommand: ToolMap.TOOL_GROUPS.cyber.isSecurityCommand });
}

function toolResultContentForModel(result, numCtx) {
  const raw = redactSecrets(result?.content || result?.summary || result?.error || "");
  const tokens = Number.isFinite(Number(numCtx)) ? Number(numCtx) : 8192;
  const maxChars = tokens <= 4096 ? 6000 : tokens <= 8192 ? 12000 : tokens <= 16384 ? 24000 : 40000;
  const highlights = extractToolResultHighlights(raw);
  let payload = raw;
  const clipped = raw.length > maxChars;
  if (clipped) {
    const headSize = Math.floor(maxChars * 0.7);
    payload = `${raw.slice(0, headSize)}\n... tool output truncated; retrieve the evidence artifact or use a narrower query ...\n${raw.slice(-(maxChars - headSize))}`;
  }
  return JSON.stringify({
    ok: Boolean(result?.ok && !result?.error),
    status: result?.status || (result?.timedOut ? "timeout" : result?.error ? "failed" : "complete"),
    errorCode: result?.errorCode || result?.code || "",
    errorClass: result?.errorClass || (result?.error ? deriveErrorClass(result) : ""),
    parserConfidence: Number.isFinite(Number(result?.parserConfidence)) ? Number(result.parserConfidence) : null,
    truncated: Boolean(result?.truncated || clipped),
    evidenceIds: AgentRuntime.evidenceIdsFromResults([result]),
    artifactPath: result?.outputPath || result?.file || "",
    sha256: result?.sha256 || result?.evidence?.record?.sha256 || "",
    highlights,
    payload,
  });
}

function normalizeToolCallsForApi(toolCalls = []) {
  return toolCalls
    .map((call) => {
      const fn = call?.function;
      if (!fn?.name) return null;

      let args = fn.arguments;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          return null;
        }
      }
      if (!args || typeof args !== "object") return null;

      return {
        id: call.id,
        type: call.type || "function",
        function: {
          ...(Number.isInteger(fn.index) ? { index: fn.index } : {}),
          name: fn.name,
          arguments: args,
        },
      };
    })
    .filter(Boolean);
}

function cleanAssistantText(text) {
  return String(text || "").trim();
}

function isReadOnlyChatProfile(profile) {
  return profile?.key === "ask" || profile?.key === "hypothesis";
}

function actionPayloadBoundaryResponse(profile) {
  if (profile?.key === "ask") return ASK_MODE_BOUNDARY_RESPONSE;
  if (profile?.key === "hypothesis") return HYPOTHESIS_BOUNDARY_RESPONSE;
  if (profile?.key === "planner") return PLANNER_BOUNDARY_RESPONSE;
  return profile?.key === "agent" ? TESTING_AGENT_BOUNDARY_RESPONSE : ASSIST_AGENT_BOUNDARY_RESPONSE;
}

function buildRetryMessage({ targetFile, userMessage }) {
  return DecisionSupport.retryPrompt({ targetFile, userMessage });
}

function parseStructuredToolFallback(text) {
  let candidate = String(text || "").trim();
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) candidate = fenced[1].trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return [];
  try {
    const value = JSON.parse(candidate);
    const name = String(value?.tool || value?.name || "").trim();
    const args = value?.arguments ?? value?.args;
    if (!name || !args || typeof args !== "object" || Array.isArray(args)) return [];
    return [{
      id: `fallback-${crypto.randomBytes(6).toString("hex")}`,
      type: "function",
      function: { name, arguments: args },
    }];
  } catch {
    return [];
  }
}

function buildPostToolSummaryPrompt({ mode, lastVerification } = {}) {
  return DecisionSupport.summaryPrompt({ mode: normalizeMode(mode), lastVerification });
}

function buildVerificationReminder({ userMessage, mutatedFiles }) {
  return DecisionSupport.verificationPrompt({ userMessage, mutatedFiles });
}

function buildFailedVerificationReminder({ userMessage, lastVerification }) {
  return DecisionSupport.failedVerificationPrompt({ userMessage, lastVerification });
}

function extractDiscoveryQuery(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function normalizeFilePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
}

function isProtectedAssessmentPath(filePath) {
  return PROTECTED_ASSESSMENT_PATH_RE.test(normalizeFilePath(filePath));
}

function parseExplicitFileTargets(text) {
  const matches = String(text || "").match(FILE_PATH_RE) || [];
  return [...new Set(matches.map(normalizeFilePath).filter(Boolean))];
}

function inferRequestedFileCount(text) {
  const value = String(text || "").toLowerCase();
  const numeric = value.match(/\b(\d+)\s+files?\b/);
  if (numeric) return Number(numeric[1]);

  for (const [word, count] of FILE_COUNT_WORDS.entries()) {
    if (new RegExp(`\\b${word}\\s+files?\\b`, "i").test(value)) return count;
  }

  return null;
}

function fileExtensionKinds(files) {
  const kinds = new Set();
  for (const file of files) {
    const norm = normalizeFilePath(file);
    if (norm.endsWith(".html")) kinds.add("html");
    if (norm.endsWith(".css")) kinds.add("css");
    if (norm.endsWith(".js")) kinds.add("js");
  }
  return kinds;
}

function shouldRequestVerification({ userMessage, mutatedFiles, ranCommand }) {
  if (ranCommand || !mutatedFiles?.size) return false;
  if (SKIP_VERIFICATION_RE.test(String(userMessage || ""))) return false;
  return [...mutatedFiles].some((file) => VERIFICATION_FILE_RE.test(file));
}

function buildIncompleteMultiFileRetry({
  userMessage,
  knownFiles,
  mutatedFiles,
}) {
  const explicitTargets = parseExplicitFileTargets(userMessage);
  const missingExplicitTargets = explicitTargets.filter((file) => !mutatedFiles.has(file));
  if (missingExplicitTargets.length) {
    return [
      "You have not completed all requested files yet.",
      `Still required this turn: ${missingExplicitTargets.join(", ")}.`,
      "Call one file tool per remaining file and keep going before you summarize.",
      `Original user request: ${userMessage}`,
    ].join(" ");
  }

  if (MULTI_FILE_WEB_REQUEST_RE.test(String(userMessage || ""))) {
    const kinds = fileExtensionKinds(knownFiles);
    const missingKinds = ["html", "css", "js"].filter((kind) => !kinds.has(kind));
    if (missingKinds.length) {
      return [
        "The request still needs separate web files.",
        `Missing file types in the workspace right now: ${missingKinds.join(", ")}.`,
        "Create or update separate HTML, CSS, and JavaScript files. Do not summarize yet.",
        `Original user request: ${userMessage}`,
      ].join(" ");
    }
  }

  const requestedFileCount = inferRequestedFileCount(userMessage);
  if (requestedFileCount && mutatedFiles.size < requestedFileCount) {
    return [
      "You have not completed all requested file changes yet.",
      `The user asked for ${requestedFileCount} files, but only ${mutatedFiles.size} file changes were completed in this turn.`,
      "Continue calling one file tool per remaining file before you summarize.",
      `Original user request: ${userMessage}`,
    ].join(" ");
  }

  return "";
}

function buildToolCallForExecution(tool) {
  const name = tool.toolName || tool.action;
  const args = { ...(tool.args || {}) };

  if (tool.file) args.path = tool.file;
  if (tool.files) args.paths = tool.files;
  if (tool.query) {
    args.query = tool.query;
    args.limit = tool.limit;
  }
  if (tool.command) {
    args.command = tool.command;
    args.timeout_ms = tool.timeoutMs;
  }
  if (tool.processId) args.id = tool.processId;
  if (tool.code != null) args.content = tool.code;
  if (tool.patches) {
    args.patches = tool.patches;
    if (tool.patches.length === 1) {
      args.search = tool.patches[0].search;
      args.replace = tool.patches[0].replace;
    }
  }

  return {
    id: tool.callId,
    type: "function",
    function: { name, arguments: args },
  };
}

function summarizeToolResults(results) {
  const parts = [];
  for (const result of results) {
    if (!result) continue;
    if (result.error) {
      parts.push(`Tool failed: ${result.error}`);
      continue;
    }
    if (result.mode === "command") {
      parts.push(`Ran command (${result.exitCode === 0 ? "passed" : `exit ${result.exitCode}`}).`);
      continue;
    }
    if (result.mode === "create") {
      parts.push("Created.");
      continue;
    }
    if (["patch", "replace", "insert", "append", "full", "noop"].includes(result.mode)) {
      parts.push("Edited.");
      continue;
    }
    if (result.mode === "delete") {
      parts.push("Deleted.");
      continue;
    }
    if (["read", "read_many", "inspect", "list", "index", "search", "outline"].includes(result.mode)) {
      parts.push("Read.");
      continue;
    }
    if (result.summary) parts.push(result.summary);
  }
  return parts.join(" ").trim();
}

async function prepareDiscoveryHints({ workspace, userMessage, findWorkspaceFiles, searchWorkspaceIndex }) {
  if (!workspace || !userMessage) return { files: [], snippets: [] };

  const query = extractDiscoveryQuery(userMessage);
  const fileMatches = findWorkspaceFiles ? findWorkspaceFiles(workspace, query, { limit: 6 }) : null;
  const searchMatches = searchWorkspaceIndex ? searchWorkspaceIndex(workspace, query, { limit: 4 }) : null;

  return {
    files: fileMatches?.results?.map((row) => row.path) || [],
    snippets: searchMatches?.results?.slice(0, 2) || [],
  };
}

async function runAgentTurn({
  workspace,
  model,
  numCtx,
  contextBudget,
  contextPlan = null,
  thinking,
  tools,
  mode = "agent",
  modeFamily = "agent",
  approvalGranted = false,
  authority = null,
  projectProfile = null,
  runId: suppliedRunId = "",
  chatHistory,
  contextSummary,
  failureMemory = [],
  dirMap,
  activeFile,
  extraFiles,
  subagentModel = "",
  userMessage,
  globalGuidanceRoot = "",
  sendEvent,
  runModelRound,
  executeToolCall,
  requestApproval = null,
  requestQuestions = null,
  findWorkspaceFiles,
  searchWorkspaceIndex,
}) {
  const profile = normalizeProfile(modeFamily, mode);
  const selectedMode = profile.legacyMode;
  const resolvedContextPlan = contextPlan?.effectiveLimitTokens
    ? {
        ...contextPlan,
        provider: String(contextPlan.provider || "ollama").toLowerCase(),
        effectiveLimitTokens: Number(contextPlan.effectiveLimitTokens) || Number(contextBudget) || Number(numCtx) || 8192,
        promptBudgetTokens: Number(contextPlan.promptBudgetTokens) || Number(contextBudget) || Number(numCtx) || 8192,
      }
    : {
        provider: "ollama",
        model,
        mode: "custom",
        modelMaxTokens: Number(contextBudget) || Number(numCtx) || 8192,
        effectiveLimitTokens: Number(contextBudget) || Number(numCtx) || 8192,
        promptBudgetTokens: Number(contextBudget) || Number(numCtx) || 8192,
        responseReserveTokens: 0,
        safetyMarginTokens: 0,
        source: "legacy",
        approximate: false,
      };
  const effectiveContextBudget = Number(resolvedContextPlan.effectiveLimitTokens) || Number(contextBudget) || Number(numCtx) || 8192;
  const promptBudgetTokens = Number(resolvedContextPlan.promptBudgetTokens) || effectiveContextBudget;
  const contextRoute = ContextRouter.routeRequest({ text: userMessage, hasWorkspace: Boolean(workspace), family: profile.family, mode: profile.key, history: chatHistory, activeFile });
  const guidanceCreateRequested = /^\/create-(?:skill|rule|subagent)(?:\s|$)/i.test(String(userMessage || "").trim());
  // Mode owns which tools are granted. Agent uses a two-layer catalog: full name
  // list always, hot JSON schemas first, load_tool_schemas expands the rest.
  let profileTools = filterToolsForMode(tools, profile.key, profile.family);
  if (!guidanceCreateRequested) profileTools = profileTools.filter((tool) => tool?.function?.name !== "create_guidance");
  const allowedToolNames = new Set(profileTools.map((tool) => tool.function.name));
  const loadedSchemaNames = new Set(ToolMap.hotToolNamesForProfile(profile));
  if (guidanceCreateRequested && allowedToolNames.has("create_guidance")) loadedSchemaNames.add("create_guidance");
  const refreshAvailableTools = () => ToolMap.compactTools(
    profileTools.filter((tool) => loadedSchemaNames.has(tool.function.name)),
  );
  let availableTools = refreshAvailableTools();
  const catalogEntries = ToolMap.buildToolCatalog(profile, undefined, loadedSchemaNames);
  if (allowedToolNames.size) {
    sendEvent({
      type: "activity",
      text: `Mode ${profileKey(profile)} · ${allowedToolNames.size} granted · ${availableTools.length} hot schema${availableTools.length === 1 ? "" : "s"}`,
      kind: "meta",
    });
    sendEvent({
      type: "activity",
      text: `Hot schemas: ${availableTools.map((tool) => tool.function.name).join(", ")}`,
      kind: "meta",
    });
  }
  const scanRequested = /\b(?:passive\s+)?scan\b/i.test(String(userMessage || "")) || /\bpassive\s+recon\b/i.test(String(userMessage || ""));
  if (scanRequested && !allowedToolNames.has("run_security_tool")) {
    sendEvent({
      type: "activity",
      text: "Security scans need Agent mode. Authority and assessment policy still decide whether a scan can run.",
      kind: "warn",
    });
  }
  const policy = loadPolicy(workspace, authority, projectProfile);
  const runId = String(suppliedRunId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const runState = AgentRuntime.createRunState({ runId, profile: profileKey(profile), objective: userMessage, model });
  const recordsRun = contextRoute.kind !== "conversation";
  if (recordsRun) {
    sendEvent({ type: "run_state", runId, state: { ...runState } });
    appendAgentAction(workspace, {
      runId,
      type: "run_started",
      timestamp: new Date().toISOString(),
      profile: profileKey(profile),
      policy: { allowActiveTesting: policy.allowActiveTesting, allowAutomatedScanning: policy.allowAutomatedScanning, allowExploitValidation: policy.allowExploitValidation, authoritySuperMode: policy.authoritySuperMode, maxRequestsPerSecond: policy.maxRequestsPerSecond, maxConcurrency: policy.maxConcurrency },
      userMessage: String(userMessage || "").slice(0, 1000),
    });
    appendAgentRun(workspace, {
      runId,
      type: "run_started",
      timestamp: new Date().toISOString(),
      profile: profileKey(profile),
      status: "running",
      approvalRequired: Boolean(profile.capability === "active" || profile.capability === "exploit"),
      policy: {
        authorizationConfirmed: Boolean(policy.authorizationConfirmed),
        scopeReviewed: Boolean(policy.scopeReviewed),
        rulesAccepted: Boolean(policy.rulesAccepted),
        allowActiveTesting: Boolean(policy.allowActiveTesting),
        allowAutomatedScanning: Boolean(policy.allowAutomatedScanning),
        allowExploitValidation: Boolean(policy.allowExploitValidation),
        maxRequestsPerSecond: policy.maxRequestsPerSecond,
        maxConcurrency: policy.maxConcurrency,
      },
    });
  }
  const explicitMutationRequest = RequestIntentRules.MUTATION_REQUEST_RE.test(String(userMessage || ""));
  const inheritedActionOnly = Boolean(contextRoute.inheritedIntent && !explicitMutationRequest);
  const explicitlyNamedPlanPath = parseExplicitFileTargets(userMessage).find(isPlanFilePath) || "";
  const requestedTargetFile = explicitlyNamedPlanPath || inferEditTarget(userMessage, activeFile, dirMap);
  const requiresPlanDocument = profile.key === "planner"
    && !contextRoute.social
    && (
      PLAN_UPDATE_REQUEST_RE.test(String(userMessage || ""))
      || /\b(?:create|write|save|draft|make)\b[\s\S]{0,40}\bplan\b/i.test(String(userMessage || ""))
      || isPlanFilePath(requestedTargetFile)
    );
  const updatesPlanDocument = Boolean(
    requiresPlanDocument
      && PLAN_UPDATE_REQUEST_RE.test(String(userMessage || ""))
      && isPlanFilePath(requestedTargetFile),
  );
  const planDocumentOperation = updatesPlanDocument ? "update" : "create";
  const planDocumentPath = requiresPlanDocument
    ? (updatesPlanDocument ? requestedTargetFile : explicitlyNamedPlanPath || PlanDocument.buildPlanDocumentPath(userMessage))
    : "";
  const editContext = {
    mode: selectedMode,
    profile: profileKey(profile),
    isEditRequest: updatesPlanDocument || (contextRoute.toolCategories.includes("os") && ["agent", "planner"].includes(profile.key) && (isEditRequest(userMessage) || contextRoute.osMutates)),
    requiresMutation: requiresPlanDocument || (contextRoute.osMutates && !inheritedActionOnly && ["agent", "planner"].includes(profile.key)),
    requiresPlanDocument,
    planDocumentPath,
    planDocumentOperation,
    inheritedActionOnly,
    targetFile: requestedTargetFile,
    activeFile,
    userMessage,
    dirMap,
  };

  const taskBrief = buildTaskBrief({
    profile,
    contextRoute,
    editContext,
    availableTools,
    userMessage,
  });
  if (taskBrief) sendEvent({ type: "task_brief", runId, brief: taskBrief });

  const discovery = contextRoute.includeWorkspaceDiscovery
    ? await prepareDiscoveryHints({ workspace, userMessage, findWorkspaceFiles, searchWorkspaceIndex })
    : { files: [], snippets: [] };

  const cyberLibraryIds = contextRoute.promptDepth === "cyber"
    ? CyberLibrary.selectLibraries(userMessage, { active: contextRoute.cyberCapabilities.includes("active") })
    : [];
  const isPlanMode = profile.key === "planner";
  const isHypothesisMode = profile.key === "hypothesis";
  const vaptLibraryIds = isPlanMode || isHypothesisMode
    ? VaptSkillLibrary.selectForHypothesis(userMessage)
    : profile.key === "agent" && contextRoute.promptDepth === "cyber"
      ? VaptSkillLibrary.selectForAgent(userMessage, { active: contextRoute.cyberCapabilities.includes("active") })
      : [];
  const specializedGuidance = [
    loadWorkspaceGuidance(workspace, { globalRoot: globalGuidanceRoot }),
    CyberLibrary.renderLibraries(cyberLibraryIds),
    VaptSkillLibrary.renderLibraries(vaptLibraryIds, { includeIndex: isPlanMode }),
    contextRoute.social ? "" : ModeSkills.render(profile.id),
  ].filter(Boolean).join("\n\n");

  const systemContext = buildSystemContext({
    mode: selectedMode,
    modeFamily: profile.family,
    numCtx: effectiveContextBudget,
    // Built-in system instructions stay canonical and are not user-editable.
    // User-authored skills/rules are additive guidance appended below them.
    promptConfig: null,
    depth: contextRoute.promptDepth,
    specializedGuidance,
  });
  const untrustedContext = contextRoute.includeWorkspaceContext
    ? buildUntrustedContext({ dirMap, activeFile, extraFiles, discovery, userMessage: "", numCtx: effectiveContextBudget })
    : "";

  const baseMessages = [{ role: "system", content: systemContext }];
  const contextBuckets = { system: [baseMessages[0]], project: [], memory: [] };
  const responseRequirements = {
    role: "system",
    content: InitialPrompts.responseRequirements({ evidenceRequired: Boolean(contextRoute.responseRequirements?.evidence) }),
  };
  baseMessages.push(responseRequirements);
  contextBuckets.system.push(responseRequirements);
  const toolMenu = profile.key === "agent"
    ? InitialPrompts.toolCatalog(catalogEntries, { packs: ToolMap.LOADABLE_PACK_NAMES })
    : InitialPrompts.toolMenu(availableTools, ToolMap.TOOL_META);
  if (toolMenu) {
    const message = { role: "system", content: toolMenu };
    baseMessages.push(message);
    contextBuckets.system.push(message);
  }
  const workspaceAction = InitialPrompts.workspaceAction(editContext);
  if (workspaceAction) {
    const message = { role: "system", content: workspaceAction };
    baseMessages.push(message);
    contextBuckets.system.push(message);
  }
  const planDocumentAction = requiresPlanDocument
    ? PlanDocument.planDocumentContract({ path: planDocumentPath, userMessage, operation: planDocumentOperation })
    : "";
  if (planDocumentAction) {
    const message = { role: "system", content: planDocumentAction };
    baseMessages.push(message);
    contextBuckets.system.push(message);
  }
  if (contextRoute.includeAuthority) {
    const message = { role: "system", content: InitialPrompts.runtimeAuthority({ approvalMode: policy.authoritySuperMode || "ask", permissions: policy.authorityPermissions || {} }) };
    baseMessages.push(message);
    contextBuckets.project.push(message);
    const roeMessage = { role: "system", content: buildRoeCapabilitiesMessage(policy) };
    baseMessages.push(roeMessage);
    contextBuckets.project.push(roeMessage);
  }
  if (contextRoute.includeProjectContext || isPlanMode || isHypothesisMode) {
    const professionalContext = buildEngagementPromptContext({ workspace, projectProfile });
    if (isPlanMode || isHypothesisMode) {
      const rendered = EngagementContext.renderEngagementContext(professionalContext);
      if (rendered) {
        const message = { role: "system", content: rendered };
        baseMessages.push(message);
        contextBuckets.project.push(message);
      }
    } else {
      const message = { role: "system", content: InitialPrompts.projectSettings(professionalContext) };
      baseMessages.push(message);
      contextBuckets.project.push(message);
    }
  }
  if (untrustedContext) {
    const message = { role: "user", content: untrustedContext };
    baseMessages.push(message);
    contextBuckets.project.push(message);
  }
  const boundedMemory = clipMemorySummary(contextSummary, effectiveContextBudget);
  if (contextRoute.includeMemory && boundedMemory) {
    const message = { role: "user", content: InitialPrompts.boundedMemory(boundedMemory) };
    baseMessages.push(message);
    contextBuckets.memory.push(message);
  }

  const anchorOptions = { objectiveMessage: userMessage };
  const workingHistory = (Array.isArray(chatHistory) ? chatHistory : []).map((message) => ({ ...message }));
  const historyStart = workingHistory.length;
  const knownFiles = new Set(parseProjectFiles(dirMap || "").map(normalizeFilePath));
  const mutatedFiles = new Set();

  let noToolRetries = 0;
  let incompleteMultiFileRetries = 0;
  let verificationReminders = 0;
  let failedVerificationReminders = 0;
  let completedEdit = false;
  let planDocumentSaved = false;
  let planRetries = 0;
  let executedTools = false;
  let ranCommand = false;
  let lastVerification = null;
  let summaryMode = false;
  let finalText = "";
  let lastToolResults = [];
  let subagentWaiting = false;
  let terminalWaiting = false;
  const allActionResults = [];
  let ranActiveAction = false;
  let lastPolicyDecision = null;
  let lastContextUsage = null;
  const failedToolCalls = new Map();
  const failedToolClasses = new Map();
  const failedErrorClassesGlobal = new Map();
  const readCallsSinceMutation = new Set();
  let failureRecords = FailureMemory.pruneFailureRecords(failureMemory);
  const newFailureRecords = [];
  applyPersistedFailureRecords(failedToolCalls, failedToolClasses, failedErrorClassesGlobal, failureRecords);
  let taskBriefState = taskBrief;
  const turnWallClockStart = Date.now();
  let cumulativePromptTokens = 0;
  let cumulativeMeasuredPromptTokens = 0;
  const turnPromptTokenCeiling = promptBudgetTokens * MAX_AGENT_ROUNDS;
  const turnPromptTokenSummaryThreshold = Math.floor(turnPromptTokenCeiling * Tunables.TURN_PROMPT_TOKEN_BUDGET_RATIO);

  function finishRun(payload = {}, status = "completed") {
    const conversational = contextRoute.kind === "conversation";
    const evidenceIds = AgentRuntime.evidenceIdsFromResults(allActionResults);
    const assessmentRequested = profile.key === "agent" && /\b(?:test|scan|assess|pentest|recon|enumerat|verify|validate|probe|audit)\w*\b/i.test(String(userMessage || ""));
    const evidenceRequirement = classifyEvidenceRequirement({ profile, contextRoute, userMessage, actionResults: allActionResults, assessmentRequested });
    const gateIssues = AgentRuntime.completionIssues(runState, { assessmentRequested, activeActions: ranActiveAction, actionResults: allActionResults });
    const claimCheck = AgentRuntime.validateFinalClaims(payload.finalText || "", {
      executedTools,
      evidenceIds,
      verification: lastVerification ? { status: lastVerification.ok ? "passed" : "failed", details: lastVerification.command } : null,
      actionResults: allActionResults,
    });
    const terminalStatus = status === "completed" && (claimCheck.warnings.length || gateIssues.length) ? "inconclusive" : status;
    const claimState = terminalStatus === "inconclusive" ? "inconclusive" : lastVerification?.ok && evidenceIds.length ? "verified" : evidenceIds.length ? "observed" : "inferred";
    const showEvidenceUi = !conversational && evidenceRequirement.required;
    const claim = showEvidenceUi ? AgentRecords.claimRecord({ runId, state: claimState, text: claimCheck.text || payload.finalText || payload.error || "", evidenceIds, model, provenance: { source: "agent-final", profile: profileKey(profile) }, rationale: [...claimCheck.warnings, ...gateIssues].join(" ") }) : null;
    const operatorFeedback = showEvidenceUi ? {
      known: evidenceIds.length ? [`${evidenceIds.length} admissible evidence record(s) produced or referenced.`] : ["No new admissible evidence was produced."],
      unknown: [...runState.unknowns, ...gateIssues],
      hypothesis: runState.hypothesisId || "None recorded",
      action: runState.proposedActionId || "No action proposed",
      policy: lastPolicyDecision ? { allowed: lastPolicyDecision.allowed, code: lastPolicyDecision.code || "ALLOWED", reason: lastPolicyDecision.reason } : { allowed: true, code: "NOT_EVALUATED", reason: "No sensitive action reached policy evaluation." },
      evidence: evidenceIds,
      verification: runState.verification,
      coverage: { changed: false, limitations: runState.skippedPhases },
      limitations: [...runState.limitations, ...gateIssues],
      nextStep: terminalStatus === "inconclusive" ? "Resolve the listed evidence or completion gaps before promotion." : "Review the recorded evidence and choose the next hypothesis or retest step.",
    } : null;
    AgentRuntime.finalize(runState, { status: terminalStatus, reason: payload.error || [...claimCheck.warnings, ...gateIssues].join(" "), limitations: gateIssues });
    if (recordsRun) {
      sendEvent({ type: "run_state", runId, state: { ...runState } });
      appendAgentAction(workspace, {
        runId,
        type: "run_terminal",
        timestamp: new Date().toISOString(),
        profile: profileKey(profile),
        status: terminalStatus,
        phase: runState.phase,
        executedTools,
        completedEdit,
        evidenceIds,
        verification: runState.verification,
        stopReason: runState.stopReason,
        finalText: String(claimCheck.text || payload.error || "").slice(0, 2000),
        evidenceRequirement,
      });
      if (claim) appendAgentAction(workspace, { runId, type: "claim_record", timestamp: new Date().toISOString(), profile: profileKey(profile), claim });
    }
    return {
      ...payload,
      ok: ["completed", "waiting"].includes(status) ? payload.ok !== false : false,
      finalText: claimCheck.text || payload.finalText || "",
      runId,
      profile: profileKey(profile),
      runState,
      claimWarnings: claimCheck.warnings,
      completionIssues: gateIssues,
      claims: claim ? [claim] : [],
      operatorFeedback,
      evidenceRequirement,
      contextRoute,
      contextUsage: lastContextUsage,
      failureRecords: FailureMemory.serializeFailureRecords(FailureMemory.mergeFailureRecords(failureRecords, newFailureRecords)),
    };
  }

  for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
    try {
    if (Date.now() - turnWallClockStart > Tunables.TURN_WALL_CLOCK_MS) {
      return finishRun({ ok: false, error: "Turn wall-clock budget exceeded before the agent could finish." }, "failed");
    }
    if (cumulativeMeasuredPromptTokens >= turnPromptTokenCeiling) {
      return finishRun({ ok: false, error: "Turn prompt token budget exceeded." }, "inconclusive");
    }
    if (cumulativeMeasuredPromptTokens >= turnPromptTokenSummaryThreshold) {
      if (executedTools && !summaryMode) {
        summaryMode = true;
        sendEvent({ type: "activity", text: "Turn token budget reached; switching to summary.", kind: "meta" });
      }
    }
    const activeStatus = profile.capability === "plan" ? "Forming hypothesis..." : profile.capability === "observe" || profile.capability === "assess" ? "Analyzing..." : profile.capability === "verify" ? "Verifying..." : profile.capability === "report" ? "Reporting..." : "Working...";
    sendEvent({ type: "status", text: summaryMode ? "Summarizing..." : activeStatus });
    sendEvent({ type: "activity", text: `Round ${round + 1}: contacting ${model || "model"}...`, kind: "meta" });

    const roundsLeft = MAX_AGENT_ROUNDS - round;
    const runtimeMessages = [
      { role: "system", content: buildGrantedToolsMessage(allowedToolNames) },
      ...(roundsLeft <= Tunables.ROUNDS_LEFT_WARNING_THRESHOLD
        ? [{
            role: "system",
            content: `Runtime budget: ${roundsLeft} round${roundsLeft === 1 ? "" : "s"} remain before this turn auto-completes. Favor parallel independent calls over sequential retries; if a tool returns an errorClass, treat repeated same-class errors as a signal to change approach rather than retry.${classBlockedForToolActive(failedToolClasses, failedErrorClassesGlobal) ? " One or more tools or failure classes are now blocked (REPEATED_FAILED_CLASS); do not call them again this turn." : ""}`,
          }]
        : []),
    ];
    const summaryMessages = [
      ...(summaryMode ? [{ role: "system", content: buildPostToolSummaryPrompt({ mode: selectedMode, lastVerification }) }] : []),
      ...runtimeMessages,
    ];
    const roundTools = summaryMode ? [] : refreshAvailableTools();
    availableTools = roundTools;
    let fitted = fitMessagesToContext({
      baseMessages,
      history: workingHistory,
      summaryMessages,
      tools: roundTools,
      promptBudget: promptBudgetTokens,
      anchorOptions,
    });
    if (!fitted.ok || fitted.overflow) {
      return finishRun({ ok: false, error: `Context payload is too large for ${model || "the selected model"}. Reduce the app context budget or remove oversized workspace/tool output.` }, "failed");
    }
    if (fitted.truncated) {
      sendEvent({ type: "activity", text: "Older context was trimmed to fit the selected app budget.", kind: "meta" });
    }
    const messages = fitted.messages;
    const contextUsage = buildContextUsageSnapshot({
      buckets: contextBuckets,
      conversation: [...fitted.history, ...summaryMessages],
      tools: roundTools,
      route: contextRoute,
      contextWindow: Number(resolvedContextPlan.modelMaxTokens) || Number(resolvedContextPlan.effectiveLimitTokens) || effectiveContextBudget,
      contextPlan: resolvedContextPlan,
      model,
      round: round + 1,
    });

    let reasoningAnnounced = false;
    let toolCallObserved = false;
    let commandResponseBuffer = "";
    let commandResponseBlocked = false;
    let commandResponseCandidate = isReadOnlyChatProfile(profile);
    let commandResponseReleased = false;
    const blockedAskToolNames = new Set();
    const emitModelText = (delta) => {
      const text = String(delta || "");
      if (!text || commandResponseBlocked) return;
      if (profile.key !== "ask" && !commandResponseCandidate) {
        const leading = text.trimStart();
        const structuredStart = leading.startsWith("{") || /^```(?:json|javascript|js|text)?\b/i.test(leading);
        if (!structuredStart) {
          sendEvent({ type: "content", delta: text });
          return;
        }
        commandResponseCandidate = true;
      }
      if (commandResponseReleased) {
        sendEvent({ type: "content", delta: text });
        return;
      }
      commandResponseBuffer += text;
      if (RequestIntentRules.looksLikeCommandResponsePrefix(commandResponseBuffer)) {
        commandResponseBlocked = true;
        commandResponseBuffer = "";
        return;
      }
      if (isReadOnlyChatProfile(profile) && commandResponseBuffer.length < Tunables.COMMAND_RESPONSE_BUFFER_CHARS) return;
      if (commandResponseBuffer.length >= Tunables.COMMAND_RESPONSE_BUFFER_CHARS) {
        commandResponseReleased = true;
        sendEvent({ type: "content", delta: commandResponseBuffer });
        commandResponseBuffer = "";
      }
    };
    const result = await runModelRound({
      model,
      numCtx,
      contextPlan: resolvedContextPlan,
      maxCompletionTokens: resolvedContextPlan.responseReserveTokens,
      promptBudgetTokens,
      temperature: summaryMode ? Tunables.TEMPERATURE_SUMMARY : isReadOnlyChatProfile(profile) ? Tunables.TEMPERATURE_READ_ONLY : Tunables.TEMPERATURE_AGENT,
      thinking,
      messages,
      tools: roundTools,
      onThinking() {
        if (reasoningAnnounced) return;
        reasoningAnnounced = true;
        sendEvent({ type: "thinking" });
        sendEvent({ type: "activity", text: "Model is reasoning...", kind: "thinking" });
      },
      onToken(delta) {
        // A model may answer with prose instead of a native tool call even during
        // a mutation request. Let the text stream through normally; the post-round
        // logic treats a text-only answer as a graceful (no file changed) response
        // rather than failing the run.
        emitModelText(delta);
        return undefined;
      },
      onToolCalls(calls) {
        const resolved = resolveTools(
          calls.map((call) => ToolMap.normalizeToolCall(call)).filter(Boolean),
          editContext,
        );
        const normalized = isReadOnlyChatProfile(profile)
          ? resolved.filter((tool) => allowedToolNames.has(tool.toolName || tool.action))
          : resolved;
        if (isReadOnlyChatProfile(profile)) {
          resolved
            .filter((tool) => !allowedToolNames.has(tool.toolName || tool.action))
            .forEach((tool) => blockedAskToolNames.add(tool.toolName || tool.action));
          if (blockedAskToolNames.size) {
            sendEvent({
              type: "activity",
              text: `Read-only mode blocked non-read-only tool${blockedAskToolNames.size === 1 ? "" : "s"}: ${[...blockedAskToolNames].join(", ")}`,
              kind: "warn",
            });
          }
        }
        toolCallObserved = normalized.length > 0;
        if (normalized.length) {
          sendEvent({
            type: "activity",
            text: `Model selected ${normalized.length} tool${normalized.length === 1 ? "" : "s"}: ${normalized.map((tool) => tool.toolName || tool.action).join(", ")}`,
            kind: "tool",
          });
          sendEvent({ type: "tool_call", tools: normalized });
        }
      },
    });

    const actualPromptTokens = Number(result?.usage?.promptTokens);
    const actualCompletionTokens = Number(result?.usage?.completionTokens);
    const measured = Number.isFinite(actualPromptTokens) && actualPromptTokens >= 0;
    const resultProvider = String(result?.provider || resolvedContextPlan.provider || "ollama").toLowerCase();
    lastContextUsage = {
      ...contextUsage,
      source: measured ? resultProvider : "estimate",
      provider: resultProvider,
      model,
      promptTokens: measured ? actualPromptTokens : contextUsage.estimatedTokens,
      completionTokens: Number.isFinite(actualCompletionTokens) && actualCompletionTokens >= 0 ? actualCompletionTokens : null,
      measuredAt: new Date().toISOString(),
    };
    sendEvent({ type: "context_usage", usage: lastContextUsage });
    cumulativePromptTokens += Number(lastContextUsage.promptTokens) || 0;
    if (measured) cumulativeMeasuredPromptTokens += actualPromptTokens;

    if (result.error) {
      return finishRun({ ok: false, error: result.error }, result.aborted ? "stopped" : "failed");
    }

    const nativeToolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
    const fallbackToolCalls = !nativeToolCalls.length && editContext.requiresMutation
      ? parseStructuredToolFallback(result.fullText)
      : [];
    const effectiveToolCalls = nativeToolCalls.length ? nativeToolCalls : fallbackToolCalls;
    const usedStructuredFallback = !nativeToolCalls.length && fallbackToolCalls.length > 0;
    const rawRoundText = usedStructuredFallback ? "" : cleanAssistantText(result.fullText);
    const resolvedToolCalls = resolveTools(
      effectiveToolCalls
        .map((call) => ToolMap.normalizeToolCall(call))
        .filter(Boolean),
      editContext,
    );
    const normalizedToolCalls = resolvedToolCalls.filter((tool) => allowedToolNames.has(tool.toolName || tool.action));
    const deniedToolCalls = resolvedToolCalls.filter((tool) => !allowedToolNames.has(tool.toolName || tool.action));
    if (isReadOnlyChatProfile(profile)) {
      deniedToolCalls.forEach((tool) => blockedAskToolNames.add(tool.toolName || tool.action));
    }
    if (deniedToolCalls.length) {
      runState.deniedToolCalls = (runState.deniedToolCalls || 0) + deniedToolCalls.length;
      sendEvent({
        type: "activity",
        text: `Blocked ${deniedToolCalls.length} tool call(s) not granted for this request: ${deniedToolCalls.map((tool) => tool.toolName || tool.action).join(", ")}. Granted: ${allowedToolNames.size ? [...allowedToolNames].join(", ") : "none"}.`,
        kind: "warn",
      });
    }
    const boundaryViolation = commandResponseBlocked
      || RequestIntentRules.looksLikeCommandResponse(rawRoundText)
      || (isReadOnlyChatProfile(profile) && blockedAskToolNames.size > 0);
    if (boundaryViolation) {
      commandResponseBlocked = true;
      commandResponseBuffer = "";
      sendEvent({
        type: "activity",
        text: isReadOnlyChatProfile(profile)
          ? "Read-only mode kept this turn read-only and discarded the executable action payload."
          : "The model returned an executable action payload instead of a native tool call; nothing was run.",
        kind: "warn",
      });
    } else if (commandResponseBuffer) {
      commandResponseReleased = true;
      emitModelText(commandResponseBuffer);
      commandResponseBuffer = "";
    }
    const roundText = boundaryViolation ? actionPayloadBoundaryResponse(profile) : rawRoundText;
    const deniedOnlyRound = !normalizedToolCalls.length && deniedToolCalls.length;
    const processDeniedInline = deniedOnlyRound && !isReadOnlyChatProfile(profile);

    if (!normalizedToolCalls.length && !processDeniedInline) {
      if (
        executedTools
        && !editContext.isEditRequest
        && lastToolResults.length
        && !roundText
        && !summaryMode
        && !editContext.requiresPlanDocument
      ) {
        summaryMode = true;
        sendEvent({ type: "status", text: "Preparing the evidence-backed analysis..." });
        continue;
      }
      if (editContext.requiresPlanDocument && !planDocumentSaved && !summaryMode) {
        if (planRetries < MAX_PLAN_RETRIES_WITHOUT_FILE) {
          planRetries += 1;
          sendEvent({ type: "status", text: "Saving plan document..." });
          workingHistory.push({
            role: "user",
            content: PlanDocument.planDocumentRetry({ path: planDocumentPath, userMessage, operation: planDocumentOperation }),
          });
          continue;
        }
        return finishRun({
          ok: false,
          error: `Plan mode must ${updatesPlanDocument ? "update" : "create"} ${planDocumentPath} with ${updatesPlanDocument ? "patch_file or write_file" : "create_file"} before finishing.`,
          appendedMessages: workingHistory.slice(historyStart),
          completedEdit,
          executedTools,
        }, "failed");
      }
      if (summaryMode || (!editContext.requiresMutation && !editContext.requiresPlanDocument)) {
        finalText = roundText || summarizeToolResults(lastToolResults);
        if (finalText) {
          workingHistory.push({ role: "assistant", content: finalText });
        }
        return finishRun({
          ok: true,
          finalText,
          appendedMessages: workingHistory.slice(historyStart),
          completedEdit,
          executedTools,
        });
      }

      if (completedEdit && !summaryMode) {
        if (
          lastVerification
          && !lastVerification.ok
          && failedVerificationReminders < MAX_FAILED_VERIFICATION_REMINDERS
        ) {
          failedVerificationReminders += 1;
          sendEvent({ type: "status", text: "Repairing failed verification..." });
          workingHistory.push({
            role: "user",
            content: buildFailedVerificationReminder({ userMessage, lastVerification }),
          });
          continue;
        }
        const incompleteWorkRetry = incompleteMultiFileRetries < 1
          ? buildIncompleteMultiFileRetry({
              userMessage,
              knownFiles,
              mutatedFiles,
            })
          : "";
        if (incompleteWorkRetry) {
          incompleteMultiFileRetries += 1;
          sendEvent({ type: "status", text: "Continuing required file work..." });
          workingHistory.push({
            role: "user",
            content: incompleteWorkRetry,
          });
          continue;
        }
        if (
          verificationReminders < MAX_VERIFICATION_REMINDERS
          && shouldRequestVerification({ userMessage, mutatedFiles, ranCommand })
        ) {
          verificationReminders += 1;
          sendEvent({ type: "status", text: "Checking verification..." });
          workingHistory.push({
            role: "user",
            content: buildVerificationReminder({ userMessage, mutatedFiles }),
          });
          continue;
        }
        if (verificationReminders >= MAX_VERIFICATION_REMINDERS && roundText) {
          finalText = roundText;
          workingHistory.push({ role: "assistant", content: finalText });
          return finishRun({
            ok: true,
            finalText,
            appendedMessages: workingHistory.slice(historyStart),
            completedEdit,
            executedTools,
          });
        }
        summaryMode = true;
        continue;
      }

      if (noToolRetries < MAX_EDIT_RETRIES_WITHOUT_TOOLS) {
        noToolRetries += 1;
        sendEvent({ type: "status", text: "Retrying with tool instructions..." });
        workingHistory.push({
          role: "user",
          content: buildRetryMessage({
            targetFile: editContext.targetFile,
            userMessage,
          }),
        });
        continue;
      }

      // The model kept answering with prose instead of a native tool call. Rather
      // than failing the run (which reads as an error to the operator), surface the
      // model's answer directly so the turn completes normally without claiming a
      // file was changed.
      finalText = roundText || "No file was changed; the model answered with text instead of a workspace tool.";
      workingHistory.push({ role: "assistant", content: finalText });
      return finishRun({
        ok: true,
        finalText,
        appendedMessages: workingHistory.slice(historyStart),
        completedEdit,
        executedTools,
      });
    }

    executedTools = true;
    noToolRetries = 0;

    workingHistory.push({
      role: "assistant",
      content: roundText || "",
      tool_calls: normalizeToolCallsForApi(effectiveToolCalls),
    });

    const toolResults = [];
    for (const tool of deniedToolCalls) {
      const toolName = tool.toolName || tool.action;
      const toolResult = buildNotGrantedToolResult(tool, allowedToolNames);
      toolResults.push(toolResult);
      allActionResults.push(toolResult);
      sendEvent({ type: "tool_result", tool, result: toolResult });
      workingHistory.push({
        role: "tool",
        content: toolResultContentForModel(toolResult, effectiveContextBudget),
        tool_name: toolName || "tool",
        ...(tool.callId ? { tool_call_id: tool.callId } : {}),
      });
    }
    const toolBatches = [];
    let pendingParallelTools = [];
    for (const tool of normalizedToolCalls) {
      if (isParallelSafeTool(tool)) pendingParallelTools.push(tool);
      else {
        if (pendingParallelTools.length) toolBatches.push(pendingParallelTools);
        pendingParallelTools = [];
        toolBatches.push([tool]);
      }
    }
    if (pendingParallelTools.length) toolBatches.push(pendingParallelTools);

    let stopRun = null;
    for (const toolBatch of toolBatches) {
      const batchCancelled = { value: false };
      const batchDeferred = [];
      const reservedReadSignatures = new Set();
      const emit = (event) => {
        if (!batchCancelled.value) sendEvent(event);
      };

      // Preflight is deliberately sequential. Policy, phase, signature and
      // immutable action-id decisions must be complete before any sibling read
      // is allowed to start.
      for (const tool of toolBatch) {
        if (stopRun || batchCancelled.value) break;
        emit({ type: "tool_start", tool });
        const toolName = tool.toolName || tool.action;
        const commandPreview = tool.command || tool.args?.command || tool.args?.target || tool.args?.adapter_id || tool.file || tool.query || "";
        emit({
          type: "activity",
          text: commandPreview
            ? `Running ${toolName}: ${String(commandPreview).slice(0, 240)}`
            : `Running ${toolName}`,
          kind: "tool",
        });
        const signature = toolCallSignature(tool);
        const actionId = String(tool.callId || signature).slice(0, 160);
        const cyberAction = Boolean(ToolMap.TOOL_GROUPS?.cyber?.ALL?.includes?.(toolName));
        const commandBlock = ["run_command", "start_process"].includes(toolName)
          ? commandGuardReason(tool.command)
          : "";
        const readOnly = READ_ONLY_TOOL_NAMES.has(toolName);
        const duplicateInBatch = readOnly && reservedReadSignatures.has(signature);
        if (readOnly) reservedReadSignatures.add(signature);

        let toolResult;
        let observeResult = profile.key !== "agent";
        let memoryFailure = false;
        let phaseOperatorApproved = approvalGranted === true;
        let phaseManagedTool = false;
        const phaseOpts = { profile, operatorApproved: phaseOperatorApproved, cyberAction };

        if (profile.key === "agent" && cyberAction && runState.phase === "preflight") {
          const inventoryStep = advanceTowardPhase(runState, "inventory", {
            reason: "Runtime preflight completed before tool evaluation.",
            ...phaseOpts,
          });
          if (!inventoryStep.ok) {
            toolResult = {
              ok: false,
              error: inventoryStep.error || "Phase transition blocked.",
              errorCode: "PHASE_TRANSITION_BLOCKED",
              retryable: false,
            };
          }
        }

        if (!toolResult && profile.key === "agent" && cyberAction) {
          let phaseStep = null;
          if (toolName === "record_hypothesis") {
            phaseManagedTool = true;
            observeResult = false;
            phaseStep = advanceTowardPhase(runState, "hypothesis", {
              reason: "Hypothesis recorded via record_hypothesis tool.",
              ...phaseOpts,
            });
            if (phaseStep.ok) {
              runState.hypothesisId = String(tool.args?.id || `hyp-${runId}`).slice(0, 160);
              runState.expectedSignal = String(tool.args?.expected_signal || "").slice(0, 1200);
              runState.unknowns = [String(tool.args?.question || "").slice(0, 1200)];
            }
          } else if (toolName === "verify_finding_candidate") {
            phaseManagedTool = true;
            observeResult = false;
            phaseStep = advanceTowardPhase(runState, "verification", {
              reason: "Finding candidate entered independent verification.",
              ...phaseOpts,
            });
          } else if (toolName === "record_finding_candidate") {
            phaseManagedTool = true;
            observeResult = false;
            phaseStep = advanceTowardPhase(runState, "finding", {
              reason: "Finding candidate recorded.",
              ...phaseOpts,
            });
          } else if (runState.phase === "inventory" && readOnly) {
            phaseManagedTool = true;
            observeResult = false;
          } else {
            if (runState.phase === "hypothesis") {
              phaseStep = advanceTowardPhase(runState, "test-design", {
                reason: "The proposed action defines the smallest test for the recorded hypothesis.",
                ...phaseOpts,
              });
            } else if (!["test-design", "approval", "execution"].includes(runState.phase)) {
              phaseStep = advanceTowardPhase(runState, "execution", {
                reason: "Action requested outside the executable assessment phase.",
                ...phaseOpts,
              });
            }
            observeResult = true;
          }
          if (phaseStep && !phaseStep.ok) {
            toolResult = {
              ok: false,
              error: phaseStep.error || "Phase transition blocked.",
              errorCode: "PHASE_TRANSITION_BLOCKED",
              retryable: false,
            };
          }
        } else if (!toolResult && toolName === "record_hypothesis") {
          const phaseStep = advanceTowardPhase(runState, "hypothesis", {
            reason: "Hypothesis recorded via record_hypothesis tool.",
            profile,
            cyberAction,
          });
          if (!phaseStep.ok) {
            toolResult = { ok: false, error: phaseStep.error || "Phase transition blocked.", errorCode: phaseStep.code || "PHASE_TRANSITION_BLOCKED", retryable: false };
          } else {
            runState.hypothesisId = String(tool.args?.id || `hyp-${runId}`).slice(0, 160);
            runState.expectedSignal = String(tool.args?.expected_signal || "").slice(0, 1200);
            runState.unknowns = [String(tool.args?.question || "").slice(0, 1200)];
          }
        } else if (!toolResult && toolName === "record_finding_candidate") {
          const phaseStep = advanceTowardPhase(runState, "finding", {
            reason: "Finding candidate recorded.",
            profile,
            cyberAction,
          });
          if (!phaseStep.ok) toolResult = { ok: false, error: phaseStep.error || "Phase transition blocked.", errorCode: phaseStep.code || "PHASE_TRANSITION_BLOCKED", retryable: false };
        }

        appendAgentAction(workspace, {
          runId,
          type: "decision_record",
          timestamp: new Date().toISOString(),
          profile: profileKey(profile),
          phase: runState.phase,
          objective: runState.objective,
          knownFacts: runState.knownFacts,
          unknowns: runState.unknowns,
          hypothesisId: runState.hypothesisId,
          proposedActionId: actionId,
          expectedSignal: runState.expectedSignal,
          completionGate: runState.completionGate,
          nextState: "approval",
        });

        let policyDecision = evaluateAction({ tool, profile, policy, approvalGranted });
        lastPolicyDecision = policyDecision;
        if (policyDecision.active) ranActiveAction = true;
        emit({ type: "action_policy", runId, tool, decision: policyDecision });
        if (!policyDecision.allowed && policyDecision.requiresApproval && typeof requestApproval === "function") {
          const target = String(tool.args?.target || tool.target || tool.url || "");
          const approval = await awaitWithTimeout(
            requestApproval({
              runId,
              actionId,
              target,
              capability: policyDecision.capability,
              risk: policyDecision.risk,
              tool: toolName,
              reason: policyDecision.reason,
              expiresInMs: Tunables.APPROVAL_TIMEOUT_MS,
            }),
            Tunables.APPROVAL_TIMEOUT_MS,
            () => ({ approved: false, expired: true }),
          );
          if (approval?.approved) {
            const token = { actionId, target, capability: policyDecision.capability, risk: policyDecision.risk, expiresAt: approval.expiresAt || new Date(Date.now() + 60_000).toISOString() };
            policyDecision = evaluateAction({ tool, profile, policy, approvalGranted: token });
            phaseOperatorApproved = Boolean(policyDecision.allowed);
            lastPolicyDecision = policyDecision;
            emit({ type: "action_policy", runId, tool, decision: policyDecision, approval: "action-bound" });
          }
        }
        if (policyDecision.requiresApproval || approvalGranted) {
          appendAgentApproval(workspace, {
            runId,
            timestamp: new Date().toISOString(),
            operator: "local-user",
            profile: profileKey(profile),
            actionId,
            tool: toolName,
            target: String(tool.args?.target || tool.target || tool.url || tool.file || "workspace"),
            capability: policyDecision.capability,
            risk: policyDecision.risk,
            decision: policyDecision.allowed ? "approved" : "blocked",
            reason: policyDecision.reason,
            scope: policy.scopeReviewed ? "reviewed" : "unreviewed",
            expiresAt: policy.authorizationExpiresAt || "",
          });
        }
        appendAgentAction(workspace, {
          runId,
          type: "action_proposed",
          timestamp: new Date().toISOString(),
          profile: profileKey(profile),
          actionId,
          tool: toolName,
          target: tool.file || tool.query || tool.url || tool.command || tool.processId || "workspace",
          risk: policyDecision.risk,
          capability: policyDecision.capability,
          allowed: policyDecision.allowed,
          requiresApproval: policyDecision.requiresApproval,
          reason: policyDecision.reason,
        });

        if (!toolResult && !phaseManagedTool) {
          if (profile.key === "agent" && cyberAction && runState.phase === "test-design") {
            const approvalStep = advanceTowardPhase(runState, "approval", {
              reason: "Runtime policy evaluated the proposed action.",
              ...phaseOpts,
            });
            if (!approvalStep.ok) {
              toolResult = { ok: false, error: approvalStep.error || "Phase transition blocked.", errorCode: "PHASE_TRANSITION_BLOCKED", retryable: false };
            }
          }
          if (!toolResult && (cyberAction || profile.key !== "agent")) {
            const phaseTarget = policyDecision.allowed ? "execution" : "approval";
            const phaseStep = advanceTowardPhase(runState, phaseTarget, {
              reason: "Action evaluated by runtime policy.",
              ...phaseOpts,
              operatorApproved: phaseOperatorApproved,
            });
            if (!phaseStep.ok) {
              toolResult = { ok: false, error: phaseStep.error || "Phase transition blocked.", errorCode: phaseStep.code || "PHASE_TRANSITION_BLOCKED", retryable: false };
            }
          }
        }

        runState.proposedActionId = actionId;
        if (!runState.actionIds.includes(actionId)) runState.actionIds.push(actionId);
        emit({ type: "run_state", runId, state: { ...runState }, policyDecision });

        if (!toolResult) {
          if (!allowedToolNames.has(toolName)) {
            toolResult = {
              ok: false,
              error: `${toolName} is not allowed in ${selectedMode} mode.`,
              errorCode: "MODE_GUARD",
              retryable: false,
            };
          } else if (!loadedSchemaNames.has(toolName) && toolName !== "load_tool_schemas") {
            loadedSchemaNames.add(toolName);
            availableTools = refreshAvailableTools();
            toolResult = {
              ok: false,
              error: `${toolName} was catalog-only. Its schema is now loaded for the next turn — call it again with valid arguments (or call load_tool_schemas for a whole pack first).`,
              errorCode: "SCHEMA_NOT_LOADED",
              errorClass: "retryable",
              retryable: true,
              loaded: [toolName],
            };
          } else if (["write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"].includes(toolName) && isProtectedAssessmentPath(tool.file || tool.args?.path || "")) {
            toolResult = {
              ok: false,
              error: "Protected assessment records may be changed only through typed evidence, hypothesis, finding, coverage, settings, traffic, run, or Map adapters.",
              errorCode: "TYPED_ASSESSMENT_MUTATION_REQUIRED",
              retryable: false,
            };
          } else if (toolName === "delete_file" && !EXPLICIT_DELETE_RE.test(String(userMessage || ""))) {
            toolResult = {
              ok: false,
              error: "Delete blocked because the user did not explicitly request deletion.",
              errorCode: "DELETE_GUARD",
              retryable: false,
            };
          } else if (commandBlock) {
            toolResult = {
              ok: false,
              error: commandBlock,
              errorCode: "COMMAND_GUARD",
              retryable: false,
            };
          } else if (!policyDecision.allowed) {
            toolResult = {
              ok: false,
              error: policyDecision.reason,
              errorCode: policyDecision.code || "POLICY_BLOCK",
              retryable: false,
              policy: policyDecision,
            };
          } else if (duplicateInBatch || (readOnly && readCallsSinceMutation.has(signature))) {
            toolResult = {
              ok: false,
              error: "Repeated unchanged read/discovery call blocked. Use the existing result or narrow the next query.",
              errorCode: "REDUNDANT_READ",
              errorClass: "retry_exhausted",
              retryable: false,
            };
          } else if ((failedToolCalls.get(signature) || 0) >= 1) {
            const priorFailure = failedToolClasses.get(signature);
            toolResult = {
              ok: false,
              error: "Repeated identical failed tool call blocked. Change the arguments or use a different discovery step.",
              errorCode: "REPEATED_FAILED_CALL",
              errorClass: priorFailure?.errorClass || "retry_exhausted",
              retryable: false,
            };
            memoryFailure = true;
          } else if (classBlockedForTool(signature, failedToolClasses)) {
            const rec = failedToolClasses.get(signature);
            toolResult = {
              ok: false,
              error: `Repeated ${rec.errorClass} failure on ${toolName} (${rec.count} prior). Stop retrying this class of call and adapt: check list_datasets, narrow scope to an in-scope target, or switch to an allowed evidence channel.`,
              errorCode: "REPEATED_FAILED_CLASS",
              errorClass: rec.errorClass,
              retryable: false,
            };
          } else if (toolName === "ingest_assessment_records" && classBlockedGlobally("not_found_or_schema", failedErrorClassesGlobal)) {
            toolResult = {
              ok: false,
              error: "Repeated not_found_or_schema failures across ingest attempts. Call list_datasets, confirm the resource name and schema, then ingest only to provisioned or auto-provisionable datasets.",
              errorCode: "REPEATED_FAILED_CLASS",
              errorClass: "not_found_or_schema",
              retryable: false,
            };
          }
        }

        if (!toolResult) {
          if (toolName === "verify_finding_candidate") tool.args = { ...(tool.args || {}), model };
          if (toolName === "run_traffsucker") {
            tool.args = {
              ...(tool.args || {}),
              model: String(tool.args?.model || subagentModel || "").trim(),
            };
            const resolution = await ScopeEngine.resolveTargetAddresses(tool.args.target);
            if (!resolution.ok) {
              toolResult = { ok: false, error: resolution.reason, errorCode: resolution.code, retryable: false, scope: resolution };
            } else {
              tool.args.resolution_addresses = resolution.addresses;
            }
          }
          if (toolName === "run_security_tool") {
            tool.args = {
              ...(tool.args || {}),
              configuration: {
                ...(tool.args?.configuration || {}),
                rateLimit: Math.min(Number(tool.args?.configuration?.rateLimit || tool.args?.configuration?.rate_limit) || policy.maxRequestsPerSecond, policy.maxRequestsPerSecond),
                concurrency: Math.min(Number(tool.args?.configuration?.concurrency) || policy.maxConcurrency, policy.maxConcurrency),
                timeoutMs: Math.min(Number(tool.args?.configuration?.timeoutMs || tool.args?.configuration?.timeout_ms) || policy.requestTimeoutSeconds * 1000, policy.requestTimeoutSeconds * 1000),
              },
            };
            const resolution = await ScopeEngine.resolveTargetAddresses(tool.args.target);
            if (!resolution.ok) {
              toolResult = { ok: false, error: resolution.reason, errorCode: resolution.code, retryable: false, scope: resolution };
            } else {
              tool.args.resolution_addresses = resolution.addresses;
            }
          }
        }

        batchDeferred.push({
          tool,
          toolName,
          signature,
          actionId,
          toolResult,
          observeResult,
          memoryFailure,
          executed: false,
        });
      }

      const abortController = typeof AbortController === "function" ? new AbortController() : null;
      const settled = await Promise.allSettled(batchDeferred.map(async (entry) => {
        if (entry.toolResult) return entry.toolResult;
        entry.executed = true;
        entry.memoryFailure = true;
        const executionTool = buildToolCallForExecution(entry.tool);
        if ((entry.toolName || entry.tool?.toolName) === "load_tool_schemas") {
          executionTool.function = executionTool.function || {};
          const rawArgs = ToolMap.parseArguments(executionTool.function.arguments);
          executionTool.function.arguments = {
            ...(rawArgs && typeof rawArgs === "object" ? rawArgs : {}),
            __allowedNames: [...allowedToolNames],
          };
        }
        const result = await executeToolCall({
          workspace,
          toolCall: executionTool,
          signal: abortController?.signal,
        });
        if (evaluateStopConditions(result, policy).stop) abortController?.abort();
        return result;
      }));
      settled.forEach((outcome, index) => {
        const entry = batchDeferred[index];
        if (outcome.status === "fulfilled") {
          entry.toolResult = outcome.value;
          return;
        }
        entry.executed = true;
        entry.memoryFailure = true;
        entry.toolResult = {
          ok: false,
          error: String(outcome.reason?.message || outcome.reason || "Tool execution failed unexpectedly."),
          errorCode: "TOOL_EXECUTION_FAILED",
          errorClass: "transient",
          retryable: false,
        };
      });

      for (let batchIndex = 0; batchIndex < batchDeferred.length; batchIndex += 1) {
        const deferred = batchDeferred[batchIndex];
        if (!deferred) continue;
        if (stopRun) break;
        const {
          tool,
          toolName,
          signature,
          actionId,
          toolResult,
          observeResult,
          memoryFailure,
          executed,
        } = deferred;
        toolResults.push(toolResult);
        allActionResults.push(toolResult);
        appendAgentAction(workspace, {
          runId,
          type: "action_result",
          timestamp: new Date().toISOString(),
          profile: profileKey(profile),
          actionId,
          tool: toolName,
          ok: Boolean(toolResult?.ok && !toolResult?.error),
          errorCode: toolResult?.errorCode || "",
          error: toolResult?.error || "",
          output: toolResult?.file || toolResult?.command || toolResult?.mode || "",
        });
        const toolOutput = String(toolResult?.content || toolResult?.stdout || toolResult?.stderr || toolResult?.summary || toolResult?.error || "");
        appendToolOutput(workspace, {
          runId,
          timestamp: new Date().toISOString(),
          tool: toolName,
          command: tool.command || "",
          target: tool.file || tool.url || tool.query || "",
          exitCode: Number.isFinite(Number(toolResult?.exitCode)) ? Number(toolResult.exitCode) : null,
          outputPath: toolResult?.file || "",
          sha256: crypto.createHash("sha256").update(toolOutput, "utf8").digest("hex"),
          redacted: true,
          truncated: toolOutput.length > 12000,
        });
        emit({ type: "tool_result", tool, result: toolResult });
        if (toolName === "load_tool_schemas" && Array.isArray(toolResult?.loaded)) {
          for (const name of toolResult.loaded) {
            if (allowedToolNames.has(name)) loadedSchemaNames.add(name);
          }
          availableTools = refreshAvailableTools();
          sendEvent({
            type: "activity",
            text: `Loaded schemas (${toolResult.loaded.length}): ${toolResult.loaded.join(", ")}. Hot set now ${availableTools.length}.`,
            kind: "meta",
          });
        } else if (toolResult?.errorCode === "SCHEMA_NOT_LOADED" && Array.isArray(toolResult?.loaded)) {
          availableTools = refreshAvailableTools();
        }
        if (executed && observeResult) {
          const observationStep = advanceTowardPhase(runState, "observation", { reason: "Tool result recorded.", profile });
          if (!observationStep.ok && profile.key === "agent") {
            stopRun = { payload: { ok: false, error: observationStep.error || "Phase transition blocked." }, status: "failed" };
            break;
          }
        }
        AgentRuntime.noteAction(runState, { actionId, ok: Boolean(toolResult?.ok && !toolResult?.error), evidenceIds: AgentRuntime.evidenceIdsFromResults([toolResult]) });
        emit({ type: "run_state", runId, state: { ...runState } });
        const stopDecision = evaluateStopConditions(toolResult, policy);
        if (stopDecision.stop) {
          batchCancelled.value = true;
          lastToolResults = [...toolResults];
          appendAgentAction(workspace, { runId, type: "stop_condition", timestamp: new Date().toISOString(), profile: profileKey(profile), tool: toolName, target: tool.args?.target || tool.url || "", ok: false, stopConditions: stopDecision.triggered });
          stopRun = { payload: { ok: false, error: `Run stopped: ${stopDecision.triggered.join(", ")}` }, status: "stopped" };
          break;
        }

        if ((toolResult?.ok === false || toolResult?.error) && memoryFailure) {
          failedToolCalls.set(signature, (failedToolCalls.get(signature) || 0) + 1);
          const errorClass = deriveErrorClass(toolResult);
          const prior = failedToolClasses.get(signature);
          const next = prior && prior.errorClass === errorClass ? { errorClass, count: prior.count + 1 } : { errorClass, count: 1 };
          failedToolClasses.set(signature, next);
          failedErrorClassesGlobal.set(errorClass, (failedErrorClassesGlobal.get(errorClass) || 0) + 1);
          const failureRecord = recordFailureMemoryEntry(failedToolClasses, toolName, signature, errorClass);
          if (failureRecord) newFailureRecords.push(failureRecord);
        } else if (executed && toolResult?.ok && !toolResult?.error) {
          failedToolCalls.delete(signature);
          failedToolClasses.delete(signature);
          if (toolName === "list_datasets" || toolName === "get_map_overview") {
            failedErrorClassesGlobal.delete("not_found_or_schema");
            failedErrorClassesGlobal.delete("map_not_built");
          }
          if (READ_ONLY_TOOL_NAMES.has(toolName)) readCallsSinceMutation.add(signature);
        }

      if (toolResult?.ok && toolResult.mutated) {
        completedEdit = true;
        readCallsSinceMutation.clear();
        if (requiresPlanDocument && PlanDocument.PLAN_MUTATION_TOOLS.includes(toolName)) {
          const savedPlan = normalizeFilePath(toolResult?.file || tool.file || "");
          const expectedPlan = normalizeFilePath(planDocumentPath);
          const validOperationTool = updatesPlanDocument
            ? PlanDocument.PLAN_UPDATE_TOOLS.includes(toolName)
            : toolName === PlanDocument.PLAN_CREATE_TOOL;
          if (validOperationTool && isPlanFilePath(savedPlan) && savedPlan.toLowerCase() === expectedPlan.toLowerCase()) {
            planDocumentSaved = true;
            summaryMode = true;
          }
        }
      }
      if ((toolResult?.mode === "command" || tool.action === "run_command") && toolResult?.mode !== "terminal_wait") {
        ranCommand = true;
        lastVerification = {
          command: toolResult?.command || tool.command || "run_command",
          ok: Boolean(
            toolResult?.ok
            && !toolResult?.error
            && !toolResult?.timedOut
            && Number(toolResult?.exitCode ?? 0) === 0
          ),
        };
        advanceTowardPhase(runState, "verification", { reason: "Command verification completed.", profile });
        runState.verification = { status: lastVerification.ok ? "passed" : "failed", details: lastVerification.command };
        emit({ type: "run_state", runId, state: { ...runState } });
      }

      if (toolResult?.mode === "subagent_wait" && toolResult?.subagentId) {
        // traffsucker has been launched as a background subagent. The main agent
        // should conclude its turn ("waiting for subagent to finish") and the
        // harness will notify it when the subagent completes.
        runState.substate = "waiting";
        runState.subagentId = toolResult.subagentId;
        runState.waitId = toolResult.waitId || toolResult.subagentId;
        subagentWaiting = true;
        emit({ type: "run_state", runId, state: { ...runState } });
        sendEvent({ type: "status", text: `Waiting for traffsucker subagent ${toolResult.subagentId} to finish...` });
      }

      if (toolResult?.mode === "terminal_wait" && (toolResult?.waitId || toolResult?.processId || toolResult?.terminalId)) {
        runState.substate = "waiting";
        runState.waitId = toolResult.waitId || toolResult.processId || toolResult.terminalId;
        runState.terminalId = toolResult.terminalId || "";
        runState.processId = toolResult.processId || "";
        terminalWaiting = true;
        emit({ type: "run_state", runId, state: { ...runState } });
        sendEvent({
          type: "status",
          text: `Waiting for terminal ${toolResult.terminalId || toolResult.processId || toolResult.waitId} to finish...`,
        });
      }

      const touchedFile = normalizeFilePath(toolResult?.file || tool.file || "");
      if (toolResult?.ok && touchedFile) {
        if (toolResult.mode === "delete") {
          knownFiles.delete(touchedFile);
          mutatedFiles.delete(touchedFile);
        } else {
          knownFiles.add(touchedFile);
          if (toolResult.mutated) mutatedFiles.add(touchedFile);
        }
      }

      workingHistory.push({
        role: "tool",
        content: toolResultContentForModel(toolResult, effectiveContextBudget),
        tool_name: tool.toolName || tool.action || "tool",
        ...(tool.callId ? { tool_call_id: tool.callId } : {}),
      });

      if (
        toolName === "request_operator_questions"
        && toolResult?.ok
        && !toolResult?.error
        && typeof requestQuestions === "function"
      ) {
        runState.substate = "clarification";
        emit({ type: "run_state", runId, state: { ...runState } });
        sendEvent({ type: "status", text: "Waiting for operator answers..." });
        const normalized = OperatorQuestions.normalizeQuestions(tool.args?.questions || []);
        const questionsForUi = normalized.questions || [];
        const response = await requestQuestions({
          runId,
          workspace,
          requestId: toolResult.requestId,
          file: toolResult.file,
          reason: tool.args?.reason || "",
          questions: questionsForUi,
          expiresInMs: Tunables.OPERATOR_QUESTIONS_TIMEOUT_MS,
        });
        const baseDocument = OperatorQuestions.buildDocument({
          reason: tool.args?.reason || "",
          topic: tool.args?.topic || "",
          requestId: toolResult.requestId,
          questions: questionsForUi,
        });
        const updatedDocument = OperatorQuestions.applyAnswers(
          baseDocument,
          response?.answers || [],
          { skipped: response?.skipped, expired: response?.expired },
        );
        toolResult.summary = updatedDocument.status === "answered"
          ? `Operator answered ${(response?.answers || []).length} question(s).`
          : "Operator skipped or did not answer before timeout.";
        const clarificationMessage = updatedDocument.status === "answered"
          ? OperatorQuestions.formatAnswersForModel(updatedDocument)
          : OperatorQuestions.formatSkippedForModel(updatedDocument);
        workingHistory.push({ role: "user", content: clarificationMessage });
        runState.substate = "";
        if (profile.key !== "agent") {
          advanceTowardPhase(runState, "observation", { reason: "Operator clarification resolved.", profile });
        }
        emit({ type: "run_state", runId, state: { ...runState } });
        sendEvent({
          type: "status",
          text: updatedDocument.status === "answered" ? "Operator answers received" : "Continuing without answers",
        });
      }
      }
    }
    if (stopRun) return finishRun(stopRun.payload, stopRun.status);

    if (subagentWaiting || terminalWaiting) {
      break;
    }
    lastToolResults = toolResults;
    taskBriefState = updateTaskBriefProgress(taskBriefState, { executedTools, completedEdit, planDocumentSaved, round });
    if (taskBriefState && round >= Tunables.TASK_BRIEF_UPDATE_AFTER_ROUND) {
      sendEvent({ type: "task_brief", runId, brief: taskBriefState });
    }
    if (requiresPlanDocument && planDocumentSaved) {
      summaryMode = true;
    } else {
      summaryMode = false;
    }
    } catch (error) {
      return finishRun({ ok: false, error: String(error?.message || error || "Agent turn failed unexpectedly.") }, "failed");
    }
  }

  finalText = subagentWaiting
    ? "Waiting for the traffsucker subagent to finish. I will summarize results when it completes."
    : terminalWaiting
      ? "Waiting for the terminal command to finish. I will continue when the harness resumes this turn with the transcript."
    : (summarizeToolResults(lastToolResults) || "Completed the requested workspace actions.");
  workingHistory.push({ role: "assistant", content: finalText });
  return finishRun({
    ok: true,
    finalText,
    appendedMessages: workingHistory.slice(historyStart),
    completedEdit,
    executedTools,
  }, (subagentWaiting || terminalWaiting) ? "waiting" : "inconclusive");
}

module.exports = {
  MAX_AGENT_ROUNDS,
  READ_ONLY_TOOL_NAMES,
  buildTaskBrief,
  buildEngagementPromptContext,
  commandGuardReason,
  classifyEvidenceRequirement,
  filterToolsForMode,
  filterToolsForRoute,
  fitMessagesToContext,
  isProtectedAssessmentPath,
  advanceTowardPhase,
  awaitWithTimeout,
  runAgentTurn,
  trimHistoryForContext,
  selectHistoryGroups,
  isAnchorHistoryGroup,
  toolCallSignature,
};
