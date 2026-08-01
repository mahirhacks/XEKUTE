const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ToolMap = require("../harness/core/tool-map");
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
const { evaluateAction, evaluateStopConditions, loadPolicy } = require("./policy/policy-engine");
const ScopeEngine = require("../domain/assessment/scope-engine");
const { appendAgentAction, appendAgentApproval, appendAgentRun, appendToolOutput } = require("./memory/action-log");
const AgentRuntime = require("./runtime");
const AgentRecords = require("./memory/records");
const InitialPrompts = require("../prompts/instructs/initial_prompt");
const DecisionSupport = require("../prompts/skills/decision-support");
const CommandGuardrails = require("../prompts/guardrail/command-guardrails");
const { redactSecrets } = require("../prompts/guardrail/data-guardrails");
const RequestIntentRules = require("../prompts/rules/request-intent-rules");
const ContextRouter = require("../prompts/skills/context-router");
const CyberLibrary = require("../prompts/skills/cyber-library");
const { loadWorkspaceGuidance } = require("./instructions/custom-guidance");

function readWorkspaceJson(workspace, relativePath) {
  if (!workspace) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(path.resolve(workspace), relativePath), "utf8"));
  } catch {
    return null;
  }
}

function buildEngagementPromptContext({ workspace = null, projectProfile = null } = {}) {
  const profile = projectProfile && typeof projectProfile === "object" ? projectProfile : {};
  const context = {
    project: { ...(profile.project || {}) },
    engagement: { ...(profile.engagement || {}) },
    authorization: { ...(profile.authorization || {}) },
    contacts: { ...(profile.contacts || {}) },
    scope: {
      inScopeTargets: Array.isArray(profile.scope?.inScopeTargets) ? [...profile.scope.inScopeTargets] : [],
      outOfScopeTargets: Array.isArray(profile.scope?.outOfScopeTargets) ? [...profile.scope.outOfScopeTargets] : [],
      wildcardRules: Array.isArray(profile.scope?.wildcardRules) ? [...profile.scope.wildcardRules] : [],
      thirdPartyAssets: Array.isArray(profile.scope?.thirdPartyAssets) ? [...profile.scope.thirdPartyAssets] : [],
      notes: String(profile.scope?.notes || ""),
    },
    rulesOfEngagement: { ...(profile.rulesOfEngagement || {}) },
    review: { ...(profile.review || {}) },
    dataHandling: { ...(profile.dataHandling || {}) },
    context: { ...(profile.context || {}) },
  };

  const inScope = readWorkspaceJson(workspace, "scope/in-scope.json");
  const outScope = readWorkspaceJson(workspace, "scope/out-of-scope.json");
  const engagement = readWorkspaceJson(workspace, "scope/engagement.json");
  const configurations = readWorkspaceJson(workspace, "scope/configurations.json");

  if (inScope?.engagement) Object.assign(context.engagement, inScope.engagement);
  if (inScope?.authorization) Object.assign(context.authorization, inScope.authorization);
  if (inScope?.rulesOfEngagement) Object.assign(context.rulesOfEngagement, inScope.rulesOfEngagement);
  if (Array.isArray(inScope?.targets) && inScope.targets.length) context.scope.inScopeTargets = inScope.targets;
  if (Array.isArray(inScope?.wildcardRules) && inScope.wildcardRules.length) context.scope.wildcardRules = inScope.wildcardRules;
  if (inScope?.notes) context.scope.notes = inScope.notes;

  if (outScope) {
    if (Array.isArray(outScope.assets) && outScope.assets.length) context.scope.outOfScopeTargets = outScope.assets;
    if (Array.isArray(outScope.thirdPartyAssets) && outScope.thirdPartyAssets.length) {
      context.scope.thirdPartyAssets = outScope.thirdPartyAssets;
    }
    if (Array.isArray(outScope.prohibitedActions) && outScope.prohibitedActions.length) {
      context.rulesOfEngagement.prohibitedActions = outScope.prohibitedActions;
    }
  }

  if (engagement?.engagement) Object.assign(context.engagement, engagement.engagement);
  if (engagement?.authorization) Object.assign(context.authorization, engagement.authorization);
  if (engagement?.scopeReview) {
    context.review = {
      ...context.review,
      scopeReviewed: Boolean(engagement.scopeReview.reviewed),
      exclusionsConfirmed: Boolean(engagement.scopeReview.exclusionsConfirmed),
      reviewedBy: engagement.scopeReview.reviewedBy || context.review.reviewedBy || "",
      reviewedAt: engagement.scopeReview.reviewedAt || context.review.reviewedAt || "",
    };
  }
  if (engagement?.rulesOfEngagement) Object.assign(context.rulesOfEngagement, engagement.rulesOfEngagement);

  if (configurations?.operator) {
    context.contacts = {
      ...context.contacts,
      primary: configurations.operator.contact || context.contacts.primary || "",
    };
  }
  if (configurations?.authorizationGate) {
    context.review = {
      ...context.review,
      scopeReviewed: Boolean(configurations.authorizationGate.scopeReviewed),
      rulesAccepted: Boolean(configurations.authorizationGate.rulesAccepted),
    };
    context.authorization = {
      ...context.authorization,
      confirmed: Boolean(configurations.authorizationGate.authorizationConfirmed),
    };
  }

  return context;
}

