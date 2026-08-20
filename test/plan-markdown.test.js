"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePlanMarkdown, renderPlanMarkdown } = require("../src/shared/plan-markdown.js");

test("plan records round-trip as a human-readable Markdown checklist", () => {
  const plan = {
    id: "plan_7",
    title: "Stable updater flow",
    objective: "Ship a reliable update experience without mixing development artifacts into releases.",
    status: "ready_for_review",
    tasks: [
      { id: "inspect", title: "Inspect updater state", status: "completed", allowedTools: ["read_file"] },
      { id: "fix", title: "Implement update handling", status: "pending", dependsOn: ["inspect"], expectedOutcome: "Updates install seamlessly" },
    ],
    allowedTools: ["read_file", "apply_patch"],
    maximumConcurrency: 1,
    requestsPerSecond: 1,
    executionHash: "hash-1",
    approval: { status: "unapproved", contentHash: "", approvedAt: "", approvedBy: "" },
  };
  const markdown = renderPlanMarkdown(plan);
  assert.match(markdown, /^# Implementation Plan: Stable updater flow/m);
  assert.match(markdown, /^## Overview$/m);
  assert.match(markdown, /^- \[x\] 1\. Inspect updater state$/m);
  assert.match(markdown, /^- \[ \] 2\. Implement update handling$/m);
  const parsed = parsePlanMarkdown(markdown);
  assert.equal(parsed.id, "plan_7");
  assert.equal(parsed.tasks[0].status, "completed");
  assert.deepEqual(parsed.tasks[1].dependsOn, ["inspect"]);
  assert.deepEqual(parsed.allowedTools, ["read_file", "apply_patch"]);
});
