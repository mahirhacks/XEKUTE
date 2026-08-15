"use strict";

/** Provider-neutral continuation loop seam used by the controller. */
async function runModelRounds({ maxRounds = 1, runRound, onRound = () => {}, shouldContinue = () => true } = {}) {
  if (typeof runRound !== "function") throw new TypeError("runRound is required");
  const results = [];
  for (let round = 0; round < Math.max(1, Number(maxRounds) || 1); round += 1) {
    if (!shouldContinue(round, results)) break;
    const result = await runRound(round);
    results.push(result);
    await onRound(result, round);
    if (result?.done || result?.error) break;
  }
  return results;
}

module.exports = { runModelRounds };
