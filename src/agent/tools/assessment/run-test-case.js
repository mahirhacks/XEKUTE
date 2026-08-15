"use strict";

const { isDeepStrictEqual } = require("node:util");
const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const RUN_TEST_CASE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["testCase"],
  properties: {
    testCase: {
      type: "object",
      required: ["id", "steps"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "action", "expected"],
            properties: {
              id: { type: "string" },
              action: { type: "string" },
              input: { type: ["object", "string"] },
              identityId: { type: "string" },
              pageId: { type: "string" },
              execution: {
                type: "object",
                properties: {
                  mode: { type: "string", enum: ["single", "barrier"] },
                  groupId: { type: "string" },
                  repetitions: { type: "integer", minimum: 1, maximum: 100 },
                },
              },
              compare: {
                type: "object",
                required: ["stepId"],
                properties: {
                  stepId: { type: "string" },
                  dimensions: { type: "array", items: { type: "string", enum: ["status", "headers", "body", "length", "timing", "semantic"] } },
                },
              },
              expected: { type: "object" },
            },
          },
          minItems: 1,
          maxItems: 50,
        },
      },
    },
  },
});

const RUN_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_RUN_TEST_CASE_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  EXECUTION_FAILED: "RUN_TEST_CASE_EXECUTION_FAILED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: RUN_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!isRecord(input.testCase) || typeof input.testCase.id !== "string" || input.testCase.id.trim() === "") {
    return invalidInput("testCase.id must be a non-empty string");
  }
  if (!Array.isArray(input.testCase.steps) || input.testCase.steps.length === 0) {
    return invalidInput("testCase.steps must be a non-empty array");
  }
  if (input.testCase.steps.length > 50) return invalidInput("testCase.steps must contain at most 50 items");
  const stepIds = new Set();
  const barrierGroups = new Set();
  let lastBarrierGroup = "";
  let barrierGroupEnded = false;
  for (let i = 0; i < input.testCase.steps.length; i += 1) {
    const step = input.testCase.steps[i];
    if (!isRecord(step)) return invalidInput(`steps[${i}] must be an object`);
    if (typeof step.id !== "string" || step.id.trim() === "") return invalidInput(`steps[${i}].id must be a non-empty string`);
    if (stepIds.has(step.id)) return invalidInput(`steps[${i}].id must be unique`);
    stepIds.add(step.id);
    if (typeof step.action !== "string" || step.action.trim() === "") return invalidInput(`steps[${i}].action must be a non-empty string`);
    if (!isRecord(step.expected)) return invalidInput(`steps[${i}].expected must be an object`);
    if (step.identityId !== undefined && (typeof step.identityId !== "string" || !step.identityId.trim())) return invalidInput(`steps[${i}].identityId must be a non-empty string when provided`);
    if (step.pageId !== undefined && (typeof step.pageId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(step.pageId))) return invalidInput(`steps[${i}].pageId is invalid`);
    if (step.execution !== undefined) {
      if (!isRecord(step.execution)) return invalidInput(`steps[${i}].execution must be an object`);
      const executionMode = step.execution.mode === undefined ? "single" : step.execution.mode;
      if (!["single", "barrier"].includes(executionMode)) return invalidInput(`steps[${i}].execution.mode must be single or barrier`);
      if (executionMode === "barrier") {
        if (typeof step.execution.groupId !== "string" || !step.execution.groupId.trim()) return invalidInput(`steps[${i}].execution.groupId is required for barrier steps`);
        const groupId = step.execution.groupId.trim();
        if ((barrierGroupEnded && barrierGroups.has(groupId)) || (lastBarrierGroup && lastBarrierGroup !== groupId && barrierGroups.has(groupId))) return invalidInput(`steps[${i}].execution.groupId must stay contiguous`);
        barrierGroups.add(groupId);
        lastBarrierGroup = groupId;
        barrierGroupEnded = false;
      } else {
        barrierGroupEnded = true;
      }
      if (step.execution.repetitions !== undefined && (!Number.isInteger(step.execution.repetitions) || step.execution.repetitions < 1 || step.execution.repetitions > 100)) return invalidInput(`steps[${i}].execution.repetitions must be between 1 and 100`);
    } else {
      barrierGroupEnded = true;
    }
    if (step.compare !== undefined) {
      if (!isRecord(step.compare) || typeof step.compare.stepId !== "string" || !step.compare.stepId.trim()) return invalidInput(`steps[${i}].compare.stepId must be a non-empty string`);
      if (step.compare.dimensions !== undefined) {
        if (!Array.isArray(step.compare.dimensions) || step.compare.dimensions.some((dimension) => !["status", "headers", "body", "length", "timing", "semantic"].includes(dimension))) return invalidInput(`steps[${i}].compare.dimensions contains an unsupported comparison dimension`);
        if (new Set(step.compare.dimensions).size !== step.compare.dimensions.length) return invalidInput(`steps[${i}].compare.dimensions must not contain duplicates`);
      }
    }
  }
  for (let index = 0; index < input.testCase.steps.length; index += 1) {
    const step = input.testCase.steps[index];
    if (step.compare && step.compare.stepId === step.id) return invalidInput(`steps.${step.id}.compare.stepId cannot reference itself`);
    if (step.compare && !stepIds.has(step.compare.stepId)) return invalidInput(`steps.${step.id}.compare.stepId must reference an existing step`);
    if (step.compare) {
      const referencedIndex = input.testCase.steps.findIndex((candidate) => candidate.id === step.compare.stepId);
      if (referencedIndex >= index) return invalidInput(`steps.${step.id}.compare.stepId must reference an earlier step`);
      const currentExecution = step.execution || {};
      const referencedExecution = input.testCase.steps[referencedIndex]?.execution || {};
      if (currentExecution.mode === "barrier" && referencedExecution.mode === "barrier" && String(currentExecution.groupId || "") === String(referencedExecution.groupId || "")) {
        return invalidInput(`steps.${step.id}.compare.stepId cannot reference another step in the same barrier`);
      }
    }
  }
  return { ok: true };
}

