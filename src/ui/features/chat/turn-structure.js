import {
  turnWorkFold, workFoldBody, isWorkNode, ensureTurnWorkFold, hasWorkNode, isFinishedWorkFold,
  promoteFinalAnswer, setWorkFoldExpanded, unwrapWorkFold,
} from "./chat-work-fold.js";
import { streamingNodeLive } from "./assistant-turn.js";
import {
  toolTargetBasename, splitToolStatusLabel, renderToolStatusLabel, hydrateToolStatusLabels,
} from "./tool-labels.js";
import { renderMarkdown } from "./chat-messages.js";
import {
  pruneEmptyWorkFolds, completedToolLabelFromRunning, stripFailedToolCardStubs,
} from "./chat-persistence.js";
import { thinkingElapsedMs } from "./chat-transcript.js";
import { formatAgentWorkDuration } from "../../core/text-format.js";
import { messages } from "../../core/dom-refs.js";

// Streaming appends land in the work body once a fold exists, so ordering
// questions are answered against whichever container currently holds the run.
export function assistantStreamHost(turn) {
  return workFoldBody(turnWorkFold(turn)) || turn || null;
}

export function isAgentResponseChild(node) {
  return Boolean(node?.classList)
    && (node.classList.contains("agent-run-chunk")
      || node.classList.contains("context-checkpoint-notice")
      || node.classList.contains("assistant-reply-footer")
      || (node.classList.contains("chat-turn") && node.classList.contains("assistant")));
}

export function ensureAgentResponseHost(root) {
  const exchange = root?.classList?.contains("chat-exchange")
    ? root
    : root?.closest?.(".chat-exchange");
  const body = exchange ? chatExchangeBody(exchange) : root;
  if (!body?.appendChild) return null;
  const hosts = [...body.children].filter((child) => child.classList.contains("agent-response-host"));
  let host = hosts.at(-1);
  if (!host) {
    host = document.createElement("div");
    host.className = "agent-response-host agent-stream";
    const user = [...body.children].findLast((child) => child.classList.contains("chat-turn") && child.classList.contains("user"));
    if (user) user.after(host);
    else body.appendChild(host);
  } else {
    host.classList.add("agent-stream");
  }
  // Migrate pre-exchange history once. Multiple hosts are chronological
  // segments separated by steering prompts and must stay separate.
  if (hosts.length <= 1) {
    [...body.children].forEach((child) => {
      if (child !== host && isAgentResponseChild(child)) host.appendChild(child);
    });
  }
  return host;
}

export function createAgentResponseHost(body, after = null) {
  if (!body?.appendChild) return null;
  const host = document.createElement("div");
  host.className = "agent-response-host agent-stream";
  if (after?.parentElement === body) body.insertBefore(host, after.nextSibling);
  else body.appendChild(host);
  return host;
}

export function startAssistantSteeringSegment(assistant, responseHost) {
  if (!assistant || !responseHost) return null;
  const exchange = responseHost.closest(".chat-exchange");
  exchange?.querySelectorAll(".assistant-reply-footer").forEach((node) => node.remove());
  assistant.sealCurrentContentSegment?.();
  assistant.finishThinking?.({ collapse: true });

  // The round keeps one Working for header under the main prompt, and its
  // timer keeps running. Steering output lists its work under the steering
  // prompt without a header of its own.
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant agent-stream";
  turn.setAttribute("aria-busy", "true");
  turn.dataset.createdAt = new Date().toISOString();
  turn.dataset.steeringSegment = "true";
  const reply = document.createElement("div");
  reply.className = "assistant-reply streaming";
  reply.dataset.lane = "prose";
  reply.dataset.liveReply = "true";
  reply.hidden = true;
  turn.appendChild(reply);
  responseHost.appendChild(turn);
  wrapAssistantInRunChunk(turn);

  assistant.turn = turn;
  assistant.contentEl = reply;
  assistant.contentSegments.push({ el: reply, raw: "" });
  assistant.thinkingFoldEl = null;
  assistant.thinkingContentEl = null;
  assistant.thinkingRaw = "";
  assistant.activityLogEl = null;
  assistant.reasoningActivityLine = null;
  assistant.exploredFoldEl = null;
  assistant.exploredBodyEl = null;
  assistant.verdictOpen = false;
  assistant.pendingVerdictBreak = false;
  assistant.lastActivityKey = "";
  return turn;
}

