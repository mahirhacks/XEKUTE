"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SkillRouter = require("../src/agent/runtime/skill-router.js");
const { defaultRegistry } = require("../src/prompts/skills/internal/registry.js");

test("automatic candidates are mode- and tool-eligible, excluding command skills", () => {
  const manifests = [
    { id: "create-rule", title: "System rule", description: "System", modes: ["agent"] },
    { id: "read-only", title: "Read only", description: "Ask-only", modes: ["ask"] },
    { id: "needs-browser", title: "Browser", description: "Needs browser", modes: ["agent"], requiredTools: ["browser_action"] },
    { id: "eligible", title: "Eligible", description: "Short help", modes: ["agent"] },
  ];
  const cards = SkillRouter.automaticSkillCards(manifests, "agent", [{ function: { name: "read_file" } }]);
  assert.deepEqual(cards.map(({ id }) => id), ["eligible"]);
  assert.deepEqual(SkillRouter.selectSkillIds({ eligible: 0.69, unknown: 1 }, { allowedIds: ["eligible"], threshold: 0.7 }), []);
  assert.deepEqual(SkillRouter.selectSkillIds({ zed: 0.9, alpha: 0.9, eligible: 0.7 }, { allowedIds: ["zed", "alpha", "eligible"], activeIds: ["eligible"], maxSkills: 2 }), ["alpha", "zed"]);
});

test("automatic registry contains the sixteen special skills and excludes three command skills", () => {
  const manifests = defaultRegistry.listInternal();
  const automaticIds = manifests.map(({ id }) => id).filter((id) => !SkillRouter.AUTOMATIC_SKILL_EXCLUSIONS.has(id));
  assert.equal(manifests.length, 19);
  assert.equal(automaticIds.length, 16);
  assert.deepEqual(
    manifests.map(({ id }) => id).filter((id) => !automaticIds.includes(id)).sort(),
    ["create-rule", "create-skill", "create-subagent"],
  );
});

test("recent decision context excludes checklist bodies and keeps remaining tool exchanges complete", () => {
  const history = [
    { role: "user", content: "Request body plus appended scope context", source_message_id: "current-task", task_revision: 4 },
    {
      role: "assistant",
      content: "Checklist and file read",
      tool_calls: [
        { id: "check-1", type: "function", function: { name: "manage_task_checklist", arguments: JSON.stringify({ action: "create", items: [{ id: "secret-checklist-label" }] }) } },
        { id: "read-1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.md" }) } },
      ],
    },
    { role: "tool", tool_name: "manage_task_checklist", tool_call_id: "check-1", content: "secret-checklist-label" },
    { role: "tool", tool_name: "read_file", tool_call_id: "read-1", content: "Safe file excerpt", source_message_id: "tool-result-1", task_revision: 3 },
    { role: "assistant", content: "Recent summary" },
  ];
  const recent = SkillRouter.clipRecentTurns(history, { excludeMessageIds: ["current-task"] });
  assert.equal(recent.some((message) => message.source_message_id === "current-task"), false);
  assert.equal(recent.some((message) => message.content.includes("secret-checklist-label")), false);
  assert.equal(recent.some((message) => message.tool_calls?.some((call) => call.name === "manage_task_checklist")), false);
  const assistantCalls = recent.find((message) => message.role === "assistant" && message.tool_calls?.length);
  assert.deepEqual(assistantCalls.tool_calls.map((call) => call.id), ["read-1"]);
  assert.ok(recent.some((message) => message.role === "tool" && message.tool_call_id === "read-1"));
  assert.ok(recent.some((message) => message.source_message_id === "tool-result-1" && message.task_revision === 3), "remaining provenance stays attached to messages");
  assert.equal(recent.some((message) => message.role === "tool" && message.tool_call_id === "check-1"), false);
});

test("recent decision context drops incomplete tool exchanges", () => {
  const recent = SkillRouter.clipRecentTurns([
    { role: "assistant", content: "Calling a tool", tool_calls: [{ id: "unfinished", function: { name: "read_file", arguments: "{}" } }] },
    { role: "user", content: "Steering arrived before the result." },
    { role: "tool", tool_call_id: "unfinished", content: "late result" },
  ]);
  assert.equal(recent.some((message) => message.tool_calls?.some((call) => call.id === "unfinished")), false);
  assert.equal(recent.some((message) => message.role === "tool" && message.tool_call_id === "unfinished"), false);
  assert.ok(recent.some((message) => message.content === "Steering arrived before the result."));
});

test("recent decision context keeps empty-text tool calls paired and drops orphan results", () => {
  const recent = SkillRouter.clipRecentTurns([
    { role: "tool", tool_call_id: "orphan", content: "Unmatched old result" },
    { role: "assistant", content: "", tool_calls: [{ id: "read", function: { name: "read_file", arguments: '{"path":"notes.md"}' } }] },
    { role: "tool", tool_call_id: "read", content: "Observed application behavior" },
  ]);
  assert.deepEqual(recent.map(message => message.role), ["assistant", "tool"]);
  assert.equal(recent[0].tool_calls[0].id, "read");
  assert.equal(recent[1].tool_call_id, "read");
});

test("frozen acceptance suite and legacy baseline contain twenty cases and eight comparisons", () => {
  const fixtureRoot = path.join(__dirname, "fixtures", "skill-router");
  const frozen = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "cases.json"), "utf8"));
  const baseline = JSON.parse(fs.readFileSync(path.join(fixtureRoot, "baseline.json"), "utf8"));
  assert.equal(frozen.cases.length, 20);
  assert.equal(frozen.comparisonCaseIds.length, 8);
  assert.equal(baseline.cases.length, 20);
  assert.equal(baseline.branch, "feature/skill-router");
  assert.match(frozen.description, /not expert-reviewed ground truth/i);
});
