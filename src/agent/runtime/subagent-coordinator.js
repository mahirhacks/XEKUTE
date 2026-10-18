"use strict";

// Coordinates background child runs for one or more parent agent sessions.
// Model execution remains injected by the delegation provider; this module
// owns only admission, lifecycle, and the FIFO result hand-off contract.

const Tunables = require("./tunables.js");
const crypto = require("node:crypto");
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
        wave: null,
        waveSeq: 0,
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
    if (closed || parent.parentBusy || parent.processingResultId || parent.pausedResultId || !parent.resultQueue.length) return false;
    const result = parent.resultQueue[0];
    if (parent.announcedResultId === result.resultId) return false;
    parent.announcedResultId = result.resultId;
    let accepted = false;
    try {
      const outcome = parent.onResultReady(result, parent);
      if (outcome && typeof outcome.then === "function") {
        Promise.resolve(outcome).then((value) => {
          if (value === false && parent.announcedResultId === result.resultId) parent.announcedResultId = "";
        }, () => { if (parent.announcedResultId === result.resultId) parent.announcedResultId = ""; });
        return true;
      }
      accepted = outcome !== false;
    } catch {
      accepted = false;
    }
    // A scheduler can lose a race with a user turn between notification and
    // claim. Clearing the announcement lets the next pump retry the same head.
    if (!accepted && parent.announcedResultId === result.resultId) parent.announcedResultId = "";
    return accepted;
  }

  function pumpResults(parentKey) {
    const parent = parents.get(String(parentKey || ""));
    if (!parent || closed || parent.parentBusy || parent.processingResultId || parent.pausedResultId) return false;
    if (parent.announcedResultId && parent.resultQueue[0]?.resultId === parent.announcedResultId) {
      parent.announcedResultId = "";
    }
    return notifyResult(parent);
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
      if (child.resumeGeneration) delete child.resumeGeneration;
      else child.generation = Number(child.generation || 0) + 1;
      parent.activeCount += 1;
      children.set(child.childInvocationId, child);
      lifecycle(parent, child, "working");
      Promise.resolve()
        .then(() => {
          if (children.get(child.childInvocationId) !== child) return null;
          if (child.cancelled || child.controller?.signal?.aborted) return { status: "stopped", output: { text: "", summary: "Stopped before the child started." } };
          return child.start(child);
        })
        .then((outcome) => children.get(child.childInvocationId) === child ? completeChild(child.childInvocationId, outcome) : null)
        .catch((error) => children.get(child.childInvocationId) === child ? completeChild(child.childInvocationId, {
          status: "failed",
          output: { text: "", format: "text", summary: "" },
          metadata: { error: boundedText(error?.message || "Child agent failed.") },
        }) : null);
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
    if (waveAdmissionBlocked(parent)) {
      return { ok: false, code: "SPAWN_WHILE_CHILDREN_ACTIVE", error: "Wait until the current wave has been synthesized before spawning again." };
    }
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
    attachChildToWave(parent, child);
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
    recordWaveResult(parent, child, result);
    startNext(parent);
    return result;
  }

  function ensureOpenWave(parent) {
    if (!parent.wave || parent.wave.sealed) {
      parent.waveSeq += 1;
      parent.wave = {
        waveId: `wave_${parent.waveSeq}`,
        childIds: [],
        pendingIds: new Set(),
        results: [],
        sealed: false,
      };
    }
    return parent.wave;
  }

  function attachChildToWave(parent, child) {
    const wave = ensureOpenWave(parent);
    if (!wave.childIds.includes(child.childInvocationId)) wave.childIds.push(child.childInvocationId);
    wave.pendingIds.add(child.childInvocationId);
    child.waveId = wave.waveId;
  }

  function waveAdmissionBlocked(parent) {
    return Boolean(parent?.wave?.sealed && hasUnconsumedResults(parent.parentKey));
  }

  function recordWaveResult(parent, child, result) {
    if (!parent.wave || parent.wave.sealed || parent.wave.waveId !== child.waveId) {
      attachChildToWave(parent, child);
    }
    const wave = parent.wave;
    wave.pendingIds.delete(child.childInvocationId);
    if (!wave.results.some((item) => item.childInvocationId === child.childInvocationId && item.generation === result.generation)) {
      wave.results.push(result);
    }
    const members = wave.childIds.map((id) => children.get(id)).filter(Boolean);
    if (!members.length || members.some((item) => item.status === "queued" || item.status === "working")) return;
    wave.pendingIds.clear();
    wave.sealed = true;
    const batch = {
      kind: "batch",
      resultId: `batch:${wave.waveId}:${parent.sequence += 1}`,
      waveId: wave.waveId,
      parentKey: parent.parentKey,
      parentSessionId: parent.parentSessionId,
      status: "ready",
      children: wave.results.slice(),
      queuedAt: new Date(now()).toISOString(),
    };
    parent.resultQueue.push(batch);
    if (!notifyResult(parent)) pumpResults(parent.parentKey);
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
    const followParent = parents.get(child.parentKey);
    if (followParent && waveAdmissionBlocked(followParent)) {
      return { ok: false, code: "SPAWN_WHILE_CHILDREN_ACTIVE", error: "Wait until the current wave has been synthesized before spawning again." };
    }
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
    child.steeringClosed = false;
    child.status = "queued";
    const parent = parents.get(child.parentKey);
    attachChildToWave(parent, child);
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

  function resumeRestoredChild({ childInvocationId, parentKey, start, controller, onCancel = null } = {}) {
    const child = getChild(childInvocationId, parentKey);
    if (!child || child.status !== "interrupted" || typeof start !== "function") return { ok: false, code: "CHILD_RECOVERY_INVALID", error: "Only a saved interrupted child can be resumed." };
    child.start = start;
    child.controller = controller;
    child.onCancel = onCancel;
    child.resumeGeneration = true;
    child.steeringClosed = false;
    child.status = "queued";
    const parent = parents.get(child.parentKey);
    parent.spawnQueue.push(child);
    startNext(parent);
    return { ok: true, childInvocationId, childSessionId: child.childSessionId, generation: child.generation };
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

  function resetParentForTask(parentKey) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const parent = parentFor(parentKey);
    const owned = [...children.values()].filter((child) => child.parentKey === parent.parentKey);
    const questionRequestIds = parent.questionQueue.filter((question) => !question.resolved).map((question) => question.questionRequestId);
    for (const child of owned) children.delete(child.childInvocationId);
    parent.activeCount = 0;
    parent.spawnQueue = [];
    parent.resultQueue = [];
    parent.questionQueue = [];
    parent.escalatedRequestId = "";
    parent.announcedResultId = "";
    parent.processingResultId = "";
    parent.pausedResultId = "";
    parent.wave = null;
    let cancelled = 0;
    for (const child of owned) {
      const open = ["queued", "working", "interrupted"].includes(child.status);
      const wasWorking = child.status === "working";
      child.cancelled = true;
      child.steeringClosed = true;
      child.status = "stopped";
      if (open) {
        cancelled += 1;
        try { child.controller?.abort?.("PARENT_TASK_REPLACED"); } catch { /* The detached child cannot publish into the new task. */ }
        if (!wasWorking) { try { child.onCancel?.(child); } catch { /* The caller owns remaining cancellation cleanup. */ } }
      }
    }
    return { ok: true, state: parent.parentBusy ? "BUSY" : "IDLE", cancelled, removed: owned.length, questionRequestIds };
  }

  function finishParentTurn(parentKey, { resultId = "", stopped = false, accepted = true } = {}) {
    const parent = parentFor(parentKey);
    const paused = stopped || Boolean(resultId && !accepted);
    if (resultId) {
      if (parent.resultQueue[0]?.resultId === resultId && !paused) parent.resultQueue.shift();
      parent.processingResultId = "";
      if (parent.announcedResultId === resultId) parent.announcedResultId = "";
    }
    if (paused) parent.pausedResultId = resultId || "OPERATOR_STOPPED";
    parent.parentBusy = false;
    if (!paused) notifyResult(parent);
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
      && (child.status === "queued" || child.status === "working" || child.status === "interrupted")
    )).length;
  }

  function validateSpawnAdmission(parentKey, batchSize = 1) {
    const size = Math.max(0, Number(batchSize) || 0);
    // A new child joins the open wave, so a separate request that arrives while
    // children work can still be delegated. Only a finished wave the parent has
    // not reviewed yet blocks another spawn.
    if (waveAdmissionBlocked(parents.get(String(parentKey || "")))) {
      return {
        ok: false,
        code: "SPAWN_WHILE_CHILDREN_ACTIVE",
        error: "Wait until the current wave has been synthesized before spawning again.",
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
      && (child.status === "queued" || child.status === "working" || child.status === "interrupted")
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

  function enqueueSteer({ parentKey, childInvocationId, instruction = "", contextText = "", messageId: suppliedMessageId = "", intentScope = null } = {}) {
    if (closed) return { ok: false, code: "SUBAGENT_COORDINATOR_CLOSED", error: "The sub-agent coordinator is shutting down." };
    const child = getChild(childInvocationId, parentKey);
    if (!child) return { ok: false, code: "UNKNOWN_SUBAGENT", error: "The delegated child no longer exists." };
    if (child.steeringClosed || (child.status !== "queued" && child.status !== "working")) {
      return { ok: false, code: "SUBAGENT_NOT_ACTIVE", error: "Steer is only allowed for queued or working children." };
    }
    const text = String(instruction || "");
    if (!text.trim()) return { ok: false, code: "INVALID_STEER", error: "Steer instruction is required." };
    if (text.length > 100_000) return { ok: false, code: "STEER_TOO_LARGE", error: "Steer instruction exceeds 100000 characters." };
    const messageId = suppliedMessageId || `steer:${crypto.randomUUID()}`;
    if (!/^[a-zA-Z0-9:_./-]{1,240}$/.test(messageId)) return { ok: false, code: "INVALID_STEER_ID", error: "A stable valid message ID is required." };
    const existing = child.steerQueue.find((entry) => entry.id === messageId);
    if (intentScope && (!Array.isArray(intentScope) || !intentScope.length || intentScope.some((scope) => scope.messageId !== messageId || !Number.isSafeInteger(scope.start) || !Number.isSafeInteger(scope.end) || scope.start < 0 || scope.end <= scope.start || scope.end > text.length))) return { ok: false, code: "INVALID_STEER_SCOPE", error: "Steering scope must name exact spans of its original message." };
    if (typeof contextText !== "string" || contextText.length > 1_000_000) return { ok: false, code: "INVALID_STEER_CONTEXT", error: "The referenced chat context is invalid." };
    if (existing) return existing.instruction === text && (existing.contextText || "") === contextText && JSON.stringify(existing.intentScope || null) === JSON.stringify(intentScope) ? { ok: true, duplicate: true, messageId, childInvocationId, childSessionId: child.childSessionId, status: child.status } : { ok: false, code: "STEER_ID_CONFLICT", error: "The steering identity already has different text or scope." };
    child.steerQueue.push({
      id: messageId,
      enqueuedAt: new Date(now()).toISOString(),
      instruction: text,
      ...(contextText ? { contextText } : {}),
      ...(intentScope ? { intentScope: JSON.parse(JSON.stringify(intentScope)) } : {}),
      operation: "steer",
    });
    child.updatedAt = new Date(now()).toISOString();
    return {
      ok: true,
      messageId,
      childInvocationId: child.childInvocationId,
      childSessionId: child.childSessionId,
      status: child.status,
      steerQueueLength: child.steerQueue.length,
    };
  }

  function peekSteerQueue(childInvocationId, parentKey = "") {
    const child = getChild(childInvocationId, parentKey);
    return child ? child.steerQueue.map((item) => ({ ...item })) : [];
  }

  function acknowledgeSteers(childInvocationId, parentKey = "", messageIds = []) {
    const child = getChild(childInvocationId, parentKey);
    if (!child) return { ok: false, code: "UNKNOWN_SUBAGENT" };
    const acknowledged = new Set(messageIds);
    const before = child.steerQueue.length;
    child.steerQueue = child.steerQueue.filter((item) => !acknowledged.has(item.id));
    if (child.steerQueue.length !== before) child.updatedAt = new Date(now()).toISOString();
    return { ok: true, acknowledged: before - child.steerQueue.length };
  }

  function sealSteering(childInvocationId, parentKey = "") {
    const child = getChild(childInvocationId, parentKey);
    if (!child) return { ok: false, code: "UNKNOWN_SUBAGENT" };
    if (child.steerQueue.length) return { ok: true, completed: false, reason: "PENDING_INPUT" };
    child.steeringClosed = true;
    return { ok: true, completed: true };
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
    if (child.status === "queued" || child.status === "interrupted") {
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
      && (child.status === "queued" || child.status === "working" || child.status === "interrupted")
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
      if (child.status === "queued" || child.status === "working" || child.status === "interrupted") {
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

  function pendingQuestionCount(parentKey) {
    const parent = parents.get(String(parentKey || ""));
    if (!parent) return 0;
    return parent.questionQueue.filter((item) => !item.resolved).length;
  }

  function exportWave(parentKey, { acceptedResultId = "" } = {}) {
    const parent = parents.get(String(parentKey || ""));
    if (!parent) return null;
    return {
      parentKey: parent.parentKey,
      parentSessionId: parent.parentSessionId,
      senderId: parent.senderId,
      workspace: parent.workspace,
      wave: parent.wave ? {
        waveId: parent.wave.waveId,
        sealed: Boolean(parent.wave.sealed),
        childIds: [...parent.wave.childIds],
        pendingIds: [...parent.wave.pendingIds],
      } : null,
      children: [...children.values()].filter((child) => child.parentKey === parent.parentKey).map((child) => ({
        childInvocationId: child.childInvocationId,
        childSessionId: child.childSessionId,
        status: child.status,
        task: child.task,
        summary: child.summary,
        model: child.model,
        generation: child.generation,
        engineRef: child.engineRef ? { ...child.engineRef } : null,
        steerQueue: child.steerQueue.map((item) => ({ ...item })),
        steeringClosed: Boolean(child.steeringClosed),
        waveId: child.waveId || "",
        output: child.output || null,
        metadata: child.metadata && typeof child.metadata === "object" ? { error: child.metadata.error || "" } : {},
      })),
      resultQueue: parent.resultQueue.filter((result) => !acceptedResultId || result.resultId !== acceptedResultId).map((result) => ({
        ...result,
        metadata: result.metadata ? Object.fromEntries(Object.entries(result.metadata).filter(([key]) => !["appendedMessages", "history", "rawOutput"].includes(key))) : undefined,
        children: Array.isArray(result.children) ? result.children.map((child) => ({ ...child,
          metadata: child.metadata ? Object.fromEntries(Object.entries(child.metadata).filter(([key]) => !["appendedMessages", "history", "rawOutput"].includes(key))) : undefined,
        })) : undefined,
      })),
      processingResultId: parent.processingResultId === acceptedResultId ? "" : parent.processingResultId || "",
    };
  }

  function restoreWave(parentKey, snapshot = {}) {
    const parent = parentFor(parentKey, {
      parentSessionId: snapshot.parentSessionId || "",
      senderId: snapshot.senderId || "",
      workspace: snapshot.workspace || "",
    });
    const pending = new Set(Array.isArray(snapshot.wave?.pendingIds) ? snapshot.wave.pendingIds : []);
    const restored = [];
    for (const record of Array.isArray(snapshot.children) ? snapshot.children : []) {
      const id = String(record.childInvocationId || "");
      if (!id || children.has(id)) continue;
      const open = pending.has(id) || record.status === "queued" || record.status === "working" || record.status === "interrupted" || record.engineRef?.pendingCompletion === true;
      const recoverable = open && record.engineRef?.version === 1;
      const steers = (Array.isArray(record.steerQueue) ? record.steerQueue : []).map((item) => {
        if (typeof item.id !== "string" || !item.id || typeof item.instruction !== "string" || item.instruction.length > 100_000
          || (item.contextText !== undefined && (typeof item.contextText !== "string" || item.contextText.length > 1_000_000))) throw Object.assign(new Error("The saved child steering message is invalid."), { code: "INVALID_SAVED_STEER" });
        return { ...item };
      });
      const child = {
        childInvocationId: id,
        childSessionId: String(record.childSessionId || ""),
        parentKey: parent.parentKey,
        parentSessionId: parent.parentSessionId,
        senderId: parent.senderId,
        workspace: parent.workspace,
        model: String(record.model || ""),
        task: String(record.task || ""),
        summary: open ? "Interrupted by restart." : String(record.summary || ""),
        metadata: open ? { error: "Interrupted by restart." } : (record.metadata || {}),
        start: async () => ({ status: "failed", output: { text: "", summary: "Interrupted by restart." } }),
        generation: Number(record.generation) || 0,
        status: recoverable ? "interrupted" : open ? "failed" : (record.status || "failed"),
        cancelled: false,
        controller: null,
        onCancel: null,
        steerQueue: steers,
        engineRef: record.engineRef ? JSON.parse(JSON.stringify(record.engineRef)) : null,
        steeringClosed: open ? false : Boolean(record.steeringClosed),
        pendingQuestionRequestId: "",
        startInstructionSnapshot: "",
        waveId: String(record.waveId || snapshot.wave?.waveId || ""),
        output: open
          ? {
            text: "",
            format: "json",
            summary: "Interrupted by restart.",
            finding: {
              status: "blocked",
              summary: "Interrupted by restart.",
              evidenceRefs: [],
              unverified: ["The child was still open when the session reloaded."],
            },
          }
          : (record.output || { text: "", format: "text", summary: "" }),
        history: [],
        createdAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
      };
      children.set(id, child);
      restored.push(child);
    }
    const queued = Array.isArray(snapshot.resultQueue) ? snapshot.resultQueue : [];
    const waveSealed = Boolean(snapshot.wave?.sealed);
    const recoverable = restored.filter((child) => child.status === "interrupted");
    if (recoverable.length) {
      parent.wave = { waveId: snapshot.wave?.waveId || "wave_restored", childIds: restored.map((child) => child.childInvocationId),
        pendingIds: new Set(recoverable.map((child) => child.childInvocationId)),
        results: restored.filter((child) => child.status !== "interrupted").map((child) => ({ childInvocationId: child.childInvocationId,
          childSessionId: child.childSessionId, generation: child.generation, status: child.status, output: child.output, metadata: child.metadata })), sealed: false };
    } else if (queued.length && !parent.resultQueue.length) {
      parent.resultQueue = queued.map((result) => ({ ...result }));
      parent.wave = {
        waveId: snapshot.wave?.waveId || "wave_restored",
        childIds: restored.map((child) => child.childInvocationId),
        pendingIds: new Set(),
        results: [],
        sealed: true,
      };
    } else if (!waveSealed && restored.length && !parent.resultQueue.length) {
      parent.waveSeq += 1;
      const results = restored.map((child) => ({
        resultId: `${child.childInvocationId}:${child.generation}:restored`,
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
        queuedAt: child.updatedAt,
      }));
      parent.wave = {
        waveId: snapshot.wave?.waveId || `wave_${parent.waveSeq}`,
        childIds: restored.map((child) => child.childInvocationId),
        pendingIds: new Set(),
        results,
        sealed: true,
      };
      const batch = {
        kind: "batch",
        resultId: `batch:${parent.wave.waveId}:${parent.sequence += 1}`,
        waveId: parent.wave.waveId,
        parentKey: parent.parentKey,
        parentSessionId: parent.parentSessionId,
        status: "ready",
        children: results,
        queuedAt: new Date(now()).toISOString(),
      };
      parent.resultQueue.push(batch);
      notifyResult(parent);
    }
    return {
      ok: true,
      hold: hasActiveChildren(parent.parentKey) || hasUnconsumedResults(parent.parentKey),
      pendingBatch: parent.resultQueue[0] || null,
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
    resumeRestoredChild,
    recoverableChildren: (parentKey) => [...children.values()].filter((child) => child.parentKey === String(parentKey) && child.status === "interrupted"),
    completeChild,
    getChild,
    beginParentTurn,
    resetParentForTask,
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
    peekSteerQueue,
    acknowledgeSteers,
    sealSteering,
    drainSteerQueue,
    hasActiveChildren,
    hasUnconsumedResults,
    validateSpawnAdmission,
    batchStillRunning,
    openChildCount,
    pendingQuestionCount,
    exportWave,
    restoreWave,
    pumpResults,
    MAX_SPAWN_BATCH,
    cancelPendingQuestionsForParent,
    parents,
    children,
    DEFAULT_MAX_ACTIVE_CHILDREN,
  };
}

module.exports = { DEFAULT_MAX_ACTIVE_CHILDREN, MAX_SPAWN_BATCH, createSubagentCoordinator };
