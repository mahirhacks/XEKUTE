"use strict";

const CHECKLIST_TOOL_NAME = "manage_task_checklist";
const CHECKLIST_STATUSES = new Set(["pending", "in_progress", "completed", "blocked"]);
const AUTOMATIC_SKILL_EXCLUSIONS = new Set(["create-rule", "create-skill", "create-subagent"]);
const { redactSecrets } = require("../../shared/secret-redaction.js");

const CHECKLIST_TOOL = Object.freeze({
  type: "function",
  function: {
    name: CHECKLIST_TOOL_NAME,
    description: "Create or update this agent's single task checklist. Create it before tasks requiring three or more meaningful steps, multiple deliverables, or sustained work. Work in item order: start the first pending item before task actions; complete the active item or describe its blocker before advancing. Greetings, brief direct answers, and straightforward one- or two-step tasks can proceed without a checklist.",
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
              description: { type: "string", description: "Hidden factual description, maximum 40 words." },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "blocked"] },
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
  if (!hasOnlyKeys(item, new Set(["id", "label", "description", "status"]))) return checklistFailure("Checklist items may contain only id, label, description, and status.");
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
  return { ok: true, value: { id, label, description, status } };
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
    if (item.status === "in_progress" && unfinished) {
      return checklistFailure(`Item "${unfinished.id}" must be completed or blocked before starting "${item.id}". Work in checklist order.`);
    }
    if (item.status === "completed" && previousItems.get(item.id)?.status !== "completed") {
      if (unfinished) return checklistFailure(`Cannot complete "${item.id}" before unfinished item "${unfinished.id}".`);
      const prior = previousItems.get(item.id);
      if (prior && prior.status !== "in_progress") return checklistFailure(`Start item "${item.id}" before completing it. Only the active item can be completed.`);
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

function checklistForModel(checklist) {
  if (!checklist) return null;
  const items = checklist.items || [];
  const focused = items.filter((item) => item.status === "in_progress");
  const descriptions = new Set((focused.length ? focused : items.filter((item) => item.status === "pending").slice(0, 1)).map((item) => item.id));
  return {
    objective: checklist.main_goal,
    items: items.map(({ id, label, status, description }) => ({ id, label, status, ...(descriptions.has(id) ? { description } : {}) })),
  };
}

function checklistForWidget(checklist, agentId = "") {
  return {
    ...(agentId ? { agentId } : {}),
    source: "agent",
    tasks: (checklist?.items || []).map(({ id, label, status }) => ({ id, title: label, status })),
  };
}

function clipRecentTurns(history, { maxTurns = 12, maxTokens = 2_000, excludeContents = [], excludeMessageIds = [], excludeToolNames = [CHECKLIST_TOOL_NAME] } = {}) {
  const excluded = new Set(excludeContents.map((content) => String(content || "").trim()).filter(Boolean));
  const excludedIds = new Set(excludeMessageIds.map((id) => String(id || "")).filter(Boolean));
  const excludedNames = new Set(excludeToolNames.map((name) => String(name || "")).filter(Boolean));
  const excludedCallIds = new Set((Array.isArray(history) ? history : []).flatMap((message) =>
    (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
      .filter((call) => excludedNames.has(String(call?.function?.name || "")))
      .map((call) => String(call?.id || ""))
      .filter(Boolean)));
  const messages = (Array.isArray(history) ? history : []).filter((message) => {
    const role = String(message?.role || "");
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (excludedIds.has(String(message?.source_message_id || ""))) return false;
    if (message?.__xekuteInternalOutputContinuation || message?.__xekuteInternalRuntimeInput) return false;
    if (role === "tool" && (excludedCallIds.has(String(message?.tool_call_id || "")) || excludedNames.has(String(message?.tool_name || message?.name || "")))) return false;
    if (role === "assistant" && Array.isArray(message?.tool_calls) && message.tool_calls.length) {
      const kept = message.tool_calls.filter((call) => !excludedNames.has(String(call?.function?.name || "")));
      if (!kept.length) return false;
      return true;
    }
    return ["user", "assistant", "tool"].includes(role)
      && content
      && !excluded.has(content);
  }).map((message) => {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) return message;
    const kept = message.tool_calls.filter((call) => !excludedNames.has(String(call?.function?.name || "")));
    return kept.length === message.tool_calls.length && !excluded.has(String(message.content || "").trim())
      ? message : { ...message, content: "", tool_calls: kept };
  });
  const groups = [];
  for (let index = 0; index < messages.length;) {
    const message = messages[index];
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (message.role === "assistant" && calls.length) {
      const expected = new Set(calls.map((call) => String(call?.id || "")).filter(Boolean));
      if (!expected.size || expected.size !== calls.length) { index += 1; continue; }
      const group = [message];
      const received = new Set();
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor].role === "tool" && received.size < expected.size) {
        const result = messages[cursor];
        if (!expected.has(String(result.tool_call_id || "")) || received.has(String(result.tool_call_id || ""))) break;
        group.push(result);
        if (expected.has(String(result.tool_call_id || ""))) received.add(String(result.tool_call_id));
        cursor += 1;
      }
      if (received.size === expected.size) {
        groups.push(group);
        index = cursor;
      } else {
        index += 1;
      }
      continue;
    }
    if (message.role === "tool") {
      index += 1;
      continue;
    }
    groups.push([message]);
    index += 1;
  }
  const selected = [];
  let usedTokens = 0;
  for (const group of groups.reverse()) {
    if (selected.length + group.length > maxTurns) continue;
    const projected = group.map((message) => {
      const role = String(message.role || "");
      const content = redactSecrets(String(message.content || "")).slice(0, 40_000);
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.map((call) => ({
        id: String(call?.id || ""),
        name: String(call?.function?.name || ""),
        arguments: redactSecrets(typeof call?.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call?.function?.arguments || {})),
      })) : undefined;
      const name = String(message.name || message.tool_name || "").slice(0, 100);
      const sourceMessageId = String(message.source_message_id || "").slice(0, 240);
      const taskRevision = Number.isSafeInteger(message.task_revision) ? message.task_revision : null;
      const metadata = {
        ...(name ? { name } : {}),
        ...(sourceMessageId ? { source_message_id: sourceMessageId } : {}),
        ...(taskRevision !== null ? { task_revision: taskRevision } : {}),
        ...(message.tool_call_id ? { tool_call_id: String(message.tool_call_id) } : {}),
        ...(toolCalls ? { tool_calls: toolCalls } : {}),
      };
      const tokens = Math.ceil((content.length + JSON.stringify(metadata).length + role.length + 8) / 4);
      return { role, content, ...metadata, tokens };
    });
    const groupTokens = projected.reduce((total, message) => total + message.tokens, 0);
    if (groupTokens > maxTokens - usedTokens) continue;
    selected.unshift(...projected.map(({ tokens, ...message }) => message));
    usedTokens += groupTokens;
  }
  return selected;
}

