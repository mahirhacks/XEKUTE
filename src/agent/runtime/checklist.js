"use strict";

const CHECKLIST_TOOL_NAME = "manage_task_checklist";
const CHECKLIST_STATUSES = new Set(["pending", "in_progress", "completed", "blocked"]);
// Rounds of task actions without a checklist update before the agent is asked
// whether the active item is still the one it is working on.
const CHECKLIST_DRIFT_ROUNDS = 5;
// Rounds of task actions without any checklist before the agent is asked
// whether the task needs one.
const CHECKLIST_MISSING_ROUNDS = 2;

const CHECKLIST_RULES = [
  "Checklist planning is the default for substantive work. Before the first task action, create a checklist with manage_task_checklist whenever the request needs more than one action; investigation, changes, verification, and reporting each count, even when the user wrote one sentence. Skip it only for greetings, answers you can give directly, or a single action. Do not pad a task with artificial steps.",
  "Each agent owns one checklist: create it once, then update that same checklist. If a task you started without one grows, create it before continuing.",
  "Work strictly in order. Exactly one item is in_progress while you act, and every task action serves that item. When its work is finished, mark it completed and start the next item in the same update. Do not work ahead, batch completions, or mark unfinished work completed.",
  "If an item cannot be finished, mark it blocked and write the concrete blocker in its description before moving on.",
  "When the user sends new instructions while you work, update the checklist before further task actions: add items for new work, revise or remove obsolete items, and keep completed work. If the plan still fits, send an update that restates main_goal.",
  "When the task changes files, runs commands with side effects, or reports findings, include a verification item with verification: true before the final step. It checks the result: run the tests or build, re-read the change, or reproduce the finding. The run cannot end while a verification item is unfinished.",
  "Checklist labels must be 12 words or fewer; hidden descriptions must be 40 words or fewer.",
  "After a checklist update, wait for routing results before task actions. If new skill instructions load, regenerate actions using those instructions.",
].join(" ");

const CHECKLIST_TOOL = Object.freeze({
  type: "function",
  function: {
    name: CHECKLIST_TOOL_NAME,
    description: "Create or update this agent's single task checklist. Create it before the first task action of any request that needs more than one action. Keep exactly one item in_progress and work in order: finish it, then complete it and start the next item in one update. Update it when the user sends new instructions. When the work changes files, runs commands with side effects, or reports findings, include an item with verification: true that checks the result. Greetings, direct answers, and single actions can proceed without a checklist.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["create", "update"] },
        main_goal: { type: "string", description: "The single goal for this agent run. Required for create; optional for update." },
        items: {
          type: "array",
          description: "Initial items for create; changed or new items for update.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              label: { type: "string", description: "Visible item label, maximum 12 words." },
              description: { type: "string", description: "Hidden factual description, maximum 40 words. For a blocked item, the concrete blocker." },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"] },
              verification: { type: "boolean", description: "True for an item that checks the work: tests, a build, re-reading the change, or reproducing a finding." },
            },
            required: ["id"],
          },
        },
        remove_ids: { type: "array", items: { type: "string" } },
      },
      required: ["action"],
    },
  },
});

function checklistFailure(error) {
  return { ok: false, error, code: "CHECKLIST_INVALID" };
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value || {}).every((key) => allowed.has(key));
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function normalizeChecklistItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return checklistFailure("Each checklist item must be an object.");
  if (!hasOnlyKeys(item, new Set(["id", "label", "description", "status", "verification"]))) return checklistFailure("Checklist items may contain only id, label, description, status, and verification.");
  if (item.verification !== undefined && typeof item.verification !== "boolean") return checklistFailure("Checklist verification must be true or false.");
  if (typeof item.id !== "string" || typeof item.label !== "string" || typeof item.description !== "string" || typeof item.status !== "string") {
    return checklistFailure("Checklist IDs, labels, descriptions, and statuses must be text.");
  }
  const id = item.id.trim();
  const label = item.label.trim().replace(/\s+/g, " ");
  const description = item.description.trim().replace(/\s+/g, " ");
  const status = item.status;
  if (!id) return checklistFailure("Checklist item IDs cannot be empty.");
  if (!label) return checklistFailure("Checklist labels cannot be empty.");
  if (wordCount(label) > 12) return checklistFailure("Checklist labels must be 12 words or fewer.");
  if (!description) return checklistFailure("Checklist descriptions cannot be empty.");
  if (wordCount(description) > 40) return checklistFailure("Checklist descriptions must be 40 words or fewer.");
  if (!CHECKLIST_STATUSES.has(status)) return checklistFailure("Checklist item status is invalid.");
  return { ok: true, value: { id, label, description, status, ...(item.verification ? { verification: true } : {}) } };
}

