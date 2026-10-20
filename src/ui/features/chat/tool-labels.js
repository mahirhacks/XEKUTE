import { compactText } from "../../core/text-format.js";
import { isPlaceholderTarget, isEmptyAssistantReply } from "./turn-structure.js";
import { ToolMap } from "../../bootstrap.js";
import { isAgentTerminalTool, agentCommandContextForTool } from "./command-timeline.js";
import { KEEPABLE_TOOL_LABEL, isStubToolStatusLabel } from "./chat-persistence.js";

export function toolIconClass(tool = {}) {
  const name = String(tool.toolName || tool.action || "").toLowerCase();
  if (/terminal|command|process|security/.test(name)) return "codicon-terminal";
  if (/search|find|inspect|outline|map|web|url/.test(name)) return "codicon-search";
  if (/write|create|patch|replace|insert|append/.test(name)) return "codicon-edit";
  if (/delete|remove/.test(name)) return "codicon-trash";
  if (/verify|finding|hypothesis|evidence/.test(name)) return "codicon-verified";
  return "codicon-file";
}

export const FILE_MUTATION_TOOL_NAMES = new Set([
  "apply_patch",
  "create_guidance",
]);

export const FILE_READ_TOOL_NAMES = new Set([
  "read_file",
]);

export function toolActionName(tool = {}) {
  const raw = String(tool.toolName || tool.action || "").toLowerCase().trim();
  if (!raw) return "";
  // Catalog names are bare (`search_workspace`). Streamed calls may arrive as
  // `workspace/search_workspace`.
  return raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
}

export function isSearchWorkspaceTool(tool = {}) {
  const action = toolActionName(tool);
  return action === "search_workspace" || action.endsWith(".search_workspace");
}

export function isFileMutationTool(tool = {}) {
  return FILE_MUTATION_TOOL_NAMES.has(toolActionName(tool));
}

export function isFileReadTool(tool = {}) {
  return FILE_READ_TOOL_NAMES.has(toolActionName(tool));
}

export function isFileActionTool(tool = {}) {
  return Boolean(fileActionKindForTool(tool));
}

export function toolCardKey(tool = {}) {
  const callId = String(tool.callId || "").trim();
  if (callId) return `call:${callId}`;
  return [
    toolActionName(tool),
    toolCardFileKey(tool),
    String(tool.args?.name || ""),
  ].join("\u0000");
}

export function toolTargetPath(tool = {}, result = {}) {
  const args = tool.args && typeof tool.args === "object" ? tool.args : {};
  const resultPath = result?.relativePath || result?.path || result?.file || "";
  const operations = Array.isArray(args.operations) ? args.operations : [];
  const op = operations.find((item) => item && (item.path || item.target)) || operations[0] || {};
  return String(resultPath || args.path || args.file || tool.file || op.path || op.target || "").trim();
}

export function toolTargetBasename(tool = {}, result = {}) {
  const value = toolTargetPath(tool, result).replace(/\\/g, "/");
  if (!value || value === "workspace" || value === ".") return "";
  const parts = value.split("/").filter(Boolean);
  return parts.at(-1) || value;
}

export function toolArgsOf(tool = {}) {
  return tool.args && typeof tool.args === "object" && !Array.isArray(tool.args) ? tool.args : {};
}

