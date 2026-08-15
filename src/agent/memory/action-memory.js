"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { redactStructuredValue } = require("../../shared/secret-redaction.js");

function logRoot(workspace) {
  return path.join(path.resolve(String(workspace || ".")), ".xekute", "logs");
}

function appendJsonl(workspace, fileName, entry) {
  if (!workspace) return { ok: false, error: "No workspace available for the agent log." };
  try {
    const root = logRoot(workspace);
    fs.mkdirSync(root, { recursive: true });
    const filePath = path.join(root, fileName);
    fs.appendFileSync(filePath, `${JSON.stringify(redactStructuredValue(entry))}\n`, "utf8");
    return { ok: true, path: path.relative(workspace, filePath).replace(/\\/g, "/") };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function appendAgentAction(workspace, entry) {
  return appendJsonl(workspace, "agent-actions.jsonl", entry);
}

function appendHypothesis(workspace, entry) {
  return appendJsonl(workspace, "agent-hypotheses.jsonl", entry);
}

function appendAgentRun(workspace, entry) {
  return appendJsonl(workspace, "agent-runs.jsonl", entry);
}

function appendToolOutput(workspace, entry) {
  return appendJsonl(workspace, "tool-output.jsonl", entry);
}

function appendToolAudit(workspace, entry) {
  return appendJsonl(workspace, "tool-audit.jsonl", entry);
}

function appendOperationState(workspace, entry) {
  return appendJsonl(workspace, "tool-operations.jsonl", entry);
}

module.exports = { appendAgentAction, appendHypothesis, appendAgentRun, appendToolOutput, appendToolAudit, appendOperationState };
