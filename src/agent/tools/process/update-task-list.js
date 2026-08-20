"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const TASK_STATUSES = Object.freeze(["pending", "in_progress", "completed", "blocked"]);
const UPDATE_TASK_LIST_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["tasks"],
  properties: {
    explanation: { type: "string", description: "One short reason for the task-list update." },
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        required: ["id", "title", "status"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: TASK_STATUSES },
        },
      },
    },
  },
});

function failure(message, code = "INVALID_TASK_LIST") {
  return { ok: false, error: { code, message, retryable: false } };
}

function normalizeInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return failure("Task-list input must be an object.");
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > 20) return failure("A task list must contain between 1 and 20 concise tasks.");
  const ids = new Set();
  const tasks = [];
  let activeCount = 0;
  let pendingSeen = false;
  for (let index = 0; index < input.tasks.length; index += 1) {
    const task = input.tasks[index];
    if (!task || typeof task !== "object" || Array.isArray(task)) return failure(`tasks[${index}] must be an object.`);
    const id = String(task.id || "").trim().slice(0, 80);
    const title = String(task.title || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    const status = String(task.status || "").trim();
    if (!id || !title || !TASK_STATUSES.includes(status)) return failure(`tasks[${index}] requires a unique id, concise title, and valid status.`);
    if (ids.has(id)) return failure(`Duplicate task id: ${id}.`);
    ids.add(id);
    if (status === "in_progress" || status === "blocked") activeCount += 1;
    if (pendingSeen && (status === "in_progress" || status === "blocked")) return failure("The active task must appear before pending tasks so execution remains sequential.", "NON_SEQUENTIAL_TASK_LIST");
    if (status === "pending") pendingSeen = true;
    if (pendingSeen && status === "completed") return failure("Completed tasks must stay before pending tasks so execution remains sequential.", "NON_SEQUENTIAL_TASK_LIST");
    tasks.push({ id, title, status });
  }
  if (activeCount > 1) return failure("Only one task may be in progress or blocked at a time.", "NON_SEQUENTIAL_TASK_LIST");
  return { ok: true, value: { explanation: String(input.explanation || "").trim().slice(0, 240), tasks } };
}

function createUpdateTaskListTool() {
  return {
    name: "update_task_list",
    description: "Create or update the short, temporary UI checklist for an Agent task that naturally requires at least four meaningful steps. Proactively use 4–7 concise items for such work, keep execution sequential, and do not use it for 1–3-step requests. Approved saved plans may retain their exact task count.",
    inputSchema: UPDATE_TASK_LIST_INPUT_SCHEMA,
    async execute(input, executionContext) {
      if (!isRestrictedToolContext(executionContext)) return failure("update_task_list requires a restricted tool execution context.", "INVALID_EXECUTION_CONTEXT");
      const normalized = normalizeInput(input);
      if (!normalized.ok) return normalized;
      const tasks = normalized.value.tasks;
      const completed = tasks.length > 0 && tasks.every((task) => task.status === "completed");
      const currentIndex = tasks.findIndex((task) => task.status === "in_progress" || task.status === "blocked" || task.status === "pending");
      return {
        ok: true,
        value: {
          ...normalized.value,
          completed,
          currentIndex: currentIndex < 0 ? tasks.length - 1 : currentIndex,
          total: tasks.length,
        },
      };
    },
  };
}

module.exports = { TASK_STATUSES, UPDATE_TASK_LIST_INPUT_SCHEMA, createUpdateTaskListTool, normalizeInput };
