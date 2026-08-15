"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const MANAGE_PLAN_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["operation", "planId"],
  properties: {
    operation: { type: "string", enum: ["create", "update", "read", "delete", "list"] },
    planId: { type: "string" },
    title: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked", "cancelled"] },
          dependsOn: { type: "array", items: { type: "string" } },
          expectedOutcome: { type: "string" },
          allowedTools: { type: "array", items: { type: "string" } },
          targetRefs: { type: "array", items: { type: "string" } },
          argumentConstraints: { type: "object" },
          expectedSignals: { type: "array", items: { type: "string" } },
          rejectingSignals: { type: "array", items: { type: "string" } },
          identityId: { type: "string" },
          identityIds: { type: "array", items: { type: "string" } },
          pageId: { type: "string" },
          execution: { type: "object" },
          testCase: { type: "object" },
        },
      },
    },
    taskId: { type: "string" },
    task: {
      type: "object",
      required: ["id", "title"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked", "cancelled"] },
        dependsOn: { type: "array", items: { type: "string" } },
        expectedOutcome: { type: "string" },
      },
    },
    status: { type: "string", enum: ["draft", "ready_for_review", "approved", "executing", "completed", "stopped", "pending", "in_progress", "blocked", "cancelled"] },
    objective: { type: "string" },
    linkedHypothesis: { type: "string" },
    allowedTools: { type: "array", items: { type: "string" } },
    requiredEvidence: { type: "array", items: { type: "string" } },
    scopeReferences: { type: "array", items: { type: "string" } },
    stopConditions: { type: "array", items: { type: "string" } },
    argumentConstraints: { type: "object" },
  },
});

const VALID_TASK_STATUSES = new Set(["draft", "ready_for_review", "approved", "executing", "completed", "stopped", "pending", "in_progress", "blocked", "cancelled"]);

const MANAGE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_MANAGE_PLAN_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  NOT_FOUND: "MANAGE_PLAN_NOT_FOUND",
  ALREADY_EXISTS: "MANAGE_PLAN_ALREADY_EXISTS",
  DUPLICATE_TASK: "MANAGE_PLAN_DUPLICATE_TASK",
  UNKNOWN_TASK: "MANAGE_PLAN_UNKNOWN_TASK",
  INVALID_DEPENDENCY: "MANAGE_PLAN_INVALID_DEPENDENCY",
  WRITE_FAILED: "MANAGE_PLAN_WRITE_FAILED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: MANAGE_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateTaskShape(task, label) {
  if (!isRecord(task)) return invalidInput(`${label} must be an object`);
  if (typeof task.id !== "string" || task.id.trim() === "") return invalidInput(`${label}.id must be a non-empty string`);
  if (typeof task.title !== "string" || task.title.trim() === "") return invalidInput(`${label}.title must be a non-empty string`);
  if (task.status !== undefined && !VALID_TASK_STATUSES.has(task.status)) {
    return invalidInput(`${label}.status must be one of ${[...VALID_TASK_STATUSES].join(", ")}`);
  }
  if (task.dependsOn !== undefined) {
    if (!Array.isArray(task.dependsOn) || task.dependsOn.some(dep => typeof dep !== "string" || dep.trim() === "")) {
      return invalidInput(`${label}.dependsOn must be an array of non-empty strings`);
    }
  }
  if (task.expectedOutcome !== undefined && typeof task.expectedOutcome !== "string") {
    return invalidInput(`${label}.expectedOutcome must be a string`);
  }
  for (const field of ["allowedTools", "targetRefs", "expectedSignals", "rejectingSignals"]) {
    if (task[field] !== undefined && (!Array.isArray(task[field]) || task[field].some((value) => typeof value !== "string"))) return invalidInput(`${label}.${field} must be an array of strings`);
  }
  if (task.identityId !== undefined && typeof task.identityId !== "string") return invalidInput(`${label}.identityId must be a string`);
  if (task.identityIds !== undefined && (!Array.isArray(task.identityIds) || task.identityIds.some((value) => typeof value !== "string"))) return invalidInput(`${label}.identityIds must be an array of strings`);
  if (task.pageId !== undefined && (typeof task.pageId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(task.pageId))) return invalidInput(`${label}.pageId is invalid`);
  if (task.execution !== undefined && (!isRecord(task.execution) || !["single", "barrier"].includes(task.execution.mode || "single"))) return invalidInput(`${label}.execution is invalid`);
  if (task.testCase !== undefined && (!isRecord(task.testCase) || !Array.isArray(task.testCase.steps))) return invalidInput(`${label}.testCase must contain a steps array`);
  if (task.argumentConstraints !== undefined && !isRecord(task.argumentConstraints)) return invalidInput(`${label}.argumentConstraints must be an object`);
  return { ok: true };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!["create", "update", "read", "delete", "list"].includes(input.operation)) {
    return invalidInput("operation must be create, update, read, delete, or list");
  }
  if (input.operation === "list") {
    if (input.planId !== undefined) return invalidInput("list does not accept planId");
  } else {
    if (typeof input.planId !== "string" || input.planId.trim() === "") {
      return invalidInput("planId must be a non-empty string");
    }
  }
  if (/[\u0000\r\n]/.test(String(input.planId || "")) || (input.title && /[\u0000\r\n]/.test(String(input.title)))) {
    return invalidInput("planId and title must not contain control characters");
  }
  if (input.title !== undefined && typeof input.title !== "string") return invalidInput("title must be a string");
  for (const field of ["allowedTools", "requiredEvidence", "scopeReferences", "stopConditions"]) {
    if (input[field] !== undefined && (!Array.isArray(input[field]) || input[field].some((value) => typeof value !== "string"))) return invalidInput(`${field} must be an array of strings`);
  }
  if (input.argumentConstraints !== undefined && !isRecord(input.argumentConstraints)) return invalidInput("argumentConstraints must be an object");
  if (input.status !== undefined && !VALID_TASK_STATUSES.has(input.status)) {
    return invalidInput(`status must be one of ${[...VALID_TASK_STATUSES].join(", ")}`);
  }
  if (input.tasks !== undefined) {
    if (!Array.isArray(input.tasks)) return invalidInput("tasks must be an array");
    const seenIds = new Set();
    for (let i = 0; i < input.tasks.length; i += 1) {
      const result = validateTaskShape(input.tasks[i], `tasks[${i}]`);
      if (!result.ok) return result;
      if (seenIds.has(input.tasks[i].id)) return invalidInput(`tasks[${i}].id duplicates task id: ${input.tasks[i].id}`);
      seenIds.add(input.tasks[i].id);
    }
  }
  if (input.task !== undefined) {
    const result = validateTaskShape(input.task, "task");
    if (!result.ok) return result;
  }
  if (input.taskId !== undefined && (typeof input.taskId !== "string" || input.taskId.trim() === "")) {
    return invalidInput("taskId must be a non-empty string");
  }
  if (input.task !== undefined && input.taskId !== undefined) {
    return invalidInput("provide either a task object or taskId+status, not both (accepted shapes: task={...} OR taskId+status)");
  }
  if (input.operation === "update" && input.taskId !== undefined && input.status === undefined) {
    return invalidInput("taskId requires status for update");
  }
  return { ok: true };
}

