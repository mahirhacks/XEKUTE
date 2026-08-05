"use strict";

const FailureMemory = require("../../application/agent/memory/failure-memory");

function createChatSessionStore({ fs, path, crypto, baseDir, protector = null }) {
  if (!fs || !path || !crypto || !baseDir) throw new Error("Chat session store dependencies are required.");

  const storeDir = path.join(baseDir, "chat-sessions");

  function sessionFile(scope) {
    const key = String(scope || "global").trim() || "global";
    const digest = crypto.createHash("sha256").update(key).digest("hex");
    return path.join(storeDir, `${digest}.json`);
  }

  function emptyState(scope, exists = false) {
    return { version: 2, schemaVersion: 3, scope: String(scope || "global"), exists, activeSessionId: "", sessions: [] };
  }

  function decodeDocument(document) {
    if (document?.version === 2 && document.encrypted === true) {
      if (!protector?.available?.()) throw new Error("Encrypted chats are unavailable on this device");
      return JSON.parse(protector.decrypt(String(document.payload || "")));
    }
    return document;
  }

  function readDocument(file) {
    return decodeDocument(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  function load(scope) {
    const file = sessionFile(scope);
    if (!fs.existsSync(file)) return emptyState(scope);
    try {
      const parsed = readDocument(file);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sessions)) return emptyState(scope);
      return {
        version: Number(parsed.version) || 1,
        scope: String(scope || "global"),
        exists: true,
        activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : "",
        sessions: parsed.sessions,
        closedSessions: Array.isArray(parsed.closedSessions) ? parsed.closedSessions : [],
      };
    } catch (error) {
      const backup = `${file}.bak`;
      try {
        if (fs.existsSync(backup)) {
          const parsed = readDocument(backup);
          if (parsed && Array.isArray(parsed.sessions)) {
            return {
              version: Number(parsed.version) || 1,
              scope: String(scope || "global"),
              exists: true,
              recovered: true,
              activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : "",
              sessions: parsed.sessions,
              closedSessions: Array.isArray(parsed.closedSessions) ? parsed.closedSessions : [],
              warning: `Primary chat storage was damaged; XEKUTE recovered the backup: ${error.message}`,
            };
          }
        }
      } catch { /* report the original failure below */ }
      return { ...emptyState(scope), warning: `Saved chats could not be read: ${error.message}` };
    }
  }

  function canonicalSession(session = {}) {
    const messages = Array.isArray(session.messages)
      ? session.messages
      : (Array.isArray(session.history) ? session.history : []);
    return {
      id: String(session.id || ""),
      title: String(session.title || "New Agent"),
      createdAt: session.createdAt || session.updatedAt || null,
      updatedAt: session.updatedAt || session.createdAt || null,
      model: String(session.model || session.selectedModel || ""),
      mode: String(session.mode || session.chatMode || "agent").includes(":")
        ? String(session.mode || session.chatMode).split(":").pop()
        : String(session.mode || session.chatMode || "agent"),
      safetyFamily: "xekute",
      memory: session.memory && typeof session.memory === "object"
        ? {
            version: 2,
            summary: String(session.memory.summary || session.contextSummary || "").slice(0, 12000),
            source: session.memory.source ? String(session.memory.source).slice(0, 30) : null,
            status: ["empty", "ready", "error"].includes(session.memory.status) ? session.memory.status : (session.memory.summary ? "ready" : "empty"),
            archivedThroughMessageId: session.memory.archivedThroughMessageId ? String(session.memory.archivedThroughMessageId).slice(0, 240) : null,
            archivedMessageCount: Math.max(0, Number(session.memory.archivedMessageCount) || 0),
            summaryTokens: Math.max(0, Number(session.memory.summaryTokens) || 0),
            updatedAt: session.memory.updatedAt || null,
            warning: String(session.memory.warning || "").slice(0, 1000),
            failureRecords: Array.isArray(session.memory.failureRecords)
              ? session.memory.failureRecords.slice(0, FailureMemory.MAX_RECORDS).map((record) => FailureMemory.normalizeRecord(record)).filter(Boolean)
              : [],
          }
        : {
            version: 2,
            summary: String(session.contextSummary || "").slice(0, 12000),
            source: session.contextSummaryMeta?.source ? String(session.contextSummaryMeta.source).slice(0, 30) : null,
            status: session.contextSummary ? "ready" : "empty",
            archivedThroughMessageId: session.contextSummaryMeta?.archivedThroughMessageId ? String(session.contextSummaryMeta.archivedThroughMessageId).slice(0, 240) : null,
            archivedMessageCount: Math.max(0, Number(session.contextSummaryMeta?.archivedMessageCount || session.contextSummaryMeta?.summarizedMessages) || 0),
            summaryTokens: Math.max(0, Number(session.contextSummaryMeta?.summaryTokens) || 0),
            updatedAt: session.contextSummaryMeta?.updatedAt || null,
            warning: String(session.contextSummaryMeta?.warning || "").slice(0, 1000),
            failureRecords: [],
          },
      contextSummary: String(session.contextSummary || session.memory?.summary || "").slice(0, 12000),
      contextSummaryMeta: session.contextSummaryMeta && typeof session.contextSummaryMeta === "object" ? session.contextSummaryMeta : null,
      lastContextUsage: session.lastContextUsage && typeof session.lastContextUsage === "object" ? {
        version: 2,
        source: ["ollama", "openrouter", "estimate"].includes(session.lastContextUsage.source) ? session.lastContextUsage.source : "estimate",
        provider: ["ollama", "openrouter"].includes(session.lastContextUsage.provider) ? session.lastContextUsage.provider : null,
        model: String(session.lastContextUsage.model || "").slice(0, 240),
        promptTokens: Math.max(0, Number(session.lastContextUsage.promptTokens) || 0),
        completionTokens: Number.isFinite(Number(session.lastContextUsage.completionTokens)) ? Math.max(0, Number(session.lastContextUsage.completionTokens)) : null,
        contextWindow: Number.isFinite(Number(session.lastContextUsage.contextWindow)) ? Math.max(0, Number(session.lastContextUsage.contextWindow)) : null,
        modelMaxTokens: Number.isFinite(Number(session.lastContextUsage.modelMaxTokens)) ? Math.max(0, Number(session.lastContextUsage.modelMaxTokens)) : null,
        effectiveLimitTokens: Number.isFinite(Number(session.lastContextUsage.effectiveLimitTokens)) ? Math.max(0, Number(session.lastContextUsage.effectiveLimitTokens)) : null,
        promptBudgetTokens: Number.isFinite(Number(session.lastContextUsage.promptBudgetTokens)) ? Math.max(0, Number(session.lastContextUsage.promptBudgetTokens)) : null,
        responseReserveTokens: Number.isFinite(Number(session.lastContextUsage.responseReserveTokens)) ? Math.max(0, Number(session.lastContextUsage.responseReserveTokens)) : null,
        safetyMarginTokens: Number.isFinite(Number(session.lastContextUsage.safetyMarginTokens)) ? Math.max(0, Number(session.lastContextUsage.safetyMarginTokens)) : null,
        approximate: Boolean(session.lastContextUsage.approximate),
        contextWindowSource: String(session.lastContextUsage.contextWindowSource || "fallback").slice(0, 20),
        estimatedTokens: Math.max(0, Number(session.lastContextUsage.estimatedTokens) || 0),
        reasoningTokens: Number.isFinite(Number(session.lastContextUsage.reasoningTokens)) ? Math.max(0, Number(session.lastContextUsage.reasoningTokens)) : null,
        cachedTokens: Number.isFinite(Number(session.lastContextUsage.cachedTokens)) ? Math.max(0, Number(session.lastContextUsage.cachedTokens)) : null,
        cost: Number.isFinite(Number(session.lastContextUsage.cost)) ? Math.max(0, Number(session.lastContextUsage.cost)) : null,
        sections: (Array.isArray(session.lastContextUsage.sections) ? session.lastContextUsage.sections : []).slice(0, 8).map((section) => ({
          key: String(section?.key || "context").slice(0, 40),
          label: String(section?.label || "Context").slice(0, 80),
          color: String(section?.color || "#a7a7ab").slice(0, 20),
          tokens: Math.max(0, Number(section?.tokens) || 0),
        })),
        toolNames: (Array.isArray(session.lastContextUsage.toolNames) ? session.lastContextUsage.toolNames : []).slice(0, 64).map((name) => String(name).slice(0, 100)),
        route: session.lastContextUsage.route && typeof session.lastContextUsage.route === "object" ? {
          kind: String(session.lastContextUsage.route.kind || "conversation").slice(0, 40),
          promptDepth: String(session.lastContextUsage.route.promptDepth || "compact").slice(0, 40),
          toolCategories: (Array.isArray(session.lastContextUsage.route.toolCategories) ? session.lastContextUsage.route.toolCategories : []).slice(0, 2).map((item) => String(item).slice(0, 20)),
        } : null,
        round: Math.max(1, Number(session.lastContextUsage.round) || 1),
        measuredAt: String(session.lastContextUsage.measuredAt || "").slice(0, 40),
      } : null,
      messages,
      toolEvents: Array.isArray(session.toolEvents) ? session.toolEvents : messages.filter((message) => message?.role === "tool"),
      status: ["complete", "stopped", "interrupted"].includes(session.status) ? session.status : "complete",
    };
  }

  function save(scope, state = {}) {
    fs.mkdirSync(storeDir, { recursive: true });
    const file = sessionFile(scope);
    const payload = {
      version: 2,
      schemaVersion: 3,
      scope: String(scope || "global"),
      savedAt: new Date().toISOString(),
      activeSessionId: typeof state.activeSessionId === "string" ? state.activeSessionId : "",
      sessions: Array.isArray(state.sessions) ? state.sessions.map(canonicalSession).filter((session) => session.id) : [],
      closedSessions: Array.isArray(state.closedSessions) ? state.closedSessions.map(canonicalSession).filter((session) => session.id) : [],
    };
    const document = protector?.available?.()
      ? { version: 2, encrypted: true, payload: protector.encrypt(JSON.stringify(payload)) }
      : { ...payload, encrypted: false };
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const descriptor = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, JSON.stringify(document), "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const backup = `${file}.bak`;
    if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      // Windows can reject replacing an existing destination. The verified
      // previous file remains in .bak before this fallback is attempted.
      fs.copyFileSync(temp, file);
      fs.rmSync(temp, { force: true });
      if (!fs.existsSync(file)) throw error;
    }
    return { ok: true, savedAt: payload.savedAt, count: payload.sessions.length };
  }

  return { load, save, sessionFile };
}

module.exports = { createChatSessionStore };