export function markActivityNode(node) {
  if (node?.dataset) node.dataset.lane = "activity";
  return node;
}

export function boxHasToolUsage(root) {
  return Boolean(root?.querySelector?.(".tool-card:not([hidden]), .agent-file-row, .agent-file-stack, .agent-command-event, .subagent-run-card, .agent-thinking-fold"));
}

// Last sibling after `reply` that carries tool work or visible model text.
// Status lines, timers, and empty placeholders never count: streamed text must
// keep flowing into the same block across them.
export function workFollowingReply(reply) {
  let found = null;
  for (let node = reply?.nextElementSibling; node; node = node.nextElementSibling) {
    if (node.classList.contains("assistant-reply-footer")) break;
    if (isWorkNode(node) || node.classList.contains("agent-work-fold") || (node.classList.contains("assistant-reply") && !isEmptyAssistantReply(node))) {
      found = node;
    }
  }
  return found;
}

export function consecutiveAssistantRepliesAfter(startNode) {
  const replies = [];
  let node = startNode;
  while (node) {
    const next = node.nextSibling;
    if (isEmptyAssistantReply(node)) {
      node = next;
      continue;
    }
    if (node.classList?.contains("assistant-reply")) {
      replies.push(node);
      node = next;
      continue;
    }
    break;
  }
  return replies;
}

export function coalesceAdjacentAssistantReplies(replies) {
  if (!Array.isArray(replies) || replies.length < 2) return replies?.[0] || null;
  const first = replies[0];
  const markdown = replies.map((el) => String(el.dataset?.rawMd || el.textContent || "")).join("");
  replies.slice(1).forEach((el) => el.remove());
  if (markdown.trim()) {
    first.hidden = false;
    renderMarkdown(first, markdown);
  }
  return first;
}

// Merge every run of back-to-back reply blocks under `host` into one block.
// Adjacent replies with no tool work between them are always fragments of a
// single answer (older snapshots split them per streamed frame).
export function coalesceAdjacentReplyRuns(host) {
  if (!host?.children) return;
  let node = host.firstElementChild;
  while (node) {
    if (!node.classList.contains("assistant-reply")) {
      node = node.nextElementSibling;
      continue;
    }
    const run = consecutiveAssistantRepliesAfter(node);
    const first = coalesceAdjacentAssistantReplies(run);
    let next = (first || node).nextElementSibling;
    while (next && isEmptyAssistantReply(next)) next = next.nextElementSibling;
    node = next;
  }
}

// Settle a finished turn into the shape a finished turn always has: one work
// fold holding everything the run did, and the closing answer beside it. Both
// the live stream and a restored snapshot land here, so reopening a session
// cannot drift from what was on screen.
export function normalizeAssistantTurns(root) {
  if (!root?.querySelectorAll) return;
  const turns = root.classList?.contains("chat-turn") && root.classList.contains("assistant")
    ? [root]
    : [...root.querySelectorAll(".chat-turn.assistant")];
  for (const turn of turns) {
    if (turn.getAttribute("aria-busy") === "true") continue;
    if (turn.querySelector('.assistant-reply[data-live-reply="true"].streaming')) continue;
    if (turn.classList.contains("agent-run-stop") || turn.closest(".agent-run-stop")) {
      coalesceAdjacentReplyRuns(turn);
      continue;
    }
    // Work under a steering prompt belongs to the run's single Worked for
    // header. It stays flat; a fold an older save gave it is removed.
    if (turn.dataset.steeringSegment === "true") {
      const fold = turnWorkFold(turn);
      if (fold) unwrapWorkFold(fold);
      continue;
    }
    if (!hasWorkNode(turn)) {
      pruneEmptyWorkFolds(turn);
      coalesceAdjacentReplyRuns(turn);
      continue;
    }
    const fold = ensureTurnWorkFold(turn);
    restackFileRows(turn);
    coalesceAdjacentReplyRuns(workFoldBody(fold));
    const answer = promoteFinalAnswer(turn);
    if (answer) answer.dataset.workVerdict = "true";
    if (isFinishedWorkFold(fold) && fold.dataset.userToggled !== "true") setWorkFoldExpanded(fold, false);
  }
}

