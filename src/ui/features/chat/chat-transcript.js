/* Structured chat timeline matching chat.json: two-lane Cursor-style events
 * (prose vs activity). Capture still walks the live DOM; normalize is the persist shape. */

export const CHAT_TRANSCRIPT_VERSION = 2;
const MAX_RUNS = 200;
const MAX_EVENTS = 400;
const MAX_ITEMS = 200;
const MAX_CHAT_TEXT = 200_000;
const MAX_THINKING_TEXT = 50_000;
const MAX_STDOUT = 50_000;
const MAX_COMMAND = 8_000;
const MAX_NAME = 200;
const MAX_PATH = 2_000;

function clip(value, limit) {
  return String(value == null ? "" : value).slice(0, limit);
}

export function toIso(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  const ms = Number(value);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  return "";
}

export function thinkingElapsedMs({ startedAt, endedAt, durationMs } = {}) {
  const stored = Number(durationMs);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  const start = Number(startedAt);
  const end = Number(endedAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
  return 0;
}

export function parseWorkedForMs(text = "") {
  const value = String(text || "");
  if (!value.trim() || /a moment/i.test(value)) return 0;
  let ms = 0;
  const hours = value.match(/(\d+)\s*h\b/i);
  const minutes = value.match(/(\d+)\s*m\b/i);
  const seconds = value.match(/(\d+)\s*s\b/i);
  if (hours) ms += Number(hours[1]) * 3_600_000;
  if (minutes) ms += Number(minutes[1]) * 60_000;
  if (seconds) ms += Number(seconds[1]) * 1_000;
  return ms;
}

function finiteMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function compact(record) {
  const result = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value == null || value === "") continue;
    if (Array.isArray(value) && !value.length) continue;
    result[key] = value;
  }
  return result;
}

function normalizeThinking(item = {}) {
  const durationMs = thinkingElapsedMs({
    startedAt: Date.parse(item.started_at || "") || Number(item.startedAt),
    endedAt: Date.parse(item.ended_at || "") || Number(item.endedAt),
    durationMs: item.duration_ms ?? item.durationMs,
  });
  return compact({
    type: "thinking",
    lane: eventLane("thinking", item),
    started_at: toIso(item.started_at || item.startedAt),
    ended_at: toIso(item.ended_at || item.endedAt),
    duration_ms: durationMs,
    text: clip(item.text, MAX_THINKING_TEXT),
  });
}

function eventLane(type, event = {}) {
  const lane = String(event.lane || "").toLowerCase();
  if (lane === "prose" || lane === "activity") return lane;
  return type === "chat" ? "prose" : "activity";
}

function normalizeTool(item = {}) {
  const args = item.args && typeof item.args === "object" && !Array.isArray(item.args)
    ? { ...item.args }
    : {};
  const target = clip(item.target || item.path || args.path || args.file || "", MAX_PATH);
  if (target && !args.path) args.path = target;
  const verb = clip(item.verb || "", 40);
  return compact({
    type: "tool",
    lane: eventLane("tool", item),
    verb: verb || undefined,
    name: clip(item.name || item.toolName || item.action || "", MAX_NAME),
    target,
    path: clip(item.path || target, MAX_PATH),
    args,
    status: String(item.status || "ok").toLowerCase() === "error" ? "error" : "ok",
  });
}

function normalizeCommand(item = {}) {
  const durationMs = thinkingElapsedMs({
    startedAt: Date.parse(item.started_at || "") || Number(item.startedAt),
    endedAt: Date.parse(item.ended_at || "") || Number(item.endedAt),
    durationMs: item.duration_ms ?? item.durationMs,
  });
  const exit = item.exit_code ?? item.exitCode;
  return compact({
    type: "command",
    lane: eventLane("command", item),
    name: clip(item.name || "exec_command", MAX_NAME) || "exec_command",
    command: clip(item.command, MAX_COMMAND),
    cwd: clip(item.cwd || ".", MAX_PATH) || ".",
    exit_code: Number.isFinite(Number(exit)) ? Number(exit) : undefined,
    status: String(item.status || "ok").toLowerCase() === "error" ? "error" : "ok",
    stdout: clip(item.stdout || "", MAX_STDOUT),
    started_at: toIso(item.started_at || item.startedAt),
    ended_at: toIso(item.ended_at || item.endedAt),
    duration_ms: durationMs || undefined,
  });
}

function normalizeItem(item) {
  const type = String(item?.type || "").toLowerCase();
  if (type === "thinking") return normalizeThinking(item);
  if (type === "command") return normalizeCommand(item);
  if (type === "tool") return normalizeTool(item);
  return null;
}

