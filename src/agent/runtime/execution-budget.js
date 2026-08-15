"use strict";

function createExecutionBudget({ maxRounds = 0, wallClockMs = 0, startedAt = Date.now() } = {}) {
  const limit = Number(maxRounds) > 0 ? Math.floor(Number(maxRounds)) : null;
  const deadline = Number(wallClockMs) > 0 ? startedAt + Number(wallClockMs) : null;
  return Object.freeze({
    maxRounds: limit,
    startedAt,
    deadline,
    canContinue(round = 0, now = Date.now()) { return (limit === null || Number(round) < limit) && (deadline === null || Number(now) <= deadline); },
    remainingRounds(round = 0) { return limit === null ? Infinity : Math.max(0, limit - Number(round)); },
    expired(now = Date.now()) { return deadline !== null && Number(now) > deadline; },
  });
}

module.exports = { createExecutionBudget };
