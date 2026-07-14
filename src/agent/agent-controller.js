const crypto = require("crypto");
const ToolMap = require("../tools/tool-map");
const {
  buildSystemContext,
  contextLimits,
  inferEditTarget,
  isEditRequest,
  normalizeMode,
  normalizeProfile,
  profileKey,
  parseProjectFiles,
  resolveTools,
} = require("./agent-prompt");
const { evaluateAction, loadPolicy } = require("./policy-engine");
const { appendAgentAction, appendAgentApproval, appendAgentRun, appendToolOutput } = require("./action-log");

const MAX_AGENT_ROUNDS = 10;
const MAX_EDIT_RETRIES_WITHOUT_TOOLS = 1;
const MAX_PLAN_GROUNDING_RETRIES = 1;
const MAX_VERIFICATION_REMINDERS = 1;
const MAX_FAILED_VERIFICATION_REMINDERS = 1;
const MULTI_FILE_WEB_REQUEST_RE = /\bhtml\b.*\bcss\b.*\b(?:javascript|js)\b|\b(?:javascript|js)\b.*\bcss\b.*\bhtml\b|\bseparate files?\b/i;
const MUTATION_REQUEST_RE = /\b(create|add|update|edit|modify|change|fix|write|implement|build|make|remove|delete|refactor|append|insert|rename|move|revamp|replace)\b/i;
const FILE_PATH_RE = /\b[\w./-]+\.[A-Za-z0-9]+\b/g;
const SKIP_VERIFICATION_RE = /\b(skip|without|no|do\s+not|don't)\s+(?:tests?|verification|commands?|running)|\bno\s+tests?\b/i;
const VERIFICATION_FILE_RE = /\.(?:js|jsx|ts|tsx|mjs|cjs|json|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|sh|ps1|yml|yaml|toml)$/i;
const EXPLICIT_DELETE_RE = /\b(delete|remove|erase)\b/i;
const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+-[^\n]*r[^\n]*f|\brm\s+-rf\b/i,
  /\brmdir\s+\/s\b|\bdel\s+\/s\b/i,
  /\bremove-item\b[^\n]*\b-recurse\b/i,
  /\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[^\s]*f/i,
  /\bformat(?:\.com)?\b|\bshutdown\b|\brestart-computer\b/i,
  /(?:curl|wget|invoke-webrequest)[^\n|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex)\b/i,
];
const FILE_COUNT_WORDS = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
]);
const READ_ONLY_TOOL_NAMES = new Set([
  "inspect_workspace",
  "list_files",
  "find_files",
  "search_code",
  "get_file_outline",
  "read_file",
  "read_files",
  "search_web",
  "fetch_url",
  "get_map_overview",
  "get_map_node",
  "get_map_neighbors",
  "find_map_paths",
  "search_map_routes",
  "get_map_shared_objects",
  "get_map_evidence",
  "get_map_hypotheses",
  "record_hypothesis",
]);
const AGENT_TOOL_NAMES = new Set([
  ...READ_ONLY_TOOL_NAMES,
  "create_file",
  "patch_file",
  "delete_file",
  "run_command",
  "start_process",
  "read_process",
  "stop_process",
  "annotate_map_finding",
]);

function allowedToolNamesForMode(mode, modeFamily = "assist") {
  const profile = normalizeProfile(modeFamily, mode);
  return ["agent", "executor"].includes(profile.key) || (profile.family === "testing" && ["execution", "exploit"].includes(profile.key))
    ? AGENT_TOOL_NAMES
    : READ_ONLY_TOOL_NAMES;
}

function filterToolsForMode(tools, mode, modeFamily = "assist") {
  const allowed = allowedToolNamesForMode(mode, modeFamily);
  return (Array.isArray(tools) ? tools : []).filter((tool) => allowed.has(tool?.function?.name));
}

function messageSize(message) {
  return String(message?.content || "").length + JSON.stringify(message?.tool_calls || []).length + 32;
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
  const value = String(command || "").trim();
  if (!value) return "Command is empty.";
  if (DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(value))) {
    return "Potentially destructive command blocked. Use scoped workspace tools or ask the user for a safer explicit action.";
  }
  return "";
}

