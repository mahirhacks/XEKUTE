import { ToolMap } from "../../bootstrap.js";
import { toolCardKey, renderToolStatusLabel } from "./tool-labels.js";
import { activeChatRuns, settleVisibleParentRun } from "./chat-run-state.js";
import { scheduleLiveChatSnapshot } from "./chat-persistence.js";
import { appState } from "../../core/app-state.js";
import { syncActiveChatSession } from "./chat-sessions.js";

export const commandTimelineTickers = new Map();
export const completedCommandLifecycles = new Map();

export function isAgentTerminalTool(tool) {
  const name = tool?.toolName || tool?.action || "";
  return name === "exec_command";
}

export function commandToolFromHistoryCall(call = {}) {
  try {
    const normalized = ToolMap.normalizeToolCall?.(call);
    if (normalized) return normalized;
  } catch { /* A damaged historical tool call must not block session opening. */ }
  const toolName = String(call?.function?.name || call.toolName || call.action || "");
  let args = call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {};
  const raw = call?.function?.arguments;
  if (typeof raw === "string" && raw.trim()) {
    try { args = JSON.parse(raw); } catch { args = {}; }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    args = raw;
  }
  return { callId: String(call.id || call.callId || ""), toolName, action: toolName, args };
}

export function agentCommandContextForTool(tool) {
  return String(tool?.args?.context || tool?.context || "").trim();
}

export function agentTerminalCommandForTool(tool) {
  if (!tool) return "";
  if (tool.command) return String(tool.command);
  if (tool.args?.command) return String(tool.args.command);
  if (["status", "stop"].includes(String(tool.args?.operation || ""))) return `${tool.args.operation} ${tool.args.process_id || "process"}`;
  if (String(tool.args?.operation || "") === "list") return "list durable processes";
  if (tool.args?.executable) {
    const quote = (value) => {
      const text = String(value ?? "");
      if (!text) return '""';
      if (!/[\s"]/.test(text)) return text;
      let quoted = '"';
      let backslashes = 0;
      for (const character of text) {
        if (character === "\\") {
          backslashes += 1;
          continue;
        }
        if (character === '"') quoted += "\\".repeat(backslashes * 2 + 1) + '"';
        else quoted += "\\".repeat(backslashes) + character;
        backslashes = 0;
      }
      return quoted + "\\".repeat(backslashes * 2) + '"';
    };
    return [quote(tool.args.executable), ...(Array.isArray(tool.args.args) ? tool.args.args.map(quote) : [])].join(" ");
  }
  return "";
}

export function commandTimelineKey(tool = {}) {
  return String(tool.callId || tool.actionId || toolCardKey(tool));
}

export function commandLifecycleIds(...sources) {
  const ids = new Set();
  const add = (value) => {
    const id = String(value || "").trim();
    if (id) ids.add(id);
  };
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const value of [source, source.value]) {
      if (!value || typeof value !== "object") continue;
      add(value.callId);
      add(value.actionId);
      add(value.commandCallId);
      add(value.commandInvocationId);
      add(value.processId);
      add(value.terminalId);
      add(value.waitId);
    }
  }
  return ids;
}

export function bindCommandTimelineIdentity(row, ...sources) {
  if (!row) return row;
  const values = sources.flatMap((source) => source && typeof source === "object" ? [source, source.value] : []);
  const first = (...keys) => {
    for (const value of values) {
      for (const key of keys) {
        const id = String(value?.[key] || "").trim();
        if (id) return id;
      }
    }
    return "";
  };
  const identities = {
    callId: first("callId", "actionId", "commandCallId"),
    invocationId: first("commandInvocationId"),
    processId: first("processId"),
    terminalId: first("terminalId"),
    waitId: first("waitId", "processId", "terminalId"),
  };
  for (const [key, value] of Object.entries(identities)) {
    if (value) row.dataset[key] = value;
  }
  const context = values.map(agentCommandContextForTool).find(Boolean);
  if (context) row.dataset.commandContext = context;
  return row;
}

export function commandTimelineRowIds(row) {
  return new Set([
    row?.dataset.callId,
    row?.dataset.invocationId,
    row?.dataset.processId,
    row?.dataset.terminalId,
    row?.dataset.waitId,
  ].map((value) => String(value || "").trim()).filter(Boolean));
}

export function commandTimelineRows() {
  const rows = new Set(document.querySelectorAll(".agent-command-event"));
  for (const run of activeChatRuns.values()) {
    for (const row of run?.assistant?.turn?.querySelectorAll?.(".agent-command-event") || []) rows.add(row);
  }
  return rows;
}

export function commandLifecycleCacheKey(sessionId, id) {
  const session = String(sessionId || "").trim();
  return session ? `${session}\u0000${id}` : id;
}

export function commandTimelineIdentityMatches(row, ids) {
  return [...commandTimelineRowIds(row)].some((id) => ids.has(id));
}

