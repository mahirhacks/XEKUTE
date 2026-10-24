"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const Checklist = require("../src/agent/runtime/checklist.js");

const item = (id, overrides = {}) => ({ id, label: `Review ${id}`, description: `Inspect supplied evidence for ${id}.`, status: "pending", ...overrides });
const create = (items = [item("one")], extra = {}) => ({ action: "create", main_goal: "Review supplied evidence safely", items, ...extra });

test("checklist creation enforces its compact contract and word limits", () => {
  assert.equal(Checklist.applyChecklistOperation(null, create()).ok, true);
  const tooLongLabel = item("one", { label: "one two three four five six seven eight nine ten eleven twelve thirteen" });
  const tooLongDescription = item("one", { description: Array.from({ length: 41 }, (_, index) => `word${index}`).join(" ") });
  assert.equal(Checklist.applyChecklistOperation(null, create([tooLongLabel])).code, "CHECKLIST_INVALID");
  assert.equal(Checklist.applyChecklistOperation(null, create([tooLongDescription])).code, "CHECKLIST_INVALID");
  assert.equal(Checklist.applyChecklistOperation(null, create([item(" ")])).code, "CHECKLIST_INVALID");
  assert.equal(Checklist.applyChecklistOperation(null, create([item("same"), item("same")])).code, "CHECKLIST_INVALID");
  assert.equal(Checklist.applyChecklistOperation(null, create([item("one", { extra: "not allowed" })])).code, "CHECKLIST_INVALID");
});

test("checklist updates merge atomically, require complete new items, and reject conflicts", () => {
  const initial = Checklist.applyChecklistOperation(null, create([item("one"), item("two")])).value;
  const updated = Checklist.applyChecklistOperation(initial, {
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
  ]) assert.equal(Checklist.applyChecklistOperation(initial, bad).ok, false);

  assert.equal(Checklist.applyChecklistOperation(initial, { action: "create", main_goal: "Again", items: [item("x")] }).ok, false);
  assert.deepEqual(initial.items.map(({ id }) => id), ["one", "two"], "a rejected update leaves the saved checklist untouched");
});

test("a checklist permits at most one in-progress item and switches it atomically", () => {
  const bothActive = create([item("one", { status: "in_progress" }), item("two", { status: "in_progress" })]);
  const rejectedCreate = Checklist.applyChecklistOperation(null, bothActive);
  assert.equal(rejectedCreate.ok, false);
  assert.equal(rejectedCreate.code, "CHECKLIST_INVALID");
  assert.match(rejectedCreate.error, /one.*in_progress/);

  const initial = Checklist.applyChecklistOperation(null, create([item("one", { status: "in_progress" }), item("two")])).value;
  const saved = structuredClone(initial);
  const rejectedUpdate = Checklist.applyChecklistOperation(initial, { action: "update", items: [{ id: "two", status: "in_progress" }] });
  assert.equal(rejectedUpdate.ok, false);
  assert.deepEqual(initial, saved, "an invalid handoff preserves all saved progress");

  for (const previousStatus of ["completed", "blocked"]) {
    const updated = Checklist.applyChecklistOperation(initial, { action: "update", items: [
      { id: "two", status: "in_progress" },
      { id: "one", status: previousStatus, ...(previousStatus === "blocked" ? { description: "Waiting on missing credentials." } : {}) },
    ] });
    assert.equal(updated.ok, true, "validation happens after merging every patch");
    assert.deepEqual(updated.value.items.map(({ id, status }) => ({ id, status })), [
      { id: "one", status: previousStatus }, { id: "two", status: "in_progress" },
    ]);
  }
  assert.equal(Checklist.applyChecklistOperation(initial, { action: "update", items: [{ id: "one", status: "completed" }] }).ok, true, "zero active items is valid");
  assert.equal(Checklist.applyChecklistOperation(initial, { action: "update", items: [item("three", { status: "in_progress" })] }).ok, false);
  const repaired = Checklist.applyChecklistOperation({ main_goal: bothActive.main_goal, items: bothActive.items }, { action: "update", items: [{ id: "two", status: "pending" }] });
  assert.equal(repaired.ok, true, "previously saved overlapping statuses can be repaired without replacing the checklist");
});

test("checklists reject skipping unfinished items and preserve saved progress during repair", () => {
  const skipped = create([item("one"), item("two", { status: "in_progress" })]);
  assert.equal(Checklist.applyChecklistOperation(null, skipped).ok, false);
  const initial = Checklist.applyChecklistOperation(null, create([item("one", { status: "in_progress" }), item("two"), item("three")])).value;
  for (const items of [
    [{ id: "one", status: "pending" }, { id: "two", status: "in_progress" }],
    [{ id: "one", status: "completed" }, { id: "three", status: "in_progress" }],
    [{ id: "two", status: "completed" }],
    [{ id: "one", status: "completed" }, { id: "two", status: "completed" }],
  ]) assert.equal(Checklist.applyChecklistOperation(initial, { action: "update", items }).ok, false);
  assert.deepEqual(initial.items.map(item => item.status), ["in_progress", "pending", "pending"]);
  const legacy = { ...initial, items: [item("one"), item("two", { status: "completed" }), item("three", { status: "in_progress" })] };
  const repaired = Checklist.applyChecklistOperation(legacy, { action: "update", items: [{ id: "one", status: "in_progress" }, { id: "three", status: "pending" }] });
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
  const modelView = Checklist.checklistForModel(checklist);
  assert.equal(modelView.objective, "Hidden goal");
  assert.equal(modelView.items[0].description, undefined);
  assert.equal(modelView.items[1].description, "active secret");
  assert.equal(modelView.items[2].description, undefined);
  const widget = Checklist.checklistForWidget(checklist, "agent-child");
  assert.equal(widget.agentId, "agent-child");
  assert.deepEqual(widget.tasks[1], { id: "active", title: checklist.items[1].label, status: "in_progress" });
  assert.equal(JSON.stringify(widget).includes("Hidden goal"), false);
  assert.equal(JSON.stringify(widget).includes("secret"), false);
});