function createManagePlanTool({ fs = null, path = null } = {}) {
  const realFs = fs || require("node:fs");
  const realPath = path || require("node:path");
  // In-memory plan store; canonical workflow plans persist under .xekute/plan/.
  const plans = new Map();

  function workspaceKey(root) {
    return root ? realPath.resolve(root).replace(/[\\/]+$/, "").toLowerCase() : "__memory__";
  }

  function cacheKey(root, planId) { return `${workspaceKey(root)}\u0000${planId}`; }

  function planFile(root, planId) {
    return realPath.join(root, ".xekute", "plan", `${planId}.json`);
  }

  function legacyPlanFile(root, planId) {
    return realPath.join(root, ".xekute", "plans", `${planId}.json`);
  }

  function loadPlan(root, planId) {
    const key = cacheKey(root, planId);
    if (plans.has(key)) return plans.get(key);
    if (!root) return null;
    try {
      let raw;
      try { raw = realFs.readFileSync(planFile(root, planId), "utf8"); }
      catch { raw = realFs.readFileSync(legacyPlanFile(root, planId), "utf8"); }
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id === planId) {
        plans.set(key, parsed);
        return parsed;
      }
    } catch {
      // Not persisted; return null.
    }
    return null;
  }

  function persistPlan(root, plan) {
    if (!root) return;
    try {
      realFs.mkdirSync(realPath.join(root, ".xekute", "plan"), { recursive: true });
      realFs.writeFileSync(planFile(root, plan.id), JSON.stringify(plan, null, 2), "utf8");
    } catch (error) {
      throw error;
    }
  }

  function normalizeTask(task, now) {
    // Returns the mutable input fields only; createdAt is preserved by merge
    // in update paths and set once at creation.
    return {
      id: task.id,
      title: task.title,
      status: task.status || "pending",
      dependsOn: Array.isArray(task.dependsOn) ? [...task.dependsOn] : [],
      expectedOutcome: task.expectedOutcome || "",
      allowedTools: Array.isArray(task.allowedTools) ? [...task.allowedTools] : [],
      targetRefs: Array.isArray(task.targetRefs) ? [...task.targetRefs] : [],
      argumentConstraints: task.argumentConstraints && typeof task.argumentConstraints === "object" ? { ...task.argumentConstraints } : {},
      expectedSignals: Array.isArray(task.expectedSignals) ? [...task.expectedSignals] : [],
      rejectingSignals: Array.isArray(task.rejectingSignals) ? [...task.rejectingSignals] : [],
      identityId: task.identityId || "",
      identityIds: Array.isArray(task.identityIds) ? [...task.identityIds] : [],
      pageId: task.pageId || "main",
      execution: task.execution && typeof task.execution === "object" ? { ...task.execution } : { mode: "single", repetitions: 1 },
      ...(task.testCase ? { testCase: JSON.parse(JSON.stringify(task.testCase)) } : {}),
      updatedAt: now,
    };
  }

  function validateDependencies(tasks) {
    const ids = new Set(tasks.map(t => t.id));
    for (const task of tasks) {
      for (const dep of task.dependsOn || []) {
        if (!ids.has(dep)) return { ok: false, task: task.id, dep };
      }
    }
    return { ok: true };
  }

  function createPlan(input, root) {
    if (!input.planId) return invalidInput("planId is required for create");
    const existing = loadPlan(root, input.planId);
    if (existing) return structuredFailure(MANAGE_ERROR_CODES.ALREADY_EXISTS, `plan already exists: ${input.planId}`, { planId: input.planId });
    const now = new Date().toISOString();
    const tasks = (input.tasks || []).map(t => ({ ...normalizeTask(t, now), createdAt: now }));
    const depResult = validateDependencies(tasks);
    if (!depResult.ok) {
      return structuredFailure(MANAGE_ERROR_CODES.INVALID_DEPENDENCY, `task ${depResult.task} depends on unknown task ${depResult.dep}`);
    }
    const plan = {
      id: input.planId,
      title: input.title || input.planId,
      objective: input.objective || input.title || input.planId,
      linkedHypothesis: input.linkedHypothesis || "",
      tasks,
      allowedTools: Array.isArray(input.allowedTools) ? [...input.allowedTools] : [],
      requiredEvidence: Array.isArray(input.requiredEvidence) ? [...input.requiredEvidence] : [],
      scopeReferences: Array.isArray(input.scopeReferences) ? [...input.scopeReferences] : [],
      stopConditions: Array.isArray(input.stopConditions) ? [...input.stopConditions] : [],
      argumentConstraints: input.argumentConstraints && typeof input.argumentConstraints === "object" ? { ...input.argumentConstraints } : {},
      status: input.status || "draft",
      createdAt: now,
      updatedAt: now,
    };
    const key = cacheKey(root, plan.id);
    plans.set(key, plan);
    if (root) {
      try {
        persistPlan(root, plan);
      } catch (error) {
        plans.delete(key);
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "create", planId: plan.id, plan } };
  }

  function readPlan(input, root) {
    const plan = loadPlan(root, input.planId || "");
    if (!plan) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `plan not found: ${input.planId}`, { planId: input.planId });
    return { ok: true, value: { operation: "read", planId: plan.id, plan } };
  }

  function updatePlan(input, root) {
    const plan = loadPlan(root, input.planId || "");
    if (!plan) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `plan not found: ${input.planId}`, { planId: input.planId });
    const now = new Date().toISOString();

    if (input.title !== undefined) plan.title = input.title;
    for (const field of ["objective", "linkedHypothesis", "status"]) if (input[field] !== undefined) plan[field] = input[field];
    for (const field of ["allowedTools", "requiredEvidence", "scopeReferences", "stopConditions"]) if (input[field] !== undefined) plan[field] = [...input[field]];
    if (input.argumentConstraints !== undefined) plan.argumentConstraints = { ...input.argumentConstraints };
    if (input.tasks !== undefined) {
      const ids = new Set();
      const normalized = [];
      for (const t of input.tasks) {
        if (ids.has(t.id)) return structuredFailure(MANAGE_ERROR_CODES.DUPLICATE_TASK, `duplicate task id: ${t.id}`, { taskId: t.id });
        ids.add(t.id);
        const existing = plan.tasks.find(pt => pt.id === t.id);
        if (existing) {
          // Partial merge: only fields present in t override existing values.
          const merged = { ...existing, ...normalizeTask({ ...existing, ...t }, now) };
          if (t.dependsOn === undefined) merged.dependsOn = existing.dependsOn;
          if (t.expectedOutcome === undefined) merged.expectedOutcome = existing.expectedOutcome;
          merged.createdAt = existing.createdAt;
          normalized.push(merged);
        } else {
          normalized.push({ ...normalizeTask(t, now), createdAt: now });
        }
      }
      const depResult = validateDependencies(normalized);
      if (!depResult.ok) {
        return structuredFailure(MANAGE_ERROR_CODES.INVALID_DEPENDENCY, `task ${depResult.task} depends on unknown task ${depResult.dep}`);
      }
      plan.tasks = normalized;
    }
    if (input.task !== undefined) {
      const idx = plan.tasks.findIndex(t => t.id === input.task.id);
      if (idx === -1) return structuredFailure(MANAGE_ERROR_CODES.UNKNOWN_TASK, `unknown task: ${input.task.id}`, { taskId: input.task.id });
      const existing = plan.tasks[idx];
      // Merge only provided fields so a partial update never resets dependsOn,
      // expectedOutcome, or createdAt.
      const merged = { ...existing, ...normalizeTask({ ...existing, ...input.task }, now) };
      if (input.task.dependsOn === undefined) merged.dependsOn = existing.dependsOn;
      if (input.task.expectedOutcome === undefined) merged.expectedOutcome = existing.expectedOutcome;
      merged.createdAt = existing.createdAt;
      plan.tasks[idx] = merged;
      const depResult = validateDependencies(plan.tasks);
      if (!depResult.ok) {
        return structuredFailure(MANAGE_ERROR_CODES.INVALID_DEPENDENCY, `task ${depResult.task} depends on unknown task ${depResult.dep}`);
      }
    }
    if (input.taskId !== undefined && input.status !== undefined) {
      const idx = plan.tasks.findIndex(t => t.id === input.taskId);
      if (idx === -1) return structuredFailure(MANAGE_ERROR_CODES.UNKNOWN_TASK, `unknown task: ${input.taskId}`, { taskId: input.taskId });
      plan.tasks[idx].status = input.status;
      plan.tasks[idx].updatedAt = now;
    }
    plan.updatedAt = now;
    if (root) {
      try {
        persistPlan(root, plan);
      } catch (error) {
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "update", planId: plan.id, plan } };
  }

  function deletePlan(input, root) {
    const plan = loadPlan(root, input.planId || "");
    if (!plan) return structuredFailure(MANAGE_ERROR_CODES.NOT_FOUND, `plan not found: ${input.planId}`, { planId: input.planId });
    plans.delete(cacheKey(root, plan.id));
    if (root) {
      try {
        realFs.rmSync(planFile(root, plan.id), { force: true });
      } catch (error) {
        return structuredFailure(MANAGE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "delete", planId: plan.id } };
  }

  function listPlans(root) {
    const prefix = `${workspaceKey(root)}\u0000`;
    if (root) {
      try {
        for (const dir of [realPath.join(root, ".xekute", "plan"), realPath.join(root, ".xekute", "plans")]) {
          const entries = realFs.existsSync(dir) ? realFs.readdirSync(dir) : [];
          for (const entry of entries) {
            if (entry.endsWith(".json")) {
              const id = entry.replace(/\.json$/, "");
              if (!plans.has(cacheKey(root, id))) loadPlan(root, id);
            }
          }
        }
      } catch {
        // Ignore read errors in listing.
      }
    }
    const visiblePlans = [...plans.entries()].filter(([key]) => key.startsWith(prefix)).map(([, plan]) => plan);
    return {
      ok: true,
      value: {
        operation: "list",
        count: visiblePlans.length,
        plans: visiblePlans.map((plan) => ({ id: plan.id, title: plan.title, taskCount: plan.tasks?.length || 0 })),
      },
    };
  }

  const adapter = {
    name: "manage_plan",
    inputSchema: MANAGE_PLAN_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(MANAGE_ERROR_CODES.INVALID_CONTEXT, "manage_plan requires a restricted tool execution context projection");
      }
      const root = executionContext.workspace?.root || null;

      switch (input.operation) {
        case "create": return createPlan(input, root);
        case "read": return readPlan(input, root);
        case "update": return updatePlan(input, root);
        case "delete": return deletePlan(input, root);
        case "list": return listPlans(root);
        default: return invalidInput(`unknown operation: ${input.operation}`);
      }
    },
  };

  return adapter;
}

module.exports = {
  MANAGE_PLAN_INPUT_SCHEMA,
  MANAGE_ERROR_CODES,
  createManagePlanTool,
  validateInput,
};