const MAX_AGENT_ROUNDS = 10;
const MAX_EDIT_RETRIES_WITHOUT_TOOLS = 1;
const MAX_VERIFICATION_REMINDERS = 1;
const MAX_FAILED_VERIFICATION_REMINDERS = 1;
const {
  MULTI_FILE_WEB_REQUEST_RE,
  MUTATION_REQUEST_RE,
  FILE_PATH_RE,
  SKIP_VERIFICATION_RE,
  VERIFICATION_FILE_RE,
  EXPLICIT_DELETE_RE,
} = RequestIntentRules;
const { PROTECTED_ASSESSMENT_PATH_RE } = CommandGuardrails;
const FILE_COUNT_WORDS = new Map(Object.entries(RequestIntentRules.FILE_COUNT_WORDS));
const READ_ONLY_TOOL_NAMES = new Set(ToolMap.MODE_TOOL_GROUPS.ask);
const ASK_MODE_BOUNDARY_RESPONSE = "Ask mode is read-only. I won't turn a confirmation into a shell or HTTP command or run reconnaissance here. I can explain the approach or use the available read-only discovery/research tools; switch to Agent/Testing Agent for an authorized action.";
const SAFE_AGENT_BOUNDARY_RESPONSE = "I stopped this turn because the model returned a raw command instead of a native workspace tool. No command was run. Safe Agent can perform only routed workspace actions; external security testing belongs in Testing Agent with approved scope.";
const TEST_AGENT_BOUNDARY_RESPONSE = "I stopped this turn because the model returned a raw shell command instead of a typed security tool. No command was run. Testing Agent actions must use an approved adapter with reviewed scope, a hypothesis, and policy approval.";
const PLANNER_BOUNDARY_RESPONSE = "Planner mode does not execute commands. I stopped the raw action payload; no command was run. I can turn this into a plan or save a plan document.";

function buildTaskBrief({ profile, contextRoute = {}, editContext = {}, availableTools = [], userMessage = "" } = {}) {
  if (!profile || contextRoute.kind === "conversation") return null;

  const isTestingAgent = profile.family === "testing" && profile.key === "agent";
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
      label: "Build a grounded plan",
      detail: "Turn the available evidence into ordered steps, assumptions, and stop conditions.",
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
    title: isPlan ? "Here’s the plan" : "Here’s how I’ll handle this",
    summary: isTestingAgent
      ? "I’ll keep the work scoped, evidence-backed, and approval-aware."
      : isMutation
        ? "I’ll inspect the current state, make a focused change, and verify the result."
        : "I’ll gather the relevant context first, then show the result and any limits.",
    steps,
    transparency: [
      { label: "Profile", value: profileKey(profile) },
      { label: "Route", value: contextRoute.reason || contextRoute.kind || "request" },
      { label: "Tools", value: toolNames.length ? toolNames.join(", ") : "No tools routed" },
      ...(targetFile ? [{ label: "Target", value: targetFile }] : []),
    ],
    objective: String(userMessage || "").trim().slice(0, 240),
  };
}

