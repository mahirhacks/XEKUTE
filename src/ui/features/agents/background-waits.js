import { appState } from "../../core/app-state.js";
import { anyChatSessionRunning, activeChatRuns } from "../chat/chat-run-state.js";
import { formatCommandWaitClock, formatWaitClock } from "../../core/text-format.js";
import {
  updateCommandTimelineLabel, commandLifecycleIds, commandTimelineRows,
  commandTimelineIdentityMatches, rememberCommandCompletion, updateCommandTimelineRow,
} from "../chat/command-timeline.js";
import { sendMessageWithAgentRuntime } from "../chat/agent-run.js";
import { isChatSessionStoppedByOperator } from "../chat/run-stop.js";
import { chatSessionIdForRuntimeId } from "./delegated-child-runs.js";
import { renderToolStatusLabelFromText } from "../chat/tool-labels.js";
import { messages } from "../../core/dom-refs.js";

export const waitCardTickers = new Map();
export const completedAgentProcessIds = new Set();

export function hasCompleteForWait(waitId) {
  if (!waitId) return false;
  if (appState.pendingBackgroundWaitEvents.some((item) => item.phase === "complete" && String(item.payload.subagentId || item.payload.waitId || item.payload.processId || item.payload.terminalId || "") === waitId)) {
    return true;
  }
  if (completedBackgroundWaitIds.has(waitId)) return true;
  return false;
}

export const completedBackgroundWaitIds = new Set();

export function drainPendingBackgroundWaitEvents() {
  if (anyChatSessionRunning() || appState.subagentCompletionPending) return;
  const next = appState.pendingBackgroundWaitEvents.shift();
  if (!next) return;
  handleBackgroundWaitEvent(next.payload, next.kind, next.phase);
}

export function beginModelRunCommandWait(run, assistant, payload = {}) {
  if (!run) return;
  const commands = Array.isArray(payload.commands) ? payload.commands : [];
  run.commandWait = true;
  run.commandWaitIds = new Set(commands.map((item) => String(item.processId || "")).filter((id) => id && !completedAgentProcessIds.has(id)));
  run.commandWaitStartedAt = Number(payload.startedAt) || Date.now();
  if (!run.commandWaitIds.size) return;
  const host = assistant?.toolWorkMount?.();
  if (!host) return;
  let line = host.querySelector(":scope > .command-run-wait");
  if (!line) {
    line = document.createElement("div");
    line.className = "command-run-wait";
    line.innerHTML = `<div class="command-run-wait-title">Running command</div><div class="command-run-wait-clock"></div>`;
    host.appendChild(line);
  }
  run.commandWaitLine = line;
  const tick = () => {
    const clock = line.querySelector(".command-run-wait-clock");
    if (!clock) return;
    clock.textContent = `Waiting for command ${formatCommandWaitClock(Date.now() - run.commandWaitStartedAt)}`;
  };
  tick();
  if (line._timer) clearInterval(line._timer);
  line._timer = setInterval(tick, 1000);
}

export function commandWaitRunForProcess(processId) {
  const id = String(processId || "");
  if (!id) return null;
  for (const run of activeChatRuns.values()) {
    if (run?.commandWaitIds?.has(id)) return run;
  }
  return null;
}

// The agent reads command output from its inbox in the main process. Here the
// wait line only goes away once every command it was waiting for has exited;
// the run stays open until the agent's next round settles it.
export function absorbModelRunCommandResult(payload = {}) {
  const processId = String(payload.processId || "");
  if (processId) completedAgentProcessIds.add(processId);
  const run = commandWaitRunForProcess(processId);
  if (!run) return false;
  run.commandWaitIds.delete(processId);
  if (run.commandWaitIds.size) return true;
  const host = run.assistant?.toolWorkMount?.();
  const line = run.commandWaitLine?.isConnected
    ? run.commandWaitLine
    : host?.querySelector?.(":scope > .command-run-wait");
  if (line?._timer) clearInterval(line._timer);
  line?.remove();
  run.commandWaitLine = null;
  return true;
}