export function createFoldCaret() {
  const caret = document.createElement("img");
  caret.className = "agent-work-caret";
  caret.src = "assets/icons/chat_fold_caret.svg";
  caret.alt = "";
  caret.setAttribute("aria-hidden", "true");
  return caret;
}

export function setCollapsibleFoldExpanded(fold, expanded, { user = false } = {}) {
  if (!fold) return;
  if (!user && fold.dataset.userToggled === "true") return;
  if (user) fold.dataset.userToggled = "true";
  const next = Boolean(expanded);
  fold.dataset.expanded = String(next);
  fold.querySelector(":scope > .agent-status-line, :scope > .agent-explored-toggle, :scope > .agent-thinking-toggle, :scope > .agent-file-stack-toggle, :scope > .agent-question-toggle")?.setAttribute("aria-expanded", String(next));
}

export function toggleCollapsibleFold(fold) {
  if (!fold) return;
  setCollapsibleFoldExpanded(fold, fold.dataset.expanded === "false", { user: true });
}

export function isEmptyAssistantReply(node) {
  return Boolean(node?.classList?.contains("assistant-reply")
    && (node.hidden || !String(node.textContent || "").trim()));
}

export function lastReusableExploredFold(host) {
  void host;
  return null;
}

export function createExploredFold() {
  const fold = document.createElement("div");
  fold.className = "agent-explored-fold";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "agent-explored-toggle";
  const text = document.createElement("span");
  text.className = "agent-explored-text";
  text.textContent = "Tool Used";
  toggle.append(text, createFoldCaret());
  const body = document.createElement("div");
  body.className = "agent-explored-body";
  fold.append(toggle, body);
  setCollapsibleFoldExpanded(fold, true);
  return fold;
}

export function hydrateExploredFoldLabels(root) {
  root?.querySelectorAll?.(".agent-explored-text").forEach((el) => {
    if (/^Explored$/i.test(String(el.textContent || "").trim())) el.textContent = "Tool Used";
  });
}

export function exploredBodyOf(fold) {
  return fold?.querySelector?.(":scope > .agent-explored-body") || fold;
}

export function thinkingBodyOf(fold) {
  return fold?.querySelector?.(":scope > .agent-thinking-body") || fold;
}

export function thinkingContentOf(fold) {
  return fold?.querySelector?.(".agent-thinking-content") || null;
}

export function lastStandaloneThinkingFold(host) {
  const last = [...(host?.children || [])].findLast((child) => !isEmptyAssistantReply(child));
  return last?.classList.contains("agent-thinking-fold") ? last : null;
}

export function createThinkingFold({ startedAt = Date.now() } = {}) {
  const fold = document.createElement("div");
  fold.className = "agent-thinking-fold";
  fold.dataset.lane = "activity";
  fold.dataset.startedAt = String(startedAt);
  fold.dataset.final = "false";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "agent-thinking-toggle";
  const text = document.createElement("span");
  text.className = "agent-thinking-text";
  text.textContent = "Thinking";
  toggle.append(text, createFoldCaret());
  const body = document.createElement("div");
  body.className = "agent-thinking-body";
  const content = document.createElement("div");
  content.className = "agent-thinking-content streaming";
  content.hidden = true;
  body.appendChild(content);
  fold.append(toggle, body);
  setCollapsibleFoldExpanded(fold, true);
  return fold;
}

export function thinkingFoldLabel(startedAt, endedAt = Date.now(), { live = false, durationMs = null } = {}) {
  if (live) return "Thinking";
  const elapsedMs = thinkingElapsedMs({ startedAt, endedAt, durationMs });
  if (elapsedMs < 10_000) return "Thought briefly";
  const start = Number(startedAt);
  const end = Number(endedAt);
  const from = Number.isFinite(start) ? start : (Number.isFinite(end) ? end - elapsedMs : 0);
  const to = Number.isFinite(end) && end >= from ? end : from + elapsedMs;
  return `Thought for ${formatAgentWorkDuration(from, to)}`;
}