function filterToolsForMode(tools, mode, modeFamily = "assist") {
  const profile = normalizeProfile(modeFamily, mode);
  return ToolMap.toolsForProfile(profile, undefined, tools);
}

function filterToolsForRoute(tools, route = {}) {
  return ToolMap.toolsForRoute(tools, route);
}

function messageSize(message) {
  return String(message?.content || "").length + JSON.stringify(message?.tool_calls || []).length + 32;
}

function estimateTokenCount(text) {
  if (!text) return 0;
  const value = String(text);
  const cjk = (value.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const pieces = value.match(/[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) || [];
  const symbols = (value.match(/[{}()[\].,;:+\-*/=<>"'`|&!?]/g) || []).length * 0.15;
  const lines = (value.match(/\n/g) || []).length * 0.35;
  return Math.max(1, Math.ceil(cjk + (pieces.length - cjk) * 1.05 + symbols + lines));
}

function estimateMessagesTokens(messages = []) {
  return (Array.isArray(messages) ? messages : []).reduce((sum, message) => {
    let count = estimateTokenCount(message?.content || "") + 4;
    if (message?.tool_calls?.length) count += estimateTokenCount(JSON.stringify(message.tool_calls));
    if (message?.tool_name) count += estimateTokenCount(message.tool_name) + 2;
    return sum + count;
  }, 0);
}

function buildContextUsageSnapshot({ buckets, conversation, tools, route, contextWindow, round }) {
  const sections = [
    { key: "system", label: "System instructions", color: "#a7a7ab", tokens: estimateMessagesTokens(buckets.system) },
    { key: "project", label: "Project & authority", color: "#4cb27a", tokens: estimateMessagesTokens(buckets.project) },
    { key: "memory", label: "Saved memory", color: "#d58dbc", tokens: estimateMessagesTokens(buckets.memory) },
    { key: "conversation", label: "Conversation & results", color: "#7ea9d8", tokens: estimateMessagesTokens(conversation) },
    { key: "tools", label: "Routed tool definitions", color: "#a879d6", tokens: tools?.length ? estimateTokenCount(JSON.stringify(tools)) : 0 },
  ];
  const estimatedTokens = sections.reduce((sum, section) => sum + section.tokens, 0);
  return {
    version: 1,
    source: "estimate",
    promptTokens: estimatedTokens,
    completionTokens: null,
    contextWindow: Number(contextWindow) || null,
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

function trimHistoryForContext(history, numCtx) {
  const tokenBudget = Number.isFinite(Number(numCtx)) ? Number(numCtx) : 8192;
  const maxChars = Math.max(3600, Math.min(28000, Math.floor(tokenBudget * 1.25)));
  const groups = groupHistoryMessages(history);
  const kept = [];
  let used = 0;

  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    const size = group.reduce((sum, message) => sum + messageSize(message), 0);
    if (kept.length && used + size > maxChars) break;
    kept.unshift(group);
    used += size;
  }

  const flattened = kept.flat();
  while (flattened[0]?.role === "tool") flattened.shift();
  return flattened;
}

function clipMemorySummary(summary, numCtx) {
  const maxChars = contextLimits(numCtx).memoryChars;
  const value = String(summary || "").trim();
  if (value.length <= maxChars) return value;
  return `... older memory omitted ...\n${value.slice(-maxChars)}`;
}

function toolCallSignature(tool) {
  return `${tool?.toolName || tool?.action || "unknown"}:${JSON.stringify(tool?.args || {})}`;
}

function commandGuardReason(command) {
  return CommandGuardrails.commandGuardReason(command, { isSecurityCommand: ToolMap.TOOL_GROUPS.cyber.isSecurityCommand });
}

function toolResultContentForModel(result, numCtx) {
  const raw = redactSecrets(result?.content || result?.summary || result?.error || "");
  const tokens = Number.isFinite(Number(numCtx)) ? Number(numCtx) : 8192;
  const maxChars = tokens <= 4096 ? 6000 : tokens <= 8192 ? 12000 : tokens <= 16384 ? 24000 : 40000;
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
    parserConfidence: Number.isFinite(Number(result?.parserConfidence)) ? Number(result.parserConfidence) : null,
    truncated: Boolean(result?.truncated || clipped),
    evidenceIds: AgentRuntime.evidenceIdsFromResults([result]),
    artifactPath: result?.outputPath || result?.file || "",
    sha256: result?.sha256 || result?.evidence?.record?.sha256 || "",
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

function actionPayloadBoundaryResponse(profile) {
  if (profile?.key === "ask") return ASK_MODE_BOUNDARY_RESPONSE;
  if (profile?.key === "planner") return PLANNER_BOUNDARY_RESPONSE;
  return profile?.family === "testing" ? TEST_AGENT_BOUNDARY_RESPONSE : SAFE_AGENT_BOUNDARY_RESPONSE;
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
      parts.push(`Ran ${result.command} (${result.exitCode === 0 ? "passed" : `exit ${result.exitCode}`}).`);
      continue;
    }
    if (result.mode === "create") {
      parts.push(`Created ${result.file}.`);
      continue;
    }
    if (["patch", "replace", "insert", "append", "full", "noop"].includes(result.mode)) {
      parts.push(`Updated ${result.file}.`);
      continue;
    }
    if (result.mode === "delete") {
      parts.push(`Deleted ${result.file}.`);
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
  thinking,
  tools,
  mode = "agent",
  modeFamily = "assist",
  approvalGranted = false,
  authority = null,
  projectProfile = null,
  runId: suppliedRunId = "",
  chatHistory,
  contextSummary,
  dirMap,
  activeFile,
  extraFiles,
  userMessage,
  sendEvent,
  runModelRound,
  executeToolCall,
  requestApproval = null,
  findWorkspaceFiles,
  searchWorkspaceIndex,
}) {
  const profile = normalizeProfile(modeFamily, mode);
  const selectedMode = profile.legacyMode;
  const effectiveContextBudget = Number(contextBudget) || Number(numCtx) || 8192;
  const contextRoute = ContextRouter.routeRequest({ text: userMessage, hasWorkspace: Boolean(workspace), family: profile.family, mode: profile.key, history: chatHistory });
  const profileTools = filterToolsForMode(tools, profile.key, profile.family);
  const routedTools = filterToolsForRoute(profileTools, contextRoute);
  const availableTools = ToolMap.compactTools(routedTools);
  const allowedToolNames = new Set(availableTools.map((tool) => tool.function.name));
  sendEvent({ type: "activity", text: `Profile ${profileKey(profile)} · routed ${availableTools.length} tool${availableTools.length === 1 ? "" : "s"}`, kind: "meta" });
  if (availableTools.length) {
    sendEvent({
      type: "activity",
      text: `Available tools: ${availableTools.map((tool) => tool.function.name).join(", ")}`,
      kind: "meta",
    });
  } else {
    sendEvent({ type: "activity", text: "No tools were routed for this request.", kind: "warn" });
  }
  const scanRequested = /\b(?:passive\s+)?scan\b/i.test(String(userMessage || "")) || /\bpassive\s+recon\b/i.test(String(userMessage || ""));
  if (scanRequested && !allowedToolNames.has("run_security_tool")) {
    sendEvent({
      type: "activity",
      text: "Security scans need Test Agent mode (testing:agent) with approved scope, authority, and a ready hypothesis.",
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
  const editContext = {
    mode: selectedMode,
    profile: profileKey(profile),
    isEditRequest: contextRoute.toolCategories.includes("os") && profile.family === "assist" && ["agent", "executor"].includes(profile.key) && isEditRequest(userMessage),
    requiresMutation: contextRoute.osMutates && profile.family === "assist" && ["agent", "executor"].includes(profile.key) && MUTATION_REQUEST_RE.test(String(userMessage || "")),
    targetFile: inferEditTarget(userMessage, activeFile, dirMap),
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
  const specializedGuidance = [
    loadWorkspaceGuidance(workspace),
    CyberLibrary.renderLibraries(cyberLibraryIds),
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
  const toolMenu = InitialPrompts.toolMenu(availableTools, ToolMap.TOOL_META);
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
  if (contextRoute.includeAuthority) {
    const message = { role: "system", content: InitialPrompts.runtimeAuthority({ approvalMode: policy.authoritySuperMode || "ask", permissions: policy.authorityPermissions || {} }) };
    baseMessages.push(message);
    contextBuckets.project.push(message);
  }
  if (contextRoute.includeProjectContext) {
    const professionalContext = buildEngagementPromptContext({ workspace, projectProfile });
    const message = { role: "system", content: InitialPrompts.projectSettings(professionalContext) };
    baseMessages.push(message);
    contextBuckets.project.push(message);
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

  const workingHistory = trimHistoryForContext(chatHistory, effectiveContextBudget);
  const historyStart = workingHistory.length;
  const knownFiles = new Set(parseProjectFiles(dirMap || "").map(normalizeFilePath));
  const mutatedFiles = new Set();

  let noToolRetries = 0;
  let incompleteMultiFileRetries = 0;
  let verificationReminders = 0;
  let failedVerificationReminders = 0;
  let completedEdit = false;
  let executedTools = false;
  let ranCommand = false;
  let lastVerification = null;
  let summaryMode = false;
  let finalText = "";
  let lastToolResults = [];
  const allActionResults = [];
  let ranActiveAction = false;
  let lastPolicyDecision = null;
  let lastContextUsage = null;
  const failedToolCalls = new Map();
  const readCallsSinceMutation = new Set();

  function finishRun(payload = {}, status = "completed") {
    const conversational = contextRoute.kind === "conversation";
    const evidenceIds = AgentRuntime.evidenceIdsFromResults(allActionResults);
    const assessmentRequested = profile.family === "testing" && profile.key === "agent" && /\b(?:test|scan|assess|pentest|recon|enumerat|verify|validate|probe|audit)\w*\b/i.test(String(userMessage || ""));
    const gateIssues = AgentRuntime.completionIssues(runState, { assessmentRequested, activeActions: ranActiveAction, actionResults: allActionResults });
    const claimCheck = AgentRuntime.validateFinalClaims(payload.finalText || "", {
      executedTools,
      evidenceIds,
      verification: lastVerification ? { status: lastVerification.ok ? "passed" : "failed", details: lastVerification.command } : null,
      actionResults: allActionResults,
    });
    const terminalStatus = status === "completed" && (claimCheck.warnings.length || gateIssues.length) ? "inconclusive" : status;
    const claimState = terminalStatus === "inconclusive" ? "inconclusive" : lastVerification?.ok && evidenceIds.length ? "verified" : evidenceIds.length ? "observed" : "inferred";
    const claim = conversational ? null : AgentRecords.claimRecord({ runId, state: claimState, text: claimCheck.text || payload.finalText || payload.error || "", evidenceIds, model, provenance: { source: "agent-final", profile: profileKey(profile) }, rationale: [...claimCheck.warnings, ...gateIssues].join(" ") });
    const operatorFeedback = conversational ? null : {
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
    };
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
      });
      if (claim) appendAgentAction(workspace, { runId, type: "claim_record", timestamp: new Date().toISOString(), profile: profileKey(profile), claim });
    }
    return {
      ...payload,
      ok: status === "completed" ? payload.ok !== false : false,
      finalText: claimCheck.text || payload.finalText || "",
      runId,
      profile: profileKey(profile),
      runState,
      claimWarnings: claimCheck.warnings,
      completionIssues: gateIssues,
      claims: claim ? [claim] : [],
      operatorFeedback,
      contextRoute,
      contextUsage: lastContextUsage,
    };
  }

  for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
    const activeStatus = profile.capability === "plan" ? "Planning..." : profile.capability === "observe" || profile.capability === "assess" ? "Analyzing..." : profile.capability === "verify" ? "Verifying..." : profile.capability === "report" ? "Reporting..." : "Working...";
    sendEvent({ type: "status", text: summaryMode ? "Summarizing..." : activeStatus });
    sendEvent({ type: "activity", text: `Round ${round + 1}: contacting ${model || "model"}...`, kind: "meta" });

    const summaryMessages = summaryMode ? [{ role: "system", content: buildPostToolSummaryPrompt({ mode: selectedMode, lastVerification }) }] : [];
    const messages = [
      ...baseMessages,
      ...workingHistory,
      ...summaryMessages,
    ];
    const roundTools = summaryMode ? [] : availableTools;
    const contextUsage = buildContextUsageSnapshot({
      buckets: contextBuckets,
      conversation: [...workingHistory, ...summaryMessages],
      tools: roundTools,
      route: contextRoute,
      contextWindow: Number(numCtx) || effectiveContextBudget,
      round: round + 1,
    });

    let reasoningAnnounced = false;
    let toolCallObserved = false;
    let withheldMutationText = "";
    let commandResponseBuffer = "";
    let commandResponseBlocked = false;
    let commandResponseCandidate = profile.key === "ask";
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
      if (profile.key === "ask" && commandResponseBuffer.length < 220) return;
      if (commandResponseBuffer.length >= 220) {
        commandResponseReleased = true;
        sendEvent({ type: "content", delta: commandResponseBuffer });
        commandResponseBuffer = "";
      }
    };
    const result = await runModelRound({
      model,
      numCtx,
      temperature: summaryMode ? 0 : profile.key === "ask" ? 0.2 : 0.1,
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
        if (editContext.requiresMutation && !summaryMode && !toolCallObserved) {
          withheldMutationText += String(delta || "");
          const structuredFallback = /^\s*(?:```json\s*)?\{/i.test(withheldMutationText);
          if (!structuredFallback && (
            withheldMutationText.length >= 180
            || /```(?!json)|<!doctype|<html\b|\bhere(?:'s| is)\b[\s\S]{0,80}\b(?:file|code|html)\b/i.test(withheldMutationText)
          )) {
            return { abort: true, code: "TEXT_ONLY_MUTATION" };
          }
          return undefined;
        }
        emitModelText(delta);
        return undefined;
      },
      onToolCalls(calls) {
        const resolved = resolveTools(
          calls.map((call) => ToolMap.normalizeToolCall(call)).filter(Boolean),
          editContext,
        );
        const normalized = profile.key === "ask"
          ? resolved.filter((tool) => allowedToolNames.has(tool.toolName || tool.action))
          : resolved;
        if (profile.key === "ask") {
          resolved
            .filter((tool) => !allowedToolNames.has(tool.toolName || tool.action))
            .forEach((tool) => blockedAskToolNames.add(tool.toolName || tool.action));
          if (blockedAskToolNames.size) {
            sendEvent({
              type: "activity",
              text: `Ask mode blocked non-read-only tool${blockedAskToolNames.size === 1 ? "" : "s"}: ${[...blockedAskToolNames].join(", ")}`,
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
    lastContextUsage = {
      ...contextUsage,
      source: Number.isFinite(actualPromptTokens) && actualPromptTokens >= 0 ? "ollama" : "estimate",
      promptTokens: Number.isFinite(actualPromptTokens) && actualPromptTokens >= 0 ? actualPromptTokens : contextUsage.estimatedTokens,
      completionTokens: Number.isFinite(actualCompletionTokens) && actualCompletionTokens >= 0 ? actualCompletionTokens : null,
      measuredAt: new Date().toISOString(),
    };
    sendEvent({ type: "context_usage", usage: lastContextUsage });

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
    const normalizedToolCalls = profile.key === "ask"
      ? resolvedToolCalls.filter((tool) => allowedToolNames.has(tool.toolName || tool.action))
      : resolvedToolCalls;
    if (profile.key === "ask") {
      resolvedToolCalls
        .filter((tool) => !allowedToolNames.has(tool.toolName || tool.action))
        .forEach((tool) => blockedAskToolNames.add(tool.toolName || tool.action));
    }
    const boundaryViolation = commandResponseBlocked
      || RequestIntentRules.looksLikeCommandResponse(rawRoundText)
      || (profile.key === "ask" && blockedAskToolNames.size > 0);
    if (boundaryViolation) {
      commandResponseBlocked = true;
      commandResponseBuffer = "";
      sendEvent({
        type: "activity",
        text: profile.key === "ask"
          ? "Ask mode kept this turn read-only and discarded the executable action payload."
          : "The model returned an executable action payload instead of a native tool call; nothing was run.",
        kind: "warn",
      });
    } else if (commandResponseBuffer) {
      commandResponseReleased = true;
      emitModelText(commandResponseBuffer);
      commandResponseBuffer = "";
    }
    const roundText = boundaryViolation ? actionPayloadBoundaryResponse(profile) : rawRoundText;

    if (!normalizedToolCalls.length) {
      if (
        executedTools
        && !editContext.isEditRequest
        && lastToolResults.length
        && !roundText
        && !summaryMode
      ) {
        summaryMode = true;
        sendEvent({ type: "status", text: "Preparing the evidence-backed analysis..." });
        continue;
      }
      if (summaryMode || !editContext.isEditRequest || (executedTools && !editContext.requiresMutation && !completedEdit)) {
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

      const error = "The selected model answered with text instead of calling a workspace tool. No file was changed. Try again or use a model with native tool-call support.";
      return finishRun({
        ok: false,
        error,
        finalText: "",
        appendedMessages: workingHistory.slice(historyStart),
        completedEdit,
        executedTools,
      }, "failed");
    }

    executedTools = true;
    noToolRetries = 0;

    workingHistory.push({
      role: "assistant",
      content: roundText || "",
      tool_calls: normalizeToolCallsForApi(effectiveToolCalls),
    });

    const toolResults = [];
    for (const tool of normalizedToolCalls) {
      sendEvent({ type: "tool_start", tool });
      const toolName = tool.toolName || tool.action;
      const commandPreview = tool.command || tool.args?.command || tool.args?.target || tool.args?.adapter_id || tool.file || tool.query || "";
      sendEvent({
        type: "activity",
        text: commandPreview
          ? `Running ${toolName}: ${String(commandPreview).slice(0, 240)}`
          : `Running ${toolName}`,
        kind: "tool",
      });
      const signature = toolCallSignature(tool);
      const commandBlock = ["run_command", "start_process"].includes(toolName)
        ? commandGuardReason(tool.command)
        : "";
      if (toolName === "record_hypothesis") {
        runState.phase = "hypothesis";
        runState.hypothesisId = String(tool.args?.id || `hyp-${runId}`).slice(0, 160);
        runState.expectedSignal = String(tool.args?.expected_signal || "").slice(0, 1200);
        runState.unknowns = [String(tool.args?.question || "").slice(0, 1200)];
      }
      if (toolName === "record_finding_candidate") runState.phase = "finding";
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
        proposedActionId: String(tool.callId || signature),
        expectedSignal: runState.expectedSignal,
        completionGate: runState.completionGate,
        nextState: "approval",
      });
      let policyDecision = evaluateAction({ tool, profile, policy, approvalGranted });
      lastPolicyDecision = policyDecision;
      if (policyDecision.active) ranActiveAction = true;
      sendEvent({ type: "action_policy", runId, tool, decision: policyDecision });
      if (!policyDecision.allowed && policyDecision.requiresApproval && typeof requestApproval === "function") {
        const target = String(tool.args?.target || tool.target || tool.url || "");
        const approval = await requestApproval({
          runId,
          actionId: String(tool.callId || signature),
          target,
          capability: policyDecision.capability,
          risk: policyDecision.risk,
          tool: toolName,
          reason: policyDecision.reason,
        });
        if (approval?.approved) {
          const token = { actionId: String(tool.callId || signature), target, capability: policyDecision.capability, risk: policyDecision.risk, expiresAt: approval.expiresAt || new Date(Date.now() + 60_000).toISOString() };
          policyDecision = evaluateAction({ tool, profile, policy, approvalGranted: token });
          lastPolicyDecision = policyDecision;
          sendEvent({ type: "action_policy", runId, tool, decision: policyDecision, approval: "action-bound" });
        }
      }
      if (policyDecision.requiresApproval || approvalGranted) {
        appendAgentApproval(workspace, {
          runId,
          timestamp: new Date().toISOString(),
          operator: "local-user",
          profile: profileKey(profile),
          actionId: String(tool.callId || signature),
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
        tool: toolName,
        target: tool.file || tool.query || tool.url || tool.command || tool.processId || "workspace",
        risk: policyDecision.risk,
        capability: policyDecision.capability,
        allowed: policyDecision.allowed,
        requiresApproval: policyDecision.requiresApproval,
        reason: policyDecision.reason,
      });
      runState.phase = policyDecision.allowed ? "execution" : "approval";
      runState.proposedActionId = String(tool.callId || signature).slice(0, 160);
      runState.actionIds.push(runState.proposedActionId);
      sendEvent({ type: "run_state", runId, state: { ...runState }, policyDecision });
      let toolResult;
      if (!allowedToolNames.has(toolName)) {
        toolResult = {
          ok: false,
          error: `${toolName} is not allowed in ${selectedMode} mode.`,
          errorCode: "MODE_GUARD",
          retryable: false,
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
      } else if (READ_ONLY_TOOL_NAMES.has(toolName) && readCallsSinceMutation.has(signature)) {
        toolResult = {
          ok: false,
          error: "Repeated unchanged read/discovery call blocked. Use the existing result or narrow the next query.",
          errorCode: "REDUNDANT_READ",
          retryable: false,
        };
      } else if ((failedToolCalls.get(signature) || 0) >= 1) {
        toolResult = {
          ok: false,
          error: "Repeated identical failed tool call blocked. Change the arguments or use a different discovery step.",
          errorCode: "REPEATED_FAILED_CALL",
          retryable: false,
        };
      } else {
        if (toolName === "verify_finding_candidate") tool.args = { ...(tool.args || {}), model };
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
        if (!toolResult) {
          toolResult = await executeToolCall({
            workspace,
            toolCall: buildToolCallForExecution(tool),
          });
        }
      }
      toolResults.push(toolResult);
      allActionResults.push(toolResult);
      appendAgentAction(workspace, {
        runId,
        type: "action_result",
        timestamp: new Date().toISOString(),
        profile: profileKey(profile),
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
      sendEvent({ type: "tool_result", tool, result: toolResult });
      runState.phase = "observation";
      AgentRuntime.noteAction(runState, { actionId: runState.proposedActionId, ok: Boolean(toolResult?.ok && !toolResult?.error), evidenceIds: AgentRuntime.evidenceIdsFromResults([toolResult]) });
      sendEvent({ type: "run_state", runId, state: { ...runState } });
      const stopDecision = evaluateStopConditions(toolResult, policy);
      if (stopDecision.stop) {
        lastToolResults = [...toolResults];
        appendAgentAction(workspace, { runId, type: "stop_condition", timestamp: new Date().toISOString(), profile: profileKey(profile), tool: toolName, target: tool.args?.target || tool.url || "", ok: false, stopConditions: stopDecision.triggered });
        return finishRun({ ok: false, error: `Run stopped: ${stopDecision.triggered.join(", ")}` }, "stopped");
      }

      if (toolResult?.ok === false || toolResult?.error) {
        failedToolCalls.set(signature, (failedToolCalls.get(signature) || 0) + 1);
      } else {
        failedToolCalls.delete(signature);
        if (READ_ONLY_TOOL_NAMES.has(toolName)) readCallsSinceMutation.add(signature);
      }

      if (toolResult?.ok && toolResult.mutated) {
        completedEdit = true;
        readCallsSinceMutation.clear();
      }
      if (toolResult?.mode === "command" || tool.action === "run_command") {
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
        runState.phase = "verification";
        runState.verification = { status: lastVerification.ok ? "passed" : "failed", details: lastVerification.command };
        sendEvent({ type: "run_state", runId, state: { ...runState } });
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
    }

    lastToolResults = toolResults;
    summaryMode = false;
  }

  finalText = summarizeToolResults(lastToolResults) || "Completed the requested workspace actions.";
  workingHistory.push({ role: "assistant", content: finalText });
  return finishRun({
    ok: true,
    finalText,
    appendedMessages: workingHistory.slice(historyStart),
    completedEdit,
    executedTools,
  }, "inconclusive");
}

module.exports = {
  MAX_AGENT_ROUNDS,
  READ_ONLY_TOOL_NAMES,
  buildTaskBrief,
  buildEngagementPromptContext,
  commandGuardReason,
  filterToolsForMode,
  filterToolsForRoute,
  isProtectedAssessmentPath,
  runAgentTurn,
  trimHistoryForContext,
};
