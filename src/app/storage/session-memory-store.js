"use strict";

const RESERVED_META_KEY = "__meta";
const STORE_VERSION = 1;
const DEFAULT_SESSION_TITLE = "New Agent";
const MESSAGE_MAX_CHARS = 16 * 1024 * 1024;

function createSessionMemoryStore({
  fs,
  path,
  crypto,
  baseDir,
  protector = null,
  now = () => new Date(),
} = {}) {
  if (!fs || !path || !crypto || !baseDir) {
    throw new Error("Session memory store dependencies are required.");
  }

  const rootDir = path.resolve(String(baseDir));
  const projectsDir = path.join(rootDir, "projects");
  const registryFile = path.join(rootDir, "project-registry.json");
  const writeQueues = new Map();

  function timestamp() {
    return now().toISOString();
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function text(value, fallback = "", limit = 100_000) {
    const result = String(value == null ? fallback : value).replace(/\u0000/g, "");
    return result.slice(0, limit);
  }

  function nonEmptyText(value) {
    return text(value).trim();
  }

  function messageText(value) {
    return text(value, "", MESSAGE_MAX_CHARS);
  }

  function id(prefix) {
    const uuid = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : crypto.createHash("sha256")
        .update(`${process.pid}:${Date.now()}:${Math.random()}`)
        .digest("hex")
        .slice(0, 32);
    return `${prefix}-${uuid}`;
  }

  function canonicalWorkspace(rawWorkspace) {
    const raw = nonEmptyText(rawWorkspace);
    if (!raw) return "";
    const resolved = path.resolve(raw).replace(/[\\/]+$/, "") || path.parse(path.resolve(raw)).root;
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  function displayWorkspace(rawWorkspace) {
    const raw = nonEmptyText(rawWorkspace);
    return raw ? path.resolve(raw) : "";
  }

  function projectFile(projectId) {
    const safe = text(projectId).replace(/[^a-z0-9_-]/gi, "_");
    return path.join(projectsDir, `${safe}.json`);
  }

  function emptyDocument(projectId, workspace = "") {
    const key = text(projectId).trim();
    return {
      [key]: {
        [RESERVED_META_KEY]: {
          schema_version: STORE_VERSION,
          project_id: key,
          project_path: displayWorkspace(workspace),
          active_session_id: "",
          closed_session_ids: [],
          created_at: timestamp(),
          updated_at: timestamp(),
        },
      },
    };
  }

  function readJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  function writeAtomic(file, document) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const descriptor = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      try { fs.fsyncSync(descriptor); } catch { /* Best effort on unsupported filesystems. */ }
    } finally {
      fs.closeSync(descriptor);
    }

    const backup = `${file}.bak`;
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, backup); } catch { /* Keep the primary write possible. */ }
    }

    try {
      fs.renameSync(temp, file);
    } catch (error) {
      try {
        fs.copyFileSync(temp, file);
        fs.rmSync(temp, { force: true });
      } catch {
        try { fs.rmSync(temp, { force: true }); } catch { /* Best effort cleanup. */ }
        throw error;
      }
    }
    try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs protect the user-data directory. */ }
  }

  function readRegistry() {
    if (!fs.existsSync(registryFile)) return { schema_version: STORE_VERSION, projects: {} };
    try {
      const parsed = readJson(registryFile);
      return parsed && typeof parsed === "object" && parsed.projects && typeof parsed.projects === "object"
        ? parsed
        : { schema_version: STORE_VERSION, projects: {} };
    } catch (error) {
      try {
        const backup = readJson(`${registryFile}.bak`);
        if (backup && typeof backup === "object" && backup.projects && typeof backup.projects === "object") return backup;
      } catch { /* Return an empty registry below. */ }
      return { schema_version: STORE_VERSION, projects: {}, warning: `Project registry could not be read: ${error.message}` };
    }
  }

  function persistRegistry(registry) {
    writeAtomic(registryFile, {
      schema_version: STORE_VERSION,
      updated_at: timestamp(),
      projects: registry.projects && typeof registry.projects === "object" ? registry.projects : {},
    });
  }

  function resolveProject(rawWorkspace, { persist = false } = {}) {
    const workspace = displayWorkspace(rawWorkspace);
    const canonical = canonicalWorkspace(workspace);
    if (!canonical) return { workspace: "", canonical: "", projectId: "", persisted: false };

    const registry = readRegistry();
    const existing = registry.projects[canonical];
    if (existing) {
      const projectId = typeof existing === "string" ? existing : existing.project_id;
      if (projectId) return { workspace, canonical, projectId: text(projectId), persisted: true };
    }

    const projectId = id("project");
    if (persist) {
      registry.projects[canonical] = {
        project_id: projectId,
        project_path: workspace,
        created_at: timestamp(),
        updated_at: timestamp(),
      };
      persistRegistry(registry);
    }
    return { workspace, canonical, projectId: persist ? projectId : "", persisted: persist };
  }

  function protectDocument(document) {
    if (protector?.available?.()) {
      try {
        return {
          version: STORE_VERSION,
          encrypted: true,
          payload: protector.encrypt(JSON.stringify(document)),
        };
      } catch { /* Fall back to protected plain JSON if safeStorage is unavailable at write time. */ }
    }
    // Plain fallback deliberately keeps the logical project-key map inspectable.
    return document;
  }

  function decodeDocument(document) {
    if (document?.encrypted === true) {
      if (!protector?.available?.()) throw new Error("Encrypted session memory is unavailable on this device");
      return JSON.parse(protector.decrypt(String(document.payload || "")));
    }
    return document;
  }

  function readDocument(projectId, workspace = "") {
    const file = projectFile(projectId);
    if (!fs.existsSync(file)) return { document: emptyDocument(projectId, workspace), exists: false, file };

    try {
      return { document: normalizeDocument(decodeDocument(readJson(file)), projectId, workspace), exists: true, file };
    } catch (error) {
      try {
        const backup = `${file}.bak`;
        if (fs.existsSync(backup)) {
          return {
            document: normalizeDocument(decodeDocument(readJson(backup)), projectId, workspace),
            exists: true,
            recovered: true,
            file,
            warning: `Primary session memory was damaged; the backup was recovered: ${error.message}`,
          };
        }
      } catch { /* Report the original failure below. */ }
      return {
        document: emptyDocument(projectId, workspace),
        exists: false,
        file,
        warning: `Saved session memory could not be read: ${error.message}`,
      };
    }
  }

  function normalizeOptions(options) {
    return (Array.isArray(options) ? options : []).map((option, index) => {
      if (typeof option === "string") {
        const label = text(option, "", 500).trim();
        return label ? { id: `opt-${index + 1}`, label, recommended: false, free_write: false } : null;
      }
      if (!option || typeof option !== "object") return null;
      const label = text(option.label || option.value || "", "", 500).trim();
      if (!label) return null;
      return {
        id: text(option.id || `opt-${index + 1}`, "", 120).trim(),
        label,
        recommended: Boolean(option.recommended),
        free_write: Boolean(option.free_write || option.freeWrite),
      };
    }).filter(Boolean);
  }

  function normalizeTranscript(messages, prefix = "memory") {
    return (Array.isArray(messages) ? messages : [])
      .filter((message) => message && typeof message === "object")
      .map((message, index) => ({
        ...clone(message),
        id: text(message.id || `message-${prefix}-${index + 1}`, "", 240),
        role: text(message.role || "message", "message", 40),
        content: messageText(message.content || ""),
        ...(message.createdAt ? { createdAt: text(message.createdAt, "", 80) } : {}),
      }));
  }

  function normalizeBlock(block = {}, blockId = "") {
    const source = block && typeof block === "object" ? block : {};
    const result = {
      time_stamp: text(source.time_stamp || source.timestamp || timestamp(), "", 80),
      __meta: {
        ...(source[RESERVED_META_KEY] && typeof source[RESERVED_META_KEY] === "object" ? clone(source[RESERVED_META_KEY]) : {}),
        transcript: normalizeTranscript(source[RESERVED_META_KEY]?.transcript || source.transcript, blockId),
      },
    };

    for (const key of ["user_prompt_id", "user_prompt", "ai_prompt_id", "ai_prompt", "outcome", "completed_at"]) {
      if (source[key] !== undefined && source[key] !== null && text(source[key]).length) {
        result[key] = ["user_prompt", "ai_prompt"].includes(key)
          ? messageText(source[key])
          : text(source[key], "", 200_000);
      }
    }

    if (source.questions_id && typeof source.questions_id === "object") {
      result.questions_id = {};
      for (const [questionId, rawQuestion] of Object.entries(source.questions_id)) {
        if (!rawQuestion || typeof rawQuestion !== "object") continue;
        const question = {
          prompt: text(rawQuestion.prompt || rawQuestion.question || "", "", 4_000),
          options: normalizeOptions(rawQuestion.options),
          multiple: Boolean(rawQuestion.multiple),
          ...(rawQuestion.answer !== undefined ? { answer: text(rawQuestion.answer, "", 8_000) } : {}),
          ...(rawQuestion.selected_option_id ? { selected_option_id: text(rawQuestion.selected_option_id, "", 200) } : {}),
          ...(Array.isArray(rawQuestion.selected_option_ids)
            ? { selected_option_ids: rawQuestion.selected_option_ids.map((optionId) => text(optionId, "", 200).trim()).filter(Boolean) }
            : {}),
          ...(rawQuestion.free_text !== undefined ? { free_text: text(rawQuestion.free_text, "", 8_000) } : {}),
          ...(rawQuestion.request_id ? { request_id: text(rawQuestion.request_id, "", 240) } : {}),
          ...(rawQuestion.reason ? { reason: text(rawQuestion.reason, "", 4_000) } : {}),
          ...(rawQuestion.status ? { status: text(rawQuestion.status, "", 40) } : {}),
          ...(rawQuestion.answered_at ? { answered_at: text(rawQuestion.answered_at, "", 80) } : {}),
        };
        result.questions_id[text(questionId, "", 120)] = question;
      }
    }

    if (Array.isArray(source.tool_usage)) {
      result.tool_usage = source.tool_usage.map((name) => text(name, "", 200).trim()).filter(Boolean);
    }
    return result;
  }

  function normalizeSession(sessionId, session = {}) {
    const source = session && typeof session === "object" ? session : {};
    const rawMeta = source[RESERVED_META_KEY] && typeof source[RESERVED_META_KEY] === "object"
      ? clone(source[RESERVED_META_KEY])
      : {};
    const normalized = {
      [RESERVED_META_KEY]: {
        ...rawMeta,
        session_id: text(rawMeta.session_id || sessionId, "", 240),
        title: text(rawMeta.title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE, 240),
        created_at: text(rawMeta.created_at || timestamp(), "", 80),
        updated_at: text(rawMeta.updated_at || rawMeta.created_at || timestamp(), "", 80),
        status: text(rawMeta.status || "active", "active", 40),
      },
    };
    for (const [blockId, block] of Object.entries(source)) {
      if (blockId === RESERVED_META_KEY || !block || typeof block !== "object") continue;
      normalized[blockId] = normalizeBlock(block, blockId);
    }
    return normalized;
  }

  function normalizeDocument(document, projectId, workspace = "") {
    const source = document && typeof document === "object" ? document : {};
    const sourceProject = source[projectId] && typeof source[projectId] === "object"
      ? source[projectId]
      : Object.values(source).find((value) => value && typeof value === "object" && value[RESERVED_META_KEY]?.project_id === projectId);
    const project = sourceProject || {};
    const sourceMeta = project[RESERVED_META_KEY] && typeof project[RESERVED_META_KEY] === "object"
      ? clone(project[RESERVED_META_KEY])
      : {};
    const normalizedProject = {
      [RESERVED_META_KEY]: {
        ...sourceMeta,
        schema_version: STORE_VERSION,
        project_id: text(sourceMeta.project_id || projectId, "", 240),
        project_path: text(sourceMeta.project_path || workspace, "", 32_768),
        active_session_id: text(sourceMeta.active_session_id || "", "", 240),
        closed_session_ids: Array.isArray(sourceMeta.closed_session_ids)
          ? sourceMeta.closed_session_ids.map((value) => text(value, "", 240)).filter(Boolean)
          : [],
        created_at: text(sourceMeta.created_at || timestamp(), "", 80),
        updated_at: text(sourceMeta.updated_at || timestamp(), "", 80),
      },
    };
    for (const [sessionId, session] of Object.entries(project)) {
      if (sessionId === RESERVED_META_KEY || !session || typeof session !== "object") continue;
      normalizedProject[text(sessionId, "", 240)] = normalizeSession(sessionId, session);
    }
    return { [projectId]: normalizedProject };
  }

  function projectPart(document, projectId) {
    if (!document?.[projectId] || typeof document[projectId] !== "object") {
      document[projectId] = emptyDocument(projectId)[projectId];
    }
    return document[projectId];
  }

  function sessionBlocks(session) {
    return Object.entries(session || {})
      .filter(([key, value]) => key !== RESERVED_META_KEY && value && typeof value === "object")
      .sort(([left], [right]) => {
        const leftNumber = Number(left.match(/^(?:block[_-])?(\d+)$/i)?.[1] || Number.MAX_SAFE_INTEGER);
        const rightNumber = Number(right.match(/^(?:block[_-])?(\d+)$/i)?.[1] || Number.MAX_SAFE_INTEGER);
        return leftNumber - rightNumber || left.localeCompare(right);
      });
  }

  function nextBlockId(session) {
    let max = 0;
    for (const [key] of sessionBlocks(session)) {
      const value = Number(key.match(/^block_(\d+)$/i)?.[1] || 0);
      if (value > max) max = value;
    }
    return `block_${max + 1}`;
  }

  function sessionProjection(sessionId, session, closed = false, archived = false) {
    const meta = session?.[RESERVED_META_KEY] || {};
    const blockEntries = sessionBlocks(session);
    const blocks = blockEntries.map(([, block]) => block);
    const history = [];
    for (const block of blocks) {
      const transcript = block?.[RESERVED_META_KEY]?.transcript;
      if (Array.isArray(transcript) && transcript.length) {
        const blockHistory = clone(transcript) || [];
        const hasUserPrompt = block.user_prompt === undefined
          || blockHistory.some((message) => message?.role === "user" && (message.id === block.user_prompt_id || message.content === block.user_prompt));
        if (!hasUserPrompt && block.user_prompt !== undefined) {
          blockHistory.unshift({
            id: block.user_prompt_id || id("message"),
            role: "user",
            content: block.user_prompt,
            createdAt: block.time_stamp,
          });
        }
        if (block.ai_prompt !== undefined) {
          const assistantIndex = blockHistory.map((message) => message?.role).lastIndexOf("assistant");
          const assistantMessage = {
            id: block.ai_prompt_id || id("message"),
            role: "assistant",
            content: block.ai_prompt,
            createdAt: block.completed_at || block.time_stamp,
          };
          if (assistantIndex >= 0) blockHistory[assistantIndex] = { ...blockHistory[assistantIndex], ...assistantMessage };
          else blockHistory.push(assistantMessage);
        }
        history.push(...blockHistory);
        continue;
      }
      if (block.user_prompt !== undefined) {
        history.push({ id: block.user_prompt_id || id("message"), role: "user", content: block.user_prompt, createdAt: block.time_stamp });
      }
      if (block.ai_prompt !== undefined) {
        history.push({ id: block.ai_prompt_id || id("message"), role: "assistant", content: block.ai_prompt, createdAt: block.completed_at || block.time_stamp });
      }
    }
    return {
      id: text(sessionId, "", 240),
      memorySessionId: text(sessionId, "", 240),
      memoryBlockId: text(meta.active_block_id || blockEntries.at(-1)?.[0] || "", "", 240),
      title: text(meta.title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE, 240),
      history,
      messages: history,
      contextFilesCache: [],
      memory: clone(meta.memory) || undefined,
      contextSummary: text(meta.context_summary || meta.contextSummary || "", "", 20_000),
      contextSummaryMeta: clone(meta.context_summary_meta || meta.contextSummaryMeta) || null,
      lastContextUsage: clone(meta.last_context_usage || meta.lastContextUsage) || null,
      chatMode: text(meta.mode || meta.chat_mode || "agent", "agent", 100),
      chatFamily: text(meta.family || meta.chat_family || "xekute", "xekute", 100),
      selectedModel: text(meta.model || meta.selected_model || "", "", 240),
      kind: text(meta.kind || "chat", "chat", 40),
      parentSessionId: text(meta.parent_session_id || "", "", 240),
      childInvocationId: text(meta.child_invocation_id || "", "", 240),
      createdAt: text(meta.created_at || "", "", 80) || null,
      updatedAt: text(meta.updated_at || meta.created_at || "", "", 80) || null,
      status: closed || archived ? "complete" : (text(meta.status || "active", "active", 40) === "active" ? "complete" : text(meta.status, "complete", 40)),
      closed,
      archived,
    };
  }

  function projectProjection(document, projectId, workspace, extras = {}) {
    const project = document?.[projectId] || emptyDocument(projectId, workspace)[projectId];
    const meta = project[RESERVED_META_KEY] || {};
    const closedIds = new Set(Array.isArray(meta.closed_session_ids) ? meta.closed_session_ids : []);
    const sessions = [];
    const closedSessions = [];
    const archivedSessions = [];
    for (const [sessionId, session] of Object.entries(project)) {
      if (sessionId === RESERVED_META_KEY) continue;
      const archived = session?.[RESERVED_META_KEY]?.status === "archived";
      const closed = !archived && (closedIds.has(sessionId) || session?.[RESERVED_META_KEY]?.status === "closed");
      const projected = sessionProjection(sessionId, session, closed, archived);
      projected.projectId = projectId;
      projected.memoryProjectId = projectId;
      if (projected.archived) archivedSessions.push(projected);
      else if (projected.closed) closedSessions.push(projected);
      else sessions.push(projected);
    }
    return {
      ok: true,
      exists: Boolean(extras.exists),
      recovered: Boolean(extras.recovered),
      warning: extras.warning || "",
      projectId,
      projectPath: text(meta.project_path || workspace, "", 32_768),
      activeSessionId: text(meta.active_session_id || "", "", 240),
      sessions,
      closedSessions,
      archivedSessions,
      data: clone(document),
    };
  }

  function updateSessionMeta(session, input = {}) {
    const meta = session[RESERVED_META_KEY] || (session[RESERVED_META_KEY] = {});
    const mapping = {
      title: "title",
      model: "model",
      mode: "mode",
      chatMode: "mode",
      family: "family",
      chatFamily: "family",
      contextSummary: "context_summary",
      context_summary: "context_summary",
      contextSummaryMeta: "context_summary_meta",
      context_summary_meta: "context_summary_meta",
      lastContextUsage: "last_context_usage",
      last_context_usage: "last_context_usage",
      memory: "memory",
      status: "status",
      kind: "kind",
      parentSessionId: "parent_session_id",
      parent_session_id: "parent_session_id",
      childInvocationId: "child_invocation_id",
      child_invocation_id: "child_invocation_id",
    };
    for (const [sourceKey, targetKey] of Object.entries(mapping)) {
      if (input[sourceKey] !== undefined) meta[targetKey] = clone(input[sourceKey]);
    }
    meta.updated_at = timestamp();
    if (!meta.created_at) meta.created_at = meta.updated_at;
    if (!meta.title) meta.title = DEFAULT_SESSION_TITLE;
    if (!meta.session_id) meta.session_id = input.sessionId || "";
  }

  function appendTranscript(block, messages) {
    if (!Array.isArray(messages)) return;
    block[RESERVED_META_KEY] = block[RESERVED_META_KEY] || {};
    block[RESERVED_META_KEY].transcript = normalizeTranscript(messages, block.time_stamp || "block");
  }

  function questionRows(questions) {
    if (Array.isArray(questions)) return questions;
    if (!questions || typeof questions !== "object") return [];
    return Object.entries(questions).map(([id, question]) => ({ id, ...(question && typeof question === "object" ? question : { prompt: question }) }));
  }

  function updateAssistantTranscript(block, messageId, content) {
    const meta = block[RESERVED_META_KEY] || (block[RESERVED_META_KEY] = {});
    const transcript = Array.isArray(meta.transcript) ? meta.transcript : [];
    const assistantIndex = transcript.map((message) => message?.role).lastIndexOf("assistant");
    const message = {
      id: text(messageId || id("message"), "", 240),
      role: "assistant",
      content: messageText(content),
      createdAt: timestamp(),
    };
    if (assistantIndex >= 0) transcript[assistantIndex] = { ...transcript[assistantIndex], ...message };
    else transcript.push(message);
    meta.transcript = normalizeTranscript(transcript, block.time_stamp || "block");
  }

  function ensureQuestions(block, questions = [], { requestId = "", reason = "" } = {}) {
    const current = block.questions_id && typeof block.questions_id === "object" ? block.questions_id : {};
    for (const rawQuestion of questionRows(questions)) {
      const questionId = text(rawQuestion?.id || rawQuestion?.questionId || "", "", 120).trim();
      if (!questionId) continue;
      const previous = current[questionId] || {};
      current[questionId] = {
        ...previous,
        prompt: text(rawQuestion.prompt || rawQuestion.question || previous.prompt || "", "", 4_000),
        options: normalizeOptions(rawQuestion.options || previous.options),
        multiple: Boolean(rawQuestion.multiple),
        ...(requestId ? { request_id: text(requestId, "", 240) } : {}),
        ...(reason ? { reason: text(reason, "", 4_000) } : {}),
      };
    }
    if (Object.keys(current).length) block.questions_id = current;
  }

  function applyAnswers(block, answers = [], { skipped = false, expired = false } = {}) {
    if (!block.questions_id || typeof block.questions_id !== "object") return;
    const status = expired ? "expired" : skipped ? "skipped" : "answered";
    const rows = Array.isArray(answers)
      ? answers
      : answers && typeof answers === "object"
        ? Object.entries(answers).map(([questionId, answer]) => ({
            questionId,
            ...(answer && typeof answer === "object" ? answer : { answer }),
          }))
        : [];
    if (!rows.length && (skipped || expired)) {
      for (const question of Object.values(block.questions_id)) {
        question.status = status;
        question.answered_at = timestamp();
      }
      return;
    }
    for (const rawAnswer of rows) {
      const questionId = text(rawAnswer?.questionId || rawAnswer?.question_id || rawAnswer?.id || "", "", 120).trim();
      if (!questionId || !block.questions_id[questionId]) continue;
      const question = block.questions_id[questionId];
      const selectedOptionId = text(rawAnswer.selectedOptionId || rawAnswer.selected_option_id || rawAnswer.optionId || "", "", 200).trim();
      const selectedOptionIds = (Array.isArray(rawAnswer.selectedOptionIds)
        ? rawAnswer.selectedOptionIds
        : Array.isArray(rawAnswer.selected_option_ids)
          ? rawAnswer.selected_option_ids
          : [])
        .map((optionId) => text(optionId, "", 200).trim())
        .filter(Boolean);
      const answerText = text(rawAnswer.answer || "", "", 8_000).trim();
      const freeText = text(rawAnswer.freeText || rawAnswer.free_text || "", "", 8_000).trim();
      const selected = question.options.find((option) => option.id === selectedOptionId || option.label === answerText);
      const selectedLabels = selectedOptionIds.map((optionId) => question.options.find((option) => option.id === optionId)?.label || optionId);
      question.answer = freeText || selectedLabels.join(", ") || selected?.label || answerText || selectedOptionId;
      question.selected_option_id = selectedOptionId || selected?.id || "";
      question.selected_option_ids = selectedOptionIds;
      question.free_text = freeText;
      question.status = status;
      question.answered_at = timestamp();
    }
  }

  function applyEvent(document, projectId, event = {}) {
    const project = projectPart(document, projectId);
    const sessionId = text(event.sessionId || "", "", 240).trim();
    const blockId = text(event.blockId || "", "", 240).trim();
    if (!sessionId || !project[sessionId]) throw new Error("Session memory session was not found");
    const session = project[sessionId];
    const block = blockId ? session[blockId] : null;
    const originalType = text(event.type || event.event || "", "", 80).trim().toLowerCase();
    const type = {
      question_presented: "questions_presented",
      question_answered: "questions_answered",
      tool_start: "tool_usage",
      assistant_output: "outcome",
      ai_output: "outcome",
      stop: "outcome",
      stopped: "outcome",
      failure: "outcome",
      failed: "outcome",
      partial: "outcome",
      archive_session: "archive",
      unarchive_session: "unarchive",
    }[originalType] || originalType;
    const eventOutcome = event.outcome || ({
      stop: "stopped",
      stopped: "stopped",
      failure: "failed",
      failed: "failed",
      partial: "incomplete",
    }[originalType] || "");

    if (blockId && block) session[RESERVED_META_KEY].active_block_id = blockId;

    if (type === "session_meta" || type === "snapshot") updateSessionMeta(session, event.session || event.sessionMeta || {});

    if (type === "snapshot") {
      if (block) {
        if (Array.isArray(event.transcript)) appendTranscript(block, event.transcript);
        if (event.assistant?.text || event.assistant?.content) {
          const content = messageText(event.assistant.text || event.assistant.content);
          if (content.trim()) {
            block.ai_prompt_id = text(event.assistant.id || block.ai_prompt_id || id("message"), "", 240);
            block.ai_prompt = content;
            if (!Array.isArray(event.transcript)) updateAssistantTranscript(block, block.ai_prompt_id, content);
          }
        }
        if (eventOutcome) block.outcome = text(eventOutcome, "", 40);
        if (eventOutcome && ["completed", "failed", "stopped", "incomplete"].includes(eventOutcome)) block.completed_at = timestamp();
      }
    } else if (type === "questions_presented") {
      if (block) ensureQuestions(block, event.questions, { requestId: event.requestId, reason: event.reason });
    } else if (type === "questions_answered") {
      if (block) applyAnswers(block, event.answers, { skipped: Boolean(event.skipped), expired: Boolean(event.expired) });
    } else if (type === "tool_usage") {
      if (block) {
        const names = Array.isArray(event.toolNames)
          ? event.toolNames
          : Array.isArray(event.tools)
            ? event.tools.map((tool) => tool?.toolName || tool?.tool_name || tool?.name || tool)
            : [event.toolName || event.tool_name || event.tool?.toolName || event.tool?.tool_name || event.tool?.name || event.tool];
        const existing = Array.isArray(block.tool_usage) ? block.tool_usage : [];
        const appended = names.map((name) => text(name, "", 200).trim()).filter(Boolean);
        if (appended.length) block.tool_usage = [...existing, ...appended];
      }
    } else if (type === "assistant" || type === "outcome") {
      if (block) {
        const content = messageText(event.text || event.content || event.ai_prompt || event.partialOutput || event.partial_output || "");
        if (content.trim()) {
          block.ai_prompt_id = text(event.messageId || event.id || block.ai_prompt_id || id("message"), "", 240);
          block.ai_prompt = content;
          if (!Array.isArray(event.transcript)) updateAssistantTranscript(block, block.ai_prompt_id, content);
        }
        if (Array.isArray(event.transcript)) appendTranscript(block, event.transcript);
        if (eventOutcome) block.outcome = text(eventOutcome, "", 40);
        if (eventOutcome && ["completed", "failed", "stopped", "incomplete"].includes(eventOutcome)) block.completed_at = timestamp();
      }
    } else if (type === "transcript") {
      if (block) appendTranscript(block, event.messages || event.transcript);
    } else if (type === "context_capsule_checkpoint") {
      // Capsules are encrypted along with the session document.  Do not accept
      // a transcript here: only the main-process lifecycle capture may append.
      if (block && event.capsule && typeof event.capsule === "object") {
        const meta = block[RESERVED_META_KEY] || (block[RESERVED_META_KEY] = {});
        const capsules = Array.isArray(meta.context_capsules) ? meta.context_capsules : [];
        const hash = text(event.capsule.integrityHash || "", "", 160);
        if (hash && !capsules.some((item) => item?.integrityHash === hash)) {
          capsules.push(clone(event.capsule));
          meta.context_capsules = capsules.slice(-2000);
        }
      }
    } else if (type === "context_capsule_finalize") {
      if (block) {
        const meta = block[RESERVED_META_KEY] || (block[RESERVED_META_KEY] = {});
        meta.context_capsule_finalized_at = timestamp();
        meta.context_capsule_outcome = text(event.outcome || "incomplete", "incomplete", 40);
        if (Array.isArray(event.user_records)) meta.context_user_records = clone(event.user_records).slice(0, 32);
      }
    } else if (type === "context_compaction_commit") {
      // Summary and cursor move together in the same encrypted atomic write.
      updateSessionMeta(session, {
        contextSummary: text(event.summary || "", "", 20_000),
        contextSummaryMeta: clone(event.meta || {}),
      });
    } else if (type === "close") {
      const closed = new Set(project[RESERVED_META_KEY].closed_session_ids || []);
      closed.add(sessionId);
      project[RESERVED_META_KEY].closed_session_ids = [...closed];
      session[RESERVED_META_KEY].status = "closed";
      if (project[RESERVED_META_KEY].active_session_id === sessionId) project[RESERVED_META_KEY].active_session_id = "";
    } else if (type === "reopen") {
      project[RESERVED_META_KEY].closed_session_ids = (project[RESERVED_META_KEY].closed_session_ids || []).filter((value) => value !== sessionId);
      session[RESERVED_META_KEY].status = "active";
      project[RESERVED_META_KEY].active_session_id = sessionId;
    } else if (type === "archive") {
      project[RESERVED_META_KEY].closed_session_ids = (project[RESERVED_META_KEY].closed_session_ids || []).filter((value) => value !== sessionId);
      session[RESERVED_META_KEY].status = "archived";
      if (project[RESERVED_META_KEY].active_session_id === sessionId) project[RESERVED_META_KEY].active_session_id = "";
    } else if (type === "unarchive") {
      session[RESERVED_META_KEY].status = "active";
      project[RESERVED_META_KEY].active_session_id = sessionId;
    }

    if (!["close", "reopen", "archive", "unarchive"].includes(type) && event.sessionId) {
      project[RESERVED_META_KEY].active_session_id = sessionId;
    }
    project[RESERVED_META_KEY].updated_at = timestamp();
  }

  function saveDocument(projectId, workspace, document) {
    const file = projectFile(projectId);
    writeAtomic(file, protectDocument(document));
    const registry = readRegistry();
    const canonical = canonicalWorkspace(workspace);
    if (canonical && !registry.projects[canonical]) {
      registry.projects[canonical] = {
        project_id: projectId,
        project_path: displayWorkspace(workspace),
        created_at: timestamp(),
        updated_at: timestamp(),
      };
      persistRegistry(registry);
    }
    return { file, savedAt: timestamp() };
  }

  function enqueue(key, task) {
    const previous = writeQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    writeQueues.set(key, next);
    return next.finally(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    });
  }

  function migrationBlocks(messages, { toolEvents = [] } = {}) {
    const blocks = {};
    let current = null;
    let counter = 0;

    function createUnmatched() {
      counter += 1;
      current = {
        time_stamp: timestamp(),
        outcome: "incomplete",
        [RESERVED_META_KEY]: { transcript: [] },
      };
      blocks[`block_${counter}`] = current;
    }

    function addQuestions(message) {
      if (!current || !message || typeof message !== "object") return;
      let questions = Array.isArray(message.questions) ? message.questions : [];
      if (!questions.length && message.questions_id && typeof message.questions_id === "object") {
        questions = Object.entries(message.questions_id).map(([questionId, question]) => ({ id: questionId, ...question }));
      }
      if (!questions.length && message.question && typeof message.question === "object") questions = [message.question];
      if (questions.length) ensureQuestions(current, questions, { requestId: message.requestId, reason: message.reason });
      if (Array.isArray(message.answers)) applyAnswers(current, message.answers, {
        skipped: Boolean(message.skipped),
        expired: Boolean(message.expired),
      });
    }

    for (const rawMessage of Array.isArray(messages) ? messages : []) {
      const message = clone(rawMessage) || {};
      const role = text(message.role || "message", "message", 40);
      if (role === "user") {
        counter += 1;
        current = {
          time_stamp: text(message.createdAt || timestamp(), "", 80),
          user_prompt_id: text(message.id || id("message"), "", 240),
          user_prompt: messageText(message.content || ""),
          outcome: "incomplete",
          [RESERVED_META_KEY]: { transcript: [] },
        };
        blocks[`block_${counter}`] = current;
      }
      if (!current) createUnmatched();
      current[RESERVED_META_KEY].transcript.push(message);
      addQuestions(message);

      if (role === "assistant") {
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        const names = toolCalls.map((call) => call?.function?.name || call?.toolName || call?.action).filter(Boolean).map((name) => text(name));
        if (names.length) current.tool_usage = [...(current.tool_usage || []), ...names];
        const content = nonEmptyText(message.content);
        if (content && !names.length) {
          current.ai_prompt_id = text(message.id || id("message"), "", 240);
          current.ai_prompt = messageText(message.content);
          current.outcome = "completed";
          current.completed_at = text(message.createdAt || timestamp(), "", 80);
        }
      } else if (role === "tool") {
        const name = text(message.tool_name || message.toolName || "", "", 200).trim();
        if (name) current.tool_usage = [...(current.tool_usage || []), name];
      }
    }
    for (const event of Array.isArray(toolEvents) ? toolEvents : []) {
      if (!current) createUnmatched();
      const names = Array.isArray(event?.toolNames)
        ? event.toolNames
        : [event?.toolName || event?.tool || event?.name];
      const appended = names.map((name) => text(name, "", 200).trim()).filter(Boolean);
      if (appended.length) current.tool_usage = [...(current.tool_usage || []), ...appended];
    }
    return blocks;
  }

  function migrateLegacy(workspace, projectId, legacyState) {
    const document = emptyDocument(projectId, workspace);
    const project = document[projectId];
    const idMap = new Map();
    const allSessions = [
      ...(Array.isArray(legacyState?.sessions) ? legacyState.sessions.map((session) => ({ session, closed: false })) : []),
      ...(Array.isArray(legacyState?.closedSessions) ? legacyState.closedSessions.map((session) => ({ session, closed: true })) : []),
    ];

    for (const { session: source, closed } of allSessions) {
      const messages = Array.isArray(source?.messages) ? source.messages : source?.history;
      if (!Array.isArray(messages) || !messages.length) continue;
      const sessionId = id("session");
      idMap.set(source.id, sessionId);
      project[sessionId] = {
        [RESERVED_META_KEY]: {
          session_id: sessionId,
          legacy_session_id: text(source.id || "", "", 240),
          title: text(source.title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE, 240),
          created_at: text(source.createdAt || timestamp(), "", 80),
          updated_at: text(source.updatedAt || source.createdAt || timestamp(), "", 80),
          status: closed ? "closed" : "active",
          model: text(source.model || source.selectedModel || "", "", 240),
          mode: text(source.mode || source.chatMode || "agent", "agent", 100),
          family: text(source.safetyFamily || source.chatFamily || "xekute", "xekute", 100),
          memory: clone(source.memory),
          context_summary: text(source.contextSummary || source.memory?.summary || "", "", 20_000),
          context_summary_meta: clone(source.contextSummaryMeta),
          last_context_usage: clone(source.lastContextUsage),
          migration_source: "legacy-chat-memory",
        },
        ...migrationBlocks(messages, { toolEvents: source.toolEvents }),
      };
      if (closed) project[RESERVED_META_KEY].closed_session_ids.push(sessionId);
    }

    const oldActive = idMap.get(legacyState?.activeSessionId);
    project[RESERVED_META_KEY].active_session_id = oldActive || "";
    project[RESERVED_META_KEY].migration_version = 1;
    project[RESERVED_META_KEY].migrated_at = timestamp();
    return document;
  }

  function load(rawWorkspace, { migrate = false } = {}) {
    const resolved = resolveProject(rawWorkspace, { persist: false });
    if (!resolved.workspace) return { ok: true, exists: false, projectId: "", projectPath: "", sessions: [], closedSessions: [], archivedSessions: [], activeSessionId: "" };

    if (!resolved.projectId) {
      return { ok: true, exists: false, projectId: "", projectPath: resolved.workspace, sessions: [], closedSessions: [], archivedSessions: [], activeSessionId: "" };
    }

    const loaded = readDocument(resolved.projectId, resolved.workspace);
    // Legacy chat files are imported only by scripts/migrate-chat-memory.js.
    // Loading the active store never mutates or consults those files.
    return projectProjection(loaded.document, resolved.projectId, resolved.workspace, loaded);
  }

  function begin(rawWorkspace, { sessionId = "", title = DEFAULT_SESSION_TITLE, userPrompt, userMessageId = "", session = {} } = {}) {
    const prompt = messageText(userPrompt);
    if (!prompt.trim()) return Promise.resolve({ ok: true, persisted: false, reason: "EMPTY_PROMPT" });
    const resolved = resolveProject(rawWorkspace, { persist: true });
    if (!resolved.projectId) return Promise.resolve({ ok: false, error: "A project workspace is required." });

    return enqueue(resolved.canonical, async () => {
      const loaded = readDocument(resolved.projectId, resolved.workspace);
      const document = loaded.document;
      const project = projectPart(document, resolved.projectId);
      const projectMeta = project[RESERVED_META_KEY];
      const actualSessionId = sessionId && project[sessionId] ? sessionId : id("session");
      if (!project[actualSessionId]) {
        project[actualSessionId] = {
          [RESERVED_META_KEY]: {
            session_id: actualSessionId,
            title: text(title || DEFAULT_SESSION_TITLE, DEFAULT_SESSION_TITLE, 240),
            created_at: timestamp(),
            updated_at: timestamp(),
            status: "active",
            ...clone(session),
          },
        };
      }
      const actualSession = project[actualSessionId];
      const blockId = nextBlockId(actualSession);
      const messageId = text(userMessageId || id("message"), "", 240);
      const block = {
        time_stamp: timestamp(),
        user_prompt_id: messageId,
        user_prompt: prompt,
        outcome: "pending",
        [RESERVED_META_KEY]: {
          transcript: [{ id: messageId, role: "user", content: prompt, createdAt: timestamp() }],
        },
      };
      actualSession[blockId] = block;
      updateSessionMeta(actualSession, { ...session, title, sessionId: actualSessionId, status: "active" });
      projectMeta.active_session_id = actualSessionId;
      projectMeta.closed_session_ids = (projectMeta.closed_session_ids || []).filter((value) => value !== actualSessionId);
      projectMeta.updated_at = timestamp();
      saveDocument(resolved.projectId, resolved.workspace, document);
      return {
        ok: true,
        persisted: true,
        projectId: resolved.projectId,
        sessionId: actualSessionId,
        blockId,
        userPromptId: messageId,
        projectPath: resolved.workspace,
      };
    });
  }

  function recordSync(rawWorkspace, event = {}) {
    const resolved = resolveProject(rawWorkspace, { persist: false });
    if (!resolved.projectId) return { ok: false, error: "Project session memory is not initialized." };
    const loaded = readDocument(resolved.projectId, resolved.workspace);
    const document = loaded.document;
    applyEvent(document, resolved.projectId, event);
    saveDocument(resolved.projectId, resolved.workspace, document);
    return { ok: true, projectId: resolved.projectId, sessionId: event.sessionId, blockId: event.blockId, savedAt: timestamp() };
  }

  function record(rawWorkspace, event = {}) {
    const resolved = resolveProject(rawWorkspace, { persist: false });
    if (!resolved.projectId) return Promise.resolve({ ok: false, error: "Project session memory is not initialized." });
    return enqueue(resolved.canonical, async () => recordSync(rawWorkspace, event));
  }

  function flush() {
    return Promise.all([...writeQueues.values()].map((pending) => pending.catch(() => null)))
      .then(() => ({ ok: true }));
  }

  function listCapsules(rawWorkspace, { sessionId = "", throughBlockId = "", throughMessageId = "" } = {}) {
    const resolved = resolveProject(rawWorkspace, { persist: false });
    if (!resolved.projectId || !sessionId) return { ok: true, capsules: [], userRecords: [], blocks: [], legacyGaps: [], committedThroughMessageId: "" };
    const loaded = readDocument(resolved.projectId, resolved.workspace);
    const session = loaded.document?.[resolved.projectId]?.[text(sessionId, "", 240)];
    if (!session) return { ok: false, error: "Session memory session was not found.", capsules: [], userRecords: [], blocks: [], legacyGaps: [], committedThroughMessageId: "" };
    const blocks = sessionBlocks(session);
    const boundaryIndex = throughBlockId
      ? blocks.findIndex(([id]) => id === throughBlockId)
      : throughMessageId
        ? blocks.findIndex(([, block]) => (block?.[RESERVED_META_KEY]?.transcript || []).some((message) => String(message?.id || "") === String(throughMessageId)))
        : blocks.length - 1;
    let selected = boundaryIndex >= 0 ? blocks.slice(0, boundaryIndex + 1) : [];
    // Do not compact part of a block. If the requested message is not the
    // block's last durable message, leave that entire active block outside the
    // atomic boundary so late tool events cannot leak into this commit.
    if (throughMessageId && selected.length) {
      const lastBlock = selected.at(-1)?.[1];
      const transcript = Array.isArray(lastBlock?.[RESERVED_META_KEY]?.transcript) ? lastBlock[RESERVED_META_KEY].transcript : [];
      const lastMessageId = String(transcript.at(-1)?.id || lastBlock?.ai_prompt_id || lastBlock?.user_prompt_id || "");
      if (lastMessageId !== String(throughMessageId)) selected = selected.slice(0, -1);
    }
    const capsules = []; const userRecords = []; const blockIds = []; const legacyGaps = [];
    for (const [id, block] of selected) {
      blockIds.push(id);
      const meta = block?.[RESERVED_META_KEY] || {};
      if (Array.isArray(meta.context_capsules)) capsules.push(...clone(meta.context_capsules));
      if (Array.isArray(meta.context_user_records)) userRecords.push(...clone(meta.context_user_records));
      if (!Array.isArray(meta.context_capsules) || !meta.context_capsules.length) {
        const pointer = crypto.createHash("sha256").update(JSON.stringify({ sessionId, blockId: id, transcript: meta.transcript || [] })).digest("hex");
        legacyGaps.push({ blockId: id, transcriptPointerHash: pointer, reason: "legacy_or_unparseable_block_claims_omitted" });
      }
    }
    const last = selected.at(-1)?.[1];
    const lastTranscript = Array.isArray(last?.[RESERVED_META_KEY]?.transcript) ? last[RESERVED_META_KEY].transcript : [];
    const committedThroughMessageId = String(lastTranscript.at(-1)?.id || last?.ai_prompt_id || last?.user_prompt_id || "");
    return { ok: true, capsules, userRecords, blocks: blockIds, legacyGaps, committedThroughMessageId, sessionMeta: clone(session[RESERVED_META_KEY] || {}) };
  }

  function remove(rawWorkspace, sessionId) {
    const resolved = resolveProject(rawWorkspace, { persist: false });
    if (!resolved.projectId) return Promise.resolve({ ok: true, removed: false });
    return enqueue(resolved.canonical, async () => {
      const loaded = readDocument(resolved.projectId, resolved.workspace);
      const document = loaded.document;
      const project = projectPart(document, resolved.projectId);
      const key = text(sessionId, "", 240);
      const existed = Boolean(project[key]);
      delete project[key];
      const projectMeta = project[RESERVED_META_KEY];
      projectMeta.closed_session_ids = (projectMeta.closed_session_ids || []).filter((value) => value !== key);
      if (projectMeta.active_session_id === key) projectMeta.active_session_id = "";
      projectMeta.updated_at = timestamp();
      saveDocument(resolved.projectId, resolved.workspace, document);
      return { ok: true, removed: existed, projectId: resolved.projectId, sessionId: key };
    });
  }

  function sessionFile(rawWorkspace) {
    const resolved = resolveProject(rawWorkspace, { persist: false });
    return resolved.projectId ? projectFile(resolved.projectId) : "";
  }

  function close(rawWorkspace, sessionId) {
    return record(rawWorkspace, { type: "close", sessionId });
  }

  function reopen(rawWorkspace, sessionId) {
    return record(rawWorkspace, { type: "reopen", sessionId });
  }

  return {
    load,
    begin,
    record,
    recordSync,
    listCapsules,
    flush,
    remove,
    deleteSession: remove,
    close,
    reopen,
    sessionFile,
    projectFile,
    registryFile,
    resolveProject,
    resolveProjectId: (workspace) => resolveProject(workspace, { persist: false }).projectId,
    normalizeDocument,
    migrationBlocks,
    migrateLegacy,
    STORE_VERSION,
  };
}

module.exports = { createSessionMemoryStore, RESERVED_META_KEY, STORE_VERSION };
