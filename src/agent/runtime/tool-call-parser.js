"use strict";

const ToolMap = require("../../contracts/tool/tool-port.js");

function normalizeToolCall(call, editContext = {}) {
  if (!call || typeof call !== "object") return { ok: false, error: "Tool call is not an object.", code: "INVALID_TOOL_CALL" };
  const name = String(call.function?.name || call.toolName || call.action || "").trim();
  if (!name) return { ok: false, error: "Tool call has no name.", code: "INVALID_TOOL_CALL" };
  const parsed = ToolMap.parseArguments(call.function?.arguments ?? call.args);
  if (!parsed.ok) return { ok: false, error: "Tool arguments could not be parsed.", code: parsed.code || "MALFORMED_TOOL_ARGUMENTS" };
  const normalized = ToolMap.resolveTools
    ? ToolMap.resolveTools([{ callId: call.id || call.callId || "", type: call.type || "function", toolName: name, action: name, args: parsed.value }], editContext)[0]
    : null;
  return {
    ok: true,
    value: normalized || {
      callId: call.id || call.callId || "",
      type: call.type || "function",
      toolName: name,
      action: name,
      args: parsed.value,
    },
  };
}

function buildToolCallForExecution(tool = {}) {
  return {
    id: tool.callId,
    type: "function",
    function: { name: tool.toolName || tool.action, arguments: { ...(tool.args || {}) } },
  };
}

module.exports = { normalizeToolCall, buildToolCallForExecution };
