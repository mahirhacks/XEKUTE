"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parsePlanMarkdown, planMarkdownPath, renderPlanMarkdown } = require("../../../shared/plan-markdown.js");

const EXECUTABLE_TOOLS = new Set([
  "exec_command", "update_task_list", "read_file", "search_workspace", "apply_patch", "inspect_environment",
  "manage_plan", "manage_state", "ingest_traffic", "manage_identity", "replay_request",
  "run_test_case", "browser_action", "compare_responses", "verify_finding", "store_finding",
  "attack_graph", "delegate_agent", "web_research",
]);
const INTELLIGENCE_TOOLS = new Set(["query_assessment", "expand_evidence"]);
const KNOWLEDGE_TOOLS = new Set(["query_knowledge"]);
const TARGET_BEARING_TOOLS = new Set([
  "exec_command", "read_file", "search_workspace", "apply_patch", "ingest_traffic",
  "replay_request", "run_test_case", "browser_action",
]);

function now() { return new Date().toISOString(); }
function text(value, max = 20_000) { return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value) { return crypto.createHash("sha256").update(canonical(value)).digest("hex"); }
function readArgumentPath(args, expression) {
  const key = String(expression || "").trim();
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(args || {}, key)) return args[key];
  const segments = key.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let value = args;
  for (const segment of segments) {
    if (value === null || value === undefined) return undefined;
    value = value[segment];
  }
  return value;
}
function flattenTargetValues(value, output = []) {
  if (typeof value === "string" && value.trim()) output.push(text(value, 4_000));
  else if (Array.isArray(value)) for (const item of value) flattenTargetValues(item, output);
  return output;
}
const PLAN_TARGET_ARGUMENTS = Object.freeze([
  "path", "url", "target", "host", "command", "endpoint", "domain", "ip", "origin",
  "request.url", "request.target", "paths", "urls", "targets", "request.hosts",
]);
function targetRefsFromInput(input = {}, explicit = []) {
  const values = [];
  for (const key of PLAN_TARGET_ARGUMENTS) flattenTargetValues(readArgumentPath(input, key), values);
  return [...new Set([...(Array.isArray(explicit) ? explicit : []), ...values].map((value) => text(value, 4_000)).filter(Boolean))].slice(0, 100);
}

function parsedHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return /^https?:$/.test(parsed.protocol) ? parsed : null;
  } catch { return null; }
}

function looksLikeFilesystemPath(value) {
  const candidate = String(value || "");
  return path.isAbsolute(candidate) || path.win32.isAbsolute(candidate) || /^\\\\/.test(candidate);
}

