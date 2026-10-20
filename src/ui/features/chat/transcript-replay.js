import { messages } from "../../core/dom-refs.js";
import { MessageIdentity } from "../../core/runtime-globals.js";
import { createUserPromptBox } from "./user-prompt-box.js";
import {
  wrapAssistantInRunChunk, currentChatExchange, appendChatTurn, appendSteeringUserTurn,
  isInternalRuntimeInputMessage, setCollapsibleFoldExpanded, thinkingContentOf,
  setThinkingFoldLabel, markActivityNode, createFileStack, updateFileStackLabel,
  createThinkingFold, absorbFileRow, isEmptyAssistantReply, restackFileRows,
} from "./turn-structure.js";
import {
  createSubagentRunCard, wireSubagentRunCard, setSubagentCardState,
} from "../agents/subagent-cards.js";
import {
  isAgentTerminalTool, commandToolFromHistoryCall, createCommandTimelineRow,
  agentCommandContextForTool, agentTerminalCommandForTool, renderCommandTimelineLabel,
} from "./command-timeline.js";
import { createToolCard, setToolCardStatus } from "./tool-cards.js";
import { toolActionName } from "./tool-labels.js";
import { renderMarkdown, attachAssistantCopyButton, syncChatStickyMask } from "./chat-messages.js";
import { syncChatEmptyState, activeChatSession } from "./chat-sessions.js";
import {
  captureChatTranscript, thinkingElapsedMs, normalizeUiTranscript,
} from "./chat-transcript.js";
import {
  createWorkFold, workFoldHeader, isWorkNode, turnWorkFold, promoteFinalAnswer, workFoldBody,
} from "./chat-work-fold.js";
import { formatAgentWorkDuration } from "../../core/text-format.js";
import { keepableToolCardLabel } from "./chat-persistence.js";
import { createQuestionAnswerCard, questionAnswerFromEvent } from "./question-answers.js";

export function renderCanonicalChatHistory(history = []) {
  const fragment = document.createDocumentFragment();
  const session = activeChatSession();
  const sourceHistory = MessageIdentity?.ensureMessageIdentity
    ? MessageIdentity.ensureMessageIdentity(history, session?.id || "chat")
    : (Array.isArray(history) ? history : []);
  let currentTaskId = "";
  const renderMessage = (message, container) => {
    if (isInternalRuntimeInputMessage(message)) return;
    const content = String(message?.content || "").trim();
    if (message.role === "user") {
      if (!content) return;
      const turn = document.createElement("div");
      turn.className = "chat-turn user";
      turn.dataset.sourceMessageId = message.source_message_id || message.id || "";
      turn.dataset.taskId = message.task_id || "";
      if (message.createdAt) turn.dataset.createdAt = message.createdAt;
      const box = createUserPromptBox(content);
      turn.appendChild(box);
      const taskId = String(message.task_id || "");
      if (taskId && taskId === currentTaskId) appendSteeringUserTurn(turn, currentChatExchange(container));
      else appendChatTurn(turn, { startsExchange: true, container });
      currentTaskId = taskId;
    } else if (message.role === "assistant") {
      const commandTools = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
        .map(commandToolFromHistoryCall)
        .filter((tool) => isAgentTerminalTool(tool));
      const subagents = Array.isArray(message.subagents) ? message.subagents : [];
      if (!content && !commandTools.length && !subagents.length) return;
      const turn = document.createElement("div");
      turn.className = "chat-turn assistant";
      if (message.createdAt) turn.dataset.createdAt = message.createdAt;
      turn.dataset.rawAssistant = content;
      let body = null;
      if (content) {
        body = document.createElement("div");
        body.className = "assistant-reply";
        renderMarkdown(body, content);
        turn.appendChild(body);
      }
      for (const tool of commandTools) turn.appendChild(createCommandTimelineRow(tool, { state: "success" }));
      for (const subagent of subagents) createSubagentRunCard({ turn }, subagent);
      appendChatTurn(turn, { container });
      wrapAssistantInRunChunk(turn);
    }
  };
  for (const message of sourceHistory) renderMessage(message, fragment);
  // History may finish with a tool-only assistant message. Attach metadata
  // only after every turn has been grouped so the footer cannot land between
  // an earlier text reply and the final tool/activity rows.
  fragment.querySelectorAll(".chat-exchange").forEach((exchange) => {
    const replies = [...exchange.querySelectorAll(".assistant-reply")];
    const copyAnchor = replies.findLast((reply) => !reply.hidden) || replies.at(-1);
    if (copyAnchor) attachAssistantCopyButton(copyAnchor);
  });
  messages.replaceChildren(fragment);
  syncChatStickyMask();
  syncChatEmptyState();
}

