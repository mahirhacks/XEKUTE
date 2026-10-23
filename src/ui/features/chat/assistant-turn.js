import {
  turnWorkFold, workFoldBody, hasWorkNode, isFinishedWorkFold, isWorkNode, promoteFinalAnswer,
  setWorkFoldExpanded, syncWorkHeaderAffordance, unwrapWorkFold, workFoldHeader,
} from "./chat-work-fold.js";
import {
  coalesceAdjacentReplyRuns, startAssistantSteeringSegment, markActivityNode, boxHasToolUsage,
  workFollowingReply, setCollapsibleFoldExpanded, isEmptyAssistantReply, thinkingContentOf,
  createThinkingFold, setThinkingFoldLabel, finishThinkingFold, sealExploredFolds,
  restackFileRows, appendChatStreamNode, ensureAssistantWorkFold, wrapAssistantInRunChunk,
  appendChatTurn,
} from "./turn-structure.js";
import { appState } from "../../core/app-state.js";
import { messages } from "../../core/dom-refs.js";
import { formatAgentWorkDuration } from "../../core/text-format.js";
import {
  isTransientToolCardLabel, isStubToolStatusLabel, completedToolLabelFromRunning,
  isKeepableToolCard, stripFailedToolCardStubs, pruneEmptyWorkFolds,
} from "./chat-persistence.js";
import {
  markSteeringAnswer, appendStoppedPlainText, isDurationWorkLabel, commandResultFailed,
} from "./transcript-replay.js";
import { syncChatEmptyState } from "./chat-sessions.js";
import {
  renderMarkdown, attachAssistantCopyButton, scrollMessages, conciseAgentStatus,
  agentStateKindForText,
} from "./chat-messages.js";
import { setToolCardStatus } from "./tool-cards.js";
import { createSkillLoadRow } from "./skill-activity.js";
import {
  commandTimelineKey, bindCommandTimelineIdentity, commandTimelineRowIds, commandTimelineRows,
  commandCompletionForRow, createCommandTimelineRow, updateCommandTimelineRow,
  startCommandTimelineTicker,
} from "./command-timeline.js";
import { showComposerQuestionsPanel } from "./composer-questions.js";

// Detached view hosts (delegated child tabs) keep nodes in a fragment tree where
// isConnected is false even though streaming should continue on the same block.
export function streamingNodeLive(node) {
  if (!node) return false;
  if (node.isConnected) return true;
  return Boolean(node.parentNode);
}

export function coalesceDelegatedAssistantReplyFragments(assistant) {
  if (!assistant?.turn) return;
  const host = typeof assistant.workHostTurn === "function" ? assistant.workHostTurn() : assistant.turn;
  if (!host) return;
  const fold = turnWorkFold(host);
  const body = fold ? workFoldBody(fold) : null;
  if (body) coalesceAdjacentReplyRuns(body);
  coalesceAdjacentReplyRuns(host);
}

