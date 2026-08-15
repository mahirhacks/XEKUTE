"use strict";

const {
  validateInput,
  evaluateObservation,
} = require("../../../agent/tools/assessment/run-test-case.js");
const { redactStructuredValue } = require("../../../shared/secret-redaction.js");

const MAX_STEP_OBSERVED_CHARS = 24_000;
const MAX_TOTAL_EVIDENCE_CHARS = 160_000;
const MAX_TOTAL_EXECUTIONS = 1_000;
const TRUNCATION_SUMMARY_RESERVE = 512;

function productionTestStepInput(step) {
  const input = step?.input && typeof step.input === "object" && !Array.isArray(step.input)
    ? JSON.parse(JSON.stringify(step.input))
    : {};
  if (step?.identityId !== undefined && input.identityId === undefined) input.identityId = step.identityId;
  if (step?.pageId !== undefined && input.pageId === undefined) input.pageId = step.pageId;
  if (step?.execution !== undefined && input.execution === undefined) input.execution = step.execution;
  return input;
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch { return ""; }
}

function boundedProjection(value, maxChars = MAX_STEP_OBSERVED_CHARS) {
  const sanitized = redactStructuredValue(value);
  const walk = (item, depth = 0) => {
    if (item === null || item === undefined || ["boolean", "number"].includes(typeof item)) return item;
    if (typeof item === "string") return item.slice(0, 8_000);
    if (depth >= 5) return "[truncated]";
    if (Array.isArray(item)) return item.slice(0, 100).map((child) => walk(child, depth + 1));
    if (typeof item === "object") return Object.fromEntries(Object.entries(item).slice(0, 100).map(([key, child]) => [String(key).slice(0, 120), walk(child, depth + 1)]));
    return undefined;
  };
  const output = walk(sanitized);
  const serialized = safeJson(output);
  if (serialized.length <= maxChars) return output;
  return { summary: serialized.slice(0, Math.max(0, maxChars - 32)), truncated: true };
}

function evidenceIdsFromResult(result) {
  return [...new Set([
    result?.evidenceId,
    result?.evidence?.id,
    result?.value?.evidenceId,
    ...(Array.isArray(result?.evidenceIds) ? result.evidenceIds : []),
    ...(Array.isArray(result?.value?.evidenceIds) ? result.value.evidenceIds : []),
  ].filter(Boolean).map(String))];
}

function capEvidence(entries) {
  const output = [];
  let total = 0;
  let omittedCount = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const candidate = { ...entry, observed: boundedProjection(entry.observed, MAX_STEP_OBSERVED_CHARS) };
    const size = safeJson(candidate).length;
    if (total + size <= MAX_TOTAL_EVIDENCE_CHARS - TRUNCATION_SUMMARY_RESERVE) {
      output.push(candidate);
      total += size;
      continue;
    }
    omittedCount += 1;
  }
  if (omittedCount) output.push({
    type: "summary",
    stepId: "__truncated__",
    action: "evidence_limit",
    omittedCount,
    observed: { summary: "Additional step evidence was omitted after the test-case result limit was reached.", truncated: true },
  });
  return { entries: output, omittedCount };
}

function minimumLimit(primary, secondary, fallback) {
  const first = Number(primary);
  const second = Number(secondary);
  if (Number.isFinite(first) && Number.isFinite(second)) return Math.max(fallback, Math.min(first, second));
  if (Number.isFinite(first)) return Math.max(fallback, first);
  if (Number.isFinite(second)) return Math.max(fallback, second);
  return fallback;
}