export function setThinkingFoldLabel(fold, { live = false, endedAt = Date.now(), durationMs = null } = {}) {
  if (!fold) return;
  const text = fold.querySelector(":scope > .agent-thinking-toggle > .agent-thinking-text");
  const stored = durationMs != null ? durationMs : fold.dataset.durationMs;
  if (text) text.textContent = thinkingFoldLabel(fold.dataset.startedAt, endedAt, { live, durationMs: stored });
}

export function finishThinkingFold(fold, { collapse = true, endedAt = Date.now() } = {}) {
  // A detached sub-agent host is not in the document, but the fold is still the
  // live passage. Seal it once. Later reasoning in a new round opens a new fold.
  if (!fold || fold.dataset.final === "true") return;
  if (typeof streamingNodeLive === "function" ? !streamingNodeLive(fold) : !fold.isConnected && !fold.parentNode) return;
  const start = Number(fold.dataset.startedAt);
  const durationMs = Number.isFinite(start) ? Math.max(0, endedAt - start) : 0;
  fold.dataset.final = "true";
  fold.dataset.durationMs = String(durationMs);
  fold.dataset.endedAt = String(endedAt);
  setThinkingFoldLabel(fold, { live: false, endedAt, durationMs });
  thinkingContentOf(fold)?.classList.remove("streaming");
  if (collapse) setCollapsibleFoldExpanded(fold, false);
}

export function hydrateThinkingFolds(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(".agent-thinking-fold").forEach((fold) => {
    const stored = Number(fold.dataset.durationMs);
    const durationMs = Number.isFinite(stored) && stored >= 0 ? stored : 0;
    const startedAt = Number(fold.dataset.startedAt);
    const endedAt = Number(fold.dataset.endedAt) || (Number.isFinite(startedAt) ? startedAt + durationMs : startedAt);
    fold.dataset.final = "true";
    fold.dataset.durationMs = String(durationMs);
    if (Number.isFinite(endedAt)) fold.dataset.endedAt = String(endedAt);
    setThinkingFoldLabel(fold, { live: false, endedAt, durationMs });
    thinkingContentOf(fold)?.classList.remove("streaming");
    setCollapsibleFoldExpanded(fold, false);
  });
}

export function sealExploredFolds(host) {
  if (!host?.querySelectorAll) return;
  host.querySelectorAll(":scope > .agent-explored-fold").forEach((fold) => {
    fold.dataset.sealed = "true";
  });
}

export function isPlaceholderTarget(value = "") {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  return !raw || raw === "." || raw === "./" || raw === "workspace";
}

export function fileRowDisplayDetail(row) {
  const labeled = String(row?.querySelector?.(".agent-tool-detail")?.textContent || "").trim();
  if (labeled && !isPlaceholderTarget(labeled)) return labeled;
  const raw = String(row?.dataset?.file || row?.dataset?.path || "").trim();
  if (isPlaceholderTarget(raw)) return "";
  return toolTargetBasename({ args: { path: raw } }, {}) || raw;
}

export function stackVerbForLabel(verb = "") {
  const value = String(verb || "").trim();
  const completed = completedToolLabelFromRunning(value);
  const label = completed || value;
  return splitToolStatusLabel(label).verb || label;
}

export function fileRowVerb(row) {
  return stackVerbForLabel(
    row?.dataset?.fileVerb
    || row?.querySelector?.(".agent-tool-verb")?.textContent
    || "",
  );
}

export function createFileStack(verb) {
  const stack = document.createElement("div");
  stack.className = "agent-file-stack";
  stack.dataset.lane = "activity";
  stack.dataset.verb = verb;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "agent-file-stack-toggle";
  const text = document.createElement("span");
  text.className = "agent-file-stack-text";
  toggle.append(text, createFoldCaret());
  const body = document.createElement("div");
  body.className = "agent-file-stack-body";
  stack.append(toggle, body);
  setCollapsibleFoldExpanded(stack, true);
  return stack;
}

