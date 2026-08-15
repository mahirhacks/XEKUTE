"use strict";

/* Model-facing loop vocabulary. Runtime state and scope decisions live in
 * agent/runtime and agent/authority/scope respectively. */
const PHASES = Object.freeze(["preflight", "inventory", "hypothesis", "test-design", "execution", "observation", "verification", "finding", "report", "retest", "complete"]);
const ITERATION_FIELDS = Object.freeze(["objective", "knownFacts", "unknowns", "hypothesis", "supportingSignal", "rejectingSignal", "smallestAction", "completionCriteria", "nextPhase"]);
const WSTG_CATEGORIES = Object.freeze({
  preflight: "WSTG-INFO (scope and engagement context)",
  inventory: "WSTG-INFO (attack surface and entry points)",
  hypothesis: "WSTG category and OWASP Top 10 theme",
  "test-design": "WSTG technique mapping and expected signals",
  execution: "Scoped probe per WSTG check",
  observation: "Evidence linked to the hypothesis",
  verification: "False-positive controls and verdict",
  finding: "Evidence-backed finding or inconclusive result",
  report: "Coverage, limitations, remediation, and retest",
});
const COMPLETION_CRITERIA = Object.freeze({
  preflight: "scope-context-recorded",
  inventory: "attack-surface-recorded",
  hypothesis: "testable-hypothesis-recorded",
  "test-design": "supporting-and-rejecting-signals-defined",
  execution: "action-reached-terminal-state",
  observation: "observations-linked-to-evidence",
  verification: "false-positive-checks-recorded",
  finding: "finding-status-recorded",
  report: "coverage-and-limitations-reported",
  retest: "retest-status-recorded",
  complete: "terminal-turn-recorded",
});
const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "inconclusive"]);

module.exports = { PHASES, ITERATION_FIELDS, WSTG_CATEGORIES, COMPLETION_CRITERIA, TERMINAL_STATUSES };