export function commandCompletionForRow(row) {
  const sessionId = String(row?.dataset.sessionId || "").trim();
  for (const id of commandTimelineRowIds(row)) {
    const completion = completedCommandLifecycles.get(commandLifecycleCacheKey(sessionId, id))
      || (!sessionId ? completedCommandLifecycles.get(id) : null);
    if (completion) return completion;
  }
  return null;
}

export function rememberCommandCompletion(ids, completion, sessionId = "") {
  for (const id of ids) {
    completedCommandLifecycles.set(commandLifecycleCacheKey(sessionId, id), completion);
    // Delegated tools can render under a child session while their terminal
    // host reports the parent session. The lifecycle IDs themselves are the
    // authoritative cross-session correlation keys.
    if (sessionId) completedCommandLifecycles.set(id, completion);
  }
  while (completedCommandLifecycles.size > 500) {
    completedCommandLifecycles.delete(completedCommandLifecycles.keys().next().value);
  }
}

export function commandTimelineStateLabel(state = "running") {
  if (state === "error") return "Command failed";
  if (state === "success") return "Ran Command";
  return "Running Command";
}

export function renderCommandTimelineLabel(row, state = "running", extraDetail = "") {
  if (!row) return;
  const label = row.querySelector(".agent-command-label");
  if (!label) return;
  const detail = String(extraDetail || row.dataset.commandContext || "").trim();
  renderToolStatusLabel(label, commandTimelineStateLabel(state), detail);
}

export function createCommandTimelineRow(tool, { state = "running" } = {}) {
  const row = document.createElement("details");
  row.className = "agent-command-event";
  row.dataset.lane = "activity";
  row.dataset.commandKey = commandTimelineKey(tool);
  bindCommandTimelineIdentity(row, tool);
  row.dataset.state = state;
  row.open = false;
  const command = agentTerminalCommandForTool(tool) || "";
  if (command) row.dataset.commandText = command;
  const commandContext = agentCommandContextForTool(tool);
  if (commandContext) row.dataset.commandContext = commandContext;
  const cwd = tool.args?.cwd || tool.cwd;
  if (cwd) row.dataset.cwd = String(cwd);
  row.dataset.startedAt = String(Date.now());

  const summary = document.createElement("summary");
  summary.className = "agent-command-summary";
  const label = document.createElement("span");
  label.className = "agent-command-label";
  summary.appendChild(label);
  row.appendChild(summary);
  renderCommandTimelineLabel(row, state);

  const body = document.createElement("div");
  body.className = "agent-command-body";
  const code = document.createElement("code");
  code.textContent = command || "Command details unavailable";
  body.appendChild(code);
  row.appendChild(body);
  return row;
}

export function updateCommandTimelineRow(row, state = "success") {
  if (!row) return null;
  stopCommandTimelineTicker(row);
  row.dataset.state = state;
  delete row.dataset.waiting;
  const label = row.querySelector(".agent-command-label");
  if (label) renderCommandTimelineLabel(row, state);
  persistCommandTimelineRowState(row);
  const sessionId = String(row.dataset.sessionId || appState.activeChatSessionId || "");
  const run = activeChatRuns.get(sessionId);
  if (run) settleVisibleParentRun(run);
  return row;
}

export function persistCommandTimelineRowState(row) {
  if (!row) return;
  queueMicrotask(() => {
    const sessionId = String(row.dataset.sessionId || "");
    const run = sessionId ? activeChatRuns.get(sessionId) : null;
    if (run) {
      scheduleLiveChatSnapshot(run);
      return;
    }
    if (!sessionId || sessionId === appState.activeChatSessionId) syncActiveChatSession();
  });
}

export function startCommandTimelineTicker(row, startedAt = Date.now()) {
  if (!row) return;
  stopCommandTimelineTicker(row);
  const start = Number(startedAt) || Date.now();
  row.dataset.waitStartedAt = String(start);
  const tick = () => {
    if (!row.isConnected || row.dataset.state !== "running" || row.dataset.waiting !== "true") {
      stopCommandTimelineTicker(row);
      return;
    }
    const label = row.querySelector(".agent-command-label");
    if (label) renderCommandTimelineLabel(row, "running");
  };
  tick();
  commandTimelineTickers.set(row, setInterval(tick, 1000));
}

export function stopCommandTimelineTicker(row) {
  const timer = commandTimelineTickers.get(row);
  if (timer) clearInterval(timer);
  commandTimelineTickers.delete(row);
}

export function updateCommandTimelineLabel(identity) {
  const ids = identity && typeof identity === "object"
    ? commandLifecycleIds(identity)
    : new Set([String(identity || "").trim()].filter(Boolean));
  if (!ids.size) return;
  for (const row of commandTimelineRows()) {
    if (!commandTimelineIdentityMatches(row, ids)) continue;
    if (row.dataset.waiting !== "true") continue;
    renderCommandTimelineLabel(row, "running");
    row.dataset.state = "running";
    persistCommandTimelineRowState(row);
  }
}
