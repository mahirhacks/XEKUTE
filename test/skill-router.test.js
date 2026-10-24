"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SkillRouter = require("../src/agent/runtime/skill-router.js");
const { defaultRegistry } = require("../src/prompts/skills/internal/registry.js");

const item = (id, overrides = {}) => ({ id, label: `Review ${id}`, description: `Inspect supplied evidence for ${id}.`, status: "pending", ...overrides });
const create = (items = [item("one")], extra = {}) => ({ action: "create", main_goal: "Review supplied evidence safely", items, ...extra });

test("checklist creation enforces its compact contract and word limits", () => {
  assert.equal(SkillRouter.applyChecklistOperation(null, create()).ok, true);
  const tooLongLabel = item("one", { label: "one two three four five six seven eight nine ten eleven twelve thirteen" });
  const tooLongDescription = item("one", { description: Array.from({ length: 41 }, (_, index) => `word${index}`).join(" ") });
  assert.equal(SkillRouter.applyChecklistOperation(null, create([tooLongLabel])).code, "CHECKLIST_INVALID");
  assert.equal(SkillRouter.applyChecklistOperation(null, create([tooLongDescription])).code, "CHECKLIST_INVALID");
  assert.equal(SkillRouter.applyChecklistOperation(null, create([item(" ")])).code, "CHECKLIST_INVALID");
  assert.equal(SkillRouter.applyChecklistOperation(null, create([item("same"), item("same")])).code, "CHECKLIST_INVALID");
  assert.equal(SkillRouter.applyChecklistOperation(null, create([item("one", { extra: "not allowed" })])).code, "CHECKLIST_INVALID");
});

test("checklist updates merge atomically, require complete new items, and reject conflicts", () => {
  const initial = SkillRouter.applyChecklistOperation(null, create([item("one"), item("two")])).value;
  const updated = SkillRouter.applyChecklistOperation(initial, {
    action: "update",
    main_goal: "Review only confirmed evidence",
    items: [{ id: "one", status: "in_progress" }, item("three")],
    remove_ids: ["two"],
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.value.main_goal, "Review only confirmed evidence");
  assert.deepEqual(updated.value.items.map(({ id }) => id), ["one", "three"]);
  assert.equal(updated.value.items[0].label, initial.items[0].label);
  assert.equal(updated.value.items[0].status, "in_progress");

  for (const bad of [
    { action: "update", items: [{ id: "new", label: "Incomplete" }] },
    { action: "update", items: [{ id: "one", label: "One" }, { id: "one", status: "blocked" }] },
    { action: "update", items: [{ id: "one", status: "unknown" }] },
    { action: "update", items: [{ id: 1, status: "blocked" }] },
    { action: "update", remove_ids: ["missing"] },
    { action: "update", items: null },
    { action: "update", main_goal: "   " },
  ]) assert.equal(SkillRouter.applyChecklistOperation(initial, bad).ok, false);

  assert.equal(SkillRouter.applyChecklistOperation(initial, { action: "create", main_goal: "Again", items: [item("x")] }).ok, false);
  assert.deepEqual(initial.items.map(({ id }) => id), ["one", "two"], "a rejected update leaves the saved checklist untouched");
});

test("a checklist permits at most one in-progress item and switches it atomically", () => {
  const bothActive = create([item("one", { status: "in_progress" }), item("two", { status: "in_progress" })]);
  const rejectedCreate = SkillRouter.applyChecklistOperation(null, bothActive);
  assert.equal(rejectedCreate.ok, false);
  assert.equal(rejectedCreate.code, "CHECKLIST_INVALID");
  assert.match(rejectedCreate.error, /one.*in_progress/);

  const initial = SkillRouter.applyChecklistOperation(null, create([item("one", { status: "in_progress" }), item("two")])).value;
  const saved = structuredClone(initial);
  const rejectedUpdate = SkillRouter.applyChecklistOperation(initial, { action: "update", items: [{ id: "two", status: "in_progress" }] });
  assert.equal(rejectedUpdate.ok, false);
  assert.deepEqual(initial, saved, "an invalid handoff preserves all saved progress");

  for (const previousStatus of ["completed", "blocked"]) {
    const updated = SkillRouter.applyChecklistOperation(initial, { action: "update", items: [
      { id: "two", status: "in_progress" },
      { id: "one", status: previousStatus },
    ] });
    assert.equal(updated.ok, true, "validation happens after merging every patch");
    assert.deepEqual(updated.value.items.map(({ id, status }) => ({ id, status })), [
      { id: "one", status: previousStatus }, { id: "two", status: "in_progress" },
    ]);
  }
  assert.equal(SkillRouter.applyChecklistOperation(initial, { action: "update", items: [{ id: "one", status: "completed" }] }).ok, true, "zero active items is valid");
  assert.equal(SkillRouter.applyChecklistOperation(initial, { action: "update", items: [item("three", { status: "in_progress" })] }).ok, false);
  const repaired = SkillRouter.applyChecklistOperation({ main_goal: bothActive.main_goal, items: bothActive.items }, { action: "update", items: [{ id: "two", status: "pending" }] });
  assert.equal(repaired.ok, true, "previously saved overlapping statuses can be repaired without replacing the checklist");
});

test("checklists reject skipping unfinished items and preserve saved progress during repair", () => {
  const skipped = create([item("one"), item("two", { status: "in_progress" })]);
  assert.equal(SkillRouter.applyChecklistOperation(null, skipped).ok, false);
  const initial = SkillRouter.applyChecklistOperation(null, create([item("one", { status: "in_progress" }), item("two"), item("three")])).value;
  for (const items of [
    [{ id: "one", status: "pending" }, { id: "two", status: "in_progress" }],
    [{ id: "one", status: "completed" }, { id: "three", status: "in_progress" }],
    [{ id: "two", status: "completed" }],
    [{ id: "one", status: "completed" }, { id: "two", status: "completed" }],
  ]) assert.equal(SkillRouter.applyChecklistOperation(initial, { action: "update", items }).ok, false);
  assert.deepEqual(initial.items.map(item => item.status), ["in_progress", "pending", "pending"]);
  const legacy = { ...initial, items: [item("one"), item("two", { status: "completed" }), item("three", { status: "in_progress" })] };
  const repaired = SkillRouter.applyChecklistOperation(legacy, { action: "update", items: [{ id: "one", status: "in_progress" }, { id: "three", status: "pending" }] });
  assert.equal(repaired.ok, true);
  assert.deepEqual(repaired.value.items.map(item => item.status), ["in_progress", "completed", "pending"]);
});

test("model and widget views expose only their permitted checklist fields", () => {
  const checklist = {
    main_goal: "Hidden goal",
    items: [
      item("done", { status: "completed", description: "completed secret" }),
      item("active", { status: "in_progress", description: "active secret" }),
      item("next", { description: "next secret" }),
    ],
  };
  const modelView = SkillRouter.checklistForModel(checklist);
  assert.equal(modelView.objective, "Hidden goal");
  assert.equal(modelView.items[0].description, undefined);
  assert.equal(modelView.items[1].description, "active secret");
  assert.equal(modelView.items[2].description, undefined);
  const widget = SkillRouter.checklistForWidget(checklist, "agent-child");
  assert.equal(widget.agentId, "agent-child");
  assert.deepEqual(widget.tasks[1], { id: "active", title: checklist.items[1].label, status: "in_progress" });
  assert.equal(JSON.stringify(widget).includes("Hidden goal"), false);
  assert.equal(JSON.stringify(widget).includes("secret"), false);
});

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