function toolResultContentForModel(result, numCtx) {
  const raw = String(result?.content || result?.summary || result?.error || "");
  const tokens = Number.isFinite(Number(numCtx)) ? Number(numCtx) : 8192;
  const maxChars = tokens <= 4096 ? 6000 : tokens <= 8192 ? 12000 : tokens <= 16384 ? 24000 : 40000;
  if (raw.length <= maxChars) return raw;
  const headSize = Math.floor(maxChars * 0.7);
  return `${raw.slice(0, headSize)}\n... tool output truncated; use a narrower search/read if needed ...\n${raw.slice(-(maxChars - headSize))}`;
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

function buildRetryMessage({ targetFile, userMessage }) {
  return [
    "Your previous response did not use valid tool calls.",
    "This request requires real workspace actions, not a text-only answer.",
    "For security work, verify authorization and scope before any active command, use the least invasive suitable action, and preserve reproducible evidence.",
    "Use inspect_workspace for broad work, list_files/find_files/search_code for discovery, read_file or read_files before editing existing files, and patch_file or create_file for changes.",
    "If the user asked for multiple files, call one file tool per file and continue until every requested file has been created or updated.",
    targetFile ? `Primary target file: ${targetFile}.` : "",
    `Original user request: ${userMessage}`,
  ].filter(Boolean).join(" ");
}

function buildPostToolSummaryPrompt({ mode, lastVerification } = {}) {
  const selectedMode = normalizeMode(mode);
  if (selectedMode === "plan") {
    return "Return the grounded pentest plan now. Do not call tools. Include ordered hypotheses, targets, prerequisites, techniques, conservative configurations, evidence to capture, output paths, success criteria, stop conditions, risks, and assumptions.";
  }
  if (selectedMode === "ask") {
    return "Answer as a pentest analyst using the gathered evidence. Do not call tools. Cite relevant assessment paths, separate observation from hypothesis and confirmed finding, state missing evidence, and never imply validation that did not occur.";
  }
  return [
    "The authorized workspace actions are complete. Do not call tools in this response.",
    "Reply with an operator summary: actions executed, targets touched, evidence/output paths, hypotheses confirmed or rejected, assessment records changed, safety limits honored, verification performed, coverage gaps, and safe next steps.",
    lastVerification && !lastVerification.ok
      ? `The latest verification failed (${lastVerification.command}). State that failure accurately and do not claim full success.`
      : "",
  ].filter(Boolean).join(" ");
}

function buildPlanGroundingReminder(userMessage) {
  return [
    "This is Plan mode and an assessment workspace is open, but the plan is not grounded in assessment evidence yet.",
    "Call inspect_workspace, then read the relevant scope, authorization, settings.config, pen_context.md, traffic, enumeration, or finding files.",
    "Do not edit files, send traffic, or run commands. Return the plan only after it names concrete targets, hypotheses, evidence requirements, conservative limits, and stop conditions.",
    `Original user request: ${userMessage}`,
  ].join(" ");
}

function buildVerificationReminder({ userMessage, mutatedFiles }) {
  return [
    "Before summarizing, verify the assessment or workspace changes with the smallest relevant check.",
    mutatedFiles.size ? `Files changed this turn: ${[...mutatedFiles].join(", ")}.` : "",
    "For assessment data, validate JSON/Markdown integrity and referenced output paths. For code, use syntax/type checks, focused tests, then a broader build only if warranted.",
    "Use inspect_workspace if the repository command is unknown. Do not install packages or invent a command.",
    "If no useful verification command exists, reply without tools and explicitly mention that no verification was run.",
    `Original user request: ${userMessage}`,
  ].filter(Boolean).join(" ");
}

function buildFailedVerificationReminder({ userMessage, lastVerification }) {
  return [
    `The latest verification failed: ${lastVerification?.command || "unknown command"}.`,
    "Do not summarize this as success.",
    "Inspect the failure. If your change caused it, fix the smallest root cause and rerun the focused check.",
    "If it is clearly unrelated or cannot be fixed safely in scope, stop and report the exact failure and why it remains.",
    `Original user request: ${userMessage}`,
  ].join(" ");
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
  findWorkspaceFiles,
  searchWorkspaceIndex,
}) {
  const profile = normalizeProfile(modeFamily, mode);
  const selectedMode = profile.legacyMode;
  const effectiveContextBudget = Number(contextBudget) || Number(numCtx) || 8192;
  const allowedToolNames = allowedToolNamesForMode(profile.key, profile.family);
  const availableTools = filterToolsForMode(tools, profile.key, profile.family);
  const policy = loadPolicy(workspace, authority);
  const runId = String(suppliedRunId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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
  const editContext = {
    mode: selectedMode,
    profile: profileKey(profile),
    isEditRequest: profile.family === "assist" && ["agent", "executor"].includes(profile.key) && isEditRequest(userMessage),
    requiresMutation: profile.family === "assist" && ["agent", "executor"].includes(profile.key) && MUTATION_REQUEST_RE.test(String(userMessage || "")),
    targetFile: inferEditTarget(userMessage, activeFile, dirMap),
    activeFile,
    userMessage,
    dirMap,
  };

  const discovery = await prepareDiscoveryHints({
    workspace,
    userMessage,
    findWorkspaceFiles,
    searchWorkspaceIndex,
  });

  const systemContext = buildSystemContext({
    mode: selectedMode,
    modeFamily: profile.family,
    numCtx: effectiveContextBudget,
    dirMap,
    activeFile,
    extraFiles,
    discovery,
    userMessage,
  });

  const baseMessages = [{ role: "system", content: systemContext }];
  baseMessages.push({
    role: "system",
    content: [
      "POINTER AUTHORITY (enforced by the runtime):",
      `- Approval mode: ${policy.authoritySuperMode || "ask"}`,
      `- Enabled permissions: ${Object.entries(policy.authorityPermissions || {}).filter(([, enabled]) => enabled).map(([name]) => name).join(", ") || "none"}`,
      `- Disabled permissions: ${Object.entries(policy.authorityPermissions || {}).filter(([, enabled]) => !enabled).map(([name]) => name).join(", ") || "none"}`,
      "Choose actions that fit these permissions. If an action is blocked, explain the exact permission or engagement gate instead of repeatedly retrying it.",
      "Maintain the workflow: observe evidence → state a testable hypothesis → propose the smallest action → execute only if allowed → verify → record evidence and confidence → report next steps.",
    ].join("\n"),
  });
  const boundedMemory = clipMemorySummary(contextSummary, effectiveContextBudget);
  if (boundedMemory) {
    baseMessages.push({
      role: "system",
      content: [
        "BOUNDED CONVERSATION MEMORY (may be stale):",
        boundedMemory,
        "Use this only for prior decisions and user preferences. Current workspace state and recent messages win conflicts.",
      ].join("\n"),
    });
  }

  const workingHistory = trimHistoryForContext(chatHistory, effectiveContextBudget);
  const historyStart = workingHistory.length;
  const knownFiles = new Set(parseProjectFiles(dirMap || "").map(normalizeFilePath));
  const mutatedFiles = new Set();

  let noToolRetries = 0;
  let planGroundingRetries = 0;
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
  const failedToolCalls = new Map();
  const readCallsSinceMutation = new Set();

  for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
    const activeStatus = profile.capability === "plan" ? "Planning..." : profile.capability === "observe" || profile.capability === "assess" ? "Analyzing..." : profile.capability === "verify" ? "Verifying..." : profile.capability === "report" ? "Reporting..." : "Working...";
    sendEvent({ type: "status", text: summaryMode ? "Summarizing..." : activeStatus });

    const messages = [
      ...baseMessages,
      ...workingHistory,
      ...(summaryMode ? [{ role: "system", content: buildPostToolSummaryPrompt({ mode: selectedMode, lastVerification }) }] : []),
    ];

    const result = await runModelRound({
      model,
      numCtx,
      thinking,
      messages,
      tools: summaryMode ? [] : availableTools,
      onThinking(delta) {
        sendEvent({ type: "thinking", delta });
      },
      onToken(delta) {
        sendEvent({ type: "content", delta });
      },
      onToolCalls(calls) {
        const normalized = resolveTools(
          calls.map((call) => ToolMap.normalizeToolCall(call)).filter(Boolean),
          editContext,
        );
        if (normalized.length) {
          sendEvent({ type: "tool_call", tools: normalized });
        }
      },
    });

    if (result.error) {
      return { ok: false, error: result.error };
    }

    const roundText = cleanAssistantText(result.fullText);
    const normalizedToolCalls = resolveTools(
      (result.toolCalls || [])
        .map((call) => ToolMap.normalizeToolCall(call))
        .filter(Boolean),
      editContext,
    );

    if (!normalizedToolCalls.length) {
      if (
        selectedMode === "plan"
        && workspace
        && !executedTools
        && planGroundingRetries < MAX_PLAN_GROUNDING_RETRIES
      ) {
        planGroundingRetries += 1;
        sendEvent({ type: "status", text: "Grounding plan in the workspace..." });
        workingHistory.push({ role: "user", content: buildPlanGroundingReminder(userMessage) });
        continue;
      }
      if (summaryMode || !editContext.isEditRequest || (executedTools && !editContext.requiresMutation && !completedEdit)) {
        finalText = roundText || summarizeToolResults(lastToolResults);
        if (finalText) {
          workingHistory.push({ role: "assistant", content: finalText });
        }
        return {
          ok: true,
          finalText,
          appendedMessages: workingHistory.slice(historyStart),
          completedEdit,
          executedTools,
          runId,
          profile: profileKey(profile),
        };
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
          return {
            ok: true,
            finalText,
            appendedMessages: workingHistory.slice(historyStart),
            completedEdit,
            executedTools,
            runId,
            profile: profileKey(profile),
          };
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

      finalText = roundText || "I could not get a usable tool call from the model, so no workspace changes were made.";
      workingHistory.push({ role: "assistant", content: finalText });
      return {
        ok: true,
        finalText,
        appendedMessages: workingHistory.slice(historyStart),
        completedEdit,
        executedTools,
        runId,
        profile: profileKey(profile),
      };
    }

    executedTools = true;
    noToolRetries = 0;

    workingHistory.push({
      role: "assistant",
      content: roundText || "",
      tool_calls: normalizeToolCallsForApi(result.toolCalls || []),
    });

    const toolResults = [];
    for (const tool of normalizedToolCalls) {
      sendEvent({ type: "tool_start", tool });
      const signature = toolCallSignature(tool);
      const toolName = tool.toolName || tool.action;
      const commandBlock = ["run_command", "start_process"].includes(toolName)
        ? commandGuardReason(tool.command)
        : "";
      const policyDecision = evaluateAction({ tool, profile, policy, approvalGranted });
      sendEvent({ type: "action_policy", runId, tool, decision: policyDecision });
      if (policyDecision.requiresApproval || approvalGranted) {
        appendAgentApproval(workspace, {
          runId,
          timestamp: new Date().toISOString(),
          operator: "local-user",
          profile: profileKey(profile),
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
      let toolResult;
      if (!allowedToolNames.has(toolName)) {
        toolResult = {
          ok: false,
          error: `${toolName} is not allowed in ${selectedMode} mode.`,
          errorCode: "MODE_GUARD",
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
        toolResult = await executeToolCall({
          workspace,
          toolCall: buildToolCallForExecution(tool),
        });
      }
      toolResults.push(toolResult);
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
  appendAgentAction(workspace, { runId, type: "run_completed", timestamp: new Date().toISOString(), profile: profileKey(profile), executedTools, completedEdit, finalText: String(finalText).slice(0, 2000) });
  return {
    ok: true,
    finalText,
    appendedMessages: workingHistory.slice(historyStart),
    completedEdit,
    executedTools,
    runId,
    profile: profileKey(profile),
  };
}

module.exports = {
  AGENT_TOOL_NAMES,
  MAX_AGENT_ROUNDS,
  READ_ONLY_TOOL_NAMES,
  commandGuardReason,
  filterToolsForMode,
  runAgentTurn,
  trimHistoryForContext,
};