export function compactUrlDetail(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return compactText(`${parsed.host || ""}${path}`, 48);
  } catch {
    return compactText(raw.replace(/^https?:\/\//i, ""), 48);
  }
}

export function compactSearchNeedle(tool = {}, result = {}) {
  const args = toolArgsOf(tool);
  const value = result && typeof result === "object" ? result : {};
  return compactText(
    args.query
    || args.pattern
    || args.filename
    || args.text
    || args.symbol
    || tool.query
    || value.query
    || value.pattern
    || "",
  );
}

export function toolDisplayName(tool = {}, result = {}) {
  if (isSearchWorkspaceTool(tool) || (isSearchTool(tool) && toolActionName(tool) !== "web_research")) {
    return compactSearchNeedle(tool, result);
  }
  const base = toolTargetBasename(tool, result);
  if (base && !isPlaceholderTarget(base)) return base;
  const fallback = String(ToolMap.targetForTool(tool) || "").trim();
  if (isPlaceholderTarget(fallback)) return "";
  return toolTargetBasename({ args: { path: fallback } }, {}) || fallback;
}

export function toolCardFileKey(tool = {}, result = {}) {
  if (isSearchWorkspaceTool(tool) || (isSearchTool(tool) && toolActionName(tool) !== "web_research")) {
    return compactSearchNeedle(tool, result) || toolActionName(tool) || "search";
  }
  const path = toolTargetPath(tool, result);
  if (!isPlaceholderTarget(path)) return path;
  const display = toolDisplayName(tool, result);
  if (display) return display;
  return toolActionName(tool) || "workspace";
}

export function isAskQuestionsTool(tool = {}) {
  return toolActionName(tool) === "ask_questions";
}

export function isEndTurnTool(tool = {}) {
  return toolActionName(tool) === "end_turn";
}

export function applyEndTurnStopToUi(assistant, result = {}) {
  if (!assistant || result?.error || result?.ok === false) return;
  assistant.finalizeThinking?.({ collapse: true });
  const current = assistant.currentContentSegment?.()?.el;
  if (current && !isEmptyAssistantReply(current)) current.dataset.stopRound = "true";
  assistant.openStopSection?.({ collapse: true, allowEmpty: false });
}

export function isSearchTool(tool = {}) {
  const action = toolActionName(tool);
  return isSearchWorkspaceTool(tool) || (action !== "web_research" && /search|grep|find/.test(action));
}

export function applyPatchOperations(tool = {}) {
  const operations = toolArgsOf(tool).operations;
  return Array.isArray(operations) ? operations.filter((item) => item && typeof item === "object") : [];
}

export function applyPatchKind(tool = {}, result = {}) {
  if (result?.mode === "delete") return "delete";
  const operations = applyPatchOperations(tool);
  if (!operations.length) return "modify";
  if (operations.every((op) => op.kind === "delete")) return "delete";
  if (operations.every((op) => op.kind === "create")) return "create";
  if (operations.every((op) => op.kind === "move")) return "move";
  if (operations.every((op) => op.kind === "ensure_dir")) return "ensure_dir";
  return String(operations[0]?.kind || "modify");
}

export function applyPatchDetail(tool = {}, result = {}) {
  const operations = applyPatchOperations(tool);
  const op = operations[0] || {};
  if (applyPatchKind(tool, result) === "move") {
    const from = toolTargetBasename({ args: { path: op.path } }, result) || toolTargetBasename(tool, result);
    const to = toolTargetBasename({ args: { path: op.target } }, {});
    if (from && to) return `${from} \u2192 ${to}`;
    return to || from;
  }
  return toolTargetBasename(tool, result);
}

export function isDeletePatchTool(tool = {}, result = {}) {
  return toolActionName(tool) === "apply_patch" && applyPatchKind(tool, result) === "delete";
}

export function webResearchParts(tool = {}, result = {}, running = false) {
  const args = toolArgsOf(tool);
  const operation = String(args.operation || result.operation || "").toLowerCase();
  if (operation === "fetch_page") {
    return {
      verb: running ? "Reading page" : "Read page",
      detail: compactText(result.title || "") || compactUrlDetail(args.url || result.url || ""),
    };
  }
  return {
    verb: running ? "Searching web" : "Searched web",
    detail: compactSearchNeedle(tool) || compactText(result.query || ""),
  };
}

export function browserActionDetail(tool = {}, result = {}) {
  const args = toolArgsOf(tool);
  const action = String(args.action || result.action || "").replace(/_/g, " ").trim();
  const target = compactUrlDetail(args.url || result.url || "")
    || compactText(args.selector || args.target?.selector || args.text || args.option || args.pageId || "", 40);
  if (action && target) return `${action} ${target}`;
  return target || action;
}

export function replayRequestDetail(tool = {}, result = {}) {
  const args = toolArgsOf(tool);
  const request = args.request && typeof args.request === "object" ? args.request : {};
  const method = String(request.method || result.method || "GET").toUpperCase();
  const path = compactUrlDetail(request.url || result.url || "") || compactText(request.url || result.url || "", 40);
  return path ? `${method} ${path}` : method;
}

export function identityActionDetail(tool = {}, result = {}) {
  const args = toolArgsOf(tool);
  const operation = String(args.operation || result.operation || "").trim();
  const name = compactText(args.name || args.identityId || result.name || result.identityId || "", 32);
  if (operation && name) return `${operation} ${name}`;
  return name || operation;
}

export function delegateAgentDetail(tool = {}, result = {}) {
  const args = toolArgsOf(tool);
  return compactText(
    args.task
    || args.prompt
    || args.summary
    || args.name
    || result.task
    || result.summary
    || args.contextPackage?.role
    || "",
  );
}

export function guidanceDetail(tool = {}, result = {}) {
  const args = toolArgsOf(tool);
  return compactText(args.name || result.name || "") || toolTargetBasename(tool, result);
}

export function fileActionKindForTool(tool = {}, result = {}) {
  const action = toolActionName(tool);
  const args = toolArgsOf(tool);
  if (action === "web_research") return String(args.operation || result.operation || "").toLowerCase() === "fetch_page" ? "read" : "search";
  if (action === "browser_action") return "browse";
  if (action === "replay_request") return "replay";
  if (action === "manage_identity") return "identity";
  if (action === "delegate_agent") return "delegate";
  if (isSearchTool(tool)) return "search";
  if (isDeletePatchTool(tool, result) || action === "delete" || result?.mode === "delete") return "delete";
  if (isFileReadTool(tool) || /read|list|inspect|outline|index|web_page/.test(action)) return "read";
  if (isFileMutationTool(tool) || /write|patch|edit|creat|delet|mutat/.test(action)) return "write";
  return "";
}

export function joinVerbAndTarget(verb, target) {
  const name = String(target || "").trim();
  return name ? `${verb} ${name}` : verb;
}

export const TOOL_STATUS_VERBS = [
  "Running Command",
  "Ran Command",
  "Command failed",
  "Updating identity",
  "Updated identity",
  "Creating folder",
  "Created folder",
  "Searching workspace",
  "Searched workspace",
  "Searching web",
  "Searched web",
  "Reading page",
  "Read page",
  "Searching",
  "Searched",
  "Reading",
  "Deleting",
  "Deleted",
  "Editing",
  "Edited",
  "Creating",
  "Created",
  "Moving",
  "Moved",
  "Browsing",
  "Browsed",
  "Replaying",
  "Replayed",
  "Delegating",
  "Delegated",
  "Failed",
  "Read",
];

export function splitToolStatusLabel(text = "") {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const verb = TOOL_STATUS_VERBS.find((item) => value === item || value.startsWith(`${item} `));
  if (!verb) return { verb: value, detail: "" };
  return { verb, detail: value.slice(verb.length).trim() };
}

export function isBareToolVerbLabel(label = "") {
  const { verb, detail } = splitToolStatusLabel(label);
  return Boolean(verb && !detail && KEEPABLE_TOOL_LABEL.test(verb));
}

export function recoveredToolTargetName(card) {
  const file = String(card?.dataset?.file || "").trim();
  if (isPlaceholderTarget(file)) return "";
  return toolTargetBasename({ args: { path: file } }, {});
}

export function decorateBareToolLabel(card, label = "") {
  const value = String(label || "").trim();
  if (!isBareToolVerbLabel(value)) return value;
  const detail = recoveredToolTargetName(card);
  if (!detail) return "";
  return `${splitToolStatusLabel(value).verb} ${detail}`;
}

export function renderToolStatusLabel(host, verb, detail = "") {
  if (!host) return;
  const nextVerb = isStubToolStatusLabel(verb) ? "" : String(verb || "").trim();
  const nextDetail = isStubToolStatusLabel(detail) ? "" : String(detail || "").trim();
  host.replaceChildren();
  if (!nextVerb && !nextDetail) return;
  const verbEl = document.createElement("span");
  verbEl.className = "agent-tool-verb";
  verbEl.textContent = nextVerb || nextDetail;
  host.appendChild(verbEl);
  if (nextVerb && nextDetail) {
    host.appendChild(document.createTextNode(" "));
    const detailEl = document.createElement("span");
    detailEl.className = "agent-tool-detail";
    detailEl.textContent = nextDetail;
    host.appendChild(detailEl);
  }
}

export function renderToolStatusLabelFromText(host, text = "") {
  const parts = splitToolStatusLabel(text);
  renderToolStatusLabel(host, parts.verb, parts.detail);
}

export function hydrateToolStatusLabels(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(".tool-card-file, .agent-command-label, .agent-file-stack-text").forEach((el) => {
    if (el.querySelector(".agent-tool-verb")) return;
    if (isStubToolStatusLabel(el.textContent)) {
      el.replaceChildren();
      return;
    }
    renderToolStatusLabelFromText(el, el.textContent);
  });
}

export function exploredToolParts(tool = {}, result = {}, phase = "success") {
  const action = toolActionName(tool);
  const file = toolTargetBasename(tool, result);
  if (phase === "error") return { verb: "Failed", detail: file };
  const running = phase === "running";
  if (isAskQuestionsTool(tool)) return { verb: "", detail: "" };
  if (action === "view_active_terminal") {
    return {
      verb: running ? "Viewing terminal" : "Viewed terminal",
      detail: String(tool.args?.terminal_id || result?.user_active_terminal || result?.terminal?.terminal_id || "active"),
    };
  }
  if (isAgentTerminalTool(tool) || /^(exec_command)$/.test(action) || /command|terminal|process|shell|script|exec/.test(action)) {
    return {
      verb: running ? "Running Command" : "Ran Command",
      detail: agentCommandContextForTool(tool),
    };
  }
  if (action === "web_research") return webResearchParts(tool, result, running);
  if (action === "browser_action") {
    return { verb: running ? "Browsing" : "Browsed", detail: browserActionDetail(tool, result) };
  }
  if (action === "replay_request") {
    return { verb: running ? "Replaying" : "Replayed", detail: replayRequestDetail(tool, result) };
  }
  if (action === "manage_identity") {
    return { verb: running ? "Updating identity" : "Updated identity", detail: identityActionDetail(tool, result) };
  }
  if (action === "delegate_agent") {
    return { verb: running ? "Delegating" : "Delegated", detail: delegateAgentDetail(tool, result) };
  }
  if (action === "create_guidance") {
    return { verb: running ? "Creating" : "Created", detail: guidanceDetail(tool, result) };
  }
  if (isSearchWorkspaceTool(tool)) {
    return { verb: running ? "Searching workspace" : "Searched workspace", detail: compactSearchNeedle(tool, result) || file };
  }
  if (isSearchTool(tool)) {
    return { verb: running ? "Searching" : "Searched", detail: compactSearchNeedle(tool, result) || file };
  }
  if (action === "apply_patch") {
    const kind = applyPatchKind(tool, result);
    const detail = applyPatchDetail(tool, result);
    if (kind === "delete") return { verb: running ? "Deleting" : "Deleted", detail };
    if (kind === "create") return { verb: running ? "Creating" : "Created", detail };
    if (kind === "move") return { verb: running ? "Moving" : "Moved", detail };
    if (kind === "ensure_dir") return { verb: running ? "Creating folder" : "Created folder", detail };
    return { verb: running ? "Editing" : "Edited", detail };
  }
  if (isDeletePatchTool(tool, result) || action === "delete" || result?.mode === "delete") {
    return { verb: running ? "Deleting" : "Deleted", detail: file };
  }
  if (isFileReadTool(tool) || /read|list|inspect|outline|index/.test(action)) {
    return { verb: running ? "Reading" : "Read", detail: file };
  }
  if (isFileMutationTool(tool) || /write|patch|edit|creat|delet|mutat/.test(action)) {
    return { verb: running ? "Editing" : "Edited", detail: file };
  }
  return { verb: "", detail: file };
}

export function exploredToolLabel(tool = {}, result = {}, phase = "success") {
  const parts = exploredToolParts(tool, result, phase);
  return joinVerbAndTarget(parts.verb, parts.detail);
}

export function fileActionMessage(tool = {}, result = {}, phase = "running") {
  return exploredToolLabel(tool, result, phase);
}

export function toolRunningMessage(tool = {}) {
  return exploredToolLabel(tool, {}, "running");
}

export function toolUiResult(result = {}) {
  const value = result?.value && typeof result.value === "object" ? result.value : {};
  const rawError = result?.error ?? value?.error;
  const error = typeof rawError === "string"
    ? rawError
    : rawError?.message || "";
  return {
    ...value,
    ...result,
    mode: result.mode || value.mode,
    summary: result.summary || value.summary,
    content: result.content || value.content,
    error,
  };
}

export function minimalToolSuccessLabel(tool = {}, result = {}) {
  const uiResult = toolUiResult(result);
  if (uiResult?.error) return "Failed";
  return exploredToolLabel(tool, uiResult, "success");
}
