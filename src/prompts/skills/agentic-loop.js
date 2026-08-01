/* Reusable assessment-loop knowledge. Runtime state transitions consume this. */

const PHASES = Object.freeze([
  "preflight", "inventory", "hypothesis", "test-design", "approval", "execution",
  "observation", "verification", "finding", "report", "retest", "complete",
]);

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

module.exports = { PHASES, COMPLETION_GATES, TERMINAL_STATUSES };