function targetWithinApprovedReference(requestedValue, approvedValue) {
  const requested = text(requestedValue, 4_000);
  const approved = text(approvedValue, 4_000);
  if (!requested || !approved) return false;

  const requestedUrl = parsedHttpUrl(requested);
  const approvedUrl = parsedHttpUrl(approved);
  if (requestedUrl || approvedUrl) {
    if (!requestedUrl || !approvedUrl || requestedUrl.origin !== approvedUrl.origin) return false;
    if (approvedUrl.search || approvedUrl.hash) return requestedUrl.href === approvedUrl.href;
    const approvedPath = approvedUrl.pathname.replace(/\/+$/, "") || "/";
    const requestedPath = requestedUrl.pathname.replace(/\/+$/, "") || "/";
    return approvedPath === "/" || requestedPath === approvedPath || requestedPath.startsWith(`${approvedPath}/`);
  }

  if (looksLikeFilesystemPath(requested) || looksLikeFilesystemPath(approved)) {
    if (!looksLikeFilesystemPath(requested) || !looksLikeFilesystemPath(approved)) return false;
    const requestedPath = path.resolve(requested);
    const approvedPath = path.resolve(approved);
    const relative = path.relative(approvedPath, requestedPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  // Hosts, commands, and other opaque target identifiers are exact values.
  // They must never gain authority through raw string-prefix matching.
  return requested === approved;
}

function effectiveStepTools(plan, step) {
  const planTools = [...new Set((Array.isArray(plan?.allowedTools) ? plan.allowedTools : []).map(String))];
  const stepTools = [...new Set((Array.isArray(step?.allowedTools) ? step.allowedTools : []).map(String))];
  if (!stepTools.length) return planTools;
  if (!planTools.length) return stepTools;
  return stepTools.filter((tool) => planTools.includes(tool));
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function normalizedExecution(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = ["single", "barrier"].includes(String(source.mode || "single")) ? String(source.mode || "single") : "single";
  return {
    mode,
    groupId: text(source.groupId || "", 120),
    repetitions: boundedInteger(source.repetitions, 1, 1, 100),
  };
}

function normalizeNestedStep(step = {}, index = 0) {
  const input = step?.input && typeof step.input === "object" && !Array.isArray(step.input) ? step.input : {};
  return {
    id: text(step.id || `nested_${index + 1}`, 120),
    action: text(step.action || "", 120),
    identityId: text(step.identityId ?? input.identityId ?? "", 120),
    pageId: text(step.pageId ?? input.pageId ?? "main", 120) || "main",
    execution: normalizedExecution(step.execution ?? input.execution),
    targetRefs: targetRefsFromInput(input, step.targetRefs),
    argumentConstraints: step.argumentConstraints && typeof step.argumentConstraints === "object" ? step.argumentConstraints : {},
  };
}

function normalizeNestedTestCase(testCase) {
  if (!testCase || typeof testCase !== "object" || !Array.isArray(testCase.steps)) return null;
  return {
    id: text(testCase.id || "", 120),
    steps: testCase.steps.slice(0, 100).map((step, index) => normalizeNestedStep(step, index)),
  };
}

function nestedActionRequests(args = {}, toolName = "") {
  const requests = [];
  // run_test_case is a container, not an authenticated action itself. Its
  // executable identity/page/execution descriptors live on the nested steps.
  if (toolName !== "run_test_case" && args && typeof args === "object") requests.push({ stepId: "__direct__", action: toolName, input: args });
  const steps = Array.isArray(args?.testCase?.steps) ? args.testCase.steps : [];
  for (const step of steps) {
    const input = step?.input && typeof step.input === "object" && !Array.isArray(step.input) ? { ...step.input } : {};
    if (step?.identityId !== undefined && input.identityId === undefined) input.identityId = step.identityId;
    if (step?.pageId !== undefined && input.pageId === undefined) input.pageId = step.pageId;
    if (step?.execution !== undefined) input.execution = step.execution;
    requests.push({ stepId: String(step?.id || ""), action: String(step?.action || ""), input });
  }
  return requests;
}

function barrierSizesFor(toolName, args = {}) {
  const groups = new Map();
  const add = (execution, repetitions = 1) => {
    const normalized = normalizedExecution(execution);
    if (normalized.mode !== "barrier") return;
    const key = normalized.groupId || "__unnamed_barrier__";
    groups.set(key, (groups.get(key) || 0) + Math.max(1, Number(repetitions) || normalized.repetitions || 1));
  };
  if (toolName === "run_test_case" && Array.isArray(args?.testCase?.steps)) {
    for (const step of args.testCase.steps) add(step?.execution, step?.execution?.repetitions || 1);
  } else add(args?.execution, args?.execution?.repetitions || 1);
  return [...groups.values()];
}

function createAssessmentModeWorkflow() {
  function root(workspace) { return path.resolve(String(workspace || "")); }
  function statePath(workspace) { return path.join(root(workspace), ".xekute", "state", "assessment-workflow.json"); }
  function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
  function atomicWrite(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  function atomicWriteText(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, String(value || ""), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  }
  function defaultState() {
    return {
      schemaVersion: 1,
      nextHypothesis: 1,
      nextPlan: 1,
      activeHypothesis: "",
      activePlan: "",
      pendingRecommendation: null,
      planBinding: null,
      updatedAt: now(),
    };
  }
  function loadState(workspace) { return { ...defaultState(), ...(readJson(statePath(workspace), {}) || {}) }; }
  function saveState(workspace, patch) {
    const value = { ...loadState(workspace), ...patch, updatedAt: now() };
    atomicWrite(statePath(workspace), value);
    return value;
  }
  function nextArtifact(workspace, kind) {
    const state = loadState(workspace);
    const key = kind === "hypothesis" ? "nextHypothesis" : "nextPlan";
    const number = Math.max(1, Number(state[key]) || 1);
    saveState(workspace, { [key]: number + 1 });
    return `${kind}_${number}`;
  }
  function artifactPath(workspace, kind, id) {
    return kind === "plan"
      ? planMarkdownPath(root(workspace), id)
      : path.join(root(workspace), ".xekute", kind, `${id}.json`);
  }
  function legacyPlanPath(workspace, id) { return path.join(root(workspace), ".xekute", "plan", `${id}.json`); }
  function writePlanRecord(workspace, record) {
    const target = artifactPath(workspace, "plan", record.id);
    atomicWriteText(target, renderPlanMarkdown(record));
    const legacy = legacyPlanPath(workspace, record.id);
    if (fs.existsSync(legacy)) fs.rmSync(legacy, { force: true });
    return target;
  }

  function saveHypothesis(workspace, input = {}) {
    const state = loadState(workspace);
    const id = text(input.id || "", 120) || nextArtifact(workspace, "hypothesis");
    const existing = readJson(artifactPath(workspace, "hypothesis", id), {});
    const record = {
      ...existing,
      schemaVersion: 1,
      id,
      sequence: Number(id.match(/_(\d+)$/)?.[1] || existing.sequence || 0),
      statement: text(input.statement || input.title || existing.statement || "", 12_000),
      confidence: text(input.confidence || existing.confidence || "inconclusive", 40),
      observationIds: [...new Set([...(existing.observationIds || []), ...(input.observationIds || [])].map(String))].slice(0, 100),
      entityIds: [...new Set([...(existing.entityIds || []), ...(input.entityIds || [])].map(String))].slice(0, 100),
      evidenceRefs: [...new Set([...(existing.evidenceRefs || []), ...(input.evidenceRefs || input.evidenceIds || [])].map(String))].slice(0, 100),
      knowledgeRefs: [...new Set([...(existing.knowledgeRefs || []), ...(input.knowledgeRefs || [])].map(String))].slice(0, 100),
      evidenceGaps: Array.isArray(input.evidenceGaps) ? input.evidenceGaps.map((value) => text(value, 1_000)).slice(0, 50) : (existing.evidenceGaps || []),
      status: text(input.status || existing.status || "completed", 40),
      createdAt: existing.createdAt || now(),
      updatedAt: now(),
    };
    atomicWrite(artifactPath(workspace, "hypothesis", id), record);
    saveState(workspace, { nextHypothesis: Math.max(Number(loadState(workspace).nextHypothesis) || 1, record.sequence + 1), activeHypothesis: id, pendingRecommendation: { targetMode: "plan", reason: "Hypothesis completed" } });
    return { ok: true, hypothesis: record, path: artifactPath(workspace, "hypothesis", id) };
  }

  function readHypothesis(workspace, id = "") {
    const state = loadState(workspace);
    const target = id || state.activeHypothesis;
    return target ? readJson(artifactPath(workspace, "hypothesis", target), null) : null;
  }

  function executionProjection(fields) {
    return {
      linkedHypothesis: fields.linkedHypothesis,
      objective: fields.objective,
      tasks: (fields.tasks || []).map((task) => ({
        id: task.id,
        title: task.title,
        dependsOn: task.dependsOn || [],
        expectedOutcome: task.expectedOutcome || "",
        allowedTools: task.allowedTools || [],
        targetRefs: task.targetRefs || [],
        argumentConstraints: task.argumentConstraints || {},
        expectedSignals: task.expectedSignals || [],
        rejectingSignals: task.rejectingSignals || [],
        identityId: task.identityId || "",
        identityIds: task.identityIds || [],
        pageId: task.pageId || "main",
        execution: normalizedExecution(task.execution),
        ...(task.testCase ? { testCase: normalizeNestedTestCase(task.testCase) } : {}),
      })),
      allowedTools: fields.allowedTools || [],
      requiredEvidence: fields.requiredEvidence || [],
      scopeReferences: fields.scopeReferences || [],
      stopConditions: fields.stopConditions || [],
      argumentConstraints: fields.argumentConstraints || {},
      allowedIdentityIds: fields.allowedIdentityIds || [],
      maximumConcurrency: fields.maximumConcurrency || 1,
      requestsPerSecond: fields.requestsPerSecond || 1,
    };
  }

  function normalizeWorkflowTasks(tasks) {
    return (Array.isArray(tasks) ? tasks : []).slice(0, 100).map((task, index) => {
      const value = task && typeof task === "object" ? task : {};
      return {
        ...value,
        id: text(value.id || `step_${index + 1}`, 120),
        title: text(value.title || value.objective || `Step ${index + 1}`, 2_000),
        status: text(value.status || "pending", 40),
        dependsOn: Array.isArray(value.dependsOn) ? value.dependsOn.map(String).slice(0, 50) : [],
        allowedTools: Array.isArray(value.allowedTools) ? [...new Set(value.allowedTools.map(String))].slice(0, 30) : [],
        targetRefs: Array.isArray(value.targetRefs) ? value.targetRefs.map((item) => text(item, 2_000)).slice(0, 50) : [],
        argumentConstraints: value.argumentConstraints && typeof value.argumentConstraints === "object" ? value.argumentConstraints : {},
        expectedSignals: Array.isArray(value.expectedSignals) ? value.expectedSignals.map((item) => text(item, 1_000)).slice(0, 30) : [],
        rejectingSignals: Array.isArray(value.rejectingSignals) ? value.rejectingSignals.map((item) => text(item, 1_000)).slice(0, 30) : [],
        identityId: text(value.identityId || "", 120),
        identityIds: Array.isArray(value.identityIds) ? [...new Set(value.identityIds.map((item) => text(item, 120)).filter(Boolean))].slice(0, 50) : [],
        pageId: text(value.pageId || "main", 120),
        execution: normalizedExecution(value.execution),
        ...(value.testCase ? { testCase: normalizeNestedTestCase(value.testCase) } : {}),
      };
    });
  }

  function savePlan(workspace, input = {}) {
    const state = loadState(workspace);
    const id = text(input.id || "", 120) || nextArtifact(workspace, "plan");
    const existing = readPlan(workspace, id) || {};
    const executionFields = {
      linkedHypothesis: text(input.linkedHypothesis || input.hypothesisId || existing.linkedHypothesis || state.activeHypothesis, 120),
      objective: text(input.objective || existing.objective || input.title || "", 12_000),
      tasks: normalizeWorkflowTasks(Array.isArray(input.tasks) ? input.tasks : (existing.tasks || [])),
      allowedTools: Array.isArray(input.allowedTools) ? [...new Set(input.allowedTools.map(String))] : (existing.allowedTools || []),
      requiredEvidence: Array.isArray(input.requiredEvidence) ? input.requiredEvidence.map(String) : (existing.requiredEvidence || []),
      scopeReferences: Array.isArray(input.scopeReferences) ? input.scopeReferences.map(String) : (existing.scopeReferences || []),
      stopConditions: Array.isArray(input.stopConditions) ? input.stopConditions.map((value) => text(value, 1_000)) : (existing.stopConditions || []),
      argumentConstraints: input.argumentConstraints && typeof input.argumentConstraints === "object" ? input.argumentConstraints : (existing.argumentConstraints || {}),
      allowedIdentityIds: Array.isArray(input.allowedIdentityIds) ? [...new Set(input.allowedIdentityIds.map((item) => text(item, 120)).filter(Boolean))] : (existing.allowedIdentityIds || []),
      maximumConcurrency: boundedInteger(input.maximumConcurrency, Number(existing.maximumConcurrency) || 1, 1, 100),
      requestsPerSecond: boundedNumber(input.requestsPerSecond, Number(existing.requestsPerSecond) || 1, 0.1, 1_000),
    };
    const executionHash = hash(executionProjection(executionFields));
    const hasExistingExecutionHash = Boolean(existing.executionHash);
    const edited = hasExistingExecutionHash && executionHash !== existing.executionHash;
    const record = {
      ...existing,
      schemaVersion: 1,
      id,
      sequence: Number(id.match(/_(\d+)$/)?.[1] || existing.sequence || 0),
      title: text(input.title || existing.title || input.objective || existing.objective || "Implementation plan", 500),
      ...executionFields,
      expectedSignals: Array.isArray(input.expectedSignals) ? input.expectedSignals.map((value) => text(value, 1_000)) : (existing.expectedSignals || []),
      rejectingSignals: Array.isArray(input.rejectingSignals) ? input.rejectingSignals.map((value) => text(value, 1_000)) : (existing.rejectingSignals || []),
      status: edited && existing.approval?.status === "approved" ? "draft" : text(input.status || existing.status || "ready_for_review", 40),
      executionHash,
      approval: edited ? { status: "unapproved", contentHash: "", approvedAt: "", approvedBy: "" } : (existing.approval || { status: "unapproved", contentHash: "", approvedAt: "", approvedBy: "" }),
      createdAt: existing.createdAt || now(),
      updatedAt: now(),
    };
    writePlanRecord(workspace, record);
    saveState(workspace, { nextPlan: Math.max(Number(loadState(workspace).nextPlan) || 1, record.sequence + 1), activePlan: id, pendingRecommendation: { targetMode: "agent", reason: "Plan is ready" } });
    return { ok: true, plan: record, path: artifactPath(workspace, "plan", id) };
  }

  function readPlan(workspace, id = "") {
    const state = loadState(workspace);
    const target = id || state.activePlan;
    if (!target) return null;
    const markdownPath = artifactPath(workspace, "plan", target);
    try {
      const parsed = parsePlanMarkdown(fs.readFileSync(markdownPath, "utf8"));
      return parsed?.id ? { schemaVersion: 1, ...parsed } : null;
    } catch {
      const legacyPath = legacyPlanPath(workspace, target);
      const legacy = readJson(legacyPath, null);
      if (!legacy?.id) return null;
      // Migrate the old machine-only JSON plan the first time it is opened.
      // The Markdown write completes before the exact legacy file is removed.
      writePlanRecord(workspace, legacy);
      return legacy;
    }
  }

  function parseStructuredText(value) {
    const source = String(value || "").trim();
    if (/^#\s+Implementation Plan:/im.test(source) && /^##\s+Tasks\s*$/im.test(source)) return parsePlanMarkdown(source);
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1] : source;
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function completeTurn(workspace, { mode = "", artifactType = "", finalText = "", evidenceIds = [], outcome = "completed", newArtifact = false } = {}) {
    if (outcome !== "completed" || !String(finalText || "").trim()) return { ok: true, artifact: null };
    const currentMode = String(artifactType || mode || "").toLowerCase();
    const state = loadState(workspace);
    const structured = parseStructuredText(finalText);
    if (currentMode === "hypothesis") {
      return saveHypothesis(workspace, {
        id: newArtifact ? "" : state.activeHypothesis || "",
        statement: structured.statement || structured.hypothesis || finalText,
        confidence: structured.confidence || "inconclusive",
        observationIds: structured.observationIds || structured.observations || [],
        entityIds: structured.entityIds || structured.entities || [],
        evidenceRefs: [...(structured.evidenceRefs || structured.evidenceIds || []), ...evidenceIds],
        knowledgeRefs: structured.knowledgeRefs || [],
        evidenceGaps: structured.evidenceGaps || [],
        status: "completed",
      });
    }
    if (currentMode === "plan") {
      const tasks = Array.isArray(structured.tasks) ? structured.tasks : [];
      if (!tasks.length) return { ok: false, artifact: null, error: "The plan response did not contain executable tasks." };
      return savePlan(workspace, {
        id: newArtifact ? "" : state.activePlan || "",
        linkedHypothesis: structured.linkedHypothesis || structured.hypothesisId || state.activeHypothesis,
        objective: structured.objective || structured.title || finalText,
        title: structured.title || structured.objective || "Implementation plan",
        tasks,
        allowedTools: structured.allowedTools || [],
        requiredEvidence: [...(structured.requiredEvidence || structured.evidenceRefs || []), ...evidenceIds],
        scopeReferences: structured.scopeReferences || [],
        stopConditions: structured.stopConditions || [],
        argumentConstraints: structured.argumentConstraints || {},
        expectedSignals: structured.expectedSignals || [],
        rejectingSignals: structured.rejectingSignals || [],
        status: "ready_for_review",
      });
    }
    return { ok: true, artifact: null };
  }

  function approvePlan(workspace, id = "", approver = "local-user") {
    const plan = readPlan(workspace, id);
    if (!plan) return { ok: false, error: "No plan is available for approval.", code: "PLAN_NOT_FOUND" };
    if (plan.status === "executing") return { ok: false, error: "An executing plan cannot be approved again.", code: "PLAN_ALREADY_EXECUTING" };
    const approval = { status: "approved", contentHash: plan.executionHash || hash(plan), approvedAt: now(), approvedBy: text(approver, 200) || "local-user" };
    const updated = { ...plan, status: "approved", approval, updatedAt: now() };
    writePlanRecord(workspace, updated);
    saveState(workspace, { activePlan: plan.id, pendingRecommendation: { targetMode: "agent", reason: "Plan approved" } });
    return { ok: true, plan: updated };
  }

  function bindPlan(workspace, planId = "", runId = "") {
    const plan = readPlan(workspace, planId);
    if (!plan) return { ok: false, error: "The requested plan was not found.", code: "PLAN_NOT_FOUND" };
    if (plan.approval?.status !== "approved" || plan.approval.contentHash !== plan.executionHash) return { ok: false, error: "The plan must be approved and unchanged before execution.", code: "PLAN_NOT_APPROVED" };
    if (!Array.isArray(plan.tasks) || !plan.tasks.length) return { ok: false, error: "The approved plan has no executable steps.", code: "PLAN_NO_EXECUTABLE_STEPS" };
    if (["completed", "stopped"].includes(String(plan.status || "").toLowerCase())) return { ok: false, error: "The plan is already terminal; revise it before starting another run.", code: "PLAN_TERMINAL" };
    const existingBinding = loadState(workspace).planBinding;
    const producedEvidenceIds = existingBinding?.planId === plan.id && existingBinding.contentHash === plan.executionHash
      ? [...new Set(existingBinding.producedEvidenceIds || [])].slice(0, 500)
      : [];
    const binding = { planId: plan.id, contentHash: plan.executionHash, runId: text(runId, 200), producedEvidenceIds, createdAt: existingBinding?.createdAt || now() };
    const executing = { ...plan, status: "executing", updatedAt: now() };
    writePlanRecord(workspace, executing);
    saveState(workspace, { activePlan: plan.id, planBinding: binding, pendingRecommendation: null });
    return { ok: true, binding, plan: executing };
  }

  function finishPlanRun(workspace, binding, status = "completed") {
    const plan = readPlan(workspace, binding?.planId);
    if (!plan || plan.executionHash !== binding?.contentHash || hash(executionProjection(plan)) !== binding.contentHash) return { ok: false, code: "PLAN_CHANGED" };
    if (["completed", "stopped"].includes(plan.status)) return { ok: true, plan };
    const allTasksComplete = Array.isArray(plan.tasks) && plan.tasks.length > 0
      && plan.tasks.every((task) => ["completed", "skipped"].includes(String(task.status || "").toLowerCase()));
    // A model response ending a turn is not proof that every approved step
    // ran. Keep the immutable binding alive until each step is completed.
    if (status === "completed" && !allTasksComplete) {
      return { ok: true, incomplete: true, plan };
    }
    const terminalStatus = status === "completed" ? "completed" : "stopped";
    const updated = {
      ...plan,
      status: terminalStatus,
      executionHistory: [...(Array.isArray(plan.executionHistory) ? plan.executionHistory : []), {
        type: "run_terminal",
        runId: text(binding?.runId || "", 200),
        status: terminalStatus,
        recordedAt: now(),
      }].slice(-500),
      updatedAt: now(),
    };
    writePlanRecord(workspace, updated);
    const state = loadState(workspace);
    if (state.planBinding?.runId === binding?.runId) saveState(workspace, { planBinding: null, pendingRecommendation: null });
    return { ok: true, plan: updated };
  }

  function recordProducedEvidence(workspace, runId, evidenceIds = []) {
    const state = loadState(workspace);
    if (!state.planBinding || state.planBinding.runId !== runId) return state;
    const produced = new Set(state.planBinding.producedEvidenceIds || []);
    for (const id of evidenceIds) if (id) produced.add(String(id));
    return saveState(workspace, { planBinding: { ...state.planBinding, producedEvidenceIds: [...produced].slice(0, 500) } });
  }

  function recordPlanAction(workspace, binding, { actionId = "", toolName = "", stepId = "", result = null } = {}) {
    const plan = readPlan(workspace, binding?.planId);
    if (!plan || plan.executionHash !== binding?.contentHash || hash(executionProjection(plan)) !== binding.contentHash) return { ok: false, code: "PLAN_CHANGED" };
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    const current = tasks.find((task) => stepId && task.id === stepId)
      || tasks.find((task) => task.status === "in_progress")
      || tasks.find((task) => task.status === "pending");
    if (!current) return { ok: false, code: "PLAN_NO_ACTIVE_STEP" };
    const actionSucceeded = Boolean(result?.ok && !result?.error);
    const completesStep = toolName === "run_test_case" && result?.ok === true && result?.value?.outcome === "passed";
    const history = Array.isArray(plan.executionHistory) ? plan.executionHistory : [];
    const updated = {
      ...plan,
      tasks: tasks.map((task) => {
        if (task.id !== current.id) return task;
        if (completesStep) return { ...task, status: "completed", startedAt: task.startedAt || now(), completedAt: now() };
        return task.status === "pending" ? { ...task, status: "in_progress", startedAt: task.startedAt || now() } : task;
      }),
      executionHistory: [...history, { actionId: text(actionId, 200), toolName: text(toolName, 120), stepId: text(current.id, 120), ok: actionSucceeded, outcome: toolName === "run_test_case" ? text(result?.value?.outcome || "", 40) : "", evidenceIds: result?.evidenceIds || [], recordedAt: now() }].slice(-500),
      updatedAt: now(),
    };
    writePlanRecord(workspace, updated);
    return { ok: true, plan: updated, stepId: current.id };
  }

  function updatePlanTaskStatuses(workspace, binding, requestedTasks = []) {
    const plan = readPlan(workspace, binding?.planId);
    if (!plan || plan.executionHash !== binding?.contentHash || hash(executionProjection(plan)) !== binding.contentHash) return { ok: false, code: "PLAN_CHANGED", error: "The approved plan changed." };
    const currentTasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    const requested = Array.isArray(requestedTasks) ? requestedTasks : [];
    if (requested.length !== currentTasks.length) return { ok: false, code: "PLAN_TASK_LIST_CHANGED", error: "The approved task list cannot be replaced during execution." };
    for (let index = 0; index < currentTasks.length; index += 1) {
      if (String(requested[index]?.id || "") !== currentTasks[index].id || String(requested[index]?.title || "") !== currentTasks[index].title) {
        return { ok: false, code: "PLAN_TASK_LIST_CHANGED", error: "Task IDs, order, and titles must match the approved plan." };
      }
    }
    const statuses = requested.map((task) => String(task.status || "pending").toLowerCase());
    if (statuses.some((status) => !["pending", "in_progress", "completed", "blocked"].includes(status))) return { ok: false, code: "PLAN_TASK_STATUS_INVALID", error: "A plan task status is invalid." };
    const active = statuses.filter((status) => status === "in_progress" || status === "blocked").length;
    if (active > 1) return { ok: false, code: "PLAN_TASK_SEQUENCE_INVALID", error: "Only one approved task may be active at a time." };
    let incompleteSeen = false;
    let pendingSeen = false;
    for (let index = 0; index < statuses.length; index += 1) {
      const previous = String(currentTasks[index].status || "pending").toLowerCase();
      const next = statuses[index];
      if (previous === "completed" && next !== "completed") return { ok: false, code: "PLAN_TASK_SEQUENCE_INVALID", error: "A completed approved task cannot be reopened during the same execution." };
      if (incompleteSeen && next === "completed") return { ok: false, code: "PLAN_TASK_SEQUENCE_INVALID", error: "Approved tasks must complete sequentially." };
      if (pendingSeen && (next === "in_progress" || next === "blocked")) return { ok: false, code: "PLAN_TASK_SEQUENCE_INVALID", error: "The active approved task must appear before pending tasks." };
      if (next !== "completed") incompleteSeen = true;
      if (next === "pending") pendingSeen = true;
    }
    const updatedAt = now();
    const updated = {
      ...plan,
      tasks: currentTasks.map((task, index) => ({
        ...task,
        status: statuses[index],
        ...(statuses[index] === "in_progress" ? { startedAt: task.startedAt || updatedAt } : {}),
        ...(statuses[index] === "completed" ? { startedAt: task.startedAt || updatedAt, completedAt: task.completedAt || updatedAt } : {}),
      })),
      updatedAt,
    };
    writePlanRecord(workspace, updated);
    return { ok: true, plan: updated };
  }

  function allowedEvidence(workspace, binding, intelligence = null) {
    const plan = readPlan(workspace, binding?.planId);
    if (!plan) return new Set();
    const declared = [...(plan.requiredEvidence || []), ...(plan.evidenceRefs || []), ...(binding?.producedEvidenceIds || [])].map(String);
    const related = intelligence?.relatedEvidence?.(workspace, declared) || [];
    return new Set([...declared, ...related].slice(0, 100));
  }

  function validateAction(workspace, binding, toolName, args = {}, intelligence = null, toolMetadata = null) {
    if (!binding || !binding.planId) return { ok: true, bound: false };
    const plan = readPlan(workspace, binding.planId);
    if (!plan || plan.executionHash !== binding.contentHash || hash(executionProjection(plan)) !== binding.contentHash || plan.approval?.status !== "approved") return { ok: false, error: "The approved plan changed or is no longer approved.", code: "PLAN_CHANGED" };
    if (INTELLIGENCE_TOOLS.has(toolName) || KNOWLEDGE_TOOLS.has(toolName)) {
      if (toolName === "expand_evidence") {
        const allowed = allowedEvidence(workspace, binding, intelligence);
        const refs = Array.isArray(args.refs) ? args.refs : [args.ref];
        const invalid = refs.filter(Boolean).map(String).filter((id) => !allowed.has(id));
        if (invalid.length) return { ok: false, error: "Evidence is outside the approved plan and current run evidence set.", code: "PLAN_EVIDENCE_NOT_ALLOWED", invalidEvidenceIds: invalid };
      }
      if (toolName === "query_assessment") {
        const allowed = allowedEvidence(workspace, binding, intelligence);
        const requested = [args.id, args.entityId].filter(Boolean).map(String);
        if (requested.length && requested.some((id) => !allowed.has(id))) return { ok: false, error: "Assessment evidence is outside the approved plan and current run evidence set.", code: "PLAN_EVIDENCE_NOT_ALLOWED", invalidEvidenceIds: requested.filter((id) => !allowed.has(id)) };
        if (!requested.length && ["search", "entity", "relationships"].includes(String(args.operation || "").toLowerCase())) return { ok: false, error: "Plan-bound assessment queries must name an approved or run-produced evidence reference.", code: "PLAN_EVIDENCE_REFERENCE_REQUIRED" };
      }
      return { ok: true, bound: true, readOnly: true };
    }
    const dynamicMcp = String(toolName || "").startsWith("mcp__");
    if (!EXECUTABLE_TOOLS.has(toolName) && !dynamicMcp) return { ok: true, bound: true, readOnly: true };
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    const current = tasks.find((task) => task.status === "in_progress") || tasks.find((task) => task.status === "pending");
    if (!current) return { ok: false, error: "The approved plan has no executable step remaining.", code: "PLAN_NO_ACTIVE_STEP" };
    const allowedTools = effectiveStepTools(plan, current);
    if (!allowedTools.length) return { ok: false, error: "The current approved plan step does not declare any executable tools.", code: "PLAN_STEP_TOOLS_NOT_DECLARED", stepId: current.id };
    if (!allowedTools.includes(toolName)) return { ok: false, error: `Tool ${toolName} is not allowed by the current approved plan step.`, code: "PLAN_ACTION_NOT_ALLOWED", stepId: current.id };
    const nestedRequests = nestedActionRequests(args, toolName);
    const canonicalRequests = nestedRequests.map((request) => ({
      ...(request.input || {}),
      __stepId: request.stepId,
      __action: request.action,
      identityId: String(request.input?.identityId || ""),
      pageId: String(request.input?.pageId || "main"),
      execution: normalizedExecution(request.input?.execution),
    }));
    if (toolName === "run_test_case") {
      const declaredNested = normalizeNestedTestCase(current.testCase);
      if (!declaredNested?.steps?.length || declaredNested.steps.length !== canonicalRequests.length) {
        return { ok: false, error: "Every nested test-case action must be declared in the immutable approved plan.", code: "PLAN_NESTED_ACTIONS_NOT_DECLARED", stepId: current.id };
      }
      const declaredById = new Map(declaredNested.steps.map((step) => [step.id, step]));
      for (const request of canonicalRequests) {
        const declared = declaredById.get(String(request.__stepId || ""));
        if (!declared) return { ok: false, error: "The nested action is not declared by the approved plan.", code: "PLAN_NESTED_ACTION_NOT_DECLARED", stepId: current.id, nestedStepId: request.__stepId };
        if (declared.action !== String(request.__action || "") || !allowedTools.includes(declared.action)) {
          return { ok: false, error: "The nested tool is not allowed by the approved plan step.", code: "PLAN_NESTED_TOOL_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
        }
        if (declared.identityId !== request.identityId) {
          return { ok: false, error: "The nested action identity does not match its approved step.", code: "PLAN_NESTED_IDENTITY_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
        }
        if (declared.pageId !== request.pageId) {
          return { ok: false, error: "The nested browser page does not match its approved step.", code: "PLAN_NESTED_PAGE_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
        }
        const requestedExecution = normalizedExecution(request.execution);
        if (canonical(requestedExecution) !== canonical(declared.execution)) {
          return { ok: false, error: "The nested execution parameters do not match the approved step.", code: "PLAN_NESTED_EXECUTION_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
        }
        const nestedTargets = [];
        for (const key of PLAN_TARGET_ARGUMENTS) flattenTargetValues(readArgumentPath(request, key), nestedTargets);
        if (TARGET_BEARING_TOOLS.has(declared.action) && (!declared.targetRefs.length || !nestedTargets.length)) {
          return { ok: false, error: "The nested target is not declared by the approved step.", code: "PLAN_NESTED_TARGET_REQUIRED", stepId: current.id, nestedStepId: declared.id };
        }
        const invalidNestedTargets = nestedTargets.filter((target) => !declared.targetRefs.some((value) => targetWithinApprovedReference(target, value)));
        if (invalidNestedTargets.length) {
          return { ok: false, error: "The nested action target is outside its approved step.", code: "PLAN_NESTED_TARGET_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id, invalidTargets: invalidNestedTargets };
        }
        for (const [key, rule] of Object.entries(declared.argumentConstraints || {})) {
          const actual = readArgumentPath(request, key);
          if (rule && typeof rule === "object" && !Array.isArray(rule)) {
            if (rule.equals !== undefined && canonical(actual) !== canonical(rule.equals)) return { ok: false, error: `Nested argument ${key} does not match the approved constraint.`, code: "PLAN_NESTED_ARGUMENT_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
            if (Array.isArray(rule.oneOf) && !rule.oneOf.some((value) => canonical(actual) === canonical(value))) return { ok: false, error: `Nested argument ${key} is outside the approved values.`, code: "PLAN_NESTED_ARGUMENT_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
            if (rule.pattern && !new RegExp(String(rule.pattern)).test(String(actual || ""))) return { ok: false, error: `Nested argument ${key} does not match the approved pattern.`, code: "PLAN_NESTED_ARGUMENT_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
          } else if (Array.isArray(rule) && !rule.some((value) => canonical(actual) === canonical(value))) {
            return { ok: false, error: `Nested argument ${key} is outside the approved values.`, code: "PLAN_NESTED_ARGUMENT_NOT_ALLOWED", stepId: current.id, nestedStepId: declared.id };
          }
        }
      }
    }
    const approvedIdentityIds = [...new Set([
      ...(Array.isArray(plan.allowedIdentityIds) ? plan.allowedIdentityIds : []),
      ...(Array.isArray(current.identityIds) ? current.identityIds : []),
      ...(current.identityId ? [current.identityId] : []),
      ...(Array.isArray(current.testCase?.steps) ? current.testCase.steps.map((step) => step.identityId).filter(Boolean) : []),
    ].map(String).filter(Boolean))];
    const invalidIdentityIds = canonicalRequests.map((request) => request.identityId).filter((identityId) => approvedIdentityIds.length ? !approvedIdentityIds.includes(identityId) : Boolean(identityId));
    if (invalidIdentityIds.length) {
      return { ok: false, error: "The action identity is not declared by the approved plan.", code: "PLAN_IDENTITY_NOT_ALLOWED", stepId: current.id, invalidIdentityIds: [...new Set(invalidIdentityIds)] };
    }
    if (toolName !== "run_test_case") {
      const approvedPage = String(current.pageId || "main");
      const requestedPages = [...new Set(canonicalRequests.map((request) => request.pageId))];
      if (toolName === "browser_action" && requestedPages.some((pageId) => pageId !== approvedPage)) {
        return { ok: false, error: "The browser page is not declared by the approved plan step.", code: "PLAN_PAGE_NOT_ALLOWED", stepId: current.id };
      }
      const approvedExecution = normalizedExecution(current.execution);
      for (const request of canonicalRequests) {
        const normalized = request.execution;
        if (normalized.mode !== approvedExecution.mode
          || normalized.groupId !== approvedExecution.groupId
          || normalized.repetitions !== approvedExecution.repetitions) {
          return { ok: false, error: "The execution mode, barrier group, or repetition count is not declared by the approved plan.", code: "PLAN_EXECUTION_PARAMETERS_NOT_ALLOWED", stepId: current.id };
        }
      }
    }
    const planMaximumConcurrency = Math.max(1, Number(plan.maximumConcurrency) || 1);
    const planRequestsPerSecond = Math.max(0.1, Number(plan.requestsPerSecond) || 0.1);
    for (const size of barrierSizesFor(toolName, args)) {
      if (size > planMaximumConcurrency) return { ok: false, error: "The barrier exceeds the concurrency limit approved for this plan.", code: "PLAN_CONCURRENCY_NOT_ALLOWED", stepId: current.id, requested: size, maximum: planMaximumConcurrency };
      if (size > planRequestsPerSecond) return { ok: false, error: "The barrier exceeds the request rate approved for this plan.", code: "PLAN_RATE_NOT_ALLOWED", stepId: current.id, requested: size, maximum: planRequestsPerSecond };
    }
    const declaredTargetValues = [];
    for (const key of Array.isArray(toolMetadata?.targetArguments) ? toolMetadata.targetArguments : []) {
      flattenTargetValues(readArgumentPath(args, key), declaredTargetValues);
    }
    const directTargetValues = [];
    for (const request of nestedRequests.map((item) => item.input || {})) {
      for (const key of ["path", "url", "target", "host", "command", "endpoint", "domain", "ip", "origin", "request.url", "request.target", "paths", "urls", "targets"]) {
        flattenTargetValues(readArgumentPath(request, key), directTargetValues);
      }
    }
    const actionTargets = toolName === "run_test_case" ? [] : [...new Set([...directTargetValues, ...declaredTargetValues])];
    const targets = [...new Set([...(plan.scopeReferences || []), ...(current.targetRefs || [])].map(String).filter(Boolean))];
    if (toolName !== "run_test_case" && (dynamicMcp || TARGET_BEARING_TOOLS.has(toolName)) && !targets.length) {
      return { ok: false, error: "The approved plan step does not declare a target for this action.", code: "PLAN_TARGET_REQUIRED", stepId: current.id };
    }
    if (toolName !== "run_test_case" && (dynamicMcp || TARGET_BEARING_TOOLS.has(toolName)) && !actionTargets.length) {
      return { ok: false, error: "The action did not expose a target that can be checked against the approved plan step.", code: "PLAN_TARGET_REQUIRED", stepId: current.id };
    }
    const invalidTargets = actionTargets.filter((target) => !targets.some((value) => targetWithinApprovedReference(target, value)));
    if (targets.length && invalidTargets.length) {
      return { ok: false, error: "The action target is outside the approved plan step.", code: "PLAN_TARGET_NOT_ALLOWED", stepId: current.id, invalidTargets };
    }
    const constraints = { ...(plan.argumentConstraints || {}), ...(current.argumentConstraints || {}) };
    for (const [key, rule] of Object.entries(constraints)) {
      const actual = args[key];
      if (rule && typeof rule === "object" && !Array.isArray(rule)) {
        if (rule.equals !== undefined && canonical(actual) !== canonical(rule.equals)) return { ok: false, error: `Argument ${key} does not match the approved plan constraint.`, code: "PLAN_ARGUMENT_NOT_ALLOWED", stepId: current.id };
        if (Array.isArray(rule.oneOf) && !rule.oneOf.some((value) => canonical(actual) === canonical(value))) return { ok: false, error: `Argument ${key} is outside the approved plan values.`, code: "PLAN_ARGUMENT_NOT_ALLOWED", stepId: current.id };
        if (rule.pattern && !new RegExp(String(rule.pattern)).test(String(actual || ""))) return { ok: false, error: `Argument ${key} does not match the approved plan pattern.`, code: "PLAN_ARGUMENT_NOT_ALLOWED", stepId: current.id };
      } else if (Array.isArray(rule) && !rule.some((value) => canonical(actual) === canonical(value))) {
        return { ok: false, error: `Argument ${key} is outside the approved plan values.`, code: "PLAN_ARGUMENT_NOT_ALLOWED", stepId: current.id };
      } else if (rule !== undefined && !Array.isArray(rule) && canonical(actual) !== canonical(rule)) {
        return { ok: false, error: `Argument ${key} does not match the approved plan constraint.`, code: "PLAN_ARGUMENT_NOT_ALLOWED", stepId: current.id };
      }
    }
    return { ok: true, bound: true, stepId: current.id };
  }

  function classify({ mode = "agent", message = "", workspace = "" } = {}) {
    const value = String(message || "").trim();
    const state = loadState(workspace);
    const approval = /^(?:yes[, ]*)?(?:approve|approved|i approve|approve the plan|approve plan)\b/i.test(value);
    const hypothesisIntent = /\b(?:hypothesis|hypotheses|correlate the findings|analy[sz]e (?:the )?(?:current )?(?:findings|evidence)|enough info(?:rmation)?|start with some assessment|what might be wrong)\b/i.test(value);
    const planIntent = /\b(?:plan|planning|assessment procedure|testing procedure|how should we test|steps to validate)\b/i.test(value);
    // Only bind or block on an explicit request to execute a plan/assessment.
    // Generic command wording (including negated phrases such as "no need to
    // execute a command") must remain ordinary Agent work even when a stale
    // unapproved plan exists in the workspace.
    const executeIntent = /\b(?:(?:execute|run|start|perform|begin)\s+(?:(?:the|a|an|this|that|approved|saved|current)\s+)*(?:plan|assessment)|carry\s+out\s+(?:(?:the|a|an|this|that|approved|saved|current)\s+)*(?:plan|assessment)|test\s+(?:(?:the|this|that|approved|saved|current)\s+)*(?:plan|assessment))\b/i.test(value);
    const revisionIntent = /\b(?:refine|revise|change|update|edit)\b/i.test(value);
    const explanationIntent = /\b(?:explain|clarify|why)\b/i.test(value);
    const intent = approval ? "plan_approval" : executeIntent ? (state.activePlan ? "plan_execution" : "ad_hoc_agent_execution") : planIntent ? (explanationIntent ? "plan_explanation" : revisionIntent ? "plan_revision" : "assessment_planning") : hypothesisIntent ? (explanationIntent ? "hypothesis_explanation" : revisionIntent ? "hypothesis_refinement" : "hypothesis_creation") : /\b(?:evidence|finding|traffic|observation|what happened)\b/i.test(value) ? "project_evidence_investigation" : "ordinary";
    // Modes are user-selected working styles, not workflow gates. Hypothesis,
    // planning, analysis, and execution requests continue in the current mode.
    // Plan approval and immutable execution binding remain mode-independent
    // safety controls.
    if (approval && state.activePlan) return { action: "approve_plan", planId: state.activePlan, intent };
    if (executeIntent && state.activePlan) {
      const plan = readPlan(workspace, state.activePlan);
      if (plan?.approval?.status === "approved" && plan.approval.contentHash === plan.executionHash) {
        return { action: "bind_plan", planId: plan.id, intent };
      }
      return { action: "review_required", intent, message: "The saved plan is not approved yet. Review it and explicitly approve it here before asking me to execute it." };
    }
    return { action: "continue", intent };
  }

  function contextPacket(workspace, mode, intelligence = null) {
    const state = loadState(workspace);
    const hypothesis = readHypothesis(workspace);
    const plan = readPlan(workspace);
    const packet = {
      mode,
      state: { activeHypothesis: state.activeHypothesis, activePlan: state.activePlan, planBinding: state.planBinding ? { planId: state.planBinding.planId, runId: state.planBinding.runId, producedEvidenceCount: (state.planBinding.producedEvidenceIds || []).length } : null },
      hypothesis: hypothesis ? { id: hypothesis.id, statement: hypothesis.statement, confidence: hypothesis.confidence, status: hypothesis.status, observationIds: (hypothesis.observationIds || []).slice(0, 30), evidenceRefs: (hypothesis.evidenceRefs || []).slice(0, 30), evidenceGaps: (hypothesis.evidenceGaps || []).slice(0, 20) } : null,
      plan: plan ? { id: plan.id, status: plan.status, objective: plan.objective, linkedHypothesis: plan.linkedHypothesis, tasks: (plan.tasks || []).slice(0, 30).map((task) => ({ id: task.id, title: task.title, status: task.status, allowedTools: task.allowedTools || [], targetRefs: task.targetRefs || [], identityId: task.identityId || "", identityIds: task.identityIds || [], pageId: task.pageId || "main", execution: normalizedExecution(task.execution), ...(task.testCase ? { testCase: normalizeNestedTestCase(task.testCase) } : {}) })), requiredEvidence: (plan.requiredEvidence || []).slice(0, 30), scopeReferences: (plan.scopeReferences || []).slice(0, 30), allowedIdentityIds: plan.allowedIdentityIds || [], maximumConcurrency: plan.maximumConcurrency || 1, requestsPerSecond: plan.requestsPerSecond || 1 } : null,
    };
    if (intelligence) packet.overview = intelligence.query(workspace, { operation: "overview", domain: "engagement" });
    return packet;
  }

  return Object.freeze({ loadState, saveState, classify, saveHypothesis, readHypothesis, savePlan, readPlan, completeTurn, approvePlan, bindPlan, finishPlanRun, recordProducedEvidence, recordPlanAction, updatePlanTaskStatuses, validateAction, contextPacket, artifactPath });
}

module.exports = { createAssessmentModeWorkflow, EXECUTABLE_TOOLS, INTELLIGENCE_TOOLS, KNOWLEDGE_TOOLS };
