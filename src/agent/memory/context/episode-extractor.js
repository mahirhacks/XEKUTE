"use strict";

const crypto = require("node:crypto");
const { redactStructuredValue, redactSecrets } = require("../../../shared/secret-redaction.js");

function text(value, maximum = 4_000) {
  return redactSecrets(String(value == null ? "" : value).replace(/\u0000/g, "").trim()).slice(0, maximum);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function stableId(prefix, value) {
  return `${prefix}:${crypto.createHash("sha256").update(canonical(value)).digest("hex").slice(0, 24)}`;
}

function parseToolContent(content) {
  const source = String(content || "").trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

function evidenceRefsFrom(value) {
  const source = value && typeof value === "object" ? value : {};
  const data = source.payload && typeof source.payload === "object" ? source.payload : {};
  return [...new Set([
    ...(Array.isArray(source.evidenceIds) ? source.evidenceIds : []),
    ...(Array.isArray(source.evidence_refs) ? source.evidence_refs : []),
    ...(Array.isArray(data.evidenceIds) ? data.evidenceIds : []),
    ...(Array.isArray(data.evidence_refs) ? data.evidence_refs : []),
  ].map((entry) => text(entry, 300)).filter(Boolean))].slice(0, 100);
}

function messageText(message) {
  if (typeof message === "string") return message;
  return message?.content || message?.text || "";
}

function extractExplicitDecisions(messages = []) {
  const decisions = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== "user") continue;
    const value = text(messageText(message), 4_000);
    if (!value) continue;
    const promotion = value.match(/(?:remember|save|keep)\s+(?:this|that)\s+(?:for|in)\s+(?:the\s+)?project\s*[:\-]?\s*([\s\S]+)/i);
    if (promotion) {
      decisions.push({
        id: stableId("decision", promotion[1]),
        summary: text(promotion[1], 2_000),
        kind: "explicit_project_memory",
        sourceRefs: [text(message.id || "", 240)].filter(Boolean),
        confidence: "explicit",
      });
    }
  }
  return decisions;
}

