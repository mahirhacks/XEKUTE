const ToolMap = require("../tools/tool-map");
const {
  buildSystemContext,
  inferEditTarget,
  isEditRequest,
  resolveTools,
} = require("./agent-prompt");

const MAX_AGENT_ROUNDS = 10;
const MAX_EDIT_RETRIES_WITHOUT_TOOLS = 1;

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
    "Use find_files if the path is unclear, search_code for discovery, read_file before editing existing files, and patch_file or create_file for changes.",
    targetFile ? `Primary target file: ${targetFile}.` : "",
    `Original user request: ${userMessage}`,
  ].filter(Boolean).join(" ");
}

function buildPostToolSummaryPrompt() {
  return [
    "The required workspace actions have already been performed.",
    "Reply to the user in 1-3 concise sentences.",
    "Do not call tools in this response.",
    "Mention verification if any command ran.",
  ].join(" ");
}

function extractDiscoveryQuery(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function buildToolCallForExecution(tool) {
  const name = tool.toolName || tool.action;
  const args = { ...(tool.args || {}) };

  if (tool.file) args.path = tool.file;
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
  thinking,
  tools,
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
  const editContext = {
    isEditRequest: isEditRequest(userMessage),
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
    dirMap,
    activeFile,
    extraFiles,
    discovery,
  });

  const baseMessages = [{ role: "system", content: systemContext }];
  if (contextSummary) {
    baseMessages.push({
      role: "system",
      content: [
        "Compressed conversation memory from earlier turns:",
        String(contextSummary || ""),
        "Use this as prior context, but prefer the current workspace state and recent messages if they conflict.",
      ].join("\n"),
    });
  }

  const workingHistory = Array.isArray(chatHistory) ? chatHistory.map((msg) => ({ ...msg })) : [];
  const historyStart = workingHistory.length;

  let noToolRetries = 0;
  let completedEdit = false;
  let executedTools = false;
  let summaryMode = false;
  let finalText = "";
  let lastToolResults = [];

  for (let round = 0; round < MAX_AGENT_ROUNDS; round += 1) {
    sendEvent({ type: "status", text: summaryMode ? "Summarizing..." : "Planning..." });

    const messages = [
      ...baseMessages,
      ...workingHistory,
      ...(summaryMode ? [{ role: "system", content: buildPostToolSummaryPrompt() }] : []),
    ];

    const result = await runModelRound({
      model,
      numCtx,
      thinking,
      messages,
      tools: summaryMode ? [] : tools,
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
      if (summaryMode || !editContext.isEditRequest) {
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
        };
      }

      if (completedEdit && !summaryMode) {
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
      const toolResult = await executeToolCall({
        workspace,
        toolCall: buildToolCallForExecution(tool),
      });
      toolResults.push(toolResult);
      sendEvent({ type: "tool_result", tool, result: toolResult });

      if (toolResult?.ok && toolResult.mutated) {
        completedEdit = true;
      }

      workingHistory.push({
        role: "tool",
        content: String(toolResult?.content || toolResult?.summary || toolResult?.error || ""),
        tool_name: tool.toolName || tool.action || "tool",
        ...(tool.callId ? { tool_call_id: tool.callId } : {}),
      });
    }

    lastToolResults = toolResults;
    summaryMode = completedEdit;
  }

  finalText = summarizeToolResults(lastToolResults) || "Completed the requested workspace actions.";
  workingHistory.push({ role: "assistant", content: finalText });
  return {
    ok: true,
    finalText,
    appendedMessages: workingHistory.slice(historyStart),
    completedEdit,
    executedTools,
  };
}

module.exports = {
  MAX_AGENT_ROUNDS,
  runAgentTurn,
};