test("blocking an item requires a new description naming the blocker", () => {
  const initial = Checklist.applyChecklistOperation(null, create([item("one", { status: "in_progress" }), item("two")])).value;
  const silent = Checklist.applyChecklistOperation(initial, { action: "update", items: [{ id: "one", status: "blocked" }, { id: "two", status: "in_progress" }] });
  assert.equal(silent.ok, false);
  assert.match(silent.error, /blocker/);
  const explained = Checklist.applyChecklistOperation(initial, { action: "update", items: [
    { id: "one", status: "blocked", description: "The staging host refuses connections." },
    { id: "two", status: "in_progress" },
  ] });
  assert.equal(explained.ok, true);
});

test("the receipt names the active item and the step after it", () => {
  const checklist = Checklist.applyChecklistOperation(null, create([item("one", { status: "completed" }), item("two", { status: "in_progress" }), item("three")])).value;
  const receipt = Checklist.checklistReceipt(checklist);
  assert.deepEqual(receipt.active, { id: "two", label: "Review two" });
  assert.equal(receipt.remaining, 2);
  assert.match(receipt.focus, /Work only on "Review two".*start "Review three"/);
  const done = Checklist.applyChecklistOperation(checklist, { action: "update", items: [{ id: "two", status: "completed" }, { id: "three", status: "in_progress" }] }).value;
  const finished = Checklist.applyChecklistOperation(done, { action: "update", items: [{ id: "three", status: "completed" }] }).value;
  assert.equal(Checklist.checklistReceipt(finished).active, undefined);
  assert.match(Checklist.checklistReceipt(finished).focus, /Every item is finished/);
});

test("the routing key changes with the plan or active item, not with descriptions", () => {
  const initial = Checklist.applyChecklistOperation(null, create([item("one", { status: "in_progress" }), item("two")])).value;
  const key = Checklist.checklistRoutingKey(initial);
  const reworded = Checklist.applyChecklistOperation(initial, { action: "update", items: [{ id: "one", description: "Narrowed to the login form." }] }).value;
  assert.equal(Checklist.checklistRoutingKey(reworded), key);
  const advanced = Checklist.applyChecklistOperation(initial, { action: "update", items: [{ id: "one", status: "completed" }, { id: "two", status: "in_progress" }] }).value;
  assert.notEqual(Checklist.checklistRoutingKey(advanced), key);
  const extended = Checklist.applyChecklistOperation(initial, { action: "update", items: [item("three")] }).value;
  assert.notEqual(Checklist.checklistRoutingKey(extended), key);
});

test("steering and drift notes point at the active item", () => {
  const checklist = Checklist.applyChecklistOperation(null, create([item("one", { status: "in_progress" })])).value;
  assert.match(Checklist.checklistSteeringNote(checklist), /New instructions arrived.*"Review one"/);
  assert.match(Checklist.checklistDriftNote(checklist, 5), /5 rounds.*"Review one"/);
  assert.equal(Checklist.checklistDriftNote({ ...checklist, items: [item("one", { status: "completed" })] }, 5), null);
  assert.match(Checklist.checklistMissingNote(2), /2 rounds of actions without a checklist/);
});

test("verification items carry an explicit flag the model can see", () => {
  const checklist = Checklist.applyChecklistOperation(null, create([item("fix", { status: "in_progress" }), item("verify", { verification: true })])).value;
  assert.equal(checklist.items[1].verification, true);
  assert.equal("verification" in checklist.items[0], false);
  assert.equal(Checklist.checklistForModel(checklist).items[1].verification, true);
  assert.equal(Checklist.applyChecklistOperation(null, create([item("verify", { verification: "yes" })])).ok, false);
});

test("ending needs a finished verification item only where one is necessary", () => {
  const plain = Checklist.applyChecklistOperation(null, create([item("read", { status: "completed" })])).value;
  assert.equal(Checklist.checklistVerificationGap(plain, { workspaceChanged: false }), null, "read-only work ends freely");
  assert.match(Checklist.checklistVerificationGap(plain, { workspaceChanged: true }), /no verification item/);
  const open = Checklist.applyChecklistOperation(null, create([item("fix", { status: "completed" }), item("verify", { verification: true })])).value;
  assert.match(Checklist.checklistVerificationGap(open), /finish the verification item "Review verify"/);
  const done = Checklist.applyChecklistOperation(open, { action: "update", items: [{ id: "verify", status: "in_progress" }] }).value;
  const verified = Checklist.applyChecklistOperation(done, { action: "update", items: [{ id: "verify", status: "completed" }] }).value;
  assert.equal(Checklist.checklistVerificationGap(verified, { workspaceChanged: true }), null);
});
