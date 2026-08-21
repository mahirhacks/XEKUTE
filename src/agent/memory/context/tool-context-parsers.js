"use strict";
const { TOOL_REGISTRY_NAMES } = require("../../tools/config/tool-metadata.js");
const C = require("./context-capsule.js");

function source(result) { const refs = C.references(result); return { refs, evidenceIds: refs.filter((id) => /evidence/i.test(id)) }; }
function outcomeState(result) { return result?.outcome === "success" ? "observed" : result?.outcome === "partial" ? "inconclusive" : "failed"; }
function lifecycle(toolName) { return (args, result, workspace) => ({ records: [C.record({ kind: "execution", claimState: outcomeState(result), subject: `${toolName} execution`, value: { outcome: C.text(result?.outcome, 80), target: C.canonicalPath(args.path || args.cwd || "", workspace) || C.canonicalUrl(args.url || "") }, source: source(result), template: "execution" })] }); }
function mutation(toolName, subjectField = "path") { return (args, result, workspace) => {
  if (result?.outcome !== "success") return lifecycle(toolName)(args, result, workspace);
  const subject = C.canonicalPath(args[subjectField] || args.id || toolName, workspace);
  return { records: [C.record({ kind: "mutation", claimState: "verified", subject, value: { tool: toolName, target: subject, revision: C.text(result?.capabilityData?.revision || result?.capabilityData?.version || "", 160) }, source: source(result), required: ["manage_plan", "manage_state", "store_finding"].includes(toolName), template: "mutation" })] };
}; }
function applyPatch(args, result, workspace) {
  if (result?.outcome !== "success") return lifecycle("apply_patch")(args, result, workspace);
  const data = C.parseObject(result?.capabilityData);
  if (data.dryRun) return { records: [C.record({ kind: "assessment", claimState: "observed", subject: "apply_patch dry run", value: { tool: "apply_patch", dryRun: true }, source: source(result), template: "assessment" })] };
  const changes = Array.isArray(data.changes) ? data.changes : [];
  if (!changes.length) return { records: [], residues: [{ reason: "apply_patch_missing_exact_changes", source: source(result) }] };
  return { records: changes.filter((change) => change?.changed !== false).map((change) => {
    const target = C.canonicalPath(change.target || change.path || "", workspace);
    return C.record({ kind: "mutation", claimState: "verified", subject: target || "apply_patch", value: { tool: "apply_patch", target, operation: C.text(change.kind || "", 40), revision: C.text(change.revisionAfter || "", 160) }, source: source(result), template: "mutation" });
  }) };
}
function assessment(toolName) { return (args, result) => {
  const data = C.parseObject(result?.capabilityData);
  const refs = source(result);
  const verdict = toolName === "verify_finding" && result?.outcome === "success" && ["verified", "failed", "partial", "inconclusive"].includes(data.verdict || data.status || result?.verification?.status)
    ? (data.verdict || data.status || result.verification.status) : outcomeState(result);
  const state = verdict === "verified" ? "verified" : verdict === "failed" ? "failed" : verdict === "partial" ? "inconclusive" : outcomeState(result);
  return { records: [C.record({ kind: "assessment", claimState: state, subject: C.text(args.findingId || args.requestId || args.url || toolName, 1000), value: { tool: toolName, method: C.text(args.method || "", 16).toUpperCase(), url: C.canonicalUrl(args.url || ""), statusCode: Number.isFinite(Number(data.statusCode || data.status)) ? Number(data.statusCode || data.status) : null, verdict: C.text(verdict, 80) }, source: refs, required: state === "verified" || state === "failed", template: "assessment" })] };
}; }
function retrieval(toolName) { return (args, result, workspace) => ({ records: [C.record({ kind: "retrieval", claimState: outcomeState(result), subject: C.canonicalPath(args.path || args.query || toolName, workspace), value: { tool: toolName, coverage: C.text(result?.capabilityData?.coverage || result?.capabilityData?.outputCompleteness || "unknown", 80) }, source: source(result), template: "retrieval" })] }); }
function exec(args, result, workspace) { const data = C.parseObject(result?.capabilityData); return { records: [C.record({ kind: "execution", claimState: outcomeState(result), subject: C.canonicalPath(data.cwd || args.cwd || "", workspace) || "exec_command", value: { tool: "exec_command", exitCode: Number.isFinite(Number(data.exitCode)) ? Number(data.exitCode) : null, status: C.text(data.status || result?.outcome || "", 80), timedOut: Boolean(data.timedOut), outputCompleteness: C.text(data.outputCompleteness || "unknown", 80) }, source: source(result), required: result?.outcome !== "success", template: "execution" })] }; }
const PARSERS = Object.freeze({
  ask_questions: lifecycle("ask_questions"), update_task_list: mutation("update_task_list", "taskId"), exec_command: exec,
  read_file: retrieval("read_file"), search_workspace: retrieval("search_workspace"), apply_patch: applyPatch, inspect_environment: retrieval("inspect_environment"), manage_plan: mutation("manage_plan", "planId"), manage_state: mutation("manage_state", "key"), manage_identity: mutation("manage_identity", "identityId"), store_finding: mutation("store_finding", "findingId"), attack_graph: mutation("attack_graph", "nodeId"),
  ingest_traffic: assessment("ingest_traffic"), replay_request: assessment("replay_request"), run_test_case: assessment("run_test_case"), browser_action: assessment("browser_action"), compare_responses: assessment("compare_responses"), verify_finding: assessment("verify_finding"), delegate_agent: lifecycle("delegate_agent"),
  query_assessment: retrieval("query_assessment"), expand_evidence: retrieval("expand_evidence"), query_knowledge: retrieval("query_knowledge"), web_research: retrieval("web_research"),
});
function assertParserCoverage() { const missing = TOOL_REGISTRY_NAMES.filter((name) => typeof PARSERS[name] !== "function"); if (missing.length) throw new Error(`Context capsule parser classification missing: ${missing.join(", ")}`); return true; }
function parseToolResult({ toolName, args, lifecycleResult, workspace }) {
  if (!C.lifecycleValid(lifecycleResult)) return { records: [], residues: [{ reason: "invalid_lifecycle_integrity", source: source(lifecycleResult || {}) }] };
  const parser = PARSERS[toolName];
  if (!parser) return { records: [C.record({ kind: "execution", claimState: outcomeState(lifecycleResult), subject: `${C.text(toolName, 160) || "dynamic"} execution`, value: { dynamic: true, outcome: lifecycleResult.outcome }, source: source(lifecycleResult), template: "execution" })], residues: [{ reason: "unknown_or_dynamic_tool", source: source(lifecycleResult) }] };
  try { return parser(args || {}, lifecycleResult, workspace || ""); } catch { return { records: [], residues: [{ reason: "parser_failed_closed", source: source(lifecycleResult) }] }; }
}
assertParserCoverage();
module.exports = { PARSERS, assertParserCoverage, parseToolResult };