export function captureSessionTranscript(session, root) {
  if (!session || !root) return;
  session.transcript = captureChatTranscript(root);
}

export function toolFromTranscriptItem(item = {}) {
  const name = String(item.name || item.toolName || "tool");
  const args = item.args && typeof item.args === "object" && !Array.isArray(item.args)
    ? { ...item.args }
    : {};
  if (item.target && !args.path && item.target !== name) args.path = item.target;
  if (item.command) args.command = item.command;
  if (item.cwd) args.cwd = item.cwd;
  return { toolName: name, action: name, args };
}

export function applyThinkingRecord(fold, item = {}) {
  const startedAt = Date.parse(item.started_at || "") || Number(fold.dataset.startedAt) || Date.now();
  const durationMs = thinkingElapsedMs({
    startedAt,
    endedAt: Date.parse(item.ended_at || "") || Number(item.endedAt),
    durationMs: item.duration_ms ?? item.durationMs,
  });
  const endedAt = Date.parse(item.ended_at || "") || startedAt + durationMs;
  fold.dataset.startedAt = String(startedAt);
  fold.dataset.endedAt = String(endedAt);
  fold.dataset.durationMs = String(durationMs);
  fold.dataset.final = "true";
  const content = thinkingContentOf(fold);
  const text = String(item.text || "").trim();
  if (content && text) {
    content.hidden = false;
    renderMarkdown(content, text);
    content.classList.remove("streaming");
  }
  setThinkingFoldLabel(fold, { live: false, endedAt, durationMs });
  setCollapsibleFoldExpanded(fold, false);
  return fold;
}

export function createRestoredWorkFold(run = {}) {
  const workedForMs = Number(run.worked_for_ms) || 0;
  const startedAt = Date.parse(run.started_at || "");
  const endedAt = Date.parse(run.ended_at || "");
  const duration = formatAgentWorkDuration(0, workedForMs);
  const fold = createWorkFold({
    label: `Worked for ${duration}`,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    final: true,
    state: "complete",
    expanded: false,
  });
  const header = workFoldHeader(fold);
  header.dataset.workedForMs = String(workedForMs);
  if (run.status) header.dataset.runOutcome = String(run.status);
  if (Number.isFinite(endedAt)) header.dataset.endedAt = String(endedAt);
  return fold;
}

export function createTranscriptChatReply(event = {}) {
  const el = document.createElement("div");
  el.className = "assistant-reply";
  el.dataset.lane = "prose";
  if (event.verdict) el.dataset.workVerdict = "true";
  if (event.answered) el.dataset.answered = "true";
  if (event.created_at) el.dataset.createdAt = event.created_at;
  const text = String(event.text || "").trim();
  if (!text) {
    el.hidden = true;
    return el;
  }
  renderMarkdown(el, text);
  return el;
}

export function createToolCardFromRecord(item) {
  if (!item || item.status === "error") return null;
  const tool = toolFromTranscriptItem(item);
  const card = createToolCard(tool, { pending: false });
  if (item.verb) card.dataset.fileVerb = item.verb;
  // Older saves stored the tool name as the path of non-file rows.
  const path = String(item.path || "").trim();
  if (path && path !== toolActionName(tool)) card.dataset.path = path;
  else delete card.dataset.path;
  // Keep such older rows visible with their saved text; they no longer open anything.
  if (!item.label && item.target && item.target === toolActionName(tool)) card.dataset.file = item.target;
  setToolCardStatus(card, "success", keepableToolCardLabel(item.label) ? item.label : undefined);
  markActivityNode(card);
  return card?.isConnected || card ? card : null;
}

export function createCommandFromRecord(item = {}) {
  const row = createCommandTimelineRow(toolFromTranscriptItem({
    name: "exec_command",
    command: item.command,
    cwd: item.cwd,
    args: { command: item.command, context: item.context, cwd: item.cwd || "." },
  }), { state: item.status === "error" ? "error" : "success" });
  markActivityNode(row);
  if (item.exit_code != null) row.dataset.exitCode = String(item.exit_code);
  if (item.stdout) row.dataset.stdout = String(item.stdout);
  if (item.cwd) row.dataset.cwd = String(item.cwd);
  const startedAt = Date.parse(item.started_at || "");
  const endedAt = Date.parse(item.ended_at || "");
  if (Number.isFinite(startedAt)) row.dataset.startedAt = String(startedAt);
  if (Number.isFinite(endedAt)) row.dataset.endedAt = String(endedAt);
  if (item.duration_ms != null) row.dataset.durationMs = String(item.duration_ms);
  return row;
}