export function createAssistantTurn({ container = messages, sessionId = appState.activeChatSessionId, resuming = false } = {}) {
  const startupState = resuming ? "resuming" : "planning";
  const startupLabel = resuming ? "Resuming\u2026" : "Planning\u2026";
  const turn = document.createElement("div");
  turn.className = "chat-turn assistant agent-stream";
  turn.setAttribute("aria-busy", "true");
  turn.dataset.createdAt = new Date().toISOString();

  const contentEl = document.createElement("div");
  contentEl.className = "assistant-reply";
  contentEl.dataset.lane = "prose";
  contentEl.dataset.liveReply = "true";
  contentEl.hidden = true;
  turn.appendChild(contentEl);
  appendChatTurn(turn, { container });
  wrapAssistantInRunChunk(turn);
  // Starting another model/tool cycle extends the current AI chunk. Remove
  // its prior metadata until this continuation reaches its true final state.
  turn.closest(".chat-exchange")?.querySelectorAll(".assistant-reply-footer").forEach((node) => node.remove());
  if (container === messages) {
    syncChatEmptyState();
    scrollMessages();
  }

  const assistant = {
    turn,
    rootTurn: turn,
    sessionId: String(sessionId || appState.activeChatSessionId || ""),
    startedAt: Date.now(),
    usedTools: false,
    finalOutcome: null,
    statusEl: null,
    contentEl,
    rawContent: "",
    contentSegments: [{ el: contentEl, raw: "" }],
    commandEntries: new Map(),
    thinkingFoldEl: null,
    thinkingContentEl: null,
    thinkingRaw: "",
    activityLogEl: null,
    reasoningActivityLine: null,
    liveStateEl: null,
    workFoldEl: null,
    workFoldBodyEl: null,
    workTimer: null,
    activityStarted: false,
    modelBlockOpen: true,
    pendingSteeringHost: null,
    exploredFoldEl: null,
    exploredBodyEl: null,
    verdictOpen: false,
    pendingVerdictBreak: false,
    lastActivityKey: "",
    taskBriefEl: null,
    taskBrief: null,
    assistantTurns() {
      const exchange = (this.rootTurn || this.turn)?.closest(".chat-exchange");
      if (!exchange) return [this.turn, this.rootTurn].filter(Boolean);
      const turns = [...exchange.querySelectorAll(".chat-turn.assistant")];
      return turns.length ? turns : [this.turn].filter(Boolean);
    },
    currentContentSegment() {
      return this.contentSegments[this.contentSegments.length - 1];
    },
    createContentSegment({ after = null } = {}) {
      const next = document.createElement("div");
      next.className = "assistant-reply";
      next.dataset.lane = "prose";
      next.dataset.liveReply = "true";
      if (this.verdictOpen) next.dataset.workVerdict = "true";
      if (this.turn.getAttribute("aria-busy") === "true") next.classList.add("streaming");
      next.hidden = true;
      const host = this.conversationMount();
      const anchor = (after && after.parentElement === host ? after : null) || this.contentSegmentAnchor(host);
      if (anchor) anchor.after(next);
      else host.appendChild(next);
      const segment = { el: next, raw: "" };
      this.contentSegments.push(segment);
      this.contentEl = next;
      this.pendingVerdictBreak = false;
      return segment;
    },
    contentSegmentAnchor(host) {
      if (!host) return null;
      return [...host.children].findLast((child) => (
        child.classList.contains("agent-work-header")
        || child.classList.contains("agent-work-fold")
        || isWorkNode(child)
        || (child.classList.contains("assistant-reply") && !isEmptyAssistantReply(child))
      )) || null;
    },
    workHostTurn() {
      const current = this.turn;
      if (current && !current.classList.contains("agent-run-stop") && !current.closest(".agent-run-stop")) {
        return current;
      }
      const working = this.assistantTurns().filter((turn) => (
        !turn.classList.contains("agent-run-stop") && !turn.closest(".agent-run-stop")
      ));
      return working.at(-1) || this.rootTurn || current;
    },
    // The closing answer belongs beside the fold, never inside it.
    replyMount() {
      if (this.turn?.classList.contains("agent-run-stop") || this.turn?.closest(".agent-run-stop")) {
        return this.turn;
      }
      return this.workHostTurn() || this.turn;
    },
    // The current reply keeps its position through completion. A later tool
    // start moves that reply into the work history before adding its activity.
    conversationMount() {
      return this.replyMount();
    },
    workingMount() {
      return this.replyMount();
    },
    // The round's header lives under the main prompt even after steering, so
    // work goes in the fold only while the fold is on the current turn.
    workFoldTurn() {
      const host = this.workHostTurn();
      return host?.dataset.steeringSegment === "true" ? this.rootTurn : host;
    },
    activityBody() {
      this.noteActivity();
      const fold = this.ensureWorkFold();
      return fold?.parentElement === this.workHostTurn() ? workFoldBody(fold) : null;
    },
    toolWorkMount() {
      return this.activityBody() || this.workHostTurn();
    },
    ensureExploredGroup() {
      return null;
    },
    exploredMount() {
      return this.toolWorkMount();
    },
    ensureThinkingFold() {
      const body = this.activityBody();
      if (streamingNodeLive(this.thinkingFoldEl) && this.thinkingFoldEl.dataset.final !== "true") {
        this.thinkingContentEl = thinkingContentOf(this.thinkingFoldEl);
        return this.thinkingFoldEl;
      }
      const host = body || this.conversationMount();
      const fold = createThinkingFold({ startedAt: Date.now() });
      markActivityNode(fold);
      if (host) appendChatStreamNode(host, fold);
      this.thinkingFoldEl = fold;
      this.thinkingContentEl = thinkingContentOf(fold);
      this.thinkingRaw = "";
      return fold;
    },
    beginModelBlock({ newRound = false } = {}) {
      if (this.modelBlockOpen && !newRound) return;
      this.modelBlockOpen = true;
      const host = this.pendingSteeringHost;
      this.pendingSteeringHost = null;
      if (streamingNodeLive(host)) startAssistantSteeringSegment(this, host);
    },
    appendThinking(token) {
      const value = String(token || "");
      this.beginModelBlock();
      this.noteActivity();
      this.showPrivateReasoning();
      const fold = this.ensureThinkingFold();
      if (!fold) return;
      setThinkingFoldLabel(fold, { live: true });
      setCollapsibleFoldExpanded(fold, true);
      if (value) {
        this.thinkingRaw = `${this.thinkingRaw || ""}${value}`;
        const content = thinkingContentOf(fold) || this.thinkingContentEl;
        if (content) {
          content.hidden = false;
          renderMarkdown(content, this.thinkingRaw, { streaming: true });
        }
      }
      scrollMessages();
    },
    finishThinking({ collapse = true } = {}) {
      const folds = [];
      if (streamingNodeLive(this.thinkingFoldEl)) folds.push(this.thinkingFoldEl);
      const host = this.workHostTurn();
      host?.querySelectorAll?.(".agent-thinking-fold:not([data-final='true'])").forEach((fold) => {
        if (!folds.includes(fold)) folds.push(fold);
      });
      for (const fold of folds) {
        const content = thinkingContentOf(fold);
        const raw = String((fold === this.thinkingFoldEl ? this.thinkingRaw : "") || content?.dataset?.rawMd || "");
        finishThinkingFold(fold, { collapse });
        if (content && raw.trim()) renderMarkdown(content, raw, { streaming: false });
      }
    },
    ensureConversationSegment() {
      if (this.turn?.classList.contains("agent-run-stop") || this.turn?.closest(".agent-run-stop")) {
        return this.currentContentSegment()?.el || null;
      }
      const host = this.conversationMount();
      const current = this.currentContentSegment()?.el;
      if (streamingNodeLive(current) && !current.closest(".agent-explored-fold") && !current.closest(".agent-thinking-fold")) {
        // Streamed text keeps flowing into the current block. The only things
        // that may break it are tool work landing after it, or the block being
        // mounted inside a fold left over from a previous tool cycle.
        const inWorkFold = Boolean(current.closest(".agent-work-fold, .agent-thinking-fold, .agent-file-stack"));
        const misplaced = this.verdictOpen ? inWorkFold : current.parentElement !== host;
        if (!misplaced) {
          const followingWork = workFollowingReply(current);
          if (!followingWork) return current;
          if (isEmptyAssistantReply(current)) {
            followingWork.after(current);
            return current;
          }
        } else if (isEmptyAssistantReply(current)) {
          const anchor = this.contentSegmentAnchor(host);
          if (anchor) anchor.after(current);
          else host.appendChild(current);
          current.dataset.liveReply = "true";
          if (this.verdictOpen) current.dataset.workVerdict = "true";
          return current;
        }
      }
      this.sealCurrentContentSegment();
      return this.createContentSegment().el;
    },
    ensurePostToolContentSegment(exploredFold = null) {
      void exploredFold;
      return this.ensureConversationSegment();
    },
    createWorkStatus(host) {
      const fold = ensureAssistantWorkFold(host, { startedAt: this.startedAt });
      if (!fold) return null;
      const header = workFoldHeader(fold);
      this.statusEl = header;
      this.liveStateEl = header;
      this.workFoldEl = fold;
      this.workFoldBodyEl = workFoldBody(fold);
      return header;
    },
    stopWorkTimer() {
      if (this.workTimer) {
        clearInterval(this.workTimer);
        this.workTimer = null;
      }
    },
    startWorkTimer() {
      if (!this.activityStarted || this.finalOutcome || this.workTimer) return;
      const tick = () => {
        const label = `Working for ${formatAgentWorkDuration(this.startedAt)}`;
        let live = false;
        for (const turn of this.assistantTurns()) {
          if (turn.classList.contains("agent-run-stop") || turn.closest(".agent-run-stop")) continue;
          for (const block of turn.querySelectorAll(":scope > .agent-work-fold > .agent-work-header")) {
            if (block.dataset.final === "true") continue;
            if (block.dataset.state === "question" || block.dataset.state === "error") continue;
            live = true;
            const textEl = block.querySelector(".agent-status-text");
            if (textEl) textEl.textContent = label;
            block.dataset.state = "working";
            syncWorkHeaderAffordance(block);
          }
        }
        if (!live) this.stopWorkTimer();
      };
      tick();
      this.workTimer = setInterval(tick, 1000);
    },
    paintStartupHeader(header = this.liveStateEl) {
      if (!header || this.activityStarted || header.dataset.final === "true") return header;
      header.dataset.state = startupState;
      header.dataset.final = "false";
      const textEl = header.querySelector(".agent-status-text");
      if (textEl) textEl.textContent = startupLabel;
      syncWorkHeaderAffordance(header);
      return header;
    },
    showStartupState() {
      if (this.activityStarted || this.finalOutcome || this.liveStateEl?.dataset.final === "true") return;
      this.ensureWorkFold();
    },
    noteActivity() {
      if (this.activityStarted || this.finalOutcome || this.liveStateEl?.dataset.final === "true") return;
      this.activityStarted = true;
      this.ensureWorkFold();
    },
    // Creating the fold adopts whatever the run already wrote, so narration
    // that arrived before the first tool call moves inside the section it
    // belongs to instead of being stranded above it.
    ensureWorkFold() {
      const fold = ensureAssistantWorkFold(this.workFoldTurn(), {
        startedAt: this.startedAt,
        label: this.activityStarted ? undefined : startupLabel,
      });
      if (!fold) return null;
      const header = workFoldHeader(fold);
      if (this.startedAt && header) header.dataset.startedAt = String(this.startedAt);
      this.workFoldEl = fold;
      this.workFoldBodyEl = workFoldBody(fold);
      this.liveStateEl = header;
      this.statusEl = header;
      this.exploredFoldEl = null;
      this.exploredBodyEl = null;
      // Late events can still mount work after the run ended; that fold is
      // finished, not live.
      if (this.finalOutcome) {
        if (header && header.dataset.final !== "true") Object.assign(header.dataset, { final: "true", state: "complete" });
        return fold;
      }
      if (this.activityStarted) this.startWorkTimer();
      else this.paintStartupHeader(header);
      return fold;
    },
    splitAtContextCheckpoint(notice) {
      if (!notice || !this.turn) return null;
      const host = this.toolWorkMount();
      markActivityNode(notice);
      if (host) appendChatStreamNode(host, notice);
      else this.turn.appendChild(notice);
      return notice;
    },
    renderContentSegment(segment, { streaming = false } = {}) {
      if (!segment?.el) return;
      const text = ToolParser.cleanReplyForDisplay(segment.raw, { streaming });
      if (text) {
        segment.el.hidden = false;
        renderMarkdown(segment.el, text, { streaming });
      } else if (String(segment.raw || "").trim() && !ToolParser.isOnlyToolSyntax(segment.raw)) {
        segment.el.hidden = false;
        renderMarkdown(segment.el, String(segment.raw).trim(), { streaming });
      } else {
        segment.el.hidden = true;
      }
    },
    sealCurrentContentSegment() {
      const segment = this.currentContentSegment();
      if (!segment) return;
      this.renderContentSegment(segment, { streaming: false });
      segment.el.classList.remove("streaming");
    },
    setRawContent(value) {
      const next = String(value ?? "");
      this.ensureConversationSegment();
      const previous = this.rawContent;
      const segment = this.currentContentSegment();
      if (segment && next.startsWith(previous)) {
        segment.raw += next.slice(previous.length);
      } else if (segment) {
        for (const item of this.contentSegments) item.raw = "";
        segment.raw = next;
      }
      this.rawContent = next;
      (this.rootTurn || this.turn).dataset.rawAssistant = next;
    },
    markToolUse() {
      const current = this.currentContentSegment()?.el;
      if (current) {
        delete current.dataset.liveReply;
        delete current.dataset.workVerdict;
      }
      this.sealCurrentContentSegment();
      this.noteActivity();
      this.pendingVerdictBreak = false;
      if (this.verdictOpen) {
        this.verdictOpen = false;
        const host = this.workHostTurn();
        host?.querySelectorAll(":scope > .assistant-reply[data-work-verdict]").forEach((node) => {
          delete node.dataset.workVerdict;
        });
      }
      this.usedTools = true;
      (this.rootTurn || this.turn).dataset.usedTools = "true";
      this.ensureWorkFold();
    },
    hadToolActivity() {
      return this.assistantTurns().some((turn) => boxHasToolUsage(turn));
    },
    applyModelRound({ finishReason = "", stop = false, answerOnly = false } = {}) {
      // A full answer from a no-tool round is completion-grade; it is marked at
      // finalization. Raw markdown is set before the text renders.
      if (answerOnly) {
        const el = [...this.contentSegments].reverse().find((segment) => String(segment?.raw || "").trim())?.el;
        if (el) (this.completionAnswerEls ||= []).push(el);
      }
      this.modelBlockOpen = false;
      const reason = String(finishReason || "").trim().toLowerCase();
      if (this.turn) this.turn.dataset.finishReason = reason;
      this.finishThinking({ collapse: true });
      sealExploredFolds(this.workHostTurn());
      this.sealCurrentContentSegment();
      // A no-tool round that did not call end_turn still wrote the answer.
      // Later stop-round text must not append onto that block.
      if (stop) this.breakConversationSegment();
    },
    breakConversationSegment() {
      const current = this.currentContentSegment()?.el;
      if (!current || isEmptyAssistantReply(current)) return;
      this.sealCurrentContentSegment();
      this.createContentSegment();
    },
    // Make `el` the block that further streamed text appends to.
    makeCurrentSegment(el) {
      if (!el) return null;
      const index = this.contentSegments.findIndex((item) => item.el === el);
      const segment = index >= 0
        ? this.contentSegments.splice(index, 1)[0]
        : { el, raw: String(el.dataset?.rawMd || "") };
      this.contentSegments.push(segment);
      this.contentEl = el;
      return segment;
    },
    // An answer delivered over several frames is still one answer.
    coalesceLiveVerdict() {
      const turn = this.workHostTurn();
      const replies = [...(turn?.children || [])].filter((node) => (
        node.classList.contains("assistant-reply") && !isEmptyAssistantReply(node)
      ));
      if (replies.length < 2) return;
      const raw = this.contentSegments
        .filter((item) => replies.includes(item.el))
        .map((item) => item.raw)
        .join("");
      const first = replies[0];
      replies.slice(1).forEach((el) => el.remove());
      this.contentSegments = this.contentSegments.filter((item) => streamingNodeLive(item.el));
      const segment = this.makeCurrentSegment(first);
      if (raw) segment.raw = raw;
      this.renderContentSegment(segment, { streaming: false });
      first.dataset.workVerdict = "true";
    },
    // Closing a run: the answer written before end_turn sits beside the fold.
    // Stop-round recap text stays inside Worked for.
    openStopSection({ collapse = false, allowEmpty = true } = {}) {
      if (!this.turn || this.turn.classList.contains("agent-run-stop") || this.turn.closest(".agent-run-stop")) return;
      const turn = this.workHostTurn();
      if (!turn) return;
      this.sealCurrentContentSegment();
      this.verdictOpen = true;
      const fold = turnWorkFold(turn);
      const current = this.currentContentSegment()?.el;
      if (current && !isEmptyAssistantReply(current)) current.dataset.stopRound = "true";
      // Promote a buried completion-grade answer over the recap that closed the
      // run. A trailing answer needs no help and must not pass for the recap.
      const laterSubstantive = (el) => [...turn.querySelectorAll(".assistant-reply, .agent-command-event, .tool-card, .agent-file-row, .subagent-run-card")]
        .some((other) => other !== el && !isEmptyAssistantReply(other) && (el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING));
      for (const el of this.completionAnswerEls || []) {
        if (!el?.isConnected || el === current || isEmptyAssistantReply(el) || el.dataset.stopRound === "true") continue;
        if (laterSubstantive(el)) el.dataset.answered = "true";
      }
      const answer = promoteFinalAnswer(turn)
        || (allowEmpty ? this.createContentSegment({ after: fold }).el : null);
      if (answer) {
        answer.dataset.workVerdict = "true";
        this.makeCurrentSegment(answer);
        this.coalesceLiveVerdict();
      }
      this.pendingVerdictBreak = Boolean(String(this.currentContentSegment()?.raw || "").trim());
      if (collapse && fold && fold.dataset.userToggled !== "true") setWorkFoldExpanded(fold, false);
    },
    appendSkillLoad(skills) {
      const row = createSkillLoadRow(skills);
      if (!row) return null;
      this.finalizeThinking();
      this.markToolUse();
      appendChatStreamNode(this.toolWorkMount(), row);
      this.ensurePostToolContentSegment();
      scrollMessages();
      return row;
    },
    ensureCommandEvent(tool) {
      this.markToolUse();
      const key = commandTimelineKey(tool);
      const entries = this.commandEntries.get(key) || [];
      const existing = entries[entries.length - 1];
      if (existing?.isConnected && existing.dataset.state === "running") return existing;
      this.sealCurrentContentSegment();
      const row = createCommandTimelineRow(tool, { state: "running" });
      row.dataset.sessionId = String(this.sessionId || "");
      row.dataset.commandKey = `${key}:${entries.length + 1}`;
      markActivityNode(row);
      appendChatStreamNode(this.toolWorkMount(), row);
      entries.push(row);
      this.commandEntries.set(key, entries);
      this.ensurePostToolContentSegment();
      scrollMessages();
      return row;
    },
    failRunningCommand(tool, result = {}) {
      const processId = String(tool?.args?.process_id || result?.processId || result?.value?.processId || "").trim();
      if (!processId) return;
      for (const row of commandTimelineRows()) {
        if (!commandTimelineRowIds(row).has(processId)) continue;
        if (row.dataset.state === "running" || row.dataset.waiting === "true") {
          updateCommandTimelineRow(row, "error");
        }
      }
    },
    completeCommandEvent(tool, result = {}) {
      const operation = String(tool?.args?.operation || "run");
      if (operation === "stop") {
        const stopStatus = String(result?.status || result?.value?.status || "").toLowerCase();
        const halted = (!result?.error && result?.ok !== false) || ["stopped", "failed", "timeout"].includes(stopStatus);
        if (halted) this.failRunningCommand(tool, result);
        return null;
      }
      if (operation === "status" || operation === "list") return null;
      const key = commandTimelineKey(tool);
      const entries = this.commandEntries.get(key) || [];
      const row = [...entries].reverse().find((entry) => entry.dataset.state === "running") || entries[entries.length - 1];
      bindCommandTimelineIdentity(row, tool, result);
      if (row) {
        const stdout = [result.stdout, result.output, typeof result.transcript === "string" ? result.transcript : "", result.content]
          .map((value) => String(value || "").trim())
          .find(Boolean);
        if (stdout) row.dataset.stdout = stdout.slice(0, 50_000);
        const exit = result.exitCode ?? result.exit_code;
        if (exit != null && exit !== "") row.dataset.exitCode = String(exit);
        const cwd = result.cwd || tool.args?.cwd || tool.cwd;
        if (cwd) row.dataset.cwd = String(cwd);
        if (!row.dataset.startedAt) {
          row.dataset.startedAt = String(Number(result.startedAt || result.value?.startedAt) || Date.now());
        }
      }
      const resultMode = result?.mode || result?.value?.mode;
      const resultStatus = String(result?.status || result?.value?.status || "").toLowerCase();
      const waiting = !commandResultFailed(result) && (resultMode === "terminal_wait"
        || (resultMode === "process_start" && (!resultStatus || resultStatus === "running")));
      if (waiting) {
        if (row) {
          row.dataset.state = "running";
          row.dataset.waiting = "true";
          const completion = commandCompletionForRow(row);
          if (completion) updateCommandTimelineRow(row, completion.state);
          else startCommandTimelineTicker(row, Number(result?.startedAt || result?.value?.startedAt) || Date.now());
        }
        return row;
      }
      const failed = commandResultFailed(result);
      if (row) {
        row.dataset.endedAt = String(Date.now());
        const start = Number(row.dataset.startedAt);
        if (Number.isFinite(start)) row.dataset.durationMs = String(Math.max(0, Date.now() - start));
      }
      return updateCommandTimelineRow(row, failed ? "error" : "success");
    },
    ensureLiveState() {
      if (this.liveStateEl?.isConnected) return this.liveStateEl;
      const fold = this.ensureWorkFold();
      return workFoldHeader(fold) || this.liveStateEl;
    },
    dismissLiveState() {
      this.stopWorkTimer();
      const fold = (this.workFoldEl?.classList?.contains("agent-work-fold") && this.workFoldEl)
        || this.liveStateEl?.closest?.(".agent-work-fold");
      if (fold && !hasWorkNode(workFoldBody(fold))) unwrapWorkFold(fold);
      this.workFoldEl = null;
      this.workFoldBodyEl = null;
      this.liveStateEl = null;
      this.statusEl = null;
      this.exploredFoldEl = null;
      this.exploredBodyEl = null;
      this.thinkingFoldEl = null;
      this.thinkingContentEl = null;
      this.thinkingRaw = "";
      this.lastActivityKey = "";
    },
    setLiveState({ kind = "working", title = "Working", detail = "", meta = "LIVE" } = {}) {
      const label = conciseAgentStatus(detail || title, kind);
      if (/^Writing response/i.test(label)) return;
      if (this.liveStateEl?.dataset.final === "true") return;
      const currentLabel = this.liveStateEl?.querySelector?.(".agent-status-text")?.textContent || "";
      if (isDurationWorkLabel(currentLabel)) {
        if (this.activityStarted) this.startWorkTimer();
        return;
      }
      if (kind === "error" || kind === "question") this.stopWorkTimer();
      else if (!this.activityStarted) {
        this.showStartupState();
        this.turn?.setAttribute("aria-busy", "true");
        (this.rootTurn || this.turn)?.setAttribute("aria-busy", "true");
        return;
      } else if (this.workFoldEl?.isConnected && this.liveStateEl?.dataset.final !== "true") {
        this.startWorkTimer();
        this.turn?.setAttribute("aria-busy", "true");
        (this.rootTurn || this.turn)?.setAttribute("aria-busy", "true");
        return;
      }
      if (kind === "working" || isStubToolStatusLabel(label)) {
        this.turn?.setAttribute("aria-busy", "true");
        (this.rootTurn || this.turn)?.setAttribute("aria-busy", "true");
        return;
      }
      const block = this.ensureLiveState();
      const stateKey = `${kind}|${label}`;
      if (block.dataset.stateKey === stateKey) return;
      block.dataset.stateKey = stateKey;
      block.dataset.state = kind;
      block.dataset.final = "false";
      block.querySelector(".agent-status-icon")?.remove();
      const textEl = block.querySelector(".agent-status-text");
      if (textEl) textEl.textContent = label;
      syncWorkHeaderAffordance(block);
      block.classList.remove("status-updated");
      void block.offsetWidth;
      block.classList.add("status-updated");
      this.turn.setAttribute("aria-busy", "true");
      (this.rootTurn || this.turn).setAttribute("aria-busy", "true");
      scrollMessages();
    },
    settlePendingActivities(outcome = "complete") {
      const failed = outcome === "error" || outcome === "stopped";
      const pendingCards = this.assistantTurns().flatMap((turn) => [...turn.querySelectorAll(".tool-card.pending, .tool-card[data-state='queued'], .tool-card[data-state='running']")]);
      for (const card of pendingCards) {
        if (card.classList.contains("subagent-wait")) continue;
        const runningLabel = String(card.dataset.runningLabel || card.querySelector(".tool-card-file")?.textContent || "").trim();
        let completedLabel = String(card.dataset.completedLabel || "").trim()
          || completedToolLabelFromRunning(runningLabel);
        if (failed && !isKeepableToolCard(card)) {
          card.remove();
          continue;
        }
        if (!completedLabel || isTransientToolCardLabel(completedLabel)) {
          if (!isKeepableToolCard(card)) {
            card.remove();
            continue;
          }
          if (!completedLabel) completedLabel = completedToolLabelFromRunning(runningLabel) || runningLabel;
        }
        setToolCardStatus(card, "success", completedLabel);
      }

      for (const row of this.assistantTurns().flatMap((turn) => [...turn.querySelectorAll(".agent-command-event[data-state='running']")])) {
        // A durable terminal_wait command remains live after this agent turn
        // settles. Its row is finalized by the later terminal_complete event.
        if (row.dataset.waiting === "true") continue;
        updateCommandTimelineRow(row, failed ? "error" : "success");
      }
    },
    finishLiveState(outcome = "complete") {
      this.stopWorkTimer();
      this.finalOutcome = outcome;
      this.settlePendingActivities(outcome);
      this.finishThinking({ collapse: true });
      this.openStopSection({ collapse: true, allowEmpty: false });
      for (const turn of this.assistantTurns()) {
        stripFailedToolCardStubs(turn);
        pruneEmptyWorkFolds(turn);
        turn.setAttribute("aria-busy", "false");
      }
      const stopped = outcome === "stopped";
      if (!stopped && !this.hadToolActivity()) {
        this.dismissLiveState();
        return;
      }
      if (this.hadToolActivity()) this.ensureWorkFold();
      const duration = formatAgentWorkDuration(this.startedAt);
      const label = `Worked for ${duration}`;
      const blocks = [];
      for (const turn of this.assistantTurns()) {
        if (turn.classList.contains("agent-run-stop") || turn.closest(".agent-run-stop")) continue;
        for (const block of turn.querySelectorAll(":scope > .agent-work-fold > .agent-work-header, :scope > .agent-status-line")) {
          if (!blocks.includes(block)) blocks.push(block);
        }
      }
      if (!blocks.length) {
        const block = this.ensureLiveState();
        if (block) blocks.push(block);
      }
      if (!stopped) (this.rootTurn || this.turn).dataset.usedTools = "true";
      const endedAt = Date.now();
      const workedForMs = Math.max(0, endedAt - Number(this.startedAt || endedAt));
      for (const block of blocks) {
        block.dataset.state = "complete";
        block.dataset.runOutcome = outcome;
        block.dataset.final = "true";
        block.dataset.stateKey = `${outcome}|${label}`;
        block.querySelector(".agent-status-icon")?.remove();
        const textEl = block.querySelector(".agent-status-text");
        if (textEl) textEl.textContent = label;
        syncWorkHeaderAffordance(block);
        block.classList.remove("status-updated");
        void block.offsetWidth;
        block.classList.add("status-updated");
        block.dataset.workedForMs = String(workedForMs);
        block.dataset.startedAt = String(this.startedAt || endedAt - workedForMs);
        block.dataset.endedAt = String(endedAt);
        const turn = block.closest(".chat-turn.assistant");
        if (turn) {
          turn.dataset.workedForMs = String(workedForMs);
        }
      }
      for (const turn of this.assistantTurns()) {
        if (turn.getAttribute("aria-busy") === "true") continue;
        const fold = turnWorkFold(turn);
        if (!fold) continue;
        restackFileRows(turn);
        const answer = promoteFinalAnswer(turn);
        if (answer) answer.dataset.workVerdict = "true";
        if (isFinishedWorkFold(fold) && fold.dataset.userToggled !== "true") setWorkFoldExpanded(fold, false);
      }
      if (stopped) appendStoppedPlainText(this.workHostTurn() || this.turn, this.contentSegments);
      markSteeringAnswer((this.rootTurn || this.turn)?.closest(".chat-exchange"));
    },
    requestQuestions({
      reason = "The agent needs your input before continuing.",
      questions = [],
      requestId = "",
      file = "",
      expiresInMs = 300_000,
      approval = null,
      questionnaire = null,
    } = {}) {
      this.turn.classList.add("has-agent-run");
      return showComposerQuestionsPanel({
        reason,
        questions,
        requestId,
        file,
        expiresInMs,
        approval,
        questionnaire,
        sessionId: this.sessionId,
        onLiveState: (state) => this.setLiveState(state),
      });
    },
    ensureTaskBrief(brief) {
      if (!brief || !Array.isArray(brief.steps) || !brief.steps.length) return;
      this.taskBrief = brief;
      this.turn.classList.add("has-agent-run");
      this.setLiveState({ kind: "planning", detail: "Planning" });
    },
    updateTaskStage(phase = "") {
      this.turn.dataset.taskPhase = String(phase || "");
    },
    noteTaskActivity(text, kind = "") {
      if (kind === "warn" || kind === "error") this.setLiveState({ kind: "error", detail: text || "Action failed" });
    },
    completeTaskBrief(status = "complete") {
      this.finalOutcome = status;
      this.turn.setAttribute("aria-busy", "false");
    },
    ensureActivityLog() {
      return this.ensureLiveState();
    },
    appendActivity(text, { kind = "info" } = {}) {
      const activityText = String(text || "").trim();
      const activityKey = `${kind}:${activityText}`;
      if (!activityText) return null;
      if (activityKey === this.lastActivityKey) return this.liveStateEl;
      this.lastActivityKey = activityKey;
      if (kind === "thinking") this.setLiveState({ kind: "thinking", detail: activityText });
      else if (kind === "warn" || kind === "error") this.setLiveState({ kind: "error", detail: activityText });
      else if (kind === "tool") this.setLiveState({ kind: "working", detail: activityText });
      return this.liveStateEl;
    },
    setStatus(text) {
      const statusText = String(text || "");
      if (text) {
        this.updateTaskStage(text);
        const kind = agentStateKindForText(text);
        this.setLiveState({ kind, detail: statusText });
      }
      this.turn.dataset.activity = String(text || "");
      this.turn.setAttribute("aria-busy", "true");
    },
    clearStatus() {
      delete this.turn.dataset.activity;
      this.turn.setAttribute("aria-busy", "false");
    },
    displayContent() {
      const streaming = this.contentEl.classList.contains("streaming");
      return ToolParser.cleanReplyForDisplay(this.rawContent, { streaming });
    },
    syncDisplay() {
      const segment = this.currentContentSegment();
      if (!segment) return;
      const raw = String(segment.raw || "");
      const text = ToolParser.cleanReplyForDisplay(raw, { streaming: true }) || raw.trim();
      if (text) {
        segment.el.hidden = false;
        renderMarkdown(
          segment.el,
          text,
          { streaming: segment.el.classList.contains("streaming") },
        );
      }
      scrollMessages();
    },
    appendContent(token) {
      let value = String(token || "");
      this.beginModelBlock();
      this.noteActivity();
      this.ensureConversationSegment();
      const segment = this.currentContentSegment();
      if (segment) {
        segment.el.classList.add("streaming");
        segment.el.dataset.liveReply = "true";
      }
      if (this.pendingVerdictBreak) {
        // A new model round is extending an already-finished verdict: keep it
        // in the same block, but as its own paragraph.
        this.pendingVerdictBreak = false;
        if (segment && String(segment.raw || "").trim() && value.trim() && !/^\s*\n/.test(value)) value = `\n\n${value}`;
      }
      this.rawContent += value;
      if (segment) segment.raw += value;
      (this.rootTurn || this.turn).dataset.rawAssistant = this.rawContent;
      this.syncDisplay();
    },
    finalizeContent() {
      this.finalizeThinking();
      (this.rootTurn || this.turn).dataset.rawAssistant = this.rawContent;
      for (const segment of this.contentSegments) {
        this.renderContentSegment(segment, { streaming: false });
        segment.el.classList.remove("streaming");
      }
      const subagentRows = this.assistantTurns().flatMap((turn) => [...turn.querySelectorAll(".subagent-run-card")]);
      if (subagentRows.length) {
        const turn = this.workHostTurn() || this.rootTurn || this.turn;
        this.ensureWorkFold();
        const body = workFoldBody(turnWorkFold(turn));
        const before = body
          ? [...body.children].find((child) => child.classList.contains("assistant-reply") || child.classList.contains("agent-command-event") || child.classList.contains("agent-file-row") || child.classList.contains("tool-card") || child.classList.contains("agent-thinking-fold"))
          : null;
        for (const card of subagentRows) {
          if (!body) break;
          if (before && before.parentElement === body) body.insertBefore(card, before);
          else body.appendChild(card);
        }
      }
      this.finishLiveState(this.finalOutcome || "complete");
      for (const segment of this.contentSegments) delete segment.el.dataset.liveReply;
      const copyAnchor = this.contentSegments.findLast((segment) => !segment.el.hidden)?.el || this.contentEl;
      attachAssistantCopyButton(copyAnchor);
      this.pruneIfEmpty();
    },
    pruneIfEmpty() {
      const hasContent = this.contentSegments.some((segment) => !segment.el.hidden && segment.el.textContent.trim());
      const statusActive = this.assistantTurns().some((turn) => turn.getAttribute("aria-busy") === "true");
      const hasStatus = Boolean(this.statusEl?.isConnected && !this.statusEl.hidden);
      const hasThinking = this.assistantTurns().some((turn) => turn.querySelector(".agent-thinking-fold"));
      const hasActivity = Boolean(this.activityLogEl?.childElementCount && this.activityLogEl.isConnected);
      const hasTools = this.assistantTurns().some((turn) => turn.querySelector(".tool-card, .agent-command-event, .agent-skill-event, .agent-thinking-fold"));
      if (!hasContent && !statusActive && !hasStatus && !hasThinking && !hasActivity && !hasTools) {
        for (const turn of this.assistantTurns()) {
          const chunk = turn.closest(".agent-run-chunk");
          if (chunk) chunk.remove();
          else turn.remove();
        }
        return;
      }
      for (const turn of this.assistantTurns()) {
        if (turn === this.rootTurn) continue;
        const visible = [...turn.querySelectorAll(".assistant-reply")].some((el) => !el.hidden && el.textContent.trim());
        const extras = turn.querySelector(".tool-card, .agent-command-event, .agent-skill-event, .subagent-run-card, .agent-status-line, .agent-thinking-fold");
        if (!visible && !extras) (turn.closest(".agent-run-chunk") || turn).remove();
      }
    },
    showPrivateReasoning() {
      this.turn.classList.add("has-agent-run");
      return true;
    },
    finalizeThinking() {
      this.finishThinking({ collapse: true });
      return this.completeReasoningActivity();
    },
    completeReasoningActivity() {
      const wasThinking = this.liveStateEl?.dataset.state === "thinking";
      this.reasoningActivityLine = null;
      this.lastActivityKey = "";
      if (wasThinking && this.liveStateEl?.isConnected && this.liveStateEl.dataset.final !== "true") {
        if (this.workFoldEl?.isConnected) {
          this.startWorkTimer();
        } else {
          this.liveStateEl.remove();
          this.liveStateEl = null;
          this.statusEl = null;
        }
      }
      return wasThinking;
    },
  };

  assistant.showStartupState();
  return assistant;
}