export function syncFileRowPresentation(row) {
  if (!row) return;
  const fileEl = row.querySelector(".tool-card-file");
  if (!fileEl) return;
  const verb = fileRowVerb(row);
  const detail = fileRowDisplayDetail(row);
  // Keep the verb on stacked rows too (`Read recon`), matching the finished layout.
  renderToolStatusLabel(fileEl, verb, detail);
}

export function updateFileStackLabel(stack) {
  if (!stack) return stack;
  const rows = [...stack.querySelectorAll(":scope > .agent-file-stack-body > .agent-file-row, :scope > .agent-file-stack-body > .tool-card")];
  const verb = stack.dataset.verb || "Read";
  const text = stack.querySelector(".agent-file-stack-text");
  const n = rows.length;
  if (text) text.textContent = n === 1 ? `${verb} 1 file` : `${verb} ${n} files`;
  rows.forEach(syncFileRowPresentation);
  if (n <= 1) {
    const parent = stack.parentElement;
    const row = rows[0];
    if (parent && row) {
      parent.insertBefore(row, stack);
      stack.remove();
      markActivityNode(row);
      syncFileRowPresentation(row);
      return row;
    }
    if (!n) stack.remove();
  }
  return stack;
}

export function absorbFileRow(row) {
  if (!row?.isConnected) return row;
  markActivityNode(row);
  const verb = fileRowVerb(row);
  if (!verb) return row;
  row.dataset.fileVerb = verb;
  if (row.closest(".agent-file-stack-body")) {
    return updateFileStackLabel(row.closest(".agent-file-stack"));
  }
  const prev = row.previousElementSibling;
  const bodyOf = (stack) => stack.querySelector(":scope > .agent-file-stack-body") || stack;
  if (prev?.classList.contains("agent-file-stack") && prev.dataset.verb === verb) {
    bodyOf(prev).appendChild(row);
    return updateFileStackLabel(prev);
  }
  if ((prev?.classList.contains("agent-file-row") || prev?.classList.contains("tool-card"))
    && fileRowVerb(prev) === verb) {
    const stack = createFileStack(verb);
    prev.before(stack);
    bodyOf(stack).append(prev, row);
    markActivityNode(stack);
    return updateFileStackLabel(stack);
  }
  syncFileRowPresentation(row);
  return row;
}

export function restackFileRows(root) {
  if (!root?.querySelectorAll) return;
  const hosts = [...root.querySelectorAll(".agent-work-fold-body")];
  if (root.classList?.contains("agent-work-fold-body")) hosts.unshift(root);
  if (root.classList?.contains("chat-turn")) hosts.push(root);
  else hosts.push(...root.querySelectorAll(".chat-turn.assistant"));
  for (const host of hosts) {
    for (const child of [...host.children]) {
      if (!child.classList.contains("tool-card") && !child.classList.contains("agent-file-row")) continue;
      if (child.classList.contains("agent-file-stack")) continue;
      child.classList.add("agent-file-row");
      markActivityNode(child);
      if (!child.dataset.fileVerb) child.dataset.fileVerb = fileRowVerb(child);
      absorbFileRow(child);
    }
  }
}

export function isChatStreamPlaceholder(node) {
  return Boolean(node?.classList)
    && (node.classList.contains("assistant-reply-footer")
      || (node.classList.contains("assistant-reply") && isEmptyAssistantReply(node)));
}

export function appendChatStreamNode(host, node) {
  if (!host || !node) return node;
  const before = [...host.children].find((child) => child !== node && isChatStreamPlaceholder(child));
  if (before) host.insertBefore(node, before);
  else host.appendChild(node);
  return node;
}

// The fold owns the turn's work, so a turn that needs one gets it here and
// every existing row and interim reply is adopted into its body.
export function turnHasWorkVerdict(turn) {
  return [...(turn?.children || [])].some((child) => (
    child.classList.contains("assistant-reply") && child.dataset.workVerdict === "true"
  ));
}

