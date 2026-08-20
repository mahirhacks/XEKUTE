"use strict";

function quoteArgument(value) {
  const text = String(value ?? "");
  if (text && /^[a-z0-9_./:\\=@%+,-]+$/i.test(text)) return text;
  return JSON.stringify(text);
}

function formatCommandForApproval(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "exec_command";
  if (typeof args.command === "string" && args.command.trim()) return args.command;
  if (typeof args.executable === "string" && args.executable.trim()) {
    return [args.executable, ...(Array.isArray(args.args) ? args.args : [])]
      .map(quoteArgument)
      .join(" ");
  }

  const operation = String(args.operation || "run");
  const parts = ["exec_command", operation];
  if (args.process_id) parts.push("--process-id", quoteArgument(args.process_id));
  if (args.wait_ms !== undefined) parts.push("--wait-ms", quoteArgument(args.wait_ms));
  if (args.tail_chars !== undefined) parts.push("--tail-chars", quoteArgument(args.tail_chars));
  return parts.join(" ");
}

module.exports = { formatCommandForApproval, quoteArgument };
