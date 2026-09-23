"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildChildContextText, appendSteeringUpdate } = require("../src/agent/runtime/delegation-provider.js");
const { validateInput } = require("../src/agent/tools/process/delegate-agent.js");

test("labeled child context includes required sections", () => {
  const text = buildChildContextText(
    {
      task: "audit login",
      contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
      expectedOutput: { description: "report", format: "markdown" },
    },
    { invocationId: "parent-1", workspace: { root: "G:/ws" } },
  );
  assert.match(text, /## Objective/);
  assert.match(text, /## Return format \(required\)/);
  assert.match(text, /You must return output that matches the return format above/);
});

test("steering sections append in FIFO order", () => {
  const merged = appendSteeringUpdate("base", ["one", "two"]);
  assert.match(merged, /Steering update 1/);
  assert.match(merged, /Steering update 2/);
});

test("resolve_question validation does not require childInvocationId", () => {
  const result = validateInput({
    operation: "resolve_question",
    resolution: "skip",
  });
  assert.equal(result.ok, true);
});

test("main wires shared continuation dedupe helpers", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  assert.match(main, /scheduleParentContinuationKind/);
  assert.match(main, /scheduleParentQuestionContinuation/);
  assert.match(main, /scheduleReleasePendingEndTurn/);
});

test("bootstrap keeps parent turn open while orchestrationHold is true", () => {
  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  assert.match(bootstrap, /run\.orchestrationHold/);
  assert.match(bootstrap, /holdActive/);
  assert.match(bootstrap, /childEventLanes/);
});

test("escalated delegated questions surface in the orchestrator with a sub-agent label", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  assert.match(main, /type: "subagent_question_escalated"/);
  assert.match(main, /subagentLabel/);
  assert.match(bootstrap, /presentOrchestratorEscalatedQuestion/);
  assert.match(bootstrap, /subagentLabel/);
  assert.match(bootstrap, /agent-questions-subagent-label/);
  assert.match(bootstrap, /subagent_question_resolved[\s\S]*?dismissEscalatedQuestionSurfaces/);
  assert.match(bootstrap, /response\?\.requestId !== requestId/);
});

test("escalated delegated questions do not schedule parent question continuation", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  const escalateBranch = main.match(
    /if \(resolved\.resolution === "escalate"\) \{[\s\S]*?refreshParentOrchestrationFlags\(parentKey\);\s*return;/,
  );
  assert.ok(escalateBranch, "expected afterDelegatedQuestionResolved escalate branch");
  assert.doesNotMatch(escalateBranch[0], /scheduleParentQuestionContinuation/);
});

test("agent controller pauses for orchestration hold after tool rounds", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "controller", "agent-controller.js"), "utf8");
  assert.match(controller, /const holdActive = typeof orchestrationHold === "function" \? Boolean\(orchestrationHold\(\)\) : false;/);
  assert.match(controller, /if \(holdActive\) \{[\s\S]*?reason: "ORCHESTRATION_HOLD"/);
  assert.match(controller, /orchestrationControlOnly/);
});

test("main schedules control-only parent continuations while siblings remain active", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  assert.match(main, /controlOnly: subagentCoordinator\.hasActiveChildren\(key\)/);
  assert.match(main, /orchestrationControlOnly/);
});