function normalizeChecklistSnapshot(checklist) {
  if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) return checklistFailure("Checklist state is missing.");
  const rawGoal = checklist.main_goal ?? checklist.mainGoal;
  if (typeof rawGoal !== "string") return checklistFailure("The checklist needs one main goal.");
  const mainGoal = rawGoal.trim().replace(/\s+/g, " ");
  if (!mainGoal) return checklistFailure("The checklist needs one main goal.");
  if (!Array.isArray(checklist.items) || checklist.items.length < 1 || checklist.items.length > 20) {
    return checklistFailure("A checklist must contain between 1 and 20 items.");
  }
  const items = [];
  const ids = new Set();
  for (const item of checklist.items) {
    const normalized = normalizeChecklistItem(item);
    if (!normalized.ok) return normalized;
    if (ids.has(normalized.value.id)) return checklistFailure("Checklist item IDs must be unique.");
    ids.add(normalized.value.id);
    items.push(normalized.value);
  }
  if (items.filter((item) => item.status === "in_progress").length > 1) {
    return checklistFailure("Only one checklist item may be in_progress. Update the previous item's actual status and the new item's status in the same call.");
  }
  return { ok: true, value: { main_goal: mainGoal, items } };
}

function applyChecklistOperation(current, operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) return checklistFailure("Checklist operation must be an object.");
  if (!hasOnlyKeys(operation, new Set(["action", "main_goal", "items", "remove_ids"]))) return checklistFailure("Checklist calls may contain only action, main_goal, items, and remove_ids.");
  if (operation.action === "create") {
    if (current) return checklistFailure("This agent already has a checklist. Update it instead of creating another.");
    if (operation.remove_ids?.length) return checklistFailure("A new checklist cannot remove existing items.");
    return validateChecklistOrder(normalizeChecklistSnapshot({ main_goal: operation.main_goal, items: operation.items }), null);
  }
  if (operation.action !== "update" || !current) return checklistFailure("Update requires this agent's existing checklist.");
  if (operation.items !== undefined && !Array.isArray(operation.items)) return checklistFailure("Updated checklist items must be an array.");
  if (operation.remove_ids !== undefined && !Array.isArray(operation.remove_ids)) return checklistFailure("Removed checklist IDs must be an array.");
  if (!operation.items?.length && !operation.remove_ids?.length && operation.main_goal === undefined) return checklistFailure("An update must change the goal, an item, or the item set.");

  const items = new Map(current.items.map((item) => [item.id, { ...item }]));
  const touched = new Set();
  const removeIds = new Set();
  for (const rawId of operation.remove_ids || []) {
    if (typeof rawId !== "string") return checklistFailure("Removed checklist IDs must be text.");
    const id = rawId.trim();
    if (!id || removeIds.has(id) || touched.has(id) || !items.has(id)) return checklistFailure("Removed checklist IDs must exist and appear once.");
    removeIds.add(id);
    touched.add(id);
  }
  for (const patch of operation.items || []) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return checklistFailure("Each checklist update must be an object.");
    if (typeof patch.id !== "string") return checklistFailure("Checklist item IDs must be text.");
    const id = patch.id.trim();
    if (!id || touched.has(id)) return checklistFailure("An item can be updated or removed only once per call.");
    touched.add(id);
    const existing = items.get(id);
    if (!existing && ["label", "description", "status"].some((field) => patch[field] === undefined)) {
      return checklistFailure("New checklist items need a label, description, and status.");
    }
    const normalized = normalizeChecklistItem({ ...existing, ...patch, id });
    if (!normalized.ok) return normalized;
    items.set(id, normalized.value);
  }
  for (const id of removeIds) items.delete(id);
  return validateChecklistOrder(normalizeChecklistSnapshot({
    main_goal: operation.main_goal === undefined ? current.main_goal : operation.main_goal,
    items: [...items.values()],
  }), current);
}

function validateChecklistOrder(normalized, previous) {
  if (!normalized.ok) return normalized;
  const previousItems = new Map((previous?.items || []).map(item => [item.id, item]));
  let unfinished = null;
  for (const item of normalized.value.items) {
    const prior = previousItems.get(item.id);
    if (item.status === "in_progress" && unfinished) {
      return checklistFailure(`Item "${unfinished.id}" must be completed or blocked before starting "${item.id}". Work in checklist order.`);
    }
    if (item.status === "completed" && prior?.status !== "completed") {
      if (unfinished) return checklistFailure(`Cannot complete "${item.id}" before unfinished item "${unfinished.id}".`);
      if (prior && prior.status !== "in_progress") return checklistFailure(`Start item "${item.id}" before completing it. Only the active item can be completed.`);
    }
    // Blocking is how an item is set aside, so it has to say why.
    if (item.status === "blocked" && prior && prior.status !== "blocked" && item.description === prior.description) {
      return checklistFailure(`Write the concrete blocker in the description of "${item.id}" when marking it blocked.`);
    }
    if (!unfinished && ["pending", "in_progress"].includes(item.status)) unfinished = item;
  }
  return normalized;
}

