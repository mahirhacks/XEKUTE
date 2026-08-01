/* Safe outcomes used after a failed, partial, denied, or ambiguous action. */

const FAILURE_OUTCOMES = Object.freeze([
  "retry-with-materially-changed-arguments",
  "use-safer-alternative",
  "mark-inconclusive",
  "pause-for-operator",
  "stop",
]);

const { VERDICTS } = require("../rules/evidence-rules");

function failureState(result = {}) {
  if (result.error || result.ok === false) return "failed";
  if (result.timedOut || result.status === "timeout") return "timeout";
  if (["partial", "aborted"].includes(result.status)) return result.status;
  return "complete";
}

module.exports = { FAILURE_OUTCOMES, VERDICTS, failureState };
