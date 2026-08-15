/* Agentic decision helpers. Model-facing wording stays in instructs/. */

const TriagePrompts = require("../instructions/triage.js");

function retryPrompt(input) { return TriagePrompts.actionRetry(input); }
function summaryPrompt(input) { return TriagePrompts.postToolSummary(input); }
function groundingPrompt(userMessage) { return TriagePrompts.planGrounding(userMessage); }
function verificationPrompt({ userMessage, mutatedFiles } = {}) {
  return TriagePrompts.verification({ userMessage, mutatedFiles: [...(mutatedFiles || [])] });
}
function failedVerificationPrompt(input) { return TriagePrompts.failedVerification(input); }

module.exports = { retryPrompt, summaryPrompt, groundingPrompt, verificationPrompt, failedVerificationPrompt };