export function ensureAssistantWorkFold(turn, { startedAt = 0, label } = {}) {
  if (!turn || turn.classList.contains("agent-run-stop") || turn.closest(".agent-run-stop")) return null;
  if (turn.dataset.steeringSegment === "true") return null;
  turn.classList.add("has-agent-run", "agent-stream");
  const fold = ensureTurnWorkFold(turn, { startedAt, label });
  // Keep work visible while tools are running. Collapse only after the
  // stop-round answer sits beside the fold.
  if (fold && turn.getAttribute("aria-busy") === "true" && !turnHasWorkVerdict(turn) && fold.dataset.userToggled !== "true") {
    setWorkFoldExpanded(fold, true);
  }
  return fold;
}

export function wrapAssistantInRunChunk(turn) {
  if (!turn) return null;
  if (turn.classList.contains("agent-run-chunk")) return turn;
  if (turn.parentElement?.classList.contains("agent-run-chunk")) {
    const existing = turn.parentElement;
    if (!existing.classList.contains("agent-run-stop")) existing.classList.add("agent-run-working");
    return existing;
  }
  if (!turn.classList.contains("assistant")) return null;
  const host = turn.closest(".agent-response-host")
    || ensureAgentResponseHost(turn.closest(".chat-exchange"))
    || turn.parentElement;
  if (!host) return null;
  const chunk = document.createElement("div");
  chunk.className = turn.classList.contains("agent-run-stop")
    ? "agent-run-chunk agent-run-stop"
    : "agent-run-chunk agent-run-working";
  if (turn.parentElement === host) host.insertBefore(chunk, turn);
  else host.appendChild(chunk);
  chunk.appendChild(turn);
  return chunk;
}

export function promoteCheckpointNotices(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll(".agent-response-host").forEach((host) => {
    const firstChunk = host.querySelector(":scope > .agent-run-chunk");
    const primaryTurn = firstChunk?.querySelector(":scope > .chat-turn.assistant");
    const primaryBody = workFoldBody(turnWorkFold(primaryTurn));
    if (!primaryTurn || !primaryBody) return;
    let node = firstChunk.nextSibling;
    while (node && node.parentElement === host) {
      const next = node.nextSibling;
      if (node.classList.contains("context-checkpoint-notice")) {
        primaryBody.appendChild(node);
      } else if (node.classList.contains("agent-run-chunk")) {
        const turn = node.querySelector(":scope > .chat-turn.assistant");
        const fold = turnWorkFold(turn);
        const body = workFoldBody(fold);
        if (body) {
          while (body.firstChild) primaryBody.appendChild(body.firstChild);
        }
        if (turn) {
          [...turn.children].forEach((child) => {
            if (child === fold) return;
            if (child.classList.contains("assistant-reply")) primaryTurn.appendChild(child);
            else if (!fold) primaryBody.appendChild(child);
          });
        }
        node.remove();
      }
      node = next;
    }
  });
  root.querySelectorAll(".chat-turn.assistant .context-checkpoint-notice").forEach((notice) => {
    const turn = notice.closest(".chat-turn.assistant");
    const body = workFoldBody(turnWorkFold(turn));
    if (!turn || !body || body.contains(notice)) return;
    const trailing = [];
    let node = notice.nextSibling;
    while (node) {
      const next = node.nextSibling;
      trailing.push(node);
      node = next;
    }
    body.appendChild(notice);
    trailing.forEach((item) => turn.appendChild(item));
  });
  root.querySelectorAll(".chat-turn.assistant").forEach((turn) => wrapAssistantInRunChunk(turn));
}

export function createChatExchange(container = messages) {
  const exchange = document.createElement("div");
  exchange.className = "chat-exchange";
  const body = document.createElement("div");
  body.className = "chat-exchange-body";
  exchange.appendChild(body);
  container.appendChild(exchange);
  return exchange;
}

export function chatExchangeBody(exchange) {
  if (!exchange?.classList?.contains("chat-exchange")) return exchange;
  let body = exchange.querySelector(":scope > .chat-exchange-body");
  if (body) return body;
  body = document.createElement("div");
  body.className = "chat-exchange-body";
  const footer = exchange.querySelector(":scope > .assistant-reply-footer");
  const movable = [...exchange.children].filter(
    (child) => child !== footer && !child.classList.contains("chat-exchange-body"),
  );
  exchange.insertBefore(body, footer || null);
  movable.forEach((child) => body.appendChild(child));
  if (footer) body.appendChild(footer);
  return body;
}

