"use strict";

const MAX_COMMAND_SLOTS = 3;

function consumesCommandSlot(tool = {}) {
  const name = String(tool.toolName || tool.action || "");
  if (name !== "exec_command") return false;
  const operation = String(tool.args?.operation || "run");
  return operation === "run" || operation === "start";
}

module.exports = {
  MAX_COMMAND_SLOTS,
  consumesCommandSlot,
};