export function restoreHistoryCommandContexts(root, history = []) {
  const contextsByCall = new Map();
  const contextsByCommand = new Map();
  for (const message of history) {
    if (message?.role !== "assistant") continue;
    for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
      const tool = commandToolFromHistoryCall(call);
      if (tool.toolName !== "exec_command") continue;
      const context = agentCommandContextForTool(tool);
      const command = agentTerminalCommandForTool(tool);
      if (!command) continue;
      if (tool.callId && context) contextsByCall.set(tool.callId, context);
      const contexts = contextsByCommand.get(command) || new Set();
      contexts.add(context);
      contextsByCommand.set(command, contexts);
    }
  }
  for (const row of root.querySelectorAll(".agent-command-event")) {
    if (!row.dataset.commandContext) {
      const contexts = contextsByCommand.get(row.dataset.commandText);
      const context = contextsByCall.get(row.dataset.callId)
        || (contexts?.size === 1 ? [...contexts][0] : "");
      if (context) row.dataset.commandContext = context;
    }
    if (row.dataset.commandContext) renderCommandTimelineLabel(row, row.dataset.state);
  }
}

export function createFileStackFromRecord(event = {}) {
  const verb = event.verb || "Read";
  const stack = createFileStack(verb);
  setCollapsibleFoldExpanded(stack, false);
  const body = stack.querySelector(":scope > .agent-file-stack-body");
  for (const file of event.files || []) {
    const row = createToolCardFromRecord({ ...file, verb: file.verb || verb });
    if (row) {
      row.dataset.fileVerb = verb;
      body.appendChild(row);
    }
  }
  markActivityNode(stack);
  updateFileStackLabel(stack);
  return stack.isConnected || (stack.querySelector(".agent-file-row, .tool-card") ? stack : null);
}

export function appendTranscriptEvent(host, event) {
  if (!host || !event) return;
  if (event.type === "chat") {
    const reply = createTranscriptChatReply(event);
    if (!reply.hidden) host.appendChild(reply);
    return;
  }
  if (event.type === "thinking") {
    const fold = createThinkingFold({ startedAt: Date.parse(event.started_at || "") || Date.now() });
    applyThinkingRecord(fold, event);
    markActivityNode(fold);
    host.appendChild(fold);
    return;
  }
  if (event.type === "file_stack") {
    const stack = createFileStackFromRecord(event);
    if (stack) {
      host.appendChild(stack);
      updateFileStackLabel(stack);
    }
    return;
  }
  if (event.type === "command") {
    host.appendChild(createCommandFromRecord(event));
    return;
  }
  if (event.type === "questions") {
    const card = createQuestionAnswerCard(questionAnswerFromEvent(event));
    if (card) host.appendChild(card);
    return;
  }
  if (event.type === "subagent") {
    createSubagentRunCard({ turn: host.closest?.(".chat-turn") || host }, {
      childInvocationId: event.child_invocation_id || event.childInvocationId || "",
      childSessionId: event.child_session_id || event.childSessionId || "",
      parentSessionId: event.parent_session_id || event.parentSessionId || "",
      independent: Boolean(event.independent),
      taskId: event.task_id || event.taskId || "",
      model: event.model || "",
      status: event.status || "completed",
      summary: event.summary || "",
    }, host);
    return;
  }
  if (event.type === "tool") {
    const card = createToolCardFromRecord(event);
    if (!card) return;
    host.appendChild(card);
    absorbFileRow(card);
    return;
  }
  if (event.type !== "tool_group") return;
  for (const item of event.items || []) appendTranscriptEvent(host, item);
}

export function replyEndsWithStopped(reply) {
  const raw = String(reply?.dataset?.rawMd || reply?.textContent || "").trim();
  return /(?:^|\n)Stopped$/.test(raw);
}

// With steering, the run can answer more than once: every round that ended the
// turn, and the text after the last work in its last steering segment. Those
// answers stay visible when Worked for is collapsed; the rest of the steering
// output folds away with the work.
export function markSteeringAnswer(exchange) {
  const turns = [...(exchange?.querySelectorAll?.('.chat-turn.assistant[data-steering-segment="true"]') || [])];
  if (!turns.length) return [];
  const isAnswer = (node) => node.classList.contains("assistant-reply") && !isEmptyAssistantReply(node);
  const children = [...turns.at(-1).children];
  const trailing = children.slice(children.findLastIndex(isWorkNode) + 1).filter(isAnswer);
  const turnEnding = turns.flatMap((turn) => [...turn.querySelectorAll(':scope > .assistant-reply[data-stop-round="true"]')]).filter(isAnswer);
  const answers = [...new Set([...turnEnding, ...trailing])];
  for (const reply of answers) reply.dataset.workVerdict = "true";
  return answers;
}