function normalizeChatEvent(event = {}) {
  return compact({
    type: "chat",
    lane: eventLane("chat", event),
    created_at: toIso(event.created_at || event.createdAt),
    verdict: event.verdict === true ? true : undefined,
    text: clip(event.text || event.content || "", MAX_CHAT_TEXT),
  });
}

function normalizeFileStack(event = {}) {
  const files = (Array.isArray(event.files) ? event.files : event.items || [])
    .map((item) => normalizeTool({ ...item, type: "tool", verb: item.verb || event.verb }))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  return compact({
    type: "file_stack",
    lane: eventLane("file_stack", event),
    verb: clip(event.verb || "Read", 40) || "Read",
    started_at: toIso(event.started_at || event.startedAt),
    ended_at: toIso(event.ended_at || event.endedAt),
    files,
  });
}

function normalizeToolGroup(event = {}) {
  const items = (Array.isArray(event.items) ? event.items : [])
    .map(normalizeItem)
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  return compact({
    type: "tool_group",
    lane: eventLane("tool_group", event),
    started_at: toIso(event.started_at || event.startedAt),
    ended_at: toIso(event.ended_at || event.endedAt),
    items,
  });
}

function normalizeEvent(event) {
  const type = String(event?.type || "").toLowerCase();
  if (type === "chat") return normalizeChatEvent(event);
  if (type === "thinking") return normalizeThinking(event);
  if (type === "file_stack") return normalizeFileStack(event);
  if (type === "tool") return normalizeTool(event);
  if (type === "command") return normalizeCommand(event);
  if (type === "tool_group") return normalizeToolGroup(event);
  return null;
}

function normalizeRun(run = {}, index = 0) {
  const events = (Array.isArray(run.events) ? run.events : [])
    .map(normalizeEvent)
    .filter(Boolean)
    .slice(0, MAX_EVENTS);
  const user = run.user && typeof run.user === "object" ? run.user : {};
  const message = clip(user.message || user.text || "", MAX_CHAT_TEXT);
  if (!message && !events.length) return null;
  const worked = finiteMs(run.worked_for_ms ?? run.workedForMs);
  const status = String(run.status || "").toLowerCase();
  return compact({
    id: clip(run.id || `run-${String(index).padStart(3, "0")}`, 120),
    started_at: toIso(run.started_at || run.startedAt),
    ended_at: toIso(run.ended_at || run.endedAt),
    worked_for_ms: worked ?? 0,
    status: ["stopped", "inconclusive"].includes(status) ? status : undefined,
    user: compact({
      created_at: toIso(user.created_at || user.createdAt || run.started_at),
      message,
    }),
    events,
  });
}

export function normalizeUiTranscript(value) {
  if (!value || typeof value !== "object") return { version: CHAT_TRANSCRIPT_VERSION, runs: [] };
  const sourceRuns = Array.isArray(value.runs)
    ? value.runs
    : Array.isArray(value.sessions)
      ? value.sessions.flatMap((session) => Array.isArray(session?.runs) ? session.runs : [])
      : [];
  const runs = sourceRuns.map(normalizeRun).filter(Boolean).slice(0, MAX_RUNS);
  return { version: CHAT_TRANSCRIPT_VERSION, runs };
}

export function hasStructuredTranscript(value) {
  const transcript = normalizeUiTranscript(value);
  return transcript.runs.some((run) => run.user?.message || run.events?.length);
}

function classListContains(node, name) {
  return Boolean(node?.classList?.contains?.(name));
}

function dataset(node) {
  return node?.dataset && typeof node.dataset === "object" ? node.dataset : {};
}

function childList(node) {
  return [...(node?.children || [])];
}

function replyText(node) {
  return String(dataset(node).rawMd || node?.textContent || "").trim();
}

function isEmptyReply(node) {
  return classListContains(node, "assistant-reply") && (node.hidden || !replyText(node));
}

function isVerdictReply(node) {
  return classListContains(node, "assistant-reply") && dataset(node).workVerdict === "true";
}

function userMessageText(turn) {
  const preview = turn?.querySelector?.(".user-prompt-preview, .chat-box-content");
  return String(preview?.textContent || turn?.textContent || "").trim();
}

function workDurationMs(fold) {
  const stored = finiteMs(dataset(fold).workedForMs);
  if (stored != null) return stored;
  const label = fold?.querySelector?.(".agent-status-text")?.textContent || "";
  return parseWorkedForMs(label);
}

