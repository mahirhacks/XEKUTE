/** Central agent-loop tunables — single place to adjust runtime behavior. */
const Tunables = {
  // Zero is the explicit unlimited sentinel. Multi-day work is stopped by the
  // operator, scope/policy denial, provider failure, or an explicitly supplied
  // operation deadline—not by an arbitrary model/tool round count.
  MAX_AGENT_ROUNDS: 0,
  MAX_EDIT_RETRIES_WITHOUT_TOOLS: 1,
  MAX_PLAN_RETRIES_WITHOUT_FILE: 3,
  MAX_VERIFICATION_REMINDERS: 1,
  MAX_FAILED_VERIFICATION_REMINDERS: 1,
  REPEAT_CLASS_LIMIT: 2,
  COMMAND_RESPONSE_BUFFER_CHARS: 220,
  TURN_PROMPT_TOKEN_BUDGET_RATIO: 0.85,
  TURN_WALL_CLOCK_MS: 0,
  LONG_HORIZON_CHECKPOINT_EVERY_ROUNDS: 1,
  LONG_HORIZON_STALE_RUN_MS: 30 * 60 * 1000,
  FAILURE_RECORD_TTL_MS: 24 * 60 * 60 * 1000,
  OPERATOR_QUESTIONS_TIMEOUT_MS: 0,
  TEMPERATURE_AGENT: 0.1,
  TEMPERATURE_READ_ONLY: 0.2,
  TEMPERATURE_SUMMARY: 0,
  ROUNDS_LEFT_WARNING_THRESHOLD: 3,
  TASK_BRIEF_UPDATE_AFTER_ROUND: 1,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = Tunables;
}

if (typeof globalThis !== "undefined") {
  globalThis.AgentTunables = Tunables;
}
