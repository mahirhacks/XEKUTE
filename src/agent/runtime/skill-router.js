"use strict";

const AUTOMATIC_SKILL_EXCLUSIONS = new Set(["create-rule", "create-skill", "create-subagent"]);
const { redactSecrets } = require("../../shared/secret-redaction.js");
const { CHECKLIST_TOOL_NAME } = require("./checklist.js");

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
  automaticSkillCards,
  clipRecentTurns,
  selectSkillIds,
});
