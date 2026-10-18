"use strict";
const crypto = require("node:crypto");

const TASK_STATUSES = new Set(["running", "waiting", "completed", "failed", "stopped", "inconclusive"]);
function invalid(code, message) { throw Object.assign(new Error(message), { code }); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function id(value) { return typeof value === "string" && /^[a-zA-Z0-9:_./-]{1,240}$/.test(value); }
function stableIntentId(messageId, start, end) { return `intent:${crypto.createHash("sha256").update(JSON.stringify([messageId, start, end])).digest("hex").slice(0, 32)}`; }
function validateIntents(input, intents) {
  if (!Array.isArray(intents) || !intents.length) invalid("SESSION_INTENT_INVALID", "A compound route needs a complete source partition.");
  let end = 0;
  for (const intent of intents) {
    if (!integer(intent.start) || !integer(intent.end) || intent.start !== end || intent.end <= intent.start || intent.end > input.text.length
      || intent.id !== stableIntentId(input.id, intent.start, intent.end) || !id(intent.taskId)) invalid("SESSION_INTENT_INVALID", "Intent spans must cover the exact source in order without gaps or overlaps.");
    end = intent.end;
  }
  if (end !== input.text.length) invalid("SESSION_INTENT_INVALID", "Every source character must belong to a recorded intent.");
  return intents;
}
function scopeFor(input, intents) { return intents.map(({ id, start, end }) => ({ id, messageId: input.id, start, end })); }
function emptyRunControl() {
  return { version: 1, arrival: 0, routed: 0, cancellationEpoch: 0, activeTaskId: "", inputs: [], routes: [], tasks: [], dispatches: [] };
}
function normalizeRunControl(value) {
  if (value === undefined || value === null) return emptyRunControl();
  const state = JSON.parse(JSON.stringify(value));
  if (state.version !== 1 || !integer(state.arrival) || !integer(state.routed) || state.routed > state.arrival || !integer(state.cancellationEpoch)
    || !Array.isArray(state.inputs) || !Array.isArray(state.routes) || !Array.isArray(state.tasks) || !Array.isArray(state.dispatches)
    || state.inputs.length !== state.arrival || state.routes.length !== state.routed) invalid("SESSION_CONTROL_INVALID", "The durable session control state is invalid.");
  const seen = new Set();
  for (const [index, entry] of state.inputs.entries()) {
    if (!id(entry.id) || seen.has(entry.id) || entry.sequence !== index + 1 || typeof entry.text !== "string" || !entry.text.trim() || entry.text.length > 100000
      || (entry.targetTaskId && !id(entry.targetTaskId)) || (entry.contextText !== undefined && (typeof entry.contextText !== "string" || entry.contextText.length > 1_000_000))) invalid("SESSION_INPUT_INVALID", "The durable input journal is invalid.");
    seen.add(entry.id);
  }
  const tasks = new Set();
  const runIds = new Set();
  const taskById = new Map();
  const deliveryKeys = new Set();
  for (const task of state.tasks) {
    if (!id(task.id) || tasks.has(task.id) || !id(task.runId) || runIds.has(task.runId) || !integer(task.revision) || !integer(task.appliedRevision) || task.appliedRevision > task.revision
      || !TASK_STATUSES.has(task.status) || !Array.isArray(task.deliveries) || !["primary", "independent", "dependent"].includes(task.kind)) invalid("SESSION_TASK_INVALID", "The durable task map is invalid.");
    tasks.add(task.id);
    runIds.add(task.runId);
    taskById.set(task.id, task);
    if (task.deliveries.some((delivery) => !seen.has(delivery.messageId) || !integer(delivery.revision) || delivery.revision > task.revision)) invalid("SESSION_DELIVERY_INVALID", "The task delivery references are invalid.");
    for (const delivery of task.deliveries) {
      const key = `${task.id}|${delivery.messageId}|${delivery.revision}`;
      if (deliveryKeys.has(key)) invalid("SESSION_DELIVERY_INVALID", "The task delivery is duplicated.");
      deliveryKeys.add(key);
    }
  }
  if (state.activeTaskId && !tasks.has(state.activeTaskId)) invalid("SESSION_TASK_INVALID", "The active task does not exist.");
  if (state.tasks.some((task) => task.dependencyOfTaskId && (!tasks.has(task.dependencyOfTaskId) || task.dependencyOfTaskId === task.id))) invalid("SESSION_DEPENDENCY_INVALID", "The task dependency does not exist or points to itself.");
  if (state.tasks.filter((task) => task.kind === "primary" && ["running", "waiting"].includes(task.status)).length > 1) invalid("SESSION_TASK_INVALID", "A session can have only one running main task.");
  const blocks = state.tasks.map((task) => task.blockId).filter(Boolean);
  if (new Set(blocks).size !== blocks.length) invalid("SESSION_TASK_INVALID", "A transcript block can belong to only one task.");
  for (const task of state.tasks) {
    const ancestors = new Set([task.id]);
    let parentId = task.dependencyOfTaskId;
    while (parentId) {
      if (ancestors.has(parentId)) invalid("SESSION_DEPENDENCY_INVALID", "Task dependencies cannot form a cycle.");
      ancestors.add(parentId);
      parentId = taskById.get(parentId)?.dependencyOfTaskId;
    }
    if (task.pendingPlan && (!id(task.pendingPlan.id) || task.pendingPlan.taskId !== task.id || task.pendingPlan.revision !== task.revision)) invalid("SESSION_PLAN_INVALID", "The saved plan belongs to an obsolete task revision or has no identity.");
    if (task.pendingExecution && (!id(task.pendingExecution.id) || task.pendingExecution.taskId !== task.id || !integer(task.pendingExecution.revision) || task.pendingExecution.revision > task.revision)) invalid("SESSION_PLAN_INVALID", "The in-flight execution round has an invalid identity or revision.");
  }
  const routedKeys = new Set();
  for (const [index, route] of state.routes.entries()) {
    const input = state.inputs[index];
    if (route.messageId !== input.id || route.sequence !== index + 1) invalid("SESSION_ROUTE_INVALID", "The durable route does not match its original input.");
    const destinations = route.intents === undefined ? [route] : validateIntents(input, route.intents);
    if (route.intents && (route.taskId !== destinations[0].taskId || route.revision !== destinations[0].revision)) invalid("SESSION_ROUTE_INVALID", "The route's primary destination does not match its intents.");
    for (const taskId of new Set(destinations.map((entry) => entry.taskId))) {
      const assigned = destinations.filter((entry) => entry.taskId === taskId);
      const revision = assigned[0].revision;
      const key = `${taskId}|${route.messageId}|${revision}`;
      const task = taskById.get(taskId);
      if (!task || !integer(revision) || revision < 1 || assigned.some((entry) => entry.revision !== revision)
        || (input.targetTaskId && input.targetTaskId !== taskId) || !deliveryKeys.has(key) || routedKeys.has(key)) invalid("SESSION_ROUTE_INVALID", "The durable route has no matching task delivery.");
      const delivery = task.deliveries.find((entry) => entry.messageId === input.id && entry.revision === revision);
      if (route.intents && (JSON.stringify(delivery.intentIds) !== JSON.stringify(assigned.map((entry) => entry.id))
        || JSON.stringify(delivery.intentScope) !== JSON.stringify(scopeFor(input, assigned)))) invalid("SESSION_INTENT_INVALID", "The delivery does not preserve its source intents.");
      if (!route.intents && (delivery.intentIds || delivery.intentScope)) invalid("SESSION_INTENT_INVALID", "The delivery has no recorded source intents.");
      routedKeys.add(key);
    }
  }
  for (const task of state.tasks) {
    if (task.deliveries.length !== task.revision || task.deliveries.some((delivery, index) => delivery.revision !== index + 1
      || !routedKeys.has(`${task.id}|${delivery.messageId}|${delivery.revision}`))) invalid("SESSION_DELIVERY_INVALID", "Task revisions and deliveries must form one contiguous route history.");
    const scopes = task.deliveries.flatMap((delivery) => delivery.intentScope || []);
    if (JSON.stringify(task.intentScope || []) !== JSON.stringify(scopes)) invalid("SESSION_INTENT_INVALID", "The task scope does not match its durable intent deliveries.");
  }
  const dispatchIds = new Set();
  if (state.dispatches.some((dispatch) => {
    if (!id(dispatch.id) || dispatchIds.has(dispatch.id) || !tasks.has(dispatch.taskId) || !["pending", "running", "waiting", "completed", "failed"].includes(dispatch.status)) return true;
    dispatchIds.add(dispatch.id); return false;
  })) invalid("SESSION_DISPATCH_INVALID", "The dispatch journal is invalid.");
  // Independent tasks no longer have a runtime. Saved ones that never finished
  // end as stopped so nothing waits on them.
  const independent = new Set(state.tasks.filter((task) => task.kind === "independent").map((task) => task.id));
  for (const task of state.tasks) if (independent.has(task.id) && ["running", "waiting"].includes(task.status)) task.status = "stopped";
  for (const dispatch of state.dispatches) if (independent.has(dispatch.taskId) && ["pending", "running", "waiting"].includes(dispatch.status)) dispatch.status = "failed";
  return state;
}
function validateInput(input) {
  if (!input || !id(input.id) || typeof input.text !== "string" || !input.text.trim() || input.text.length > 100000 || (input.targetTaskId && !id(input.targetTaskId))) invalid("SESSION_INPUT_INVALID", "A stable message ID and a nonempty prompt of at most 100000 characters are required.");
  if (input.contextText !== undefined && (typeof input.contextText !== "string" || input.contextText.length > 1_000_000)) invalid("SESSION_INPUT_INVALID", "The referenced chat context is invalid.");
  return { id: input.id, text: input.text, targetTaskId: input.targetTaskId || "", ...(input.contextText ? { contextText: input.contextText } : {}) };
}
function receiveInput(state, input, now = new Date().toISOString()) {
  const validated = validateInput(input);
  const prior = state.inputs.find((entry) => entry.id === validated.id);
  if (prior) {
    if (prior.text !== validated.text || (prior.targetTaskId || "") !== validated.targetTaskId) invalid("MESSAGE_ID_CONFLICT", "This message ID was already used for different input.");
    return { messageId: prior.id, sequence: prior.sequence, duplicate: true, status: prior.sequence <= state.routed ? "accepted" : "received" };
  }
  const entry = { ...validated, sequence: ++state.arrival, receivedAt: now };
  state.inputs.push(entry);
  return { messageId: entry.id, sequence: entry.sequence, duplicate: false, status: "received" };
}
function createTask({ taskId = `task:${crypto.randomUUID()}`, runId = `run:${crypto.randomUUID()}`, kind = "primary", objective = "", binding = {}, blockId = "", dependencyOfTaskId = "" } = {}) {
  const bindingKeys = ["provider", "model", "thinking", "numCtx", "reasoningEffort", "authorityProfile", "mode", "modeFamily", "contextPlan"];
  const executionBinding = Object.fromEntries(bindingKeys.filter((key) => binding[key] !== undefined).map((key) => [key, binding[key]]));
  return { id: taskId, runId, kind, objective, binding: executionBinding, blockId, dependencyOfTaskId, status: "running", revision: 0, appliedRevision: 0, deliveries: [], engine: null, completionIntent: null };
}
function acceptRoutes(state, { expectedRouted, cancellationEpoch, routes, tasks = [], settingsRevision = 0, plan = null, planningTaskId = "" } = {}) {
  if (state.routed !== expectedRouted || state.cancellationEpoch !== cancellationEpoch) invalid("ROUTING_SNAPSHOT_STALE", "The session changed before routing could be accepted.");
  if (!Array.isArray(routes) || !routes.length || state.routed + routes.length > state.arrival) invalid("SESSION_ROUTE_INVALID", "A contiguous unread input batch is required.");
  for (const task of tasks) {
    if (state.tasks.some((existing) => existing.id === task.id || existing.runId === task.runId)) invalid("SESSION_TASK_CONFLICT", "The task or run identity already exists.");
    if (task.kind === "primary" && state.tasks.some((existing) => existing.kind === "primary" && ["running", "waiting"].includes(existing.status))) invalid("PRIMARY_TASK_BUSY", "The session already has a running main task.");
    state.tasks.push(task);
    if (task.kind === "primary") state.activeTaskId = task.id;
    else state.dispatches.push({ id: `dispatch:${task.id}`, taskId: task.id, status: "pending" });
  }
  const expectedRevisions = new Map();
  for (const [index, route] of routes.entries()) {
    const input = state.inputs[state.routed + index];
    if (route.messageId !== input.id) invalid("SESSION_ROUTE_INVALID", "Routing must preserve original input order.");
    const destinations = route.intents === undefined ? [route] : validateIntents(input, route.intents);
    for (const destination of destinations) {
      const task = state.tasks.find((entry) => entry.id === destination.taskId);
      const cancelled = !route.intents && route.method === "cancelled" && input.targetTaskId === task?.id && ["stopped", "completed", "failed", "inconclusive"].includes(task?.status);
      if (!task || (input.targetTaskId && input.targetTaskId !== task.id) || (!cancelled && !["running", "waiting"].includes(task.status))) invalid("SESSION_ROUTE_INVALID", "Routing must deliver original input to its permitted runnable task.");
      const expected = expectedRevisions.get(task.id) ?? task.revision;
      if (destination.expectedRevision !== expected) invalid("TASK_REVISION_STALE", "The destination task changed before routing could be accepted.");
      expectedRevisions.set(task.id, expected);
    }
  }
  const deliveries = [];
  for (const route of routes) {
    const input = state.inputs[state.routed];
    const destinations = route.intents || [route];
    const acceptedIntents = [];
    const sourceDeliveries = [];
    for (const taskId of new Set(destinations.map((entry) => entry.taskId))) {
      const task = state.tasks.find((entry) => entry.id === taskId);
      const assigned = destinations.filter((entry) => entry.taskId === taskId);
      task.revision += 1;
      const dispatch = state.dispatches.find((entry) => entry.taskId === task.id);
      if (dispatch?.status === "waiting") dispatch.status = "pending";
      task.completionIntent = null;
      delete task.pendingPlan;
      const scope = route.intents ? scopeFor(input, assigned) : null;
      const delivery = { messageId: input.id, revision: task.revision, ...(scope ? { intentIds: assigned.map((entry) => entry.id), intentScope: scope } : {}) };
      task.deliveries.push(delivery);
      if (scope) task.intentScope = [...(task.intentScope || []), ...scope];
      sourceDeliveries.push({ ...delivery, taskId: task.id, sequence: input.sequence, settingsRevision, method: route.method || "orchestrator", ...(route.hint ? { hint: route.hint } : {}) });
      if (route.intents) acceptedIntents.push(...assigned.map(({ id, start, end }) => ({ id, start, end, taskId, revision: task.revision })));
    }
    const primary = sourceDeliveries[0];
    state.routes.push({ messageId: input.id, sequence: input.sequence, taskId: primary.taskId, revision: primary.revision, settingsRevision, method: route.method || "orchestrator", ...(route.hint ? { hint: route.hint } : {}),
      ...(route.intents ? { intents: acceptedIntents.sort((left, right) => left.start - right.start) } : {}) });
    deliveries.push(...sourceDeliveries);
    state.routed += 1;
  }
  if (plan) {
    const task = state.tasks.find((entry) => entry.id === plan.taskId);
    const expectedMessages = task?.deliveries.filter((delivery) => delivery.revision > task.appliedRevision).map((delivery) => delivery.messageId) || [];
    if (!id(plan.id) || !task || !["running", "waiting"].includes(task.status) || plan.taskId !== (planningTaskId || state.activeTaskId) || plan.revision !== task.revision
      || !Array.isArray(plan.messageIds) || JSON.stringify(plan.messageIds) !== JSON.stringify(expectedMessages)) invalid("SESSION_PLAN_INVALID", "The supplied plan does not match the planning task, revision and deliveries.");
    task.pendingPlan = plan;
  }
  return { routed: state.routed, deliveries };
}

module.exports = { emptyRunControl, normalizeRunControl, validateInput, receiveInput, createTask, acceptRoutes, stableIntentId };