export function appendStoppedPlainText(turn, segments = []) {
  if (!turn) return;
  const children = [...turn.children];
  let reply = children.findLast((node) => (
    node.classList?.contains("assistant-reply") && !node.hidden && String(node.textContent || node.dataset?.rawMd || "").trim()
  ));
  if (reply && children.slice(children.indexOf(reply) + 1).some(isWorkNode)) reply = null;
  if (!reply) {
    reply = document.createElement("div");
    reply.className = "assistant-reply";
    reply.dataset.workVerdict = "true";
    const fold = turnWorkFold(turn);
    if (fold) fold.after(reply);
    else turn.appendChild(reply);
  }
  if (replyEndsWithStopped(reply)) return;
  // A later re-render of the reply can fold an earlier label onto its last
  // line ("... detail Stopped"); take it off so the label appears once, alone.
  const raw = String(reply.dataset.rawMd || "").trim().replace(/\s+Stopped$/, "");
  const next = raw ? `${raw}\n\nStopped` : "Stopped";
  reply.dataset.rawMd = next;
  const segment = segments.find((item) => item?.el === reply);
  if (segment) segment.raw = next;
  renderMarkdown(reply, next);
  reply.dataset.rawMd = next;
  reply.hidden = false;
}

export function isDurationWorkLabel(text = "") {
  return /^(Working for|Worked for)\b/i.test(String(text || "").trim());
}

export function commandResultFailed(result = {}) {
  const status = String(result?.status || result?.value?.status || "").toLowerCase();
  const exit = result?.exitCode ?? result?.exit_code ?? result?.value?.exitCode;
  if (result?.error || result?.ok === false) return true;
  if (["failed", "stopped", "timeout", "finished_unknown", "error"].includes(status)) return true;
  return exit != null && exit !== "" && Number(exit) !== 0;
}