function foldStatus(fold) {
  const outcome = String(dataset(fold).runOutcome || "").toLowerCase();
  if (outcome === "stopped") return "stopped";
  if (outcome === "inconclusive") return "inconclusive";
  const label = String(fold?.querySelector?.(".agent-status-text")?.textContent || "").trim();
  if (/^Stopped\b/i.test(label)) return "stopped";
  if (/^Finished in\b/i.test(label)) return "inconclusive";
  return "";
}

function captureThinkingEvent(fold) {
  const startedAt = Number(dataset(fold).startedAt) || 0;
  const stored = finiteMs(dataset(fold).durationMs);
  const endedAt = Number(dataset(fold).endedAt) || 0;
  const liveElapsed = dataset(fold).final !== "true" && startedAt
    ? Math.max(0, Date.now() - startedAt)
    : 0;
  const durationMs = thinkingElapsedMs({
    startedAt,
    endedAt,
    durationMs: stored ?? (liveElapsed || undefined),
  });
  const content = fold.querySelector?.(".agent-thinking-content");
  return compact({
    type: "thinking",
    lane: "activity",
    started_at: toIso(startedAt),
    ended_at: toIso(endedAt || (startedAt ? startedAt + durationMs : "")),
    duration_ms: durationMs,
    text: clip(content?.dataset?.rawMd || content?.textContent || "", MAX_THINKING_TEXT),
  });
}

function captureToolItem(card) {
  if (!card || card.hidden) return null;
  const name = clip(dataset(card).toolAction || "", MAX_NAME);
  const path = clip(dataset(card).path || dataset(card).file || "", MAX_PATH);
  const target = clip(
    dataset(card).file || path.split(/[/\\]/).filter(Boolean).at(-1) || "",
    MAX_PATH,
  );
  if (!name && !target && !path) return null;
  return compact({
    type: "tool",
    lane: "activity",
    verb: clip(dataset(card).fileVerb || dataset(card).verb || "", 40) || undefined,
    name,
    target: target.split(/[/\\]/).filter(Boolean).at(-1) || target,
    path: path || target,
    args: path || target ? { path: path || target } : {},
    status: dataset(card).state === "error" ? "error" : "ok",
  });
}

function captureFileStack(stack) {
  const files = childList(stack.querySelector?.(":scope > .agent-file-stack-body") || stack)
    .map(captureToolItem)
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  if (!files.length) return null;
  return compact({
    type: "file_stack",
    lane: "activity",
    verb: clip(dataset(stack).verb || files[0]?.verb || "Read", 40) || "Read",
    started_at: toIso(dataset(stack).startedAt),
    ended_at: toIso(dataset(stack).endedAt),
    files,
  });
}

export function mergeConsecutiveFileEvents(events = []) {
  const out = [];
  for (const event of events) {
    if (event?.type === "tool" && event.verb) {
      const last = out.at(-1);
      if (last?.type === "tool" && last.verb === event.verb) {
        out[out.length - 1] = compact({
          type: "file_stack",
          lane: "activity",
          verb: event.verb,
          files: [normalizeTool(last), normalizeTool(event)].filter(Boolean),
        });
        continue;
      }
      if (last?.type === "file_stack" && last.verb === event.verb) {
        last.files = [...(last.files || []), normalizeTool(event)].filter(Boolean).slice(0, MAX_ITEMS);
        continue;
      }
    }
    out.push(event);
  }
  return out;
}

function captureCommandItem(row) {
  const command = clip(
    dataset(row).commandText || row.querySelector?.("code")?.textContent || "",
    MAX_COMMAND,
  );
  if (!command) return null;
  const startedAt = dataset(row).startedAt || dataset(row).waitStartedAt;
  const endedAt = dataset(row).endedAt;
  const durationMs = finiteMs(dataset(row).durationMs);
  const exit = dataset(row).exitCode;
  return compact({
    type: "command",
    lane: "activity",
    name: "exec_command",
    command,
    cwd: clip(dataset(row).cwd || ".", MAX_PATH) || ".",
    exit_code: exit === "" || exit == null ? undefined : Number(exit),
    status: dataset(row).state === "error" ? "error" : "ok",
    stdout: clip(dataset(row).stdout || "", MAX_STDOUT),
    started_at: toIso(startedAt),
    ended_at: toIso(endedAt),
    duration_ms: durationMs,
  });
}

