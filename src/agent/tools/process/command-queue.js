"use strict";

const MAX_COMMAND_SLOTS = 3;

function consumesCommandSlot(tool = {}) {
  const name = String(tool.toolName || tool.action || "");
  if (name !== "exec_command") return false;
  const operation = String(tool.args?.operation || "run");
  return operation === "run" || operation === "start";
}

function formatCommandList(commands = []) {
  const labels = commands.map((item, index) => {
    const command = String(item?.command || "").trim();
    const id = String(item?.processId || item?.id || "").trim();
    if (command && id) return `${command} (${id})`;
    return command || id || `command ${index + 1}`;
  });
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function queueRejectionMessage({ running = [], freeSlots = 0, requested = 0, limit = MAX_COMMAND_SLOTS } = {}) {
  const outcome = requested === 1
    ? "this command was not started"
    : `this request asked for ${requested} commands, so none were started`;
  if (!running.length) {
    const lead = outcome.charAt(0).toUpperCase() + outcome.slice(1);
    return `No more than ${limit} commands at a time. ${lead}.`;
  }
  const names = formatCommandList(running);
  const verb = running.length === 1 ? "is" : "are";
  if (freeSlots <= 0) {
    return `${names} ${verb} still running. The command queue is full, so ${outcome}.`;
  }
  const slots = freeSlots === 1 ? "only 1 slot is available" : `only ${freeSlots} slots are available`;
  return `${names} ${verb} still running and ${slots}, so ${outcome}.`;
}

function queueRejectionResult(details, shape = "controller") {
  const message = queueRejectionMessage(details);
  const value = {
    limit: MAX_COMMAND_SLOTS,
    freeSlots: Number(details.freeSlots) || 0,
    requested: Number(details.requested) || 0,
    running: Array.isArray(details.running) ? details.running : [],
  };
  if (shape === "manager") {
    return {
      ok: false,
      error: { code: "COMMAND_QUEUE_REJECTED", message, retryable: false },
      errorCode: "COMMAND_QUEUE_REJECTED",
      value,
    };
  }
  return {
    ok: false,
    error: message,
    errorCode: "COMMAND_QUEUE_REJECTED",
    retryable: false,
    value,
  };
}

module.exports = {
  MAX_COMMAND_SLOTS,
  consumesCommandSlot,
  formatCommandList,
  queueRejectionMessage,
  queueRejectionResult,
};
