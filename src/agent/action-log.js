const fs = require("fs");
const path = require("path");

function logRoot(workspace) {
  return path.join(path.resolve(String(workspace || ".")), "logs");
}

const SECRET_KEY_RE = /authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|password|passwd|secret|token|private[_-]?key/i;
function redactLogValue(value, key = "", depth = 0) {
  if (SECRET_KEY_RE.test(key)) return "[REDACTED]";
  if (depth > 8) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactLogValue(item, "", depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 300).map(([name, item]) => [name, redactLogValue(item, name, depth + 1)]));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length <= 100000) {
      try { return JSON.stringify(redactLogValue(JSON.parse(trimmed), "", depth + 1)).slice(0, 12000); } catch { /* Treat as plain text below. */ }
    }
    return value
      .replace(/(["']?(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^"'\s,;&}]+/gi, "$1[REDACTED]")
      .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
      .slice(0, 12000);
  }
  return value;
}

function appendJsonl(workspace, fileName, entry) {
  if (!workspace) return { ok: false, error: "No workspace available for the agent log." };
  try {
    const root = logRoot(workspace);
    fs.mkdirSync(root, { recursive: true });
    const filePath = path.join(root, fileName);
    fs.appendFileSync(filePath, `${JSON.stringify(redactLogValue(entry))}\n`, "utf8");
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

function appendAgentApproval(workspace, entry) {
  return appendJsonl(workspace, "agent-approvals.jsonl", entry);
}

function appendToolOutput(workspace, entry) {
  return appendJsonl(workspace, "tool-output.jsonl", entry);
}

module.exports = { appendAgentAction, appendHypothesis, appendAgentRun, appendAgentApproval, appendToolOutput };
