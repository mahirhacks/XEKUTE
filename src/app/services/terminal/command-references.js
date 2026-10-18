"use strict";
const path = require("node:path");
const { stripAnsi } = require("./active-terminal-catalog.js");
const { estimateTokenCount } = require("../../../agent/runtime/context-budget.js");

function shellName(value = "") {
  const name = String(value).split(/[\\/]/).at(-1).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  return /powershell|pwsh/.test(name) ? "powershell" : name || (process.platform === "win32" ? "powershell" : "bash");
}
function commandLabel(shell, command) {
  const firstLine = String(command).split(/\r\n|\r|\n/, 1)[0];
  // Keep the whole first line (bounded). The picker row and the chip each clip
  // it to their own width with a CSS ellipsis, so the label fills the space it
  // has instead of a fixed character count.
  const characters = [...firstLine];
  return `${shellName(shell)} : ${characters.slice(0, 200).join("")}${characters.length > 200 ? "…" : ""}`;
}
function parseObject(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}
function commandText(args) {
  return String(args.command || (args.executable ? [args.executable, ...(Array.isArray(args.args) ? args.args : [])].join(" ") : ""));
}
function commandEvents(events = [], base = "") {
  return events.flatMap((event, index) => {
    const key = `${base}/${index}`;
    if (event.type === "command") return [{ ...event, key }];
    if (event.type === "tool_group") return commandEvents(event.items, key);
    return [];
  });
}
function savedCommands(session) {
  const commands = [], results = new Map(), latestProcesses = new Map();
  for (const message of session.history || []) {
    if (message.role !== "tool") continue;
    results.set(message.tool_call_id, message);
    const parsed = parseObject(message.content), value = parsed?.value || parsed;
    if (value?.processId && (value.stdout || value.stderr)) latestProcesses.set(value.processId, value);
  }
  for (const message of session.history || []) {
    for (const [index, call] of (message.tool_calls || []).entries()) {
      if (!["exec_command", "run_command", "start_process"].includes(call.function?.name || call.toolName)) continue;
      const args = parseObject(call.function?.arguments || call.args) || {};
      if (["status", "stop", "list"].includes(args.operation)) continue;
      const command = commandText(args);
      if (!command) continue;
      const callId = call.id || `${message.id}:${index}`;
      const resultMessage = results.get(callId), parsed = parseObject(resultMessage?.content), initial = parsed?.value || parsed || {};
      if (!resultMessage || initial.executed === false) continue;
      const result = latestProcesses.get(initial.processId) || initial;
      commands.push({ id: `chat:${session.id}:${callId}`,
        command, shell: args.shell === "auto" ? "" : args.shell || result.shell,
        origin: "agent", sessionId: session.id, toolCallId: callId, processId: result.processId || "",
        cwd: result.cwd || args.cwd || "", createdAt: result.startedAt || message.createdAt || session.createdAt || "",
        output: result.stdout || result.stderr ? [result.stdout, result.stderr].filter(Boolean).join("\n")
          : resultMessage && !parsed ? String(resultMessage.content) : "",
        exitCode: result.exitCode ?? null, running: false, source: "chat-history" });
    }
  }
  const unmatched = [...commands];
  for (const run of session.transcript?.runs || []) {
    const events = run.timeline?.length
      ? run.timeline.flatMap((item, index) => item.type === "assistant" ? commandEvents(item.events, String(index)) : [])
      : commandEvents(run.events);
    for (const event of events) {
      if (!event.command) continue;
      const match = unmatched.findIndex(item => item.command === event.command);
      if (match >= 0) {
        const [existing] = unmatched.splice(match, 1);
        if (event.stdout) existing.output = event.stdout;
        if (!existing.createdAt) existing.createdAt = event.started_at || run.started_at || "";
        continue;
      }
      commands.push({ id: `transcript:${session.id}:${run.id}:${event.key}`,
        command: event.command, shell: event.shell, origin: event.origin === "user" ? "user" : "agent",
        sessionId: session.id, cwd: event.cwd || "", output: event.stdout || "", exitCode: event.exit_code ?? null,
        createdAt: event.started_at || run.started_at || session.createdAt || "", running: false, source: "chat-history" });
    }
  }
  return commands;
}