function defaultStepExecutor(step) {
  // Production dispatch is supplied by the Electron composition root. A raw
  // adapter without an injected executor must fail closed rather than turning
  // a test definition into fake evidence.
  return {
    ok: false,
    error: { code: "RUN_TEST_CASE_EXECUTOR_UNAVAILABLE", message: "No authenticated assessment runner is configured for this adapter." },
  };
}

// Recognized matcher keys. An expectation object carrying at least one of these
// is a matcher object; a plain object with none of them is a structural template
// matched field-by-field (enables header and parsed-JSON assertions).
const MATCHER_KEYS = new Set([
  "equals",
  "includes",
  "bodyContains",
  "regex",
  "status",
  "not",
  "in",
  "length",
  "type",
]);

function isMatcherObject(value) {
  return isRecord(value) && Object.keys(value).some(key => MATCHER_KEYS.has(key));
}

function deepEqual(a, b) {
  return isDeepStrictEqual(a, b);
}

function lengthOf(value) {
  if (typeof value === "string" || Array.isArray(value)) return value.length;
  if (isRecord(value)) return Object.keys(value).length;
  return null;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function evaluateMatchers(actual, matcher, label) {
  const failures = [];
  let checked = 0;
  if (matcher.equals !== undefined) {
    checked += 1;
    if (!deepEqual(actual, matcher.equals)) {
      failures.push(`${label}: expected ${JSON.stringify(matcher.equals)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (matcher.includes !== undefined) {
    checked += 1;
    const haystack = typeof actual === "string" ? actual : JSON.stringify(actual ?? "");
    if (!haystack.includes(String(matcher.includes))) {
      failures.push(`${label}: expected to include ${JSON.stringify(matcher.includes)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (matcher.bodyContains !== undefined) {
    checked += 1;
    const bodyText = typeof actual === "string" ? actual : JSON.stringify(actual ?? "");
    if (!bodyText.includes(String(matcher.bodyContains))) {
      failures.push(`${label}: expected body to contain ${JSON.stringify(matcher.bodyContains)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (matcher.regex !== undefined) {
    checked += 1;
    try {
      const re = new RegExp(matcher.regex);
      const text = typeof actual === "string" ? actual : JSON.stringify(actual ?? "");
      if (!re.test(text)) failures.push(`${label}: expected to match ${matcher.regex}, got ${JSON.stringify(actual)}`);
    } catch {
      failures.push(`${label}: invalid regex ${matcher.regex}`);
    }
  }
  if (matcher.status !== undefined) {
    checked += 1;
    if (actual !== matcher.status) {
      failures.push(`${label}: expected status ${matcher.status}, got ${JSON.stringify(actual)}`);
    }
  }
  if (matcher.not !== undefined) {
    checked += 1;
    if (deepEqual(actual, matcher.not)) {
      failures.push(`${label}: expected not ${JSON.stringify(matcher.not)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (matcher.in !== undefined) {
    checked += 1;
    const allowed = Array.isArray(matcher.in) ? matcher.in : [matcher.in];
    if (!allowed.some(item => deepEqual(actual, item))) {
      failures.push(`${label}: expected one of ${JSON.stringify(matcher.in)}, got ${JSON.stringify(actual)}`);
    }
  }
  if (matcher.length !== undefined) {
    checked += 1;
    const len = lengthOf(actual);
    if (len === null) {
      failures.push(`${label}: length matcher requires a string, array, or object, got ${JSON.stringify(actual)}`);
    } else if (typeof matcher.length === "number") {
      if (len !== matcher.length) failures.push(`${label}: expected length ${matcher.length}, got ${len}`);
    } else if (isRecord(matcher.length)) {
      if (matcher.length.min !== undefined && len < matcher.length.min) {
        failures.push(`${label}: expected length >= ${matcher.length.min}, got ${len}`);
      }
      if (matcher.length.max !== undefined && len > matcher.length.max) {
        failures.push(`${label}: expected length <= ${matcher.length.max}, got ${len}`);
      }
    } else {
      failures.push(`${label}: length must be a number or a {min,max} object`);
    }
  }
  if (matcher.type !== undefined) {
    checked += 1;
    const actualType = typeOf(actual);
    if (actualType !== matcher.type) {
      failures.push(`${label}: expected type ${matcher.type}, got ${actualType}`);
    }
  }
  return { failures, matched: checked > 0 && failures.length === 0 };
}

function evaluateStructural(actual, template, label) {
  const failures = [];
  let matched = false;
  const entries = Object.entries(template).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return { failures, matched: true };
  if (actual === null || typeof actual !== "object") {
    failures.push(`${label}: expected an object/array to match structure, got ${JSON.stringify(actual)}`);
    return { failures, matched: false };
  }
  for (const [key, subExpectation] of entries) {
    const subActual = Array.isArray(actual) ? actual[Number(key)] : actual[key];
    const sub = evaluateValue(subActual, subExpectation, `${label}.${key}`);
    failures.push(...sub.failures);
    if (sub.matched) matched = true;
  }
  return { failures, matched };
}

function evaluateValue(actual, expectation, label) {
  if (expectation === null || expectation === undefined) return { failures: [], matched: false };
  if (Array.isArray(expectation)) {
    if (!Array.isArray(actual) || !deepEqual(actual, expectation)) {
      return { failures: [`${label}: expected array ${JSON.stringify(expectation)}, got ${JSON.stringify(actual)}`], matched: false };
    }
    return { failures: [], matched: true };
  }
  if (isMatcherObject(expectation)) return evaluateMatchers(actual, expectation, label);
  if (isRecord(expectation)) return evaluateStructural(actual, expectation, label);
  if (!deepEqual(actual, expectation)) {
    return { failures: [`${label}: expected ${JSON.stringify(expectation)}, got ${JSON.stringify(actual)}`], matched: false };
  }
  return { failures: [], matched: true };
}

function evaluateObservation(observed, expected) {
  const failures = [];
  let matchedAny = false;
  for (const [key, expectation] of Object.entries(expected || {})) {
    if (expectation === null || expectation === undefined) continue;
    const actual = observed?.[key];
    const sub = evaluateValue(actual, expectation, key);
    failures.push(...sub.failures);
    if (sub.matched) matchedAny = true;
  }
  return { failures, matchedAny };
}

function createRunTestCaseTool({ stepExecutor = null } = {}) {
  const executeStep = typeof stepExecutor === "function" ? stepExecutor : defaultStepExecutor;
  const executorKind = typeof stepExecutor === "function" ? "injected" : "unavailable";

  const adapter = {
    name: "run_test_case",
    inputSchema: RUN_TEST_CASE_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(RUN_ERROR_CODES.INVALID_CONTEXT, "run_test_case requires a restricted tool execution context projection");
      }

      const { testCase } = input;
      const evidence = [];
      let anyFailed = false;
      let anyPartial = false;

      for (const step of testCase.steps) {
        const stepResult = {
          stepId: step.id,
          action: step.action,
          passed: false,
          partial: false,
          observed: null,
          failures: [],
        };
        try {
          const outcome = await executeStep(step, input.testCase);
          stepResult.observed = outcome?.observed ?? outcome ?? null;
          if (outcome?.ok === false) {
            stepResult.failures.push(outcome.error || "step executor reported failure");
          }
        } catch (error) {
          stepResult.failures.push(error.message);
        }

        const { failures, matchedAny } = evaluateObservation(stepResult.observed, step.expected);
        stepResult.failures.push(...failures);

        if (stepResult.failures.length === 0) {
          stepResult.passed = true;
        } else {
          // Partial only when an observation was produced AND at least one
          // expectation key matched; otherwise it's a plain failure.
          stepResult.partial = stepResult.observed !== null && stepResult.observed !== undefined && matchedAny;
          anyFailed = true;
          if (stepResult.partial) anyPartial = true;
        }
        evidence.push(stepResult);
      }

      const outcome = anyFailed ? (anyPartial ? "partial" : "failed") : "passed";

      return {
        ok: true,
        value: {
          testCaseId: testCase.id,
          name: testCase.name || testCase.id,
          executor: executorKind,
          outcome,
          stepCount: evidence.length,
          passedSteps: evidence.filter(e => e.passed).length,
          failedSteps: evidence.filter(e => !e.passed).length,
          evidence,
        },
      };
    },
  };

  return adapter;
}

module.exports = {
  RUN_TEST_CASE_INPUT_SCHEMA,
  RUN_ERROR_CODES,
  createRunTestCaseTool,
  validateInput,
  evaluateObservation,
};