export function renderTranscriptRun(run, container) {
  const renderAssistantSegment = (segment, { workHeader = false, steering = false } = {}) => {
    const events = Array.isArray(segment?.events) ? segment.events : [];
    if (!events.length) return null;
    const hasActivity = events.some((event) => event.type !== "chat");
    const turn = document.createElement("div");
    turn.className = "chat-turn assistant agent-stream";
    turn.setAttribute("aria-busy", "false");
    if (steering) turn.dataset.steeringSegment = "true";
    if (run.ended_at) turn.dataset.createdAt = run.ended_at;
    else if (run.started_at) turn.dataset.createdAt = run.started_at;
    let mount = turn;
    if (workHeader) {
      turn.classList.add("has-agent-run");
      turn.dataset.usedTools = "true";
      const fold = createRestoredWorkFold(run);
      turn.appendChild(fold);
      mount = workFoldBody(fold);
    }
    for (const event of events) appendTranscriptEvent(mount, event);
    if (hasActivity || workHeader) {
      restackFileRows(turn);
      const answer = promoteFinalAnswer(turn);
      if (answer) answer.dataset.workVerdict = "true";
    }
    if (String(run.status || "") === "stopped") appendStoppedPlainText(turn);
    if (!turn.querySelector(".assistant-reply, .agent-work-header, .agent-thinking-fold, .agent-file-stack, .agent-file-row, .tool-card, .agent-command-event, .subagent-run-card, .agent-question-answer")) return null;
    appendChatTurn(turn, { container });
    wrapAssistantInRunChunk(turn);
    return turn;
  };
  const timeline = Array.isArray(run.timeline) ? run.timeline : [];
  if (timeline.length) {
    // One Worked for header per run, under the main prompt, as in the live view.
    const usedTools = (item) => item.type === "assistant" && (item.events || []).some((event) => event.type !== "chat");
    const firstUser = timeline.findIndex((item) => item.type === "user");
    const firstSteering = firstUser < 0 ? -1 : timeline.findIndex((item, index) => index > firstUser && item.type === "user");
    const mainItems = firstSteering < 0 ? timeline : timeline.slice(0, firstSteering);
    const headerItem = mainItems.find(usedTools)
      || (timeline.some(usedTools) ? mainItems.find((item) => item.type === "assistant" && item.events?.length) : null);
    let startedExchange = false;
    let steering = false;
    for (const item of timeline) {
      if (item.type === "user") {
        const turn = document.createElement("div");
        turn.className = "chat-turn user";
        if (item.created_at) turn.dataset.createdAt = item.created_at;
        turn.dataset.sourceMessageId = item.source_message_id || "";
        turn.dataset.taskId = item.task_id || "";
        turn.appendChild(createUserPromptBox(item.message, item.images));
        if (!startedExchange) {
          appendChatTurn(turn, { startsExchange: true, container });
          startedExchange = true;
        } else {
          appendSteeringUserTurn(turn, currentChatExchange(container));
          steering = true;
        }
        continue;
      }
      if (item.type !== "assistant") continue;
      renderAssistantSegment(item, { workHeader: item === headerItem, steering });
    }
    if (steering) markSteeringAnswer([...container.querySelectorAll(".chat-exchange")].at(-1));
    return;
  }

  const userMessages = Array.isArray(run.user?.messages) && run.user.messages.length
    ? run.user.messages
    : (run.user?.message ? [{
      message: run.user.message,
      created_at: run.user.created_at,
      source_message_id: run.user.source_message_id,
      task_id: run.user.task_id,
    }] : []);
  userMessages.forEach((message, index) => {
    const userTurn = document.createElement("div");
    userTurn.className = "chat-turn user";
    if (message.created_at) userTurn.dataset.createdAt = message.created_at;
    userTurn.dataset.sourceMessageId = message.source_message_id || "";
    userTurn.dataset.taskId = message.task_id || "";
    userTurn.appendChild(createUserPromptBox(message.message));
    if (index === 0) appendChatTurn(userTurn, { startsExchange: true, container });
    else appendSteeringUserTurn(userTurn, currentChatExchange(container));
  });
  const events = Array.isArray(run.events) ? run.events : [];
  if (!events.length) return;
  const hasActivity = events.some((event) => event.type !== "chat");
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant agent-stream";
  turn.setAttribute("aria-busy", "false");
  if (run.ended_at) turn.dataset.createdAt = run.ended_at;
  else if (run.started_at) turn.dataset.createdAt = run.started_at;
  let mount = turn;
  if (hasActivity) {
    turn.classList.add("has-agent-run");
    turn.dataset.usedTools = "true";
    const fold = createRestoredWorkFold(run);
    turn.appendChild(fold);
    mount = workFoldBody(fold);
  }
  for (const event of events) appendTranscriptEvent(mount, event);
  if (hasActivity) {
    restackFileRows(turn);
    const answer = promoteFinalAnswer(turn);
    if (answer) answer.dataset.workVerdict = "true";
  }
  if (String(run.status || "") === "stopped") appendStoppedPlainText(turn);
  if (!turn.querySelector(".assistant-reply, .agent-work-header, .agent-thinking-fold, .agent-file-stack, .agent-file-row, .tool-card, .agent-command-event, .subagent-run-card, .agent-question-answer")) return;
  appendChatTurn(turn, { container });
  wrapAssistantInRunChunk(turn);
}

export function renderStructuredChatTranscript(transcript, container = messages) {
  const fragment = document.createDocumentFragment();
  for (const run of normalizeUiTranscript(transcript).runs) renderTranscriptRun(run, fragment);
  fragment.querySelectorAll(".chat-exchange").forEach((exchange) => {
    const replies = [...exchange.querySelectorAll(".assistant-reply")];
    const copyAnchor = replies.findLast((reply) => !reply.hidden) || replies.at(-1);
    if (copyAnchor) attachAssistantCopyButton(copyAnchor);
  });
  container.replaceChildren(fragment);
  syncChatStickyMask();
  syncChatEmptyState();
}

export function restoreHistorySubagentCards(history = []) {
  if (!messages || messages.querySelector(".subagent-run-card")) return;
  const rows = [];
  for (const message of Array.isArray(history) ? history : []) {
    if (message?.role !== "assistant" || !Array.isArray(message.subagents)) continue;
    rows.push(...message.subagents);
  }
  if (!rows.length) return;
  const turn = [...messages.querySelectorAll(".chat-turn.assistant")].at(-1);
  if (!turn) return;
  const host = turn.querySelector(".agent-work-fold-body") || turn;
  for (const row of rows) {
    createSubagentRunCard({ turn }, {
      ...row,
      status: row.status || "completed",
    }, host);
  }
}

export function hydrateSubagentRunCards(root = messages) {
  root?.querySelectorAll?.(".subagent-run-card").forEach((card) => {
    wireSubagentRunCard(card);
    setSubagentCardState(card, card.dataset.state || "working");
  });
}