function createCommandReferences({ terminals, sessionStore = null, processManager = null, now = () => new Date() } = {}) {
  const projectKey = workspace => {
    const resolved = workspace ? path.resolve(workspace) : "";
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  function entries(workspace, project, includeHistory = true) {
    if (!workspace) return [];
    const saved = includeHistory ? project || sessionStore?.load(workspace) : null;
    if (saved?.ok === false) throw Object.assign(new Error(saved.error || "Project command history could not be loaded."), { code: saved.code || "TERMINAL_HISTORY_UNAVAILABLE" });
    const byId = new Map();
    for (const session of [...(saved?.sessions || []), ...(saved?.closedSessions || []), ...(saved?.archivedSessions || [])]) {
      for (const item of savedCommands(session)) byId.set(item.id, { ...item, saved: true });
    }
    for (const item of processManager?.referenceCommands(workspace) || []) {
      if (!item.command) continue;
      const previous = [...byId.values()].find(entry => entry.processId === item.id);
      const id = previous?.id || `process:${item.id}`;
      byId.set(id, { ...byId.get(id), id, command: item.command, shell: item.shell,
        origin: "agent", running: item.running, sessionId: item.sessionId, processId: item.id,
        createdAt: item.startedAt, cwd: item.cwd, exitCode: item.exitCode, source: "process-history",
        output: byId.get(id)?.output || "" });
    }
    for (const [terminalId, record] of terminals) {
      if (projectKey(record.workspace) !== projectKey(workspace)) continue;
      if (!record.agent) {
        for (const item of record.commands || []) {
          const start = Math.max(item.outputStart || 0, record.outputOffset || 0) - (record.outputOffset || 0);
          const end = item.outputEnd == null ? undefined : Math.max(0, item.outputEnd - (record.outputOffset || 0));
          byId.set(item.id, { ...item, terminalId, origin: "user", shell: record.shell || record.profileId,
            output: String(record.outputTail || "").slice(start, end), source: "terminal-buffer",
            outputTruncated: (record.outputOffset || 0) > item.outputStart,
            running: !record.exited && record.commandRunning === true && item === record.commands.at(-1) });
        }
        continue;
      }
      if (!record.command) continue;
      const previous = record.processId ? [...byId.values()].find(entry => entry.processId === record.processId) : null;
      const id = record.commandCallId && record.sessionId ? `chat:${record.sessionId}:${record.commandCallId}`
        : previous?.id || (record.processId ? `process:${record.processId}` : `terminal:${terminalId}`);
      const old = byId.get(id) || previous;
      if (previous && previous.id !== id) byId.delete(previous.id);
      byId.set(id, { ...old, id, command: record.command, shell: record.shell,
        origin: "agent", running: !record.exited && !record.queued, sessionId: record.sessionId || "",
        terminalId, processId: record.processId || "", cwd: record.cwd, exitCode: record.exitCode ?? null,
        output: record.outputTail || old?.output || "", createdAt: record.createdAt || old?.createdAt || "",
        source: "terminal-buffer" });
    }
    return [...byId.values()].map(item => ({ ...item, name: commandLabel(item.shell, item.command) }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function list({ workspace, includeHistory = true }) {
    return entries(workspace, null, includeHistory).map(({ output, source, outputTruncated, outputStart, outputEnd, ...item }) => item);
  }
  function capture({ workspace, id, project }) {
    const item = entries(workspace, project).find(entry => entry.id === id || entry.processId && `process:${entry.processId}` === id);
    if (!item) throw Object.assign(new Error("This command is unavailable or belongs to another project."), { code: "TERMINAL_REFERENCE_UNAVAILABLE" });
    let raw = item.output;
    if (item.source === "process-history") {
      const observed = processManager.readReferenceCommand(workspace, item.processId);
      if (observed) raw = [observed.stdout, observed.stderr].filter(Boolean).join("\n") || raw;
    }
    let output = stripAnsi(raw).replace(/\r(?!\n)/g, "\n");
    const originalLength = output.length;
    while (estimateTokenCount(output) > 8000) output = output.slice(Math.floor(output.length / 4));
    const { output: _output, outputStart, outputEnd, saved: _saved, ...metadata } = item;
    return { ...metadata, capturedAt: now().toISOString(), output,
      outputTruncated: Boolean(item.outputTruncated) || output.length < originalLength,
      outputAvailable: Boolean(raw), source: item.source };
  }
  return { list, capture };
}
module.exports = { createCommandReferences, commandLabel };
