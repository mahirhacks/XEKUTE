/* Reusable assessment-loop knowledge. Runtime state transitions consume this. */

const PHASES = Object.freeze([
  "preflight", "inventory", "hypothesis", "test-design", "approval", "execution",
  "observation", "verification", "finding", "report", "retest", "complete",
]);

const ITERATION_FIELDS = Object.freeze([
  "objective", "knownFacts", "unknowns", "hypothesis", "supportingSignal",
  "rejectingSignal", "smallestAction", "completionGate", "nextPhase",
]);

const WSTG_CATEGORIES = Object.freeze({
  preflight: "WSTG-INFO (scope/authorization review)",
  inventory: "WSTG-INFO (attack surface, entry points, architecture)",
  hypothesis: "WSTG category selection + OWASP Top 10:2025 theme",
  "test-design": "WSTG technique mapping (CONF, ATHN, ATHZ, SESS, INPV, APIT, BUSL, CLNT, CRYP, ERRH)",
  execution: "Approved probe per WSTG check ID",
  observation: "Evidence linked to hypothesis and checklist item",
  verification: "False-positive controls per WSTG guidance",
  finding: "Top 10:2025 classification with evidence gate",
  report: "WSTG + Top 10 coverage matrix",
});

const COMPLETION_GATES = Object.freeze({
  preflight: "authorization-scope-and-roe-reviewed",
  inventory: "attack-surface-inventory-recorded",
  hypothesis: "testable-hypothesis-recorded",
  "test-design": "supporting-and-rejecting-signals-defined",
  approval: "action-policy-decision-recorded",
  execution: "approved-action-reached-terminal-state",
  observation: "observations-linked-to-evidence",
  verification: "false-positive-checks-and-verdict-recorded",
  finding: "finding-promotion-gate-passed-or-inconclusive",
  report: "coverage-limitations-and-evidence-reported",
  retest: "retest-status-recorded",
  complete: "terminal-run-record-written",
});

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped", "inconclusive"]);

module.exports = { PHASES, ITERATION_FIELDS, WSTG_CATEGORIES, COMPLETION_GATES, TERMINAL_STATUSES };
