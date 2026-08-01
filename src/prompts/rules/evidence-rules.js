/* Allowed lifecycle states for durable assessment records. */

const CLAIM_STATES = new Set(["observed", "inferred", "hypothesis", "verified", "rejected", "inconclusive", "unsupported"]);
const HYPOTHESIS_STATES = new Set(["proposed", "ready", "testing", "supported", "rejected", "inconclusive"]);
const COVERAGE_STATES = new Set(["not-tested", "in-progress", "passed", "failed", "blocked", "not-applicable"]);
const VERDICTS = new Set(["accept", "reject", "inconclusive"]);

module.exports = { CLAIM_STATES, HYPOTHESIS_STATES, COVERAGE_STATES, VERDICTS };