export function currentChatExchange(container = messages) {
  const candidate = container?.lastElementChild;
  return candidate?.classList.contains("chat-exchange") ? candidate : createChatExchange(container);
}

export function appendChatTurn(turn, { startsExchange = false, container = messages } = {}) {
  const exchange = startsExchange ? createChatExchange(container) : currentChatExchange(container);
  if (turn?.classList?.contains("assistant")) {
    ensureAgentResponseHost(exchange).appendChild(turn);
    wrapAssistantInRunChunk(turn);
    return;
  }
  chatExchangeBody(exchange).appendChild(turn);
}

// A model block that is still streaming keeps writing above the steering
// prompt. The next block starts under the latest steering prompt.
export function appendSteeringUserTurn(turn, exchange, assistant = null) {
  if (!turn || !exchange) return;
  const body = chatExchangeBody(exchange);
  const pending = assistant?.pendingSteeringHost?.isConnected ? assistant.pendingSteeringHost : null;
  const responseHost = pending || assistant?.turn?.closest?.(".agent-response-host") || ensureAgentResponseHost(exchange);
  if (responseHost?.parentElement === body) responseHost.after(turn);
  else body.appendChild(turn);
  if (pending && !pending.children.length) pending.remove();
  const nextHost = createAgentResponseHost(body, turn);
  if (assistant) assistant.pendingSteeringHost = nextHost;
}

// Older saved chats stored every turn directly under #messages. Group the real
// nodes in place so sticky prompts are bounded by their own response, allowing
// the next prompt to push the previous one away instead of crossing through it.
export function normalizeChatExchanges() {
  if (!messages) return;
  messages.querySelectorAll(".chat-turn.error").forEach((node) => node.remove());
  const children = [...messages.children];
  let exchange = null;

  for (const child of children) {
    if (child.classList.contains("chat-exchange")) {
      exchange = child;
      continue;
    }

    if (child.classList.contains("context-checkpoint-notice") || child.classList.contains("agent-run-chunk") || child.classList.contains("agent-response-host")) {
      if (exchange) chatExchangeBody(exchange).appendChild(child);
      continue;
    }

    if (child.classList.contains("chat-turn") && child.classList.contains("user")) {
      exchange = document.createElement("div");
      exchange.className = "chat-exchange";
      messages.insertBefore(exchange, child);
      exchange.appendChild(child);
      continue;
    }

    if (!exchange) {
      exchange = document.createElement("div");
      exchange.className = "chat-exchange";
      messages.insertBefore(exchange, child);
    }
    exchange.appendChild(child);
  }

  messages?.querySelectorAll(".chat-exchange").forEach((exchange) => {
    chatExchangeBody(exchange);
    ensureAgentResponseHost(exchange);
  });
  promoteCheckpointNotices(messages);
  hydrateExploredFoldLabels(messages);
  hydrateToolStatusLabels(messages);
  stripFailedToolCardStubs(messages);
  normalizeAssistantTurns(messages);
  messages?.querySelectorAll(".harness-wait-line").forEach((node) => node.remove());
  messages?.querySelectorAll(".chat-exchange").forEach((exchange) => {
    const host = ensureAgentResponseHost(exchange);
    const footer = host?.querySelector?.(".assistant-reply-footer");
    if (footer) host.appendChild(footer);
  });
}

export function isInternalRuntimeInputMessage(message = {}) {
  if (message?.__xekuteInternalRuntimeInput || message?.__xekuteInternalSubagentResult) return true;
  // Late tool and command results reach the agent through its inbox as user
  // messages. They are the agent's input, not the operator's.
  if (String(message?.source_message_id || "").startsWith("result:")) return true;
  if (message?.role !== "user") return false;
  return /^Harness (?:checkpoint:|waited\b)/.test(String(message?.content || "").trim());
}
