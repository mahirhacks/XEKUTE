"use strict";

function computeOrchestrationHold(coordinator, parentKey, { parentContinuationScheduled = false, descriptor = null } = {}) {
  const key = String(parentKey || "");
  if (!key || !coordinator) return false;
  if (typeof coordinator.hasActiveChildren === "function" && coordinator.hasActiveChildren(key)) return true;
  if (typeof coordinator.hasUnconsumedResults === "function" && coordinator.hasUnconsumedResults(key)) return true;
  const parent = coordinator.parents?.get?.(key);
  if (parent?.processingResultId) return true;
  if (parentContinuationScheduled) return true;
  if (descriptor?.scheduled) return true;
  return false;
}

module.exports = {
  computeOrchestrationHold,
};