function checklistActionError(checklist) {
  if (!checklist) return null;
  const first = checklist.items.find(item => ["pending", "in_progress"].includes(item.status));
  if (!first) return "The checklist has no remaining actionable item. Add or reopen the next step before further task actions, or finish the run.";
  if (first.status !== "in_progress" || checklist.items.filter(item => item.status === "in_progress").length !== 1) {
    return `Before task actions, update the checklist so "${first.id}" is the only in_progress item. Work in order; complete the current item or describe its blocker before advancing. Preserve actual completed work.`;
  }
  return null;
}

function activeChecklistItem(checklist) {
  return checklist?.items.find((item) => item.status === "in_progress") || null;
}

// The receipt is the last thing the agent reads after an update, so it names
// the one item to work on and the step that follows it.
function checklistReceipt(checklist) {
  const active = activeChecklistItem(checklist);
  const next = checklist.items.find((item) => item.status === "pending");
  const remaining = checklist.items.filter((item) => ["pending", "in_progress"].includes(item.status)).length;
  const focus = active
    ? `Work only on "${active.label}". When it is finished, mark it completed${next ? ` and start "${next.label}"` : ""} in one update.`
    : next ? `Start "${next.label}" before further task actions.`
      : "Every item is finished. Report the result, or add items if work remains.";
  return { status: "saved", itemCount: checklist.items.length, remaining, ...(active ? { active: { id: active.id, label: active.label } } : {}), focus };
}

function checklistSteeringNote(checklist) {
  const active = activeChecklistItem(checklist);
  return `New instructions arrived while you were working. Before further task actions, update the checklist to cover them: add items for new work, revise or remove obsolete items, and keep completed work. If the plan still fits, send an update that restates main_goal.${active ? ` The active item is "${active.label}".` : ""}`;
}

function checklistDriftNote(checklist, rounds) {
  const active = activeChecklistItem(checklist);
  if (!active) return null;
  return `You have taken ${rounds} rounds of actions since the last checklist update. The active item is "${active.label}". If it is finished, mark it completed and start the next item; if your work has moved past it, update the checklist to match before continuing.`;
}

function checklistMissingNote(rounds) {
  return `You have taken ${rounds} rounds of actions without a checklist. If more steps remain, create one with manage_task_checklist now and continue from its first unfinished item.`;
}

function checklistRepairNote(checklist, problem, attempts) {
  const state = checklist
    ? JSON.stringify(checklist.items.map(({ id, label, status }) => ({ id, label, status })))
    : "none yet; use action create";
  return `Your last ${attempts} checklist attempts were rejected, so task actions are on hold. Latest problem: ${problem} Current checklist: ${state}. Send one manage_task_checklist call that fixes only this problem, then continue the task.`;
}

// Ending is held while a verification item is unfinished, or when the run
// changed the workspace and nothing in the checklist checks that change.
function checklistVerificationGap(checklist, { workspaceChanged = false } = {}) {
  if (!checklist) return null;
  const checks = checklist.items.filter((item) => item.verification);
  const open = checks.find((item) => ["pending", "in_progress"].includes(item.status));
  if (open) return `Before ending, finish the verification item "${open.label}", or mark it blocked with the concrete reason.`;
  if (!checks.length && workspaceChanged) return "This run changed the workspace, but the checklist has no verification item. Add one with verification: true that checks the result (run the tests or build, re-read the change, or reproduce the finding), complete it, then end.";
  return null;
}

// Skill routing only needs to run again when what the agent is about to do
// changes: the goal, the item set, or the active item.
function checklistRoutingKey(checklist) {
  if (!checklist) return "";
  return JSON.stringify([checklist.main_goal, checklist.items.map((item) => [item.id, item.label]), activeChecklistItem(checklist)?.id || ""]);
}

function checklistForModel(checklist) {
  if (!checklist) return null;
  const items = checklist.items || [];
  const focused = items.filter((item) => item.status === "in_progress");
  const descriptions = new Set((focused.length ? focused : items.filter((item) => item.status === "pending").slice(0, 1)).map((item) => item.id));
  return {
    objective: checklist.main_goal,
    items: items.map(({ id, label, status, description, verification }) => ({ id, label, status, ...(verification ? { verification } : {}), ...(descriptions.has(id) ? { description } : {}) })),
  };
}

function checklistForWidget(checklist, agentId = "") {
  return {
    ...(agentId ? { agentId } : {}),
    source: "agent",
    tasks: (checklist?.items || []).map(({ id, label, status }) => ({ id, title: label, status })),
  };
}

module.exports = Object.freeze({
  CHECKLIST_DRIFT_ROUNDS,
  CHECKLIST_MISSING_ROUNDS,
  CHECKLIST_RULES,
  CHECKLIST_TOOL,
  CHECKLIST_TOOL_NAME,
  activeChecklistItem,
  applyChecklistOperation,
  checklistActionError,
  checklistDriftNote,
  checklistForModel,
  checklistForWidget,
  checklistMissingNote,
  checklistRepairNote,
  checklistReceipt,
  checklistRoutingKey,
  checklistSteeringNote,
  checklistVerificationGap,
  normalizeChecklistItem,
  normalizeChecklistSnapshot,
  wordCount,
});
