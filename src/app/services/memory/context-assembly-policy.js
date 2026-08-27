"use strict";

const {
  createObjectiveClassification,
  OBJECTIVE_KINDS,
} = require("../../../contracts/memory/context-assembly-contracts.js");

const DOMAIN_ORDER = Object.freeze([
  "checkpoint",
  "recent_tail",
  "project",
  "investigation",
  "evidence",
  "knowledge",
  "graph",
  "artifact",
]);

// These policies are deliberately data-only. They select what may be read;
// they never grant tool authority, change scope, or promote a record.
const PACKET_POLICIES = Object.freeze({
  recon: Object.freeze({
    id: "context:recon:v1",
    domains: Object.freeze(["checkpoint", "recent_tail", "project", "investigation", "knowledge", "graph", "artifact"]),
    graphDepth: 2,
    expandArtifacts: false,
    sensitivityCeiling: "confidential",
    weights: Object.freeze({ checkpoint: 0.08, recent_tail: 0.20, project: 0.24, investigation: 0.18, knowledge: 0.16, graph: 0.10, artifact: 0.04 }),
    limits: Object.freeze({ project: 80, investigation: 60, knowledge: 40, graph: 80, artifact: 20 }),
  }),
  authentication: Object.freeze({
    id: "context:authentication:v1",
    domains: Object.freeze(["checkpoint", "recent_tail", "project", "investigation", "knowledge", "graph", "artifact"]),
    graphDepth: 2,
    expandArtifacts: false,
    sensitivityCeiling: "confidential",
    weights: Object.freeze({ checkpoint: 0.08, recent_tail: 0.22, project: 0.24, investigation: 0.22, knowledge: 0.16, graph: 0.06, artifact: 0.02 }),
    limits: Object.freeze({ project: 80, investigation: 80, knowledge: 50, graph: 50, artifact: 12 }),
  }),
  authorization: Object.freeze({
    id: "context:authorization:v1",
    domains: Object.freeze(["checkpoint", "recent_tail", "project", "investigation", "evidence", "knowledge", "graph", "artifact"]),
    graphDepth: 2,
    expandArtifacts: false,
    sensitivityCeiling: "confidential",
    weights: Object.freeze({ checkpoint: 0.07, recent_tail: 0.18, project: 0.22, investigation: 0.25, evidence: 0.08, knowledge: 0.12, graph: 0.06, artifact: 0.02 }),
    limits: Object.freeze({ project: 80, investigation: 100, evidence: 20, knowledge: 50, graph: 60, artifact: 12 }),
  }),
  evidence_review: Object.freeze({
    id: "context:evidence-review:v1",
    domains: Object.freeze(["checkpoint", "recent_tail", "project", "investigation", "evidence", "graph", "artifact", "knowledge"]),
    graphDepth: 2,
    expandArtifacts: false,
    sensitivityCeiling: "confidential",
    weights: Object.freeze({ checkpoint: 0.06, recent_tail: 0.16, project: 0.14, investigation: 0.20, evidence: 0.27, graph: 0.07, artifact: 0.08, knowledge: 0.02 }),
    limits: Object.freeze({ project: 50, investigation: 80, evidence: 100, graph: 50, artifact: 40, knowledge: 20 }),
  }),
  reporting: Object.freeze({
    id: "context:reporting:v1",
    domains: Object.freeze(["checkpoint", "recent_tail", "project", "investigation", "evidence", "artifact"]),
    graphDepth: 1,
    expandArtifacts: false,
    sensitivityCeiling: "confidential",
    weights: Object.freeze({ checkpoint: 0.10, recent_tail: 0.15, project: 0.18, investigation: 0.22, evidence: 0.30, artifact: 0.05 }),
    limits: Object.freeze({ project: 60, investigation: 80, evidence: 120, artifact: 25 }),
  }),
  project_editing: Object.freeze({
    id: "context:project-editing:v1",
    domains: Object.freeze(["checkpoint", "recent_tail", "project"]),
    graphDepth: 0,
    expandArtifacts: false,
    sensitivityCeiling: "internal",
    weights: Object.freeze({ checkpoint: 0.18, recent_tail: 0.28, project: 0.54 }),
    limits: Object.freeze({ project: 120 }),
  }),
  generic: Object.freeze({
    id: "context:generic:v1",
    domains: Object.freeze(["checkpoint", "recent_tail", "project"]),
    graphDepth: 0,
    expandArtifacts: false,
    sensitivityCeiling: "internal",
    weights: Object.freeze({ checkpoint: 0.20, recent_tail: 0.35, project: 0.45 }),
    limits: Object.freeze({ project: 40 }),
  }),
});

const CLASSIFIERS = Object.freeze([
  ["reporting", /\b(?:report|write\s*up|export|summari[sz]e|remediation\s+advice|executive\s+summary)\b/i],
  ["evidence_review", /\b(?:finding|vulnerabilit(?:y|ies)|proof|evidence|impact|retest|reproduction|confirmed|verification)\b/i],
  ["authorization", /\b(?:authori[sz]ation|access\s*control|idor|privilege|permission|role(?:\s+based)?|tenant|horizontal|vertical|object\s+level)\b/i],
  ["authentication", /\b(?:auth(?:entication|n)?|login|log\s*in|logout|session|cookie|token|csrf|mfa|oauth|sso|jwt|credential)\b/i],
  ["recon", /\b(?:recon(?:naissance)?|enumerat|discover|map(?:ping)?|endpoint|route|subdomain|hostname|surface|technology|service|listener)\b/i],
  ["project_editing", /\b(?:project\s+memory|rules?\s+of\s+engagement|scope\s+(?:file|setting|change)|edit(?:ing)?\s+(?:the\s+)?project|target\s+configuration|memory\s+configuration)\b/i],
]);

function policyFor(kind) { return PACKET_POLICIES[kind] || PACKET_POLICIES.generic; }

function classifyObjective({ objective = "", mode = "agent" } = {}) {
  const text = String(objective || "").replace(/[\u0000\r\n]/g, " ").trim().slice(0, 2_000);
  const normalizedMode = String(mode || "agent").trim().toLowerCase().slice(0, 80) || "agent";
  let kind = "generic";
  for (const [candidate, pattern] of CLASSIFIERS) {
    if (pattern.test(text)) { kind = candidate; break; }
  }
  // Explicit reporting/review modes can refine otherwise generic wording,
  // but the mode still cannot authorize tools or widen the assessment scope.
  if (kind === "generic" && /\b(?:report|finding|evidence)\b/i.test(normalizedMode)) kind = normalizedMode.includes("report") ? "reporting" : "evidence_review";
  const policy = policyFor(kind);
  return createObjectiveClassification({
    kind,
    objective: text,
    mode: normalizedMode,
    confidence: kind === "generic" ? "fallback" : "deterministic",
    domains: policy.domains,
    policy_id: policy.id,
  });
}

function budgetForPolicy(policy, tokenBudget) {
  const total = Math.max(0, Number(tokenBudget) || 0);
  const weights = policy?.weights || {};
  return Object.fromEntries(DOMAIN_ORDER
    .filter((domain) => policy?.domains?.includes(domain))
    .map((domain) => [domain, Math.max(0, Math.floor(total * (Number(weights[domain]) || 0)))]));
}

function limitForPolicy(policy, domain, fallback = 50) {
  return Math.max(1, Math.min(200, Number(policy?.limits?.[domain] || fallback)));
}

module.exports = Object.freeze({
  DOMAIN_ORDER,
  PACKET_POLICIES,
  OBJECTIVE_KINDS,
  classifyObjective,
  policyFor,
  budgetForPolicy,
  limitForPolicy,
});
