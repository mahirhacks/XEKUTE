"use strict";
const path = require("node:path");

// These tools never change workspace files themselves, so they run alongside
// each other and alongside a delegated child. Commands are bounded by their own
// process slots; holding the workspace for a command's whole wait serialized
// every command in the chat.
const CONCURRENT_TOOLS = new Set([
  "read_file", "list_directory", "search_files", "search_workspace", "find_files", "view_active_terminal", "get_project_profile", "read_artifact",
  "exec_command", "ask_questions", "end_turn", "delegate_agent", "web_research", "release_blocks", "recall_block",
  // Browser actions never write workspace files; the native browser service
  // already orders actions per tab.
  "browser_action",
]);
function concurrent(call) {
  return CONCURRENT_TOOLS.has(call?.function?.name || call?.toolName);
}
// Only run and start launch work. status, list, and stop must stay available
// while the workspace waits on reconciliation, or the agent cannot inspect or
// stop the very job that holds it.
function launchesCommand(call) {
  let args = call?.args ?? call?.function?.arguments ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { return true; }
  }
  return ["", "run", "start"].includes(String(args?.operation || "").trim().toLowerCase());
}
function createResourceReservations({ listProcesses = async () => [] } = {}) {
  const tails = new Map();
  async function reconciliationRequired(workspace) {
    const processes = await listProcesses(workspace);
    return processes.some((record) => record.status === "reconciliation_required");
  }
  const reconciliationFailure = { ok: false, errorCode: "RESOURCE_RECONCILIATION_REQUIRED", error: "A command from before the app restarted may still own this workspace, and its PID is still in use. Tell the operator; they can release it from the chat. Status, list, and stop still work.", retryable: false };
  const stoppedFailure = { ok: false, errorCode: "RESOURCE_WAIT_STOPPED", error: "The task stopped while waiting for the workspace.", retryable: false };
  async function untilSettledOrStopped(previous, signal) {
    if (signal?.aborted) return false;
    let aborted;
    const stop = new Promise((resolve) => { aborted = () => resolve(false); signal?.addEventListener("abort", aborted, { once: true }); });
    try { return await Promise.race([previous.then(() => true), stop]); } finally { signal?.removeEventListener("abort", aborted); }
  }
  async function execute({ workspace = "", toolCall, signal }, perform) {
    const key = workspace ? path.resolve(workspace).toLowerCase() : "app";
    if (concurrent(toolCall)) {
      if ((toolCall?.function?.name || toolCall?.toolName) !== "exec_command" || !launchesCommand(toolCall)) return perform();
      if (await reconciliationRequired(workspace)) return reconciliationFailure;
      // A command never starts in the middle of a file edit. It does not hold
      // the workspace while it runs, so commands never queue behind each other.
      const editing = tails.get(key);
      if (editing && !await untilSettledOrStopped(editing, signal)) return stoppedFailure;
      return perform();
    }
    const previous = tails.get(key) || Promise.resolve();
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    tails.set(key, turn);
    try {
      if (!await untilSettledOrStopped(previous, signal)) return stoppedFailure;
      if (await reconciliationRequired(workspace)) return reconciliationFailure;
      return await perform();
    } finally {
      previous.then(() => { release(); if (tails.get(key) === turn) tails.delete(key); });
    }
  }
  return { execute };
}
module.exports = { createResourceReservations, concurrent, launchesCommand };
