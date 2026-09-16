"use strict";

const DEFAULT_MAX_OUTPUT_CHARS = 80_000;
const DEFAULT_TAIL_CHARS = 8_000;
const MAX_TAIL_CHARS = 50_000;

function appendTerminalOutput(record, chunk, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
  if (!record) return "";
  const next = `${record.outputTail || ""}${chunk == null ? "" : String(chunk)}`;
  record.outputTail = next.length > maxChars ? next.slice(next.length - maxChars) : next;
  return record.outputTail;
}

function stripAnsi(text) {
  return String(text || "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
}

function tailText(text, maxChars) {
  const value = String(text || "");
  const limit = Number.isInteger(maxChars) ? maxChars : DEFAULT_TAIL_CHARS;
  if (limit <= 0) return { text: "", truncated: value.length > 0 };
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: value.slice(value.length - limit), truncated: true };
}

function ownerKey(ownerId) {
  return String(ownerId ?? "");
}

function isAgentMade(record, tab) {
  return Boolean(record?.agent || tab?.agent);
}

function createActiveTerminalCatalog({
  terminals,
  durableProcessManager = null,
  now = () => Date.now(),
} = {}) {
  if (!terminals || typeof terminals.get !== "function") {
    throw new TypeError("active terminal catalog requires a terminals map");
  }

  const activeByOwner = new Map();

  function emptyActive() {
    return {
      terminalId: null,
      panelOpen: false,
      updatedAt: null,
      tabs: [],
    };
  }

  function getUserActiveTerminal(ownerId) {
    return activeByOwner.get(ownerKey(ownerId)) || emptyActive();
  }

  function setUserActiveTerminal({ ownerId, terminalId = null, panelOpen = false, tabs = [] } = {}) {
    const key = ownerKey(ownerId);
    if (!key) return emptyActive();
    const open = Boolean(panelOpen);
    const requested = open && terminalId != null && String(terminalId).trim() ? String(terminalId).trim() : null;
    const normalizedTabs = Array.isArray(tabs)
      ? tabs.slice(0, 200).map((tab) => ({
        id: String(tab?.id || tab?.terminalId || ""),
        name: String(tab?.name || ""),
        agent: Boolean(tab?.agent),
        exited: Boolean(tab?.exited),
      })).filter((tab) => tab.id)
      : [];
    const known = Boolean(
      requested
      && (normalizedTabs.some((tab) => tab.id === requested) || terminals.has(requested) || normalizedTabs.length === 0),
    );
    const resolvedId = known ? requested : null;
    const entry = {
      terminalId: resolvedId,
      panelOpen: Boolean(open && resolvedId),
      updatedAt: now(),
      tabs: normalizedTabs,
    };
    activeByOwner.set(key, entry);
    return entry;
  }

  function clearOwner(ownerId) {
    activeByOwner.delete(ownerKey(ownerId));
  }

  function clearAll() {
    activeByOwner.clear();
  }

  function clearActiveIf(ownerId, terminalId) {
    const current = getUserActiveTerminal(ownerId);
    if (current.terminalId && String(current.terminalId) === String(terminalId || "")) {
      return setUserActiveTerminal({
        ownerId,
        terminalId: null,
        panelOpen: false,
        tabs: (current.tabs || []).filter((tab) => tab.id !== String(terminalId || "")),
      });
    }
    if (current.tabs?.length) {
      return setUserActiveTerminal({
        ownerId,
        terminalId: current.terminalId,
        panelOpen: current.panelOpen,
        tabs: current.tabs.filter((tab) => tab.id !== String(terminalId || "")),
      });
    }
    return current;
  }

  function recordsForOwner(ownerId) {
    const key = ownerKey(ownerId);
    const listed = [];
    for (const [terminalId, record] of terminals.entries()) {
      if (key && String(record?.ownerId) !== key) continue;
      listed.push({ terminalId, record });
    }
    return listed;
  }

  function visibleInChat(record, tab, { chatSessionId, activeId } = {}) {
    const agent = isAgentMade(record, tab);
    if (!agent) return true;
    if (activeId && String(tab?.id || record?.terminalId || "") === String(activeId)) return true;
    const sessionId = String(record?.sessionId || "");
    const want = String(chatSessionId || "").trim();
    if (!want || !sessionId) return true;
    return sessionId === want;
  }

  function describe({ terminalId, record = null, tab = null, activeId = null } = {}) {
    const agent = isAgentMade(record, tab);
    const exited = Boolean(record?.exited || tab?.exited);
    return {
      terminal_id: String(terminalId || tab?.id || ""),
      name: String(tab?.name || record?.command || record?.profileId || ""),
      origin: agent ? "agent" : "user",
      can_read: true,
      can_control: agent,
      process_id: String(record?.processId || ""),
      status: exited ? "exited" : "running",
      command: String(record?.command || ""),
      cwd: String(record?.cwd || ""),
      session_id: String(record?.sessionId || ""),
      hidden: Boolean(record?.hidden),
      active: Boolean(activeId && String(terminalId) === String(activeId)),
    };
  }

  function mergeSessions({ ownerId, chatSessionId } = {}) {
    const active = getUserActiveTerminal(ownerId);
    const activeId = active.panelOpen ? active.terminalId : null;
    const byId = new Map();
    for (const tab of active.tabs || []) {
      const record = terminals.get(tab.id) || null;
      if (!visibleInChat(record, tab, { chatSessionId, activeId })) continue;
      byId.set(tab.id, describe({ terminalId: tab.id, record, tab, activeId }));
    }
    for (const { terminalId, record } of recordsForOwner(ownerId)) {
      const tab = (active.tabs || []).find((item) => item.id === terminalId) || {
        id: terminalId,
        name: record?.command || record?.profileId || "",
        agent: Boolean(record?.agent),
        exited: Boolean(record?.exited),
      };
      if (!visibleInChat(record, tab, { chatSessionId, activeId })) continue;
      if (!byId.has(terminalId)) byId.set(terminalId, describe({ terminalId, record, tab, activeId }));
    }
    return { active, activeId, sessions: [...byId.values()] };
  }

  async function snapshotOutput({ record, workspace, tailChars }) {
    const limit = Number.isInteger(tailChars) ? Math.max(0, Math.min(tailChars, MAX_TAIL_CHARS)) : DEFAULT_TAIL_CHARS;
    if (record?.agent && record.processId && durableProcessManager && typeof durableProcessManager.status === "function" && workspace) {
      try {
        const status = await durableProcessManager.status(workspace, {
          process_id: record.processId,
          tail_chars: limit,
        });
        if (status?.ok) {
          const combined = [status.value?.stdout, status.value?.stderr].filter((part) => String(part || "").trim()).join("\n");
          const tailed = tailText(stripAnsi(combined || record.outputTail || ""), limit);
          return { output: tailed.text, output_truncated: Boolean(tailed.truncated || status.value?.outputTruncated?.stdout || status.value?.outputTruncated?.stderr) };
        }
      } catch { /* Fall back to the in-memory pty/log tail. */ }
    }
    const tailed = tailText(stripAnsi(record?.outputTail || ""), limit);
    return { output: tailed.text, output_truncated: tailed.truncated };
  }

  async function view({ ownerId, chatSessionId = "", terminalId = "", tailChars, workspace = "" } = {}) {
    const { active, activeId, sessions } = mergeSessions({ ownerId, chatSessionId });
    const requested = String(terminalId || "").trim();
    const focusId = requested || activeId || null;
    const user_active_terminal = activeId;
    const base = {
      user_active_terminal,
      panel_open: Boolean(active.panelOpen && activeId),
      updated_at: active.updatedAt ? new Date(active.updatedAt).toISOString() : null,
      sessions,
      note: "Operator terminals are read-only. Agent-made terminals can be stopped with exec_command operation=stop and the process_id.",
    };
    if (!focusId) {
      return { ok: true, value: { ...base, terminal: null } };
    }
    const record = terminals.get(focusId) || null;
    const tab = (active.tabs || []).find((item) => item.id === focusId) || (record ? {
      id: focusId,
      name: record.command || record.profileId || "",
      agent: Boolean(record.agent),
      exited: Boolean(record.exited),
    } : null);
    if (!record && !tab) {
      return {
        ok: false,
        error: {
          code: "TERMINAL_NOT_FOUND",
          message: `No terminal session ${focusId} is available in this window.`,
          retryable: false,
        },
      };
    }
    if (record && !visibleInChat(record, tab, { chatSessionId, activeId }) && focusId !== activeId) {
      return {
        ok: false,
        error: {
          code: "TERMINAL_NOT_IN_SESSION",
          message: "That agent terminal belongs to a different chat session.",
          retryable: false,
        },
      };
    }
    const meta = describe({ terminalId: focusId, record, tab, activeId });
    const output = await snapshotOutput({ record, workspace, tailChars });
    return {
      ok: true,
      value: {
        ...base,
        terminal: {
          ...meta,
          ...output,
        },
      },
    };
  }

  return {
    setUserActiveTerminal,
    getUserActiveTerminal,
    clearOwner,
    clearAll,
    clearActiveIf,
    view,
    list: (input) => mergeSessions(input).sessions,
  };
}

function denyUserTerminalControl(record) {
  if (!record) {
    return {
      ok: false,
      error: {
        code: "TERMINAL_NOT_FOUND",
        message: "That terminal session is no longer available.",
        retryable: false,
      },
    };
  }
  if (!record.agent) {
    return {
      ok: false,
      error: {
        code: "TERMINAL_CONTROL_DENIED",
        message: "The agent can read operator terminals but cannot write, interrupt, or kill them.",
        retryable: false,
      },
    };
  }
  return null;
}

module.exports = {
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_TAIL_CHARS,
  MAX_TAIL_CHARS,
  appendTerminalOutput,
  stripAnsi,
  createActiveTerminalCatalog,
  denyUserTerminalControl,
};