function captureWorkItem(node) {
  if (classListContains(node, "agent-thinking-fold")) return captureThinkingEvent(node);
  if (classListContains(node, "agent-command-event")) return captureCommandItem(node);
  if (classListContains(node, "agent-file-row")
    || classListContains(node, "tool-card")
    || classListContains(node, "subagent-run-card")) {
    return captureToolItem(node);
  }
  return null;
}

function captureNode(node, events, { verdict = false } = {}) {
  if (!node?.classList) return;
  if (classListContains(node, "agent-work-header") || classListContains(node, "agent-status-line")) return;
  if (classListContains(node, "assistant-reply")) {
    if (isEmptyReply(node)) return;
    events.push(compact({
      type: "chat",
      lane: "prose",
      created_at: toIso(dataset(node).createdAt),
      verdict: verdict || isVerdictReply(node) ? true : undefined,
      text: clip(replyText(node), MAX_CHAT_TEXT),
    }));
    return;
  }
  if (classListContains(node, "agent-thinking-fold")) {
    events.push(captureThinkingEvent(node));
    return;
  }
  if (classListContains(node, "agent-file-stack")) {
    const stack = captureFileStack(node);
    if (stack) events.push(stack);
    return;
  }
  if (classListContains(node, "agent-work-fold")) {
    captureHostChildren(node.querySelector?.(":scope > .agent-work-fold-body") || node, events);
    return;
  }
  if (classListContains(node, "agent-explored-fold")) {
    captureHostChildren(node.querySelector?.(":scope > .agent-explored-body") || node, events);
    return;
  }
  if (classListContains(node, "agent-command-event")) {
    const command = captureCommandItem(node);
    if (command) events.push(command);
    return;
  }
  if (classListContains(node, "agent-file-row")
    || classListContains(node, "tool-card")
    || classListContains(node, "subagent-run-card")) {
    const tool = captureWorkItem(node);
    if (tool) events.push(tool);
  }
}

function captureHostChildren(host, events, { verdict = false } = {}) {
  for (const child of childList(host)) {
    if (classListContains(child, "agent-work-header") || classListContains(child, "agent-status-line")) continue;
    captureNode(child, events, { verdict: verdict || isVerdictReply(child) });
  }
}

function captureAssistantTurn(turn, events) {
  captureHostChildren(turn, events);
}

function lastEventTime(events = []) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const stamp = event.ended_at || event.created_at || event.started_at
      || event.items?.at?.(-1)?.ended_at
      || event.items?.at?.(-1)?.started_at;
    if (stamp) return stamp;
  }
  return "";
}

function captureExchangeRun(exchange, index) {
  const body = exchange.querySelector?.(":scope > .chat-exchange-body") || exchange;
  const userTurn = body.querySelector?.(":scope > .chat-turn.user")
    || exchange.querySelector?.(".chat-turn.user");
  const userText = userTurn ? userMessageText(userTurn) : "";
  const events = [];
  const host = body.querySelector?.(":scope > .agent-response-host") || body;
  for (const turn of host.querySelectorAll?.(".chat-turn.assistant") || []) {
    if (classListContains(turn, "agent-run-stop") || turn.closest?.(".agent-run-stop")) continue;
    captureAssistantTurn(turn, events);
  }
  if (!userText && !events.length) return null;
  const fold = host.querySelector?.(".chat-turn.assistant > .agent-work-fold");
  const header = fold?.querySelector?.(":scope > .agent-work-header")
    || host.querySelector?.(".chat-turn.assistant > .agent-work-header, .chat-turn.assistant > .agent-work-fold");
  const startedAt = toIso(dataset(header).startedAt) || toIso(dataset(userTurn).createdAt)
    || toIso(events[0]?.created_at || events[0]?.started_at);
  return compact({
    id: `run-${String(index).padStart(3, "0")}`,
    started_at: startedAt,
    ended_at: toIso(dataset(header).endedAt) || lastEventTime(events),
    worked_for_ms: workDurationMs(header) || 0,
    status: foldStatus(header) || undefined,
    user: compact({
      created_at: toIso(dataset(userTurn).createdAt) || startedAt,
      message: userText,
    }),
    events: mergeConsecutiveFileEvents(events),
  });
}

function chatExchangesOf(root) {
  if (!root) return [];
  if (classListContains(root, "chat-exchange")) return [root];
  return [...(root.querySelectorAll?.(":scope > .chat-exchange") || [])];
}

export function captureChatTranscript(root) {
  const exchanges = chatExchangesOf(root);
  return normalizeUiTranscript({
    version: CHAT_TRANSCRIPT_VERSION,
    runs: exchanges.map((exchange, index) => captureExchangeRun(exchange, index)).filter(Boolean),
  });
}
