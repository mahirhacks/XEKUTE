"use strict";

const { operationFailure, clone } = require("../../storage/memory/memory-storage-utils.js");

const OPTIMISTIC_MEMORY_COMMIT_VERSION = 1;
const DEFAULT_MAX_ATTEMPTS = 3;
const REVISION_CONFLICT_CODES = new Set([
  "MEMORY_REVISION_CONFLICT",
  "MEMORY_PROJECT_REVISION_CONFLICT",
  "MEMORY_INVESTIGATION_REVISION_CONFLICT",
  "MEMORY_EVIDENCE_REVISION_CONFLICT",
]);

function isRevisionConflict(result) {
  return REVISION_CONFLICT_CODES.has(String(result?.code || result?.error?.code || ""));
}

async function commitWithRevisionRetry({
  operationId = "",
  read,
  build,
  commit,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  isConflict = isRevisionConflict,
} = {}) {
  if (typeof read !== "function" || typeof build !== "function" || typeof commit !== "function") throw new TypeError("Optimistic memory commit requires read, build, and commit functions.");
  const attempts = Math.max(1, Math.min(10, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  const history = [];
  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const loaded = await read({ attempt });
    if (!loaded?.ok) return loaded || operationFailure("MEMORY_OPTIMISTIC_READ_FAILED", "The canonical memory state could not be read.", {}, true);
    let plan;
    try { plan = await build(loaded, { attempt }); }
    catch (error) { return operationFailure(error.code || "MEMORY_OPTIMISTIC_BUILD_FAILED", error.message, error.details || {}); }
    if (!plan?.ok) return plan;
    if (plan.changed === false || plan.commands?.length === 0 && plan.result) return plan.result;
    let committed;
    try { committed = await commit(plan, loaded, { attempt }); }
    catch (error) { committed = operationFailure(error.code || "MEMORY_OPTIMISTIC_COMMIT_FAILED", error.message, error.details || {}, Boolean(error.retryable)); }
    lastResult = committed;
    history.push({ attempt, code: committed?.code || "", revision: Number(committed?.revision ?? committed?.currentRevision ?? 0) || 0 });
    if (committed?.ok) return { ...committed, retry: { attempts: attempt, history } };
    if (!isConflict(committed) || attempt >= attempts) {
      if (isConflict(committed)) return { ...committed, retryable: true, details: { ...(committed.details || {}), attempts, history }, code: committed.code || "MEMORY_CONCURRENT_RETRY_EXHAUSTED" };
      return committed;
    }
  }
  return { ...(lastResult || operationFailure("MEMORY_CONCURRENT_RETRY_EXHAUSTED", "The canonical memory commit could not converge.", {}, true)), retryable: true, details: { ...(lastResult?.details || {}), attempts, history } };
}

module.exports = Object.freeze({
  OPTIMISTIC_MEMORY_COMMIT_VERSION,
  DEFAULT_MAX_ATTEMPTS,
  REVISION_CONFLICT_CODES: [...REVISION_CONFLICT_CODES],
  isRevisionConflict,
  commitWithRevisionRetry,
});