function createTestCaseRunner({ registry, executeToolCall, projectProfileProvider = () => null, planLimitsProvider = () => null, evidenceRecorder = null } = {}) {
  if (!registry || typeof registry.names !== "function") throw new TypeError("test-case runner requires a tool registry");
  if (typeof executeToolCall !== "function") throw new TypeError("test-case runner requires an execution callback");

  function limitsFor(workspace, planBinding) {
    const profile = projectProfileProvider(workspace) || {};
    const rules = profile.rulesOfEngagement || {};
    const plan = planBinding ? planLimitsProvider(workspace, planBinding) || {} : {};
    const configuredRate = Number.isFinite(Number(rules.requestsPerSecond)) || Number.isFinite(Number(rules.rateLimitPerSecond)) || Number.isFinite(Number(plan.requestsPerSecond));
    return {
      maximumConcurrency: minimumLimit(rules.maximumConcurrency, plan.maximumConcurrency, 1),
      requestsPerSecond: minimumLimit(rules.requestsPerSecond ?? rules.rateLimitPerSecond, plan.requestsPerSecond, 0.1),
      rateConfigured: configuredRate,
    };
  }

  return async function runTestCase({ workspace, input, signal = null, sessionId = "", mode = "agent", terminalHost = null, planBinding = null, authorityProfile = "approve_for_me", approvalProvider = null, durableRunId = "" } = {}) {
    const validation = validateInput(input);
    if (!validation.ok) return validation;
    const testCase = input.testCase;
    const knownActions = new Set(registry.names());
    const steps = testCase.steps;
    for (const step of steps) {
      if (!knownActions.has(step.action) || step.action === "run_test_case") {
        return { ok: false, error: { code: "INVALID_RUN_TEST_CASE_INPUT", message: `Unsupported executable test step: ${step.action}`, retryable: false } };
      }
      if (step.execution?.mode === "barrier" && step.action !== "replay_request") {
        return { ok: false, error: { code: "RUN_TEST_CASE_BARRIER_UNSUPPORTED", message: "Barrier groups support replay_request steps only.", retryable: false } };
      }
    }

    const limits = limitsFor(workspace, planBinding);
    const evidence = [];
    const observationsByStep = new Map();
    let anyFailed = false;
    let anyPartial = false;
    let stopped = false;
    let limitExceeded = false;
    let executedCount = 0;
    let nextRateAt = 0;

    function waitForRateDelay(waitMs) {
      if (waitMs <= 0) return Promise.resolve(!signal?.aborted);
      return new Promise((resolve) => {
        let settled = false;
        const finish = (allowed) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(allowed);
        };
        const onAbort = () => finish(false);
        const timer = setTimeout(() => finish(true), waitMs);
        if (signal?.aborted) finish(false);
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    }

    async function reserveRateSlot(count = 1) {
      if (!limits.rateConfigured) return !signal?.aborted;
      const rate = Math.max(0.1, Number(limits.requestsPerSecond) || 0.1);
      const now = Date.now();
      const start = Math.max(now, nextRateAt);
      const waitMs = Math.max(0, start - now);
      if (!(await waitForRateDelay(waitMs))) return false;
      nextRateAt = Math.max(start, Date.now()) + (count > 1 ? 1_000 : 1_000 / rate);
      return true;
    }

    async function executeStep(step, repetition = 1) {
      if (signal?.aborted) {
        stopped = true;
        return { ok: false, error: { code: "RUN_TEST_CASE_STOPPED", message: "The test case was stopped before this step ran.", retryable: false } };
      }
      if (executedCount >= MAX_TOTAL_EXECUTIONS) {
        limitExceeded = true;
        stopped = true;
        return { ok: false, error: { code: "RUN_TEST_CASE_EXECUTION_LIMIT", message: `The test case exceeded the ${MAX_TOTAL_EXECUTIONS}-execution limit.`, retryable: false } };
      }
      executedCount += 1;
      const nestedInput = productionTestStepInput(step);
      const result = await executeToolCall({
        workspace,
        toolCall: { function: { name: step.action, arguments: nestedInput } },
        signal,
        sessionId,
        mode,
        terminalHost,
        planBinding,
        nested: true,
        authorityProfile,
        approvalProvider,
        durableRunId,
      });
      if (signal?.aborted || result?.aborted || ["RUN_TEST_CASE_STOPPED", "BROWSER_ACTION_STOPPED", "REPLAY_REQUEST_STOPPED", "MCP_REQUEST_STOPPED"].includes(result?.code)) stopped = true;
      return { result, nestedInput };
    }

    async function appendObservation(step, repetition, outcome) {
      let result = outcome?.result || outcome;
      const baseObserved = result?.ok === false ? null : (result?.value ?? result ?? null);
      const boundedObserved = boundedProjection(baseObserved);
      const evidenceIds = evidenceIdsFromResult(result);
      if (typeof evidenceRecorder === "function") {
        try {
          const recorded = await evidenceRecorder({
            workspace,
            runId: planBinding?.runId || "",
            planId: planBinding?.planId || "",
            stepId: step.id,
            repetition,
            action: step.action,
            identityId: step.identityId || step.input?.identityId || "",
            pageId: step.pageId || step.input?.pageId || "main",
            result: boundedObserved,
          });
          evidenceIds.push(...evidenceIdsFromResult(recorded), ...(Array.isArray(recorded?.evidenceIds) ? recorded.evidenceIds.map(String) : []));
        } catch { /* Evidence persistence must not block the assessment runner. */ }
      }
      const comparison = step.compare;
      let observed = boundedObserved;
      if (comparison) {
        const previous = observationsByStep.get(comparison.stepId);
        if (previous === undefined) {
          result = { ok: false, error: { code: "RUN_TEST_CASE_COMPARISON_REFERENCE_MISSING", message: `Comparison step ${comparison.stepId} has not completed.`, retryable: false } };
          observed = null;
        } else {
          const comparisonResult = await executeToolCall({
            workspace,
            toolCall: {
              function: {
                name: "compare_responses",
                arguments: {
                  responses: [
                    comparisonResponse(comparison.stepId, previous),
                    comparisonResponse(step.id, boundedObserved),
                  ],
                  ...(Array.isArray(comparison.dimensions) && comparison.dimensions.length ? { compare: comparison.dimensions } : {}),
                },
              },
            },
            signal,
            sessionId,
            mode,
            terminalHost,
            planBinding,
            nested: true,
            authorityProfile,
            approvalProvider,
            durableRunId,
          });
          result = comparisonResult;
          observed = comparisonResult?.ok === false ? null : (comparisonResult?.value ?? comparisonResult ?? null);
        }
      }
      const stepResult = {
        stepId: step.id,
        action: step.action,
        ...(step.identityId || step.input?.identityId ? { identityId: step.identityId || step.input.identityId } : {}),
        ...(step.pageId || step.input?.pageId ? { pageId: step.pageId || step.input.pageId } : {}),
        ...(repetition > 1 ? { repetition } : {}),
        passed: false,
        partial: false,
        observed,
        failures: [],
        ...(evidenceIds.length ? { evidenceIds: [...new Set(evidenceIds.map(String))].slice(0, 20) } : {}),
      };
      if (result?.ok === false || result?.error) {
        const failure = result.error?.message || result.error?.error || result.error || result.message || "step executor reported failure";
        stepResult.failures.push(String(failure));
      }
      const matched = evaluateObservation(observed, step.expected);
      stepResult.failures.push(...matched.failures);
      if (stepResult.failures.length === 0) stepResult.passed = true;
      else {
        stepResult.partial = observed !== null && observed !== undefined && matched.matchedAny;
        anyFailed = true;
        if (stepResult.partial) anyPartial = true;
      }
      // Store the completed step only after its optional comparison has run so
      // a comparison can never accidentally resolve against the step itself.
      observationsByStep.set(step.id, boundedObserved);
      return stepResult;
    }

    let index = 0;
    while (index < steps.length) {
      if (signal?.aborted) { stopped = true; break; }
      const step = steps[index];
      const execution = step.execution || {};
      const executionMode = execution.mode || "single";
      const repetitions = Number(execution.repetitions) || 1;
      if (executionMode === "barrier") {
        const groupId = String(execution.groupId || "");
        const group = [];
        while (index < steps.length) {
          const candidate = steps[index];
          const candidateExecution = candidate.execution || {};
          if ((candidateExecution.mode || "single") !== "barrier" || String(candidateExecution.groupId || "") !== groupId) break;
          for (let repetition = 1; repetition <= (Number(candidateExecution.repetitions) || 1); repetition += 1) group.push({ step: candidate, repetition });
          index += 1;
        }
        const allowedByConcurrency = group.length <= limits.maximumConcurrency;
        const allowedByRate = group.length <= limits.requestsPerSecond;
        if (!allowedByConcurrency || !allowedByRate) {
          return { ok: false, error: { code: "RUN_TEST_CASE_BARRIER_LIMIT", message: `Barrier ${groupId} contains ${group.length} requests, exceeding the effective plan/project limit.`, retryable: false }, value: { testCaseId: testCase.id, evidence: capEvidence(evidence).entries } };
        }
        if (executedCount + group.length > MAX_TOTAL_EXECUTIONS) {
          limitExceeded = true;
          const capped = capEvidence(evidence);
          return { ok: false, error: { code: "RUN_TEST_CASE_EXECUTION_LIMIT", message: `The test case would exceed the ${MAX_TOTAL_EXECUTIONS}-execution limit.`, retryable: false }, value: { testCaseId: testCase.id, evidence: capped.entries, omittedEvidenceCount: capped.omittedCount } };
        }
        if (!(await reserveRateSlot(group.length))) { stopped = true; break; }
        const outcomes = await Promise.all(group.map(({ step: groupedStep, repetition }) => executeStep(groupedStep, repetition)));
        const groupEvidence = await Promise.all(outcomes.map((outcome, groupIndex) => appendObservation(group[groupIndex].step, group[groupIndex].repetition, outcome)));
        evidence.push(...groupEvidence);
        continue;
      }
      index += 1;
      for (let repetition = 1; repetition <= repetitions; repetition += 1) {
        if (!(await reserveRateSlot(1))) { stopped = true; break; }
        const outcome = await executeStep(step, repetition);
        evidence.push(await appendObservation(step, repetition, outcome));
        if (stopped) break;
      }
      if (stopped) break;
    }

    const cappedEvidence = capEvidence(evidence);
    const boundedEvidence = cappedEvidence.entries;
    const evidenceIds = [...new Set(boundedEvidence.flatMap((entry) => Array.isArray(entry.evidenceIds) ? entry.evidenceIds : []))].slice(0, 100);
    const outcome = stopped && !limitExceeded ? "stopped" : anyFailed || limitExceeded ? (anyPartial ? "partial" : "failed") : "passed";
    return {
      ok: true,
      value: {
        testCaseId: testCase.id,
        name: testCase.name || testCase.id,
        executor: "runtime-dispatcher",
        outcome,
        stepCount: evidence.length,
        returnedStepCount: boundedEvidence.filter((entry) => entry.type !== "summary").length,
        omittedEvidenceCount: cappedEvidence.omittedCount,
        passedSteps: boundedEvidence.filter((entry) => entry.type !== "summary" && entry.passed).length,
        failedSteps: boundedEvidence.filter((entry) => entry.type !== "summary" && !entry.passed).length,
        evidence: boundedEvidence,
        ...(evidenceIds.length ? { evidenceIds } : {}),
        limits,
      },
    };
  };
}

function comparisonResponse(id, value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    id,
    status: source.status,
    statusText: source.statusText,
    headers: source.headers,
    body: source.body,
    bodyStructure: source.bodyStructure,
    length: source.length,
    durationMs: source.durationMs ?? source.elapsedMs,
  };
}

module.exports = { createTestCaseRunner, productionTestStepInput };
