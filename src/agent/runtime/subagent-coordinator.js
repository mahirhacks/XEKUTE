"use strict";

// Coordinates background child runs for one or more parent agent sessions.
// Model execution remains injected by the delegation provider; this module
// owns only admission, lifecycle, and the FIFO result hand-off contract.

const Tunables = require("./tunables.js");
const DEFAULT_MAX_ACTIVE_CHILDREN = Math.max(1, Number(Tunables.MAX_ACTIVE_CHILDREN) || 8);
const MAX_SPAWN_BATCH = 5;

function boundedText(value, maximum = 2_000) {
  return String(value || "").slice(0, maximum);
}

function createSubagentCoordinator({
  maxActiveChildren = DEFAULT_MAX_ACTIVE_CHILDREN,
  onResultReady = () => {},
  onLifecycle = () => {},
  now = () => Date.now(),
} = {}) {
  const parents = new Map();
  const children = new Map();
  let closed = false;

  function parentFor(parentKey, options = {}) {
    const key = String(parentKey || "");
    if (!key) throw new TypeError("parentKey is required");
    let parent = parents.get(key);
    if (!parent) {
      parent = {
        parentKey: key,
        parentSessionId: String(options.parentSessionId || ""),
        senderId: String(options.senderId || ""),
        workspace: String(options.workspace || ""),
        maxActiveChildren: Math.max(1, Number(options.maxActiveChildren || maxActiveChildren) || DEFAULT_MAX_ACTIVE_CHILDREN),
        activeCount: 0,
        spawnQueue: [],
        resultQueue: [],
        questionQueue: [],
        escalatedRequestId: "",
        announcedResultId: "",
        processingResultId: "",
        pausedResultId: "",
        parentBusy: false,
        sequence: 0,
        onResultReady: typeof options.onResultReady === "function" ? options.onResultReady : onResultReady,
        onLifecycle: typeof options.onLifecycle === "function" ? options.onLifecycle : onLifecycle,
      };
      parents.set(key, parent);
    } else {
      if (options.parentSessionId) parent.parentSessionId = String(options.parentSessionId);
      if (options.senderId) parent.senderId = String(options.senderId);
      if (options.workspace) parent.workspace = String(options.workspace);
      if (typeof options.onResultReady === "function") parent.onResultReady = options.onResultReady;
      if (typeof options.onLifecycle === "function") parent.onLifecycle = options.onLifecycle;
    }
    return parent;
  }

  function lifecycle(parent, child, status, extra = {}) {
    child.status = String(status || child.status || "queued");
    child.updatedAt = new Date(now()).toISOString();
    const payload = {
      type: `subagent_${child.status === "queued" ? "queued" : child.status === "working" ? "started" : child.status === "completed" ? "completed" : child.status === "stopped" ? "stopped" : "failed"}`,
      status: child.status,
      childInvocationId: child.childInvocationId,
      childSessionId: child.childSessionId,
      parentSessionId: parent.parentSessionId,
      model: child.model,
      task: boundedText(child.task, 400),
      summary: boundedText(child.summary || child.task, 240),
      generation: child.generation,
      ...extra,
    };
    try { parent.onLifecycle(payload, child, parent); } catch { /* UI observers are best effort. */ }
    return payload;
  }

  function notifyResult(parent) {
    if (closed || parent.parentBusy || parent.processingResultId || parent.pausedResultId || !parent.resultQueue.length) return;
    const result = parent.resultQueue[0];
    if (parent.announcedResultId === result.resultId) return;
    parent.announcedResultId = result.resultId;
    try {
      const accepted = parent.onResultReady(result, parent);
      // A scheduler can lose a race with a user turn between notification and
      // claim. Let the next parent boundary notify the same FIFO head again
      // instead of leaving an announced-but-unclaimed result stranded.
      if (accepted === false && parent.announcedResultId === result.resultId) parent.announcedResultId = "";
    } catch {
      // Renderer/main delivery is best effort; clearing the announcement lets
      // the next parent boundary retry the authoritative queue head.
      if (parent.announcedResultId === result.resultId) parent.announcedResultId = "";
    }
  }

  function startNext(parent) {
    if (closed) return;
    while (parent.activeCount < parent.maxActiveChildren && parent.spawnQueue.length) {
      const child = parent.spawnQueue.shift();
      if (!child) continue;
      if (child.cancelled) {
        try { child.onCancel?.(child); } catch { /* Persistence/UI cleanup is best effort. */ }
        completeChild(child.childInvocationId, {
          status: "stopped",
          output: { text: "", format: "text", summary: "Stopped before the child started." },
          metadata: { error: "Stopped by operator" },
        });
        continue;
      }
      if (child.controller?.signal?.aborted) {
        try { child.onCancel?.(child); } catch { /* Persistence/UI cleanup is best effort. */ }
        completeChild(child.childInvocationId, {
          status: "stopped",
          output: { text: "", format: "text", summary: "Stopped before the child started." },
          metadata: { error: "Stopped by operator" },
        });
        continue;
      }
      child.status = "working";
      child.generation = Number(child.generation || 0) + 1;
      parent.activeCount += 1;
      children.set(child.childInvocationId, child);
      lifecycle(parent, child, "working");
      Promise.resolve()
        .then(() => child.start(child))
        .then((outcome) => completeChild(child.childInvocationId, outcome))
        .catch((error) => completeChild(child.childInvocationId, {
          status: "failed",
          output: { text: "", format: "text", summary: "" },
          metadata: { error: boundedText(error?.message || "Child agent failed.") },
        }));
    }
  }

  function submitChild({
    parentKey,
    parentSessionId = "",
    senderId = "",
    workspace = "",
    childInvocationId,
    childSessionId,
    model = "",
    task = "",
    summary = "",
    start,
    generation = 0,
    metadata = {},
    controller = null,
    onCancel = null,
  } = {}) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const parent = parentFor(parentKey, { parentSessionId, senderId, workspace });
    const id = String(childInvocationId || "");
    if (!id || typeof start !== "function") throw new TypeError("childInvocationId and start are required");
    if (children.has(id)) return { ok: false, code: "DUPLICATE_SUBAGENT_ID", error: "A sub-agent with this id is already active." };
    const child = {
      childInvocationId: id,
      childSessionId: String(childSessionId || ""),
      parentKey: parent.parentKey,
      parentSessionId: parent.parentSessionId,
      senderId: parent.senderId,
      workspace: parent.workspace,
      model: String(model || ""),
      task: String(task || ""),
      summary: String(summary || task || ""),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      start,
      generation: Number(generation) || 0,
      status: "queued",
      cancelled: false,
      controller,
      onCancel: typeof onCancel === "function" ? onCancel : null,
      steerQueue: [],
      pendingQuestionRequestId: "",
      startInstructionSnapshot: "",
      createdAt: new Date(now()).toISOString(),
      updatedAt: new Date(now()).toISOString(),
    };
    children.set(id, child);
    parent.spawnQueue.push(child);
    lifecycle(parent, child, "queued");
    startNext(parent);
    return {
      ok: true,
      childInvocationId: id,
      childSessionId: child.childSessionId,
      status: child.status,
      generation: child.generation,
    };
  }

  function completeChild(childInvocationId, outcome = {}) {
    const child = children.get(String(childInvocationId || ""));
    if (!child || child.status === "completed" || child.status === "failed" || child.status === "stopped") return null;
    const parent = parents.get(child.parentKey);
    if (!parent) return null;
    const wasWorking = child.status === "working";
    const status = String(outcome.status || "completed").toLowerCase();
    // Only an explicit completed result is successful. Unknown or incomplete
    // statuses fail closed instead of becoming a false completion.
    child.status = status === "stopped" ? "stopped" : status === "completed" ? "completed" : "failed";
    child.output = outcome.output && typeof outcome.output === "object" ? outcome.output : { text: "", format: "text", summary: "" };
    const outcomeMetadata = outcome.metadata && typeof outcome.metadata === "object" ? outcome.metadata : child.metadata;
    child.metadata = {
      ...(outcomeMetadata && typeof outcomeMetadata === "object" ? outcomeMetadata : {}),
      ...(status !== child.status ? { runtimeStatus: status } : {}),
    };
    child.summary = String(outcome.output?.summary || outcome.output?.text || child.summary || "");
    child.updatedAt = new Date(now()).toISOString();
    if (wasWorking) parent.activeCount = Math.max(0, parent.activeCount - 1);
    child.history = Array.isArray(child.metadata?.appendedMessages) ? child.metadata.appendedMessages : (Array.isArray(child.history) ? child.history : []);
    lifecycle(parent, child, child.status, {
      output: child.output,
      metadata: child.metadata,
    });
    const result = {
      resultId: `${child.childInvocationId}:${child.generation}:${parent.sequence += 1}`,
      parentKey: parent.parentKey,
      parentSessionId: parent.parentSessionId,
      childInvocationId: child.childInvocationId,
      childSessionId: child.childSessionId,
      generation: child.generation,
      model: child.model,
      task: boundedText(child.task, 4_000),
      status: child.status,
      output: child.output,
      metadata: child.metadata,
      queuedAt: new Date(now()).toISOString(),
    };
    parent.resultQueue.push(result);
    parent.announcedResultId = parent.announcedResultId === result.resultId ? "" : parent.announcedResultId;
    startNext(parent);
    notifyResult(parent);
    return result;
  }

  function getChild(childInvocationId, parentKey = "") {
    const child = children.get(String(childInvocationId || ""));
    if (!child || (parentKey && child.parentKey !== String(parentKey))) return null;
    return child;
  }

  function submitFollowUp({ childInvocationId, parentKey, task, summary, start, metadata = {}, controller = null, onCancel = null } = {}) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const child = getChild(childInvocationId, parentKey);
    if (!child) return { ok: false, code: "UNKNOWN_SUBAGENT", error: "The delegated child no longer exists." };
    if (child.status === "queued" || child.status === "working") {
      return { ok: false, code: "SUBAGENT_ALREADY_RUNNING", error: "The delegated child is already running." };
    }
    if (typeof start !== "function") return { ok: false, code: "INVALID_SUBAGENT_FOLLOW_UP", error: "A follow-up runner is required." };
    child.task = String(task || child.task);
    child.summary = String(summary || child.task);
    child.metadata = { ...child.metadata, ...(metadata && typeof metadata === "object" ? metadata : {}) };
    child.start = start;
    if (controller) child.controller = controller;
    if (typeof onCancel === "function") child.onCancel = onCancel;
    child.cancelled = false;
    child.status = "queued";
    const parent = parents.get(child.parentKey);
    parent.spawnQueue.push(child);
    lifecycle(parent, child, "queued", { operation: "follow_up" });
    startNext(parent);
    return {
      ok: true,
      childInvocationId: child.childInvocationId,
      childSessionId: child.childSessionId,
      status: child.status,
      generation: child.generation + 1,
      operation: "follow_up",
    };
  }

  function beginParentTurn(parentKey, { continuation = false } = {}) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const parent = parentFor(parentKey);
    if (parent.parentBusy) {
      if (continuation && parent.processingResultId) return { ok: true, state: "PROCESSING_RESULT", queueLength: parent.resultQueue.length };
      return { ok: false, code: "PARENT_BUSY", error: "The parent agent is already processing a turn." };
    }
    if (!continuation) parent.pausedResultId = "";
    parent.parentBusy = true;
    return { ok: true, state: "BUSY", queueLength: parent.resultQueue.length };
  }

  function finishParentTurn(parentKey, { resultId = "", stopped = false } = {}) {
    const parent = parentFor(parentKey);
    if (resultId) {
      if (parent.resultQueue[0]?.resultId === resultId && !stopped) parent.resultQueue.shift();
      parent.processingResultId = "";
      if (parent.announcedResultId === resultId) parent.announcedResultId = "";
    }
    if (stopped) parent.pausedResultId = resultId || "OPERATOR_STOPPED";
    parent.parentBusy = false;
    if (!stopped) notifyResult(parent);
    return { ok: true, state: parent.parentBusy ? "BUSY" : parent.processingResultId ? "PROCESSING_RESULT" : "IDLE", queueLength: parent.resultQueue.length };
  }

  function claimResult(parentKey, resultId) {
    const parent = parentFor(parentKey);
    if (parent.parentBusy || parent.processingResultId) {
      return { ok: false, code: "PARENT_BUSY", error: "The parent agent is still processing a turn." };
    }
    const result = parent.resultQueue[0];
    if (!result || String(result.resultId) !== String(resultId || "")) {
      return { ok: false, code: "SUBAGENT_RESULT_NOT_READY", error: "The requested delegated result is not the next FIFO result." };
    }
    parent.announcedResultId = "";
    parent.processingResultId = result.resultId;
    parent.pausedResultId = "";
    parent.parentBusy = true;
    return { ok: true, result, state: "PROCESSING_RESULT" };
  }

  function projectRosterEntry(child) {
    const pendingQuestionRequestId = String(child.pendingQuestionRequestId || "");
    return {
      childInvocationId: child.childInvocationId,
      childSessionId: child.childSessionId,
      status: child.status,
      taskSummary: boundedText(child.summary || child.task, 240),
      model: String(child.model || ""),
      pendingQuestion: pendingQuestionRequestId.length > 0,
      generation: Number(child.generation || 0),
      updatedAt: child.updatedAt || child.createdAt || "",
    };
  }

  function listChildren(parentKey) {
    const key = String(parentKey || "");
    const parent = parents.get(key);
    if (!parent) return [];
    return [...children.values()]
      .filter((child) => child.parentKey === key)
      .map((child) => projectRosterEntry(child));
  }

  function getRosterEntry(parentKey, childInvocationId) {
    const child = getChild(childInvocationId, parentKey);
    if (!child) return null;
    return projectRosterEntry(child);
  }

  function openChildCount(parentKey) {
    const key = String(parentKey || "");
    return [...children.values()].filter((child) => (
      child.parentKey === key
      && (child.status === "queued" || child.status === "working")
    )).length;
  }

  function validateSpawnAdmission(parentKey, batchSize = 1) {
    const size = Math.max(0, Number(batchSize) || 0);
    const open = openChildCount(parentKey);
    if (open > 0) {
      return {
        ok: false,
        code: "SPAWN_WHILE_CHILDREN_ACTIVE",
        error: "A delegated spawn is already in progress. Wait until every child is completed, stopped, or failed.",
      };
    }
    if (size < 1 || size > MAX_SPAWN_BATCH) {
      return {
        ok: false,
        code: "TOO_MANY_SUBAGENTS",
        error: `At most ${MAX_SPAWN_BATCH} sub-agents may be started in one spawn call.`,
      };
    }
    return { ok: true };
  }

  function batchStillRunning(parentKey) {
    return openChildCount(parentKey) > 0;
  }

  function hasActiveChildren(parentKey) {
    const key = String(parentKey || "");
    return [...children.values()].some((child) => (
      child.parentKey === key
      && (child.status === "queued" || child.status === "working")
    ));
  }

  function hasUnconsumedResults(parentKey) {
    const parent = parents.get(String(parentKey || ""));
    if (!parent || !parent.resultQueue.length) return false;
    const processingId = String(parent.processingResultId || "");
    return parent.resultQueue.some((result) => String(result.resultId) !== processingId);
  }

  function peekQuestionHead(parentKey) {
    const parent = parents.get(String(parentKey || ""));
    if (!parent || !parent.questionQueue.length) return null;
    const head = parent.questionQueue.find((item) => !item.resolved);
    return head || null;
  }

  function dequeueOwnedQuestionsForChild(child, resolution = "cancelled") {
    const parent = parents.get(child.parentKey);
    if (!parent) return;
    for (const item of parent.questionQueue) {
      if (item.resolved) continue;
      if (item.childInvocationId !== child.childInvocationId) continue;
      item.resolved = true;
      item.resolution = resolution;
    }
    if (String(child.pendingQuestionRequestId || "")) {
      child.pendingQuestionRequestId = "";
      child.updatedAt = new Date(now()).toISOString();
    }
    const head = peekQuestionHead(parent.parentKey);
    parent.escalatedRequestId = head?.escalated && !head.resolved ? head.questionRequestId : "";
  }

  function enqueueQuestion({
    parentKey,
    questionRequestId,
    childInvocationId,
    childSessionId,
    parentSessionId = "",
    payload = {},
  } = {}) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const parent = parentFor(parentKey);
    const child = getChild(childInvocationId, parentKey);
    if (!child) return { ok: false, code: "UNKNOWN_SUBAGENT", error: "The delegated child no longer exists." };
    const requestId = String(questionRequestId || "");
    if (!requestId) return { ok: false, code: "INVALID_QUESTION", error: "questionRequestId is required." };
    const item = {
      questionRequestId: requestId,
      childInvocationId: String(childInvocationId || ""),
      childSessionId: String(childSessionId || child.childSessionId || ""),
      parentKey: parent.parentKey,
      parentSessionId: String(parentSessionId || parent.parentSessionId || ""),
      enqueuedAt: new Date(now()).toISOString(),
      payload: payload && typeof payload === "object" ? payload : {},
      escalated: false,
      resolved: false,
    };
    parent.questionQueue.push(item);
    child.pendingQuestionRequestId = requestId;
    child.updatedAt = new Date(now()).toISOString();
    return { ok: true, questionRequestId: requestId, head: peekQuestionHead(parent.parentKey) };
  }

  function resolveQuestion({
    parentKey,
    questionRequestId = "",
    resolution = "",
    escalated = false,
  } = {}) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const parent = parents.get(String(parentKey || ""));
    if (!parent) return { ok: false, code: "NO_PENDING_QUESTION", error: "No pending delegated question." };
    const head = peekQuestionHead(parent.parentKey);
    if (!head) return { ok: false, code: "NO_PENDING_QUESTION", error: "No pending delegated question." };
    const requestedId = String(questionRequestId || "");
    if (requestedId && requestedId !== head.questionRequestId) {
      return { ok: false, code: "QUESTION_NOT_HEAD", error: "The question is not the current FIFO head." };
    }
    if (head.resolved) {
      return { ok: false, code: "QUESTION_ALREADY_RESOLVED", error: "The question was already resolved." };
    }
    const normalized = String(resolution || "").toLowerCase();
    if (!["answer", "answered", "skip", "skipped", "cancelled", "escalate"].includes(normalized)) {
      return { ok: false, code: "INVALID_QUESTION_RESOLUTION", error: "Invalid question resolution." };
    }
    const child = getChild(head.childInvocationId, parent.parentKey);
    if (normalized === "escalate") {
      head.escalated = true;
      parent.escalatedRequestId = head.questionRequestId;
      return {
        ok: true,
        questionRequestId: head.questionRequestId,
        childInvocationId: head.childInvocationId,
        childSessionId: head.childSessionId,
        resolution: "escalate",
        escalated: true,
        nextHead: peekQuestionHead(parent.parentKey),
      };
    }
    const storedResolution = normalized === "answer" || normalized === "answered"
      ? "answered"
      : normalized === "skip" || normalized === "skipped"
        ? "skipped"
        : "cancelled";
    head.resolved = true;
    head.resolution = storedResolution;
    if (child) {
      child.pendingQuestionRequestId = "";
      child.updatedAt = new Date(now()).toISOString();
    }
    parent.escalatedRequestId = parent.escalatedRequestId === head.questionRequestId ? "" : parent.escalatedRequestId;
    return {
      ok: true,
      questionRequestId: head.questionRequestId,
      childInvocationId: head.childInvocationId,
      childSessionId: head.childSessionId,
      resolution: storedResolution,
      escalated: Boolean(head.escalated),
      nextHead: peekQuestionHead(parent.parentKey),
    };
  }

  function enqueueSteer({ parentKey, childInvocationId, instruction = "" } = {}) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const child = getChild(childInvocationId, parentKey);
    if (!child) return { ok: false, code: "UNKNOWN_SUBAGENT", error: "The delegated child no longer exists." };
    if (child.status !== "queued" && child.status !== "working") {
      return { ok: false, code: "SUBAGENT_NOT_ACTIVE", error: "Steer is only allowed for queued or working children." };
    }
    const text = String(instruction || "").trim();
    if (!text) return { ok: false, code: "INVALID_STEER", error: "Steer instruction is required." };
    child.steerQueue.push({
      enqueuedAt: new Date(now()).toISOString(),
      instruction: boundedText(text, 12_000),
      operation: "steer",
    });
    child.updatedAt = new Date(now()).toISOString();
    return {
      ok: true,
      childInvocationId: child.childInvocationId,
      childSessionId: child.childSessionId,
      status: child.status,
      steerQueueLength: child.steerQueue.length,
    };
  }

  function drainSteerQueue(childInvocationId, parentKey = "") {
    const child = getChild(childInvocationId, parentKey);
    if (!child || !child.steerQueue.length) return [];
    const drained = child.steerQueue.splice(0, child.steerQueue.length);
    child.updatedAt = new Date(now()).toISOString();
    return drained;
  }

  function cancelPendingQuestionsForParent(parentKey, reason = "cancelled") {
    const parent = parents.get(String(parentKey || ""));
    if (!parent) return { ok: true, cancelled: 0 };
    let cancelled = 0;
    for (const item of parent.questionQueue) {
      if (item.resolved) continue;
      item.resolved = true;
      item.resolution = reason;
      cancelled += 1;
      const child = getChild(item.childInvocationId, parent.parentKey);
      if (child && child.pendingQuestionRequestId === item.questionRequestId) {
        child.pendingQuestionRequestId = "";
        child.updatedAt = new Date(now()).toISOString();
      }
    }
    parent.escalatedRequestId = "";
    return { ok: true, cancelled };
  }

  function cancelChild(childInvocationId, parentKey = "", reason = "OPERATOR_STOPPED") {
    const child = getChild(childInvocationId, parentKey);
    if (!child) return { ok: false, code: "UNKNOWN_SUBAGENT", error: "The delegated child no longer exists." };
    dequeueOwnedQuestionsForChild(child, "cancelled");
    const shutdown = String(reason || "") === "APP_SHUTDOWN";
    const stopError = shutdown ? "Application shutdown" : "Stopped by operator";
    if (child.status === "queued") {
      child.cancelled = true;
      const parent = parents.get(child.parentKey);
      parent.spawnQueue = parent.spawnQueue.filter((item) => item !== child);
      try { child.controller?.abort?.(reason); } catch { /* Best effort. */ }
      try { child.onCancel?.(child); } catch { /* Persistence/UI cleanup is best effort. */ }
      const result = completeChild(child.childInvocationId, {
        status: "stopped",
        output: { text: "", format: "text", summary: "Stopped before the child started." },
        metadata: { error: stopError },
      });
      return { ok: true, result };
    }
    if (child.status === "working" && child.controller && !child.controller.signal?.aborted) {
      try { child.controller.abort(reason); } catch { /* Best effort; the child runner owns finalization. */ }
    }
    return { ok: true, status: child.status, childSessionId: child.childSessionId };
  }

  function cancelChildBySession(childSessionId, parentKey = "") {
    const child = [...children.values()].find((item) => item.childSessionId === String(childSessionId || "") && (!parentKey || item.parentKey === String(parentKey)));
    return child
      ? cancelChild(child.childInvocationId, child.parentKey)
      : { ok: false, code: "UNKNOWN_SUBAGENT", error: "The delegated child no longer exists." };
  }

  function cancelChildrenForParent(parentKey, reason = "OPERATOR_STOPPED") {
    const parent = parents.get(String(parentKey || ""));
    if (!parent) return { ok: true, cancelled: 0 };
    const open = [...children.values()].filter((child) => (
      child.parentKey === parent.parentKey
      && (child.status === "queued" || child.status === "working")
    ));
    for (const child of open) cancelChild(child.childInvocationId, parent.parentKey, reason);
    cancelPendingQuestionsForParent(parent.parentKey, "cancelled");
    return { ok: true, cancelled: open.length };
  }

  function pendingResultsForSender(senderId = "") {
    const owner = String(senderId || "");
    return [...parents.values()]
      .filter((parent) => !owner || parent.senderId === owner)
      .flatMap((parent) => parent.resultQueue
        // A result currently being consumed is already embedded in an
        // in-flight parent prompt; only unclaimed FIFO results need recovery.
        .filter((result) => result.resultId !== parent.processingResultId)
        .map((result) => ({ ...result })));
  }

  async function shutdown({ timeoutMs = 5_000, reason = "APP_SHUTDOWN" } = {}) {
    closed = true;
    for (const child of [...children.values()]) {
      if (child.status === "queued" || child.status === "working") {
        cancelChild(child.childInvocationId, child.parentKey, reason);
      }
    }

    const timeout = Math.max(0, Number(timeoutMs) || 0);
    const deadline = Date.now() + timeout;
    const active = () => [...children.values()].filter((child) => child.status === "working");
    while (active().length && Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, remaining)));
    }

    // A non-cooperative model runner must not keep the application in a
    // half-shutdown state. Mark it stopped after the bounded grace period;
    // any late runner completion is ignored by completeChild's terminal guard.
    for (const child of active()) {
      completeChild(child.childInvocationId, {
        status: "stopped",
        output: { text: "", format: "text", summary: "Stopped during application shutdown." },
        metadata: { error: "Application shutdown", forced: true },
      });
    }
    return {
      ok: true,
      closed: true,
      activeChildren: active().length,
      pendingResults: [...parents.values()].reduce((count, parent) => count + parent.resultQueue.length, 0),
    };
  }

  function snapshot(parentKey = "") {
    const parent = parents.get(String(parentKey || ""));
    if (!parent) return null;
    return {
      parentKey: parent.parentKey,
      state: parent.processingResultId ? "PROCESSING_RESULT" : parent.parentBusy ? "BUSY" : "IDLE",
      activeCount: parent.activeCount,
      maxActiveChildren: parent.maxActiveChildren,
      queuedChildren: parent.spawnQueue.map((child) => child.childInvocationId),
      resultQueue: parent.resultQueue.map((result) => result.resultId),
      processingResultId: parent.processingResultId,
    };
  }

  function registerParent(parentKey, options = {}) {
    if (parentKey && typeof parentKey === "object") {
      const descriptor = parentKey;
      return parentFor(descriptor.parentKey, descriptor);
    }
    return parentFor(parentKey, options);
  }

  return {
    registerParent,
    submitChild,
    submitFollowUp,
    completeChild,
    getChild,
    beginParentTurn,
    finishParentTurn,
    claimResult,
    cancelChild,
    cancelChildBySession,
    cancelChildrenForParent,
    pendingResultsForSender,
    shutdown,
    snapshot,
    listChildren,
    getRosterEntry,
    enqueueQuestion,
    peekQuestionHead,
    resolveQuestion,
    enqueueSteer,
    drainSteerQueue,
    hasActiveChildren,
    hasUnconsumedResults,
    validateSpawnAdmission,
    batchStillRunning,
    openChildCount,
    MAX_SPAWN_BATCH,
    cancelPendingQuestionsForParent,
    parents,
    children,
    DEFAULT_MAX_ACTIVE_CHILDREN,
  };
}

module.exports = { DEFAULT_MAX_ACTIVE_CHILDREN, MAX_SPAWN_BATCH, createSubagentCoordinator };