export async function handleBackgroundWaitEvent(payload, kind = "terminal", phase = "complete") {
  if (appState.subagentCompletionPending) {
    appState.pendingBackgroundWaitEvents.unshift({ payload, kind, phase });
    return;
  }
  appState.subagentCompletionPending = true;
  try {
    const waitId = String(payload.subagentId || payload.waitId || payload.processId || payload.terminalId || "");
    if (phase === "complete" && waitId) completedBackgroundWaitIds.add(waitId);
    const status = String(payload.status || (phase === "checkpoint" ? "running" : "complete"));
    const elapsedMs = Number.isFinite(Number(payload.elapsedMs))
      ? Number(payload.elapsedMs)
      : Math.max(0, Date.now() - Date.parse(payload.startedAt || "") || 0);
    const elapsedLabel = formatWaitClock(elapsedMs);
    if (phase === "checkpoint") {
      const waitLabel = kind === "terminal" ? `Running command · ${elapsedLabel}` : `waiting ${elapsedLabel}`;
      updateWaitCardLabel(waitId, waitLabel);
      if (kind === "terminal") updateCommandTimelineLabel(payload);
    } else {
      finalizeSubagentWaitingCard(waitId, status, elapsedLabel);
      if (kind === "terminal") finalizeCommandTimeline(payload, status, payload.exitCode);
    }
    // Command status reaches the agent through its inbox in the main process.
    if (kind === "terminal") return;
    const transcript = String(payload.stdout || "").trim();
    const stderr = String(payload.stderr || "").trim();
    const target = String(payload.target || "");
    const terminalId = String(payload.terminalId || "");
    const clipped = transcript.length > 8000 ? `${transcript.slice(-8000)}\n…(truncated)` : transcript;
    const errClipped = stderr.length > 2000 ? `${stderr.slice(-2000)}\n…(truncated)` : stderr;
    const message = phase === "checkpoint"
      ? [
          `Harness checkpoint: traffsucker subagent ${waitId || ""} has been waiting ${elapsedLabel}${target ? ` for ${target}` : ""} and is still running.`,
          terminalId ? `Terminal: ${terminalId}` : "",
          clipped ? `Current terminal log:\n\`\`\`\n${clipped}\n\`\`\`` : "No terminal transcript was captured yet.",
          errClipped ? `stderr:\n\`\`\`\n${errClipped}\n\`\`\`` : "",
          "Decide whether the run looks healthy. Leave it running, stop it with stop_process, or take another action. The harness will resume you again when it exits.",
        ].filter(Boolean).join("\n\n")
      : [
          `Harness waited ${elapsedLabel}: traffsucker subagent ${waitId ? `${waitId} ` : ""}finished with status "${status}"${target ? ` for ${target}` : ""}.`,
          terminalId ? `Terminal: ${terminalId}` : "",
          clipped ? `Terminal transcript:\n\`\`\`\n${clipped}\n\`\`\`` : "No terminal transcript was captured.",
          errClipped ? `stderr:\n\`\`\`\n${errClipped}\n\`\`\`` : "",
          "Review the captured traffic/artifacts and summarize results for the operator.",
        ].filter(Boolean).join("\n\n");
    const targetSessionId = chatSessionIdForRuntimeId(payload.sessionId || payload.parentSessionId || "") || appState.activeChatSessionId;
    if (isChatSessionStoppedByOperator(targetSessionId) || isChatSessionStoppedByOperator(payload.sessionId) || isChatSessionStoppedByOperator(payload.parentSessionId)) {
      return;
    }
    await sendMessageWithAgentRuntime({
      internal: true,
      sessionId: targetSessionId,
      text: message,
      skipContextFiles: true,
    });
  } finally {
    appState.subagentCompletionPending = false;
    queueMicrotask(drainPendingBackgroundWaitEvents);
  }
}

export async function handleBackgroundWaitCompletion(payload, kind = "terminal") {
  return handleBackgroundWaitEvent(payload, kind, "complete");
}

export async function handleSubagentCompletion(payload) {
  return handleBackgroundWaitEvent(payload, "subagent", "complete");
}