function extractProjectDelta({ messages = [], events = [], sessionId = "", blockId = "", workflow = null, outcome = "completed" } = {}) {
  const safeMessages = Array.isArray(messages) ? messages.slice(-400) : [];
  const safeEvents = Array.isArray(events) ? events.slice(-400) : [];
  const evidenceRefs = new Set();
  const observations = [];
  const findings = [];
  const completedWork = [];
  const completedPlans = [];
  const completedRuns = [];
  const failures = [];
  const negativeResults = [];
  const relationships = [];
  const anomalies = [];
  const knownGaps = [];

  for (const message of safeMessages) {
    if (message?.role === "tool") {
      const parsed = parseToolContent(message.content) || {};
      const refs = evidenceRefsFrom(parsed);
      refs.forEach((ref) => evidenceRefs.add(ref));
      const toolName = text(message.tool_name || message.toolName || message.name || "tool", 160);
      const failed = Boolean(parsed.error || parsed.errorCode || parsed.code && parsed.ok === false || parsed.ok === false);
      // `payload` is the model-facing projection and may contain raw file
      // contents, knowledge packets, MCP results, or other large artifacts.
      // Project LTM is a durable fact store, not a transcript or lease cache;
      // only explicitly controlled status/error text may cross this boundary.
      const summary = text(parsed.summary || parsed.status || parsed.error || "", 2_000);
      if (failed) {
        failures.push({ id: stableId("failure", { toolName, summary }), summary: `${toolName}: ${summary || "tool failed"}`, toolName, outcome: "failed", sourceRefs: refs });
      } else if (summary || refs.length) {
        completedWork.push({ id: stableId("work", { toolName, summary, refs }), summary: `${toolName}: ${summary || "completed"}`, toolName, outcome: "completed", sourceRefs: refs });
      }
      continue;
    }
    const value = text(messageText(message), 4_000);
    if (!value) continue;
    if (message?.role === "assistant") {
      const hypothesis = value.match(/(?:hypothesis|the working theory|likely explanation)\s*[:\-]\s*([\s\S]{20,2000})/i);
      if (hypothesis) {
        observations.push({ id: stableId("observation", hypothesis[1]), summary: text(hypothesis[1], 2_000), kind: "assistant_observation", sourceRefs: [text(message.id || "", 240)].filter(Boolean) });
      }
      const finding = value.match(/(?:finding|vulnerability|confirmed issue)\s*[:\-]\s*([\s\S]{20,2000})/i);
      if (finding) findings.push({ id: stableId("finding", finding[1]), summary: text(finding[1], 2_000), status: /confirmed|verified/i.test(value) ? "verified" : "candidate", sourceRefs: [text(message.id || "", 240)].filter(Boolean) });
    }
  }

  for (const event of safeEvents) {
    const refs = evidenceRefsFrom(event);
    refs.forEach((ref) => evidenceRefs.add(ref));
    const toolName = text(event.toolName || event.tool || "", 160);
    if (event.type === "tool_usage" && toolName) completedWork.push({ id: stableId("tool-use", { toolName, blockId }), summary: `Used ${toolName}`, toolName, outcome: "used", sourceRefs: refs });
    if (event.type === "tool_failed" || event.outcome === "failed") failures.push({ id: stableId("failure", { toolName, error: event.error, blockId }), summary: text(event.error || `${toolName || "Action"} failed`, 2_000), toolName, outcome: "failed", sourceRefs: refs });
    if (event.type === "negative_result" || event.negativeResult) negativeResults.push({ id: stableId("negative", event), summary: text(event.summary || event.reason || "Negative result", 2_000), sourceRefs: refs, confidence: text(event.confidence || "observed", 80) });
    if (event.type === "evidence_relationship" || event.relationship) relationships.push({ id: stableId("relationship", event), summary: text(event.summary || event.relationship || "Evidence relationship", 2_000), from: text(event.from || event.source || "", 300), to: text(event.to || event.target || "", 300), relation: text(event.relation || "related", 120), sourceRefs: refs });
    if (event.type === "anomaly" || event.anomaly) anomalies.push({ id: stableId("anomaly", event), summary: text(event.summary || event.anomaly || "Anomaly observed", 2_000), sourceRefs: refs, confidence: text(event.confidence || "observed", 80) });
    if (event.type === "finding_status") findings.push({ id: text(event.findingId || stableId("finding", event), 240), summary: text(event.summary || "Finding status changed", 2_000), status: text(event.outcome || "updated", 80), sourceRefs: refs });
    if (event.type === "plan_completed") completedPlans.push({ id: stableId("plan", event.planId || event), summary: text(event.summary || event.planId || "Plan completed", 2_000), planId: text(event.planId || "", 240), sourceRefs: refs });
    if (event.type === "run_completed" || event.type === "agent_turn_completed") completedRuns.push({ id: stableId("run", event.runId || event), summary: text(event.summary || event.runId || "Run completed", 2_000), runId: text(event.runId || "", 240), outcome: text(event.outcome || "completed", 80), sourceRefs: refs });
    if (event.type === "evidence_gap" || event.type === "question_skipped") knownGaps.push({ id: stableId("gap", event), summary: text(event.reason || event.prompt || "Evidence gap remains unresolved.", 2_000), sourceRefs: refs });
  }

  const delta = {
    sessionId: text(sessionId, 240),
    blockId: text(blockId, 240),
    outcome: text(outcome, 80),
    observations,
    findings,
    completedWork,
    completedPlans,
    completedRuns,
    failures,
    negativeResults,
    knownGaps,
    relationships,
    anomalies,
    evidenceRefs: [...evidenceRefs].map((ref) => ({ id: ref, ref, summary: `Evidence reference ${ref}`, sourceRefs: [ref] })),
    decisions: extractExplicitDecisions(safeMessages),
  };
  if (workflow?.hypothesis && typeof workflow.hypothesis === "object") {
    const hypothesis = redactStructuredValue(workflow.hypothesis);
    delta.activeHypothesis = {
      ...hypothesis,
      id: text(hypothesis.id || "active", 240),
      summary: text(hypothesis.statement || hypothesis.summary || "", 4_000),
      sourceRefs: [...new Set([...(hypothesis.evidenceRefs || []), ...[...evidenceRefs]])].map((ref) => text(ref, 300)).filter(Boolean).slice(0, 100),
    };
  }
  return delta;
}

module.exports = { extractProjectDelta, stableId, evidenceRefsFrom };