function automaticSkillCards(manifests = [], mode = "agent", availableTools = []) {
  const toolNames = new Set(availableTools.map((tool) => String(tool?.function?.name || "")).filter(Boolean));
  return manifests
    .filter((skill) => !AUTOMATIC_SKILL_EXCLUSIONS.has(String(skill?.id || "")))
    .filter((skill) => Array.isArray(skill?.modes) && skill.modes.includes(mode))
    .filter((skill) => [...(skill.requiredTools || []), ...(skill.requiredCapabilities || [])].every((name) => toolNames.has(name)))
    .map((skill) => ({ id: skill.id, title: skill.title, description: skill.description, requiredTools: [...(skill.requiredTools || []), ...(skill.requiredCapabilities || [])] }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function selectSkillIds(scores, { activeIds = [], threshold = 0.7, maxSkills = 2, allowedIds = [] } = {}) {
  const active = new Set(activeIds.map(String));
  const allowed = new Set(allowedIds.map(String));
  return Object.entries(scores || {})
    .filter(([id, score]) => allowed.has(id) && !active.has(id) && Number.isFinite(score) && score >= threshold)
    .sort(([leftId, leftScore], [rightId, rightScore]) => rightScore - leftScore || leftId.localeCompare(rightId))
    .slice(0, maxSkills)
    .map(([id]) => id);
}

module.exports = Object.freeze({
  AUTOMATIC_SKILL_EXCLUSIONS,
  CHECKLIST_TOOL,
  CHECKLIST_TOOL_NAME,
  applyChecklistOperation,
  automaticSkillCards,
  checklistForModel,
  checklistForWidget,
  checklistActionError,
  clipRecentTurns,
  normalizeChecklistItem,
  normalizeChecklistSnapshot,
  selectSkillIds,
  wordCount,
});