export function startWaitCardTicker(card) {
  const waitId = card.dataset.waitId || card.dataset.subagentId || "";
  if (!waitId) return;
  stopWaitCardTicker(waitId);
  const tick = () => {
    if (!card.isConnected || card.dataset.state !== "waiting") {
      stopWaitCardTicker(waitId);
      return;
    }
    const startedAt = Number(card.dataset.waitStartedAt) || Date.now();
    const waitKind = card.dataset.waitKind || "terminal";
    const elapsed = formatWaitClock(Date.now() - startedAt);
    const label = waitKind === "terminal" ? `Running command · ${elapsed}` : `waiting ${elapsed}`;
    const fileEl = card.querySelector(".tool-card-file");
    if (fileEl) renderToolStatusLabelFromText(fileEl, label);
    card.setAttribute("aria-label", label);
  };
  tick();
  const timer = setInterval(tick, 1000);
  waitCardTickers.set(waitId, timer);
}

export function stopWaitCardTicker(waitId) {
  const timer = waitCardTickers.get(waitId);
  if (timer) clearInterval(timer);
  waitCardTickers.delete(waitId);
}

export function updateWaitCardLabel(waitId, label) {
  if (!messages || !waitId) return;
  for (const card of messages.querySelectorAll(".tool-card.subagent-wait[data-subagent-id], .tool-card.subagent-wait[data-wait-id]")) {
    const cardId = card.dataset.subagentId || card.dataset.waitId || "";
    if (cardId !== waitId) continue;
    const fileEl = card.querySelector(".tool-card-file");
    if (fileEl) renderToolStatusLabelFromText(fileEl, label);
    card.setAttribute("aria-label", label);
  }
}

export function finalizeCommandTimeline(identity, status = "complete", exitCode = null) {
  const source = identity && typeof identity === "object" ? identity : { waitId: identity };
  const ids = commandLifecycleIds(source);
  if (!ids.size) return;
  const normalized = String(status || "complete").toLowerCase();
  const failed = ["failed", "stopped", "timeout", "finished_unknown"].includes(normalized)
    || (exitCode !== null && exitCode !== undefined && Number(exitCode) !== 0);
  const completion = { state: failed ? "error" : "success", status: normalized, exitCode };
  const sessionId = String(source.sessionId || "").trim();
  rememberCommandCompletion(ids, completion, sessionId);
  for (const row of commandTimelineRows()) {
    if (!commandTimelineIdentityMatches(row, ids)) continue;
    updateCommandTimelineRow(row, completion.state);
    if (exitCode != null && exitCode !== "") row.dataset.exitCode = String(exitCode);
    if (typeof source.stdout === "string" && source.stdout) row.dataset.stdout = source.stdout.slice(0, 50_000);
    if (Number.isFinite(Number(source.elapsedMs))) row.dataset.durationMs = String(Number(source.elapsedMs));
    row.dataset.endedAt = String(Date.parse(source.endedAt || "") || Date.now());
  }
}

export function finalizeSubagentWaitingCard(subagentId, status, elapsedLabel = "") {
  if (!messages) return;
  for (const card of messages.querySelectorAll(".tool-card.subagent-wait[data-subagent-id], .tool-card.subagent-wait[data-wait-id]")) {
    const cardId = card.dataset.subagentId || card.dataset.waitId || "";
    if (subagentId && cardId && cardId !== subagentId) continue;
    stopWaitCardTicker(cardId);
    card.dataset.state = "complete";
    card.classList.remove("subagent-wait");
    const fileEl = card.querySelector(".tool-card-file");
    const label = elapsedLabel
      ? `waited ${elapsedLabel}`
      : `${card.dataset.waitKind === "terminal" ? "terminal" : "traffsucker subagent"} ${status === "complete" ? "completed" : status}`;
    if (fileEl) renderToolStatusLabelFromText(fileEl, label);
    card.setAttribute("aria-label", label);
    const statusEl = card.querySelector(".tool-card-status");
    if (statusEl) statusEl.className = `tool-card-status ${status === "complete" || status === "running" ? "success" : "error"}`;
  }
}
