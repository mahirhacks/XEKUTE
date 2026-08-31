"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, createOpaqueId, isMemoryId } = require("../../../contracts/memory/memory-identity.js");

const DEFAULT_TITLE = "New Agent";
const MAX_TEXT = 16 * 1024 * 1024;
const MESSAGE_FIELDS = Object.freeze(["tool_calls", "tool_call_id", "tool_name", "name", "subagents"]);
const META_KEYS = Object.freeze([
  "title", "model", "mode", "family", "kind", "parentSessionId", "parent_session_id",
  "childInvocationId", "child_invocation_id", "lastContextUsage", "last_context_usage",
  "status", "checkpointId", "checkpoint_id", "checkpointRevision", "checkpoint_revision",
]);

/*
 * Chat persistence is an application continuity service, not a second memory
 * authority.  Exact blocks live only in the encrypted V3 Tier 1 store; the
 * renderer receives a bounded projection needed to display chat history.
 */
function createV3SessionStore({ sensitiveStore, projectIdentityStore, crypto = nodeCrypto, now = () => new Date() } = {}) {
  if (!sensitiveStore || !projectIdentityStore) throw new TypeError("V3 session store dependencies are required.");
  const queues = new Map();

  function stamp() { return now().toISOString(); }
  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
  }
  function text(value, fallback = "", limit = 100_000) {
    return String(value == null ? fallback : value).replace(/\u0000/g, "").slice(0, limit);
  }
  function messageContent(value) { return text(value, "", MAX_TEXT); }
  function opaqueId(raw, prefix, salt = "") {
    const value = String(raw || "").trim();
    if (isMemoryId(value, prefix)) return value;
    const digest = crypto.createHash("sha256").update(`${prefix}|${value}|${salt}`).digest("hex").slice(0, 40);
    return `${prefix}_${digest}`;
  }
  function workspaceResult(rawWorkspace, persist = false) {
    const resolved = projectIdentityStore.resolveV3Project(rawWorkspace, { persist });
    if (!resolved?.ok || !isMemoryId(resolved.projectId, "proj")) return resolved;
    return resolved;
  }
  function queueKey(resolved) { return resolved.canonical || resolved.workspace || resolved.projectId; }
  function enqueue(key, task) {
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(task);
    queues.set(key, next);
    return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  }
  function emptyDocument(projectId, sessionId, metadata = {}) {
    const stampValue = stamp();
    return {
      schema_version: 3,
      project_id: assertMemoryId(projectId, "proj"),
      session_id: assertMemoryId(sessionId, "session"),
      metadata: {
        session_id: sessionId,
        title: text(metadata.title || DEFAULT_TITLE, DEFAULT_TITLE, 240),
        created_at: stampValue,
        updated_at: stampValue,
        status: "active",
      },
      display_html: "",
      blocks: [],
    };
  }
  function normalizeMessages(messages, salt) {
    return (Array.isArray(messages) ? messages : [])
      .filter((message) => message && typeof message === "object")
      .map((message, index) => {
        const normalized = {
          id: opaqueId(message.id || ("message-" + index), "event", salt),
          role: text(message.role || "message", "message", 40),
          content: messageContent(message.content || ""),
        };
        if (message.createdAt || message.created_at) normalized.createdAt = text(message.createdAt || message.created_at, "", 80);
        for (const key of MESSAGE_FIELDS) {
          if (message[key] !== undefined && message[key] !== null) normalized[key] = clone(message[key]);
        }
        return normalized;
      });
  }
  function normalizeBlock(block, projectId, sessionId, fallbackBlockId = "") {
    const source = block && typeof block === "object" ? block : {};
    const blockId = opaqueId(source.block_id || source.blockId || fallbackBlockId, "block", `${projectId}|${sessionId}`);
    const messages = normalizeMessages(source.messages || source.transcript, `${projectId}|${sessionId}|${blockId}`);
    return {
      project_id: projectId,
      session_id: sessionId,
      block_id: blockId,
      user_prompt_id: source.user_prompt_id || source.userMessageId
        ? opaqueId(source.user_prompt_id || source.userMessageId, "event", `${projectId}|${sessionId}|${blockId}`)
        : "",
      user_prompt: messageContent(source.user_prompt || source.userPrompt || ""),
      messages,
      tool_events: Array.isArray(source.tool_events) ? clone(source.tool_events) : [],
      outcome: text(source.outcome || "pending", "pending", 40),
      captured_at: text(source.captured_at || source.timestamp || stamp(), "", 80),
      ...(source.completed_at ? { completed_at: text(source.completed_at, "", 80) } : {}),
    };
  }
  function normalizeMetadata(source = {}, sessionId, fallback = {}) {
    const value = source && typeof source === "object" ? source : {};
    const result = {
      session_id: sessionId,
      title: text(value.title || fallback.title || DEFAULT_TITLE, DEFAULT_TITLE, 240),
      created_at: text(value.created_at || value.createdAt || fallback.created_at || stamp(), "", 80),
      updated_at: text(value.updated_at || value.updatedAt || stamp(), "", 80),
      status: ["active", "running", "closed", "archived"].includes(String(value.status || "")) ? String(value.status) : "active",
    };
    const aliases = {
      parentSessionId: "parent_session_id",
      childInvocationId: "child_invocation_id",
      lastContextUsage: "last_context_usage",
      checkpointId: "checkpoint_id",
      checkpointRevision: "checkpoint_revision",
    };
    for (const key of META_KEYS) {
      if (value[key] === undefined || value[key] === null) continue;
      const target = aliases[key] || key;
      result[target] = clone(value[key]);
    }
    result.session_id = sessionId;
    result.updated_at = stamp();
    return result;
  }
  function normalizeDocument(value, projectId, sessionId, fallback = {}) {
    const source = value && typeof value === "object" ? value : {};
    const blocks = (Array.isArray(source.blocks) ? source.blocks : [])
      .map((block, index) => normalizeBlock(block, projectId, sessionId, `block-${index + 1}`));
    return {
      schema_version: 3,
      project_id: projectId,
      session_id: sessionId,
      metadata: normalizeMetadata(source.metadata, sessionId, fallback),
      display_html: messageContent(source.display_html || source.displayHtml || ""),
      blocks,
    };
  }
  function loadDocument(projectId, sessionId) {
    const loaded = sensitiveStore.readTranscript(projectId, sessionId);
    if (!loaded?.ok) return loaded;
    if (!loaded.exists) return { ok: true, exists: false, value: emptyDocument(projectId, sessionId) };
    return { ok: true, exists: true, encrypted: loaded.encrypted, durable: loaded.durable !== false, value: normalizeDocument(loaded.value, projectId, sessionId) };
  }
  function sessionHistory(document) {
    const result = [];
    for (const block of document.blocks || []) {
      const messages = Array.isArray(block.messages) ? clone(block.messages) : [];
      if (block.user_prompt && !messages.some((message) => message?.id === block.user_prompt_id)) {
        const matchingPrompt = messages.find((message) => message?.role === "user" && messageContent(message.content).trim() === messageContent(block.user_prompt).trim());
        if (matchingPrompt) matchingPrompt.id = block.user_prompt_id || matchingPrompt.id;
        else messages.unshift({ id: block.user_prompt_id || opaqueId(`${block.block_id}:user`, "event"), role: "user", content: block.user_prompt, createdAt: block.captured_at });
      }
      result.push(...messages);
    }
    return result;
  }
  function projection(projectId, sessionId, document, workspace, flags = {}) {
    const metadata = document.metadata || {};
    const history = sessionHistory(document);
    const status = String(metadata.status || "active");
    return {
      id: sessionId,
      memorySessionId: sessionId,
      memoryProjectId: projectId,
      memoryBlockId: document.blocks.at(-1)?.block_id || "",
      title: text(metadata.title || DEFAULT_TITLE, DEFAULT_TITLE, 240),
      history,
      messages: clone(history),
      messagesHtml: messageContent(document.display_html || ""),
      contextFilesCache: [],
      lastContextUsage: clone(metadata.last_context_usage) || null,
      chatMode: text(metadata.mode || "agent", "agent", 100),
      chatFamily: text(metadata.family || "xekute", "xekute", 100),
      selectedModel: text(metadata.model || "", "", 240),
      kind: text(metadata.kind || "chat", "chat", 40),
      parentSessionId: text(metadata.parent_session_id || "", "", 240),
      childInvocationId: text(metadata.child_invocation_id || "", "", 240),
      createdAt: text(metadata.created_at || "", "", 80) || null,
      updatedAt: text(metadata.updated_at || "", "", 80) || null,
      status,
      closed: flags.closed || status === "closed",
      archived: flags.archived || status === "archived",
    };
  }
  function readSession(projectId, sessionId, workspace = "") {
    const loaded = loadDocument(projectId, sessionId);
    if (!loaded?.ok) return loaded;
    return { ...loaded, document: loaded.value, projection: projection(projectId, sessionId, loaded.value, workspace) };
  }
  function load(rawWorkspace) {
    const resolved = workspaceResult(rawWorkspace, false);
    if (!resolved?.ok || !resolved.projectId) return { ok: true, exists: false, projectId: "", projectPath: resolved?.workspace || "", activeSessionId: "", sessions: [], closedSessions: [], archivedSessions: [], warning: resolved?.warning || "" };
    const listed = sensitiveStore.listSessionIds(resolved.projectId);
    if (!listed?.ok) return listed;
    const sessions = [];
    const closedSessions = [];
    const archivedSessions = [];
    const warnings = [];
    for (const sessionId of listed.session_ids || []) {
      const loaded = readSession(resolved.projectId, sessionId, resolved.workspace);
      if (!loaded?.ok) { warnings.push(loaded.error || loaded.code || "Session could not be read"); continue; }
      const item = loaded.projection;
      if (item.archived) archivedSessions.push(item);
      else if (item.closed) closedSessions.push(item);
      else sessions.push(item);
    }
    const active = sessions.filter((item) => item.status === "active" || item.status === "running").sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    return {
      ok: true,
      exists: Boolean(listed.session_ids?.length),
      projectId: resolved.projectId,
      projectPath: resolved.workspace,
      activeSessionId: active?.id || "",
      sessions,
      closedSessions,
      archivedSessions,
      warning: [resolved.warning, ...warnings].filter(Boolean).join(" "),
    };
  }
  function begin(rawWorkspace, { sessionId = "", title = DEFAULT_TITLE, userPrompt = "", userMessageId = "", session = {} } = {}) {
    if (!String(userPrompt || "").trim()) return Promise.resolve({ ok: true, persisted: false, reason: "EMPTY_PROMPT" });
    const resolved = workspaceResult(rawWorkspace, true);
    if (!resolved?.ok || !resolved.projectId) return Promise.resolve(resolved || { ok: false, error: "A project workspace is required." });
    const actualSessionId = isMemoryId(sessionId, "session")
      ? String(sessionId)
      : String(sessionId || "").trim()
        ? opaqueId(sessionId, "session", `${resolved.projectId}|${resolved.canonical}`)
        : createOpaqueId("session", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
    return enqueue(queueKey(resolved), () => {
      const loaded = loadDocument(resolved.projectId, actualSessionId);
      if (!loaded?.ok) return loaded;
      const document = loaded.exists ? normalizeDocument(loaded.value, resolved.projectId, actualSessionId, session) : emptyDocument(resolved.projectId, actualSessionId, session);
      const blockId = createOpaqueId("block", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
      const messageId = opaqueId(userMessageId || `${blockId}:user`, "event", `${resolved.projectId}|${actualSessionId}`);
      document.metadata = normalizeMetadata({ ...document.metadata, ...session, title, status: "active" }, actualSessionId, session);
      document.blocks.push(normalizeBlock({ block_id: blockId, user_prompt_id: messageId, user_prompt: userPrompt, messages: [{ id: messageId, role: "user", content: userPrompt, createdAt: stamp() }], outcome: "pending" }, resolved.projectId, actualSessionId, blockId));
      const saved = sensitiveStore.writeTranscript(resolved.projectId, actualSessionId, document);
      return saved?.ok === false ? saved : { ok: true, persisted: true, durable: saved?.durable !== false, encrypted: Boolean(saved?.encrypted), projectId: resolved.projectId, sessionId: actualSessionId, blockId, userPromptId: messageId, projectPath: resolved.workspace };
    });
  }
  function applyEvent(document, event = {}) {
    const sessionId = assertMemoryId(opaqueId(event.sessionId, "session"), "session");
    const blockId = event.blockId ? opaqueId(event.blockId, "block", `${document.project_id}|${sessionId}`) : document.blocks.at(-1)?.block_id || "";
    const block = document.blocks.find((entry) => entry.block_id === blockId);
    const type = String(event.type || event.event || "").toLowerCase();
    if (type === "session_meta") document.metadata = normalizeMetadata({ ...document.metadata, ...(event.sessionMeta || event.session || {}) }, sessionId);
    if (type === "snapshot" || type === "transcript") {
      if (!block) throw Object.assign(new Error("The V3 chat block was not found."), { code: "MEMORY_BLOCK_NOT_FOUND" });
      if (Array.isArray(event.transcript)) block.messages = normalizeMessages(event.transcript, `${document.project_id}|${sessionId}|${blockId}`);
      if (Array.isArray(event.messages)) block.messages = normalizeMessages(event.messages, `${document.project_id}|${sessionId}|${blockId}`);
      if (Array.isArray(event.toolEvents)) block.tool_events = clone(event.toolEvents).slice(-500);
      if (Array.isArray(event.tool_events)) block.tool_events = clone(event.tool_events).slice(-500);
      if (event.displayHtml !== undefined || event.display_html !== undefined) {
        document.display_html = messageContent(event.displayHtml ?? event.display_html ?? "");
      }
      if (event.outcome) block.outcome = text(event.outcome, "pending", 40);
      if (["completed", "failed", "stopped", "incomplete"].includes(block.outcome)) block.completed_at = stamp();
    } else if (type === "tool_usage") {
      if (!block) throw Object.assign(new Error("The V3 chat block was not found."), { code: "MEMORY_BLOCK_NOT_FOUND" });
      const names = Array.isArray(event.toolNames) ? event.toolNames : [event.toolName || event.tool_name].filter(Boolean);
      block.tool_events = [...(Array.isArray(block.tool_events) ? block.tool_events : []), ...names.map((name) => ({ tool_name: text(name, "unknown", 200), captured_at: stamp() }))].slice(-500);
    } else if (type === "outcome" || type === "assistant" || type === "ai_output") {
      if (!block) throw Object.assign(new Error("The V3 chat block was not found."), { code: "MEMORY_BLOCK_NOT_FOUND" });
      const content = messageContent(event.text || event.content || event.ai_prompt || "");
      if (Array.isArray(event.transcript)) block.messages = normalizeMessages(event.transcript, `${document.project_id}|${sessionId}|${blockId}`);
      else if (content.trim()) {
        const messageId = opaqueId(event.messageId || event.id || `${blockId}:assistant`, "event", `${document.project_id}|${sessionId}|assistant`);
        const current = Array.isArray(block.messages) ? block.messages : [];
        const index = current.findIndex((message) => message.id === messageId);
        const assistant = { id: messageId, role: "assistant", content, createdAt: stamp() };
        if (index >= 0) current[index] = { ...current[index], ...assistant };
        else current.push(assistant);
        block.messages = normalizeMessages(current, `${document.project_id}|${sessionId}|${blockId}`);
      }
      if (event.displayHtml !== undefined || event.display_html !== undefined) {
        document.display_html = messageContent(event.displayHtml ?? event.display_html ?? "");
      }
      if (event.outcome) block.outcome = text(event.outcome, "pending", 40);
      if (["completed", "failed", "stopped", "incomplete"].includes(block.outcome)) block.completed_at = stamp();
    } else if (["close", "reopen", "archive", "unarchive"].includes(type)) {
      document.metadata.status = type === "close" ? "closed" : type === "archive" ? "archived" : "active";
    }
    if (event.sessionMeta || event.session) document.metadata = normalizeMetadata({ ...document.metadata, ...(event.sessionMeta || event.session) }, sessionId);
    document.metadata.updated_at = stamp();
    return document;
  }
  function recordSync(rawWorkspace, event = {}) {
    const resolved = workspaceResult(rawWorkspace, false);
    if (!resolved?.ok || !resolved.projectId) return { ok: false, error: "The V3 project identity is not initialized." };
    const sessionId = opaqueId(event.sessionId, "session", `${resolved.projectId}|${resolved.canonical}`);
    const loaded = loadDocument(resolved.projectId, sessionId);
    if (!loaded?.ok) return loaded;
    if (!loaded.exists) return { ok: false, code: "MEMORY_SESSION_NOT_FOUND", error: "The V3 chat session was not found." };
    const document = normalizeDocument(loaded.value, resolved.projectId, sessionId);
    try { applyEvent(document, { ...event, sessionId }); } catch (error) { return { ok: false, code: error.code || "MEMORY_SESSION_EVENT_INVALID", error: error.message }; }
    const saved = sensitiveStore.writeTranscript(resolved.projectId, sessionId, document);
    return saved?.ok === false ? saved : { ok: true, projectId: resolved.projectId, sessionId, blockId: event.blockId || document.blocks.at(-1)?.block_id || "", durable: saved?.durable !== false, encrypted: Boolean(saved?.encrypted), savedAt: stamp() };
  }
  function record(rawWorkspace, event = {}) {
    const resolved = workspaceResult(rawWorkspace, false);
    if (!resolved?.ok || !resolved.projectId) return Promise.resolve({ ok: false, error: "The V3 project identity is not initialized." });
    return enqueue(queueKey(resolved), () => recordSync(rawWorkspace, event));
  }
  function close(rawWorkspace, sessionId) { return record(rawWorkspace, { type: "close", sessionId }); }
  function reopen(rawWorkspace, sessionId) { return record(rawWorkspace, { type: "reopen", sessionId }); }
  function remove(rawWorkspace, sessionId) {
    const resolved = workspaceResult(rawWorkspace, false);
    if (!resolved?.ok || !resolved.projectId) return Promise.resolve({ ok: true, removed: false });
    const actual = opaqueId(sessionId, "session", `${resolved.projectId}|${resolved.canonical}`);
    return enqueue(queueKey(resolved), () => sensitiveStore.deleteSession(resolved.projectId, actual));
  }
  function sessionFile(rawWorkspace, sessionId = "") {
    const resolved = workspaceResult(rawWorkspace, false);
    if (!resolved?.ok || !resolved.projectId || !isMemoryId(sessionId, "session")) return "";
    return sensitiveStore.transcriptFile(resolved.projectId, String(sessionId));
  }
  function flush() { return Promise.all([...queues.values()].map((pending) => pending.catch(() => null))).then(() => sensitiveStore.flush?.() || { ok: true }); }

  return Object.freeze({ load, begin, record, recordSync, close, reopen, remove, deleteSession: remove, sessionFile, flush, resolveProject: (workspace, options) => workspaceResult(workspace, options?.persist === true), resolveProjectId: (workspace) => workspaceResult(workspace, false)?.projectId || "" });
}

module.exports = Object.freeze({ createV3SessionStore });
