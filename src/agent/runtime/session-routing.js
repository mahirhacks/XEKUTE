"use strict";
const crypto = require("node:crypto");

function stableTaskId(sessionId, messageId) { return `task:${crypto.createHash("sha256").update(`${sessionId}|${messageId}`).digest("hex").slice(0, 32)}`; }
function runnable(task) { return Boolean(task) && ["running", "waiting"].includes(task.status); }
function routeTo(input, task, method) { return { messageId: input.id, taskId: task.id, expectedRevision: task.revision, method }; }

// Every unread message goes to the main task, which decides whether it changes
// the current work or is a separate request to delegate. A message sent inside
// a delegated child's chat steers that child.
function routeSessionInput(snapshot) {
  const tasks = new Map(snapshot.control.tasks.map((task) => [task.id, task]));
  const main = tasks.get(snapshot.planningTaskId);
  if (!runnable(main)) return { ok: false, code: "ROUTING_PLAN_INVALID", error: "The planning task is no longer runnable." };
  const routes = snapshot.batch.map((input) => {
    const target = input.targetTaskId ? tasks.get(input.targetTaskId) : null;
    if (!target) return routeTo(input, main, "main");
    return routeTo(input, target, runnable(target) ? "explicit" : "cancelled");
  });
  return { ok: true, routes, tasks: [], plan: null };
}

module.exports = { stableTaskId, routeSessionInput };
