"use strict";

const path = require("node:path");

const TASK_LABELS = Object.freeze({
  ID: "id",
  Status: "status",
  "Depends on": "dependsOn",
  "Expected outcome": "expectedOutcome",
  "Allowed tools": "allowedTools",
  Targets: "targetRefs",
  "Argument constraints": "argumentConstraints",
  "Expected signals": "expectedSignals",
  "Rejecting signals": "rejectingSignals",
  Identity: "identityId",
  Identities: "identityIds",
  Page: "pageId",
  Execution: "execution",
  "Test case": "testCase",
  "Created at": "createdAt",
  "Updated at": "updatedAt",
});

const PLAN_LABELS = Object.freeze({
  "Plan ID": "id",
  Status: "status",
  "Linked hypothesis": "linkedHypothesis",
  "Allowed tools": "allowedTools",
  "Required evidence": "requiredEvidence",
  "Scope references": "scopeReferences",
  "Stop conditions": "stopConditions",
  "Argument constraints": "argumentConstraints",
  "Allowed identities": "allowedIdentityIds",
  "Maximum concurrency": "maximumConcurrency",
  "Requests per second": "requestsPerSecond",
  "Expected signals": "expectedSignals",
  "Rejecting signals": "rejectingSignals",
  "Execution hash": "executionHash",
  Approval: "approval",
  "Created at": "createdAt",
  "Updated at": "updatedAt",
  "Execution history": "executionHistory",
});

function oneLine(value = "") {
  return String(value == null ? "" : value).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function displayTitle(plan = {}) {
  const explicit = oneLine(plan.title || "");
  if (explicit) return explicit.replace(/^implementation plan:\s*/i, "");
  const objective = oneLine(plan.objective || "");
  return objective ? objective.slice(0, 120) : oneLine(plan.id || "Assessment");
}

function encoded(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function detail(lines, label, value, { omitEmpty = true } = {}) {
  const empty = value == null
    || value === ""
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0);
  if (omitEmpty && empty) return;
  lines.push(`  - **${label}:** ${encoded(value)}`);
}

function renderPlanMarkdown(plan = {}) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const lines = [
    `# Implementation Plan: ${displayTitle(plan)}`,
    "",
    "## Overview",
    "",
    String(plan.objective || "No overview was provided.").trim(),
    "",
    "## Tasks",
    "",
  ];

  tasks.forEach((task, index) => {
    const status = String(task?.status || "pending").toLowerCase();
    const checked = ["completed", "skipped"].includes(status) ? "x" : " ";
    lines.push(`- [${checked}] ${index + 1}. ${oneLine(task?.title || `Task ${index + 1}`)}`);
    detail(lines, "ID", String(task?.id || `step_${index + 1}`));
    detail(lines, "Status", status, { omitEmpty: false });
    detail(lines, "Depends on", task?.dependsOn || []);
    detail(lines, "Expected outcome", task?.expectedOutcome || "");
    detail(lines, "Allowed tools", task?.allowedTools || []);
    detail(lines, "Targets", task?.targetRefs || []);
    detail(lines, "Argument constraints", task?.argumentConstraints || {});
    detail(lines, "Expected signals", task?.expectedSignals || []);
    detail(lines, "Rejecting signals", task?.rejectingSignals || []);
    detail(lines, "Identity", task?.identityId || "");
    detail(lines, "Identities", task?.identityIds || []);
    detail(lines, "Page", task?.pageId && task.pageId !== "main" ? task.pageId : "");
    detail(lines, "Execution", task?.execution || {});
    detail(lines, "Test case", task?.testCase || null);
    detail(lines, "Created at", task?.createdAt || "");
    detail(lines, "Updated at", task?.updatedAt || "");
    lines.push("");
  });

  if (!tasks.length) lines.push("- [ ] 1. Define the first executable task", "");

  lines.push("## Plan Details", "");
  const planFields = [
    ["Plan ID", plan.id || "plan_1", false],
    ["Status", plan.status || "ready_for_review", false],
    ["Linked hypothesis", plan.linkedHypothesis || ""],
    ["Allowed tools", plan.allowedTools || []],
    ["Required evidence", plan.requiredEvidence || []],
    ["Scope references", plan.scopeReferences || []],
    ["Stop conditions", plan.stopConditions || []],
    ["Argument constraints", plan.argumentConstraints || {}],
    ["Allowed identities", plan.allowedIdentityIds || []],
    ["Maximum concurrency", Number(plan.maximumConcurrency) || 1, false],
    ["Requests per second", Number(plan.requestsPerSecond) || 1, false],
    ["Expected signals", plan.expectedSignals || []],
    ["Rejecting signals", plan.rejectingSignals || []],
    ["Execution hash", plan.executionHash || ""],
    ["Approval", plan.approval || { status: "unapproved", contentHash: "", approvedAt: "", approvedBy: "" }, false],
    ["Created at", plan.createdAt || ""],
    ["Updated at", plan.updatedAt || ""],
    ["Execution history", plan.executionHistory || []],
  ];
  for (const [label, value, omitEmpty = true] of planFields) {
    const temp = [];
    detail(temp, label, value, { omitEmpty });
    if (temp.length) lines.push(temp[0].replace(/^  /, ""));
  }
  return `${lines.join("\n").trim()}\n`;
}

