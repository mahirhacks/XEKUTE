"use strict";

function createChatSessionStore({ fs, path, crypto, baseDir, protector = null }) {
  if (!fs || !path || !crypto || !baseDir) throw new Error("Chat session store dependencies are required.");

  const storeDir = path.join(baseDir, "chat-sessions");

  function sessionFile(scope) {
    const key = String(scope || "global").trim() || "global";
    const digest = crypto.createHash("sha256").update(key).digest("hex");
    return path.join(storeDir, `${digest}.json`);
  }

  function emptyState(scope, exists = false) {
    return { version: 2, scope: String(scope || "global"), exists, activeSessionId: "", sessions: [] };
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
              warning: `Primary chat storage was damaged; Pointer recovered the backup: ${error.message}`,
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
      model: String(session.model || session.selectedModel || ""),
      mode: String(session.mode || session.chatMode || "assist:agent"),
      safetyFamily: String(session.safetyFamily || session.chatFamily || "assist"),
      contextSummary: String(session.contextSummary || ""),
      contextSummaryMeta: session.contextSummaryMeta && typeof session.contextSummaryMeta === "object" ? session.contextSummaryMeta : null,
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
      scope: String(scope || "global"),
      savedAt: new Date().toISOString(),
      activeSessionId: typeof state.activeSessionId === "string" ? state.activeSessionId : "",
      sessions: Array.isArray(state.sessions) ? state.sessions.map(canonicalSession).filter((session) => session.id) : [],
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
