/* Shared professional web/API assessment vocabulary and scope. */

const CLAIM_STATES = Object.freeze(["observed", "inferred", "hypothesis", "verified", "rejected", "inconclusive", "unsupported"]);
const SUPPORTED_DOMAINS = Object.freeze(["web", "api", "external-perimeter"]);
const EXCLUDED_DOMAINS = Object.freeze(["active-directory", "mobile", "wireless", "internal-network", "social-engineering", "cloud-control-plane"]);

const HYPOTHESIS_FIELDS = Object.freeze([
  "objective", "knownFacts", "unknowns", "hypothesis", "supportingSignal",
  "rejectingSignal", "smallestAction", "completionGate", "nextPhase",
]);

module.exports = { CLAIM_STATES, SUPPORTED_DOMAINS, EXCLUDED_DOMAINS, HYPOTHESIS_FIELDS };
