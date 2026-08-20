"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { createUpdateTaskListTool, normalizeInput } = require("../src/agent/tools/process/update-task-list.js");

function context() {
  return projectExecutionContext(createExecutionContext({
    invocationId: "task-list-test",
    toolName: "update_task_list",
    role: "agent",
    authority: "ask_for_approval",
    workspace: { root: path.resolve(".") },
    sessionId: "session-1",
    mode: "agent",
  }));
}

test("task-list updates stay short and sequential", async () => {
  const input = {
    explanation: "Starting the larger implementation",
    tasks: [
      { id: "inspect", title: "Inspect the current implementation", status: "completed" },
      { id: "change", title: "Implement the focused change", status: "in_progress" },
      { id: "verify", title: "Run focused verification", status: "pending" },
    ],
  };
  const result = await createUpdateTaskListTool().execute(input, context());
  assert.equal(result.ok, true);
  assert.equal(result.value.currentIndex, 1);
  assert.equal(result.value.completed, false);
  assert.deepEqual(result.value.tasks, input.tasks);
});

test("task-list validation rejects parallel or out-of-order progress", () => {
  assert.equal(normalizeInput({ tasks: [
    { id: "a", title: "A", status: "in_progress" },
    { id: "b", title: "B", status: "in_progress" },
  ] }).ok, false);
  assert.equal(normalizeInput({ tasks: [
    { id: "a", title: "A", status: "pending" },
    { id: "b", title: "B", status: "in_progress" },
  ] }).error.code, "NON_SEQUENTIAL_TASK_LIST");
});

test("a fully completed task list reports completion for immediate UI removal", async () => {
  const result = await createUpdateTaskListTool().execute({ tasks: [
    { id: "a", title: "A", status: "completed" },
    { id: "b", title: "B", status: "completed" },
  ] }, context());
  assert.equal(result.ok, true);
  assert.equal(result.value.completed, true);
});