function decoded(value = "") {
  const source = String(value || "").trim();
  if (!source) return "";
  try { return JSON.parse(source); } catch { return source.replace(/^`|`$/g, ""); }
}

function parsePlanMarkdown(markdown = "") {
  const source = String(markdown || "");
  const lines = source.split(/\r?\n/);
  const plan = { tasks: [] };
  let section = "";
  let currentTask = null;
  const overview = [];

  for (const line of lines) {
    const title = line.match(/^#\s+Implementation Plan:\s*(.+?)\s*$/i);
    if (title) { plan.title = oneLine(title[1]); continue; }
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1].trim().toLowerCase();
      currentTask = null;
      continue;
    }
    if (section === "overview") {
      overview.push(line);
      continue;
    }
    if (section === "tasks") {
      const taskLine = line.match(/^-\s+\[([ xX])\]\s+(?:\d+\.\s*)?(.+?)\s*$/);
      if (taskLine) {
        currentTask = { title: oneLine(taskLine[2]), status: taskLine[1].toLowerCase() === "x" ? "completed" : "pending" };
        plan.tasks.push(currentTask);
        continue;
      }
      const field = line.match(/^\s{2,}-\s+\*\*(.+?):\*\*\s*(.*?)\s*$/);
      if (field && currentTask && TASK_LABELS[field[1]]) currentTask[TASK_LABELS[field[1]]] = decoded(field[2]);
      continue;
    }
    if (section === "plan details") {
      const field = line.match(/^-\s+\*\*(.+?):\*\*\s*(.*?)\s*$/);
      if (field && PLAN_LABELS[field[1]]) plan[PLAN_LABELS[field[1]]] = decoded(field[2]);
    }
  }

  plan.objective = overview.join("\n").trim() || plan.title || "";
  plan.id = oneLine(plan.id || "");
  plan.linkedHypothesis = oneLine(plan.linkedHypothesis || "");
  plan.allowedTools = Array.isArray(plan.allowedTools) ? plan.allowedTools.map(String) : [];
  plan.requiredEvidence = Array.isArray(plan.requiredEvidence) ? plan.requiredEvidence.map(String) : [];
  plan.scopeReferences = Array.isArray(plan.scopeReferences) ? plan.scopeReferences.map(String) : [];
  plan.stopConditions = Array.isArray(plan.stopConditions) ? plan.stopConditions.map(String) : [];
  plan.argumentConstraints = plan.argumentConstraints && typeof plan.argumentConstraints === "object" && !Array.isArray(plan.argumentConstraints) ? plan.argumentConstraints : {};
  plan.allowedIdentityIds = Array.isArray(plan.allowedIdentityIds) ? plan.allowedIdentityIds.map(String) : [];
  plan.maximumConcurrency = Number(plan.maximumConcurrency) || 1;
  plan.requestsPerSecond = Number(plan.requestsPerSecond) || 1;
  plan.expectedSignals = Array.isArray(plan.expectedSignals) ? plan.expectedSignals.map(String) : [];
  plan.rejectingSignals = Array.isArray(plan.rejectingSignals) ? plan.rejectingSignals.map(String) : [];
  plan.executionHistory = Array.isArray(plan.executionHistory) ? plan.executionHistory : [];
  plan.tasks = plan.tasks.map((task, index) => ({
    ...task,
    id: oneLine(task.id || `step_${index + 1}`),
    title: oneLine(task.title || `Task ${index + 1}`),
    status: oneLine(task.status || "pending"),
    dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn.map(String) : [],
    allowedTools: Array.isArray(task.allowedTools) ? task.allowedTools.map(String) : [],
    targetRefs: Array.isArray(task.targetRefs) ? task.targetRefs.map(String) : [],
    argumentConstraints: task.argumentConstraints && typeof task.argumentConstraints === "object" && !Array.isArray(task.argumentConstraints) ? task.argumentConstraints : {},
    expectedSignals: Array.isArray(task.expectedSignals) ? task.expectedSignals.map(String) : [],
    rejectingSignals: Array.isArray(task.rejectingSignals) ? task.rejectingSignals.map(String) : [],
    identityId: oneLine(task.identityId || ""),
    identityIds: Array.isArray(task.identityIds) ? task.identityIds.map(String) : [],
    pageId: oneLine(task.pageId || "main") || "main",
    execution: task.execution && typeof task.execution === "object" && !Array.isArray(task.execution) ? task.execution : { mode: "single", repetitions: 1 },
  }));
  return plan;
}

function planMarkdownPath(workspace, id) {
  return path.join(path.resolve(String(workspace || "")), ".xekute", "plans", `${oneLine(id)}.md`);
}

module.exports = { displayTitle, parsePlanMarkdown, planMarkdownPath, renderPlanMarkdown };
