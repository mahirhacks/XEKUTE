"use strict";

const { allow, deny, gate } = require("./gate-utils.js");

const DEFAULT_RESOURCE_LIMITS = Object.freeze({
  memoryBytes: 4 * 1024 * 1024 * 1024,
  cpuPercent: 90,
  outputBytes: 2_000_000,
  processCount: 32,
  diskBytes: 20 * 1024 * 1024 * 1024,
  maximumConcurrency: 8,
  requestsPerSecond: 20,
});

function requestedResources(toolName, args = {}) {
  const steps = Array.isArray(args?.testCase?.steps) ? args.testCase.steps : [];
  const repetitions = steps.length
    ? steps.reduce((sum, step) => sum + Math.max(1, Number(step?.execution?.repetitions) || 1), 0)
    : Math.max(1, Number(args?.execution?.repetitions || args?.repetitions) || 1);
  const barrierCounts = new Map();
  for (const step of steps) {
    if (step?.execution?.mode !== "barrier") continue;
    const key = String(step.execution.groupId || "default");
    barrierCounts.set(key, (barrierCounts.get(key) || 0) + Math.max(1, Number(step.execution.repetitions) || 1));
  }
  const concurrency = Math.max(
    1,
    Number(args?.execution?.concurrency || args?.concurrency) || 1,
    ...barrierCounts.values(),
  );
  return {
    memoryBytes: Number(args?.resources?.memoryBytes || 0),
    cpuPercent: Number(args?.resources?.cpuPercent || 0),
    diskBytes: Number(args?.resources?.diskBytes || 0),
    outputBytes: Number(args?.resources?.outputBytes || 0),
    processCount: toolName === "exec_command" && String(args.operation || "run") === "start" ? 1 : 0,
    concurrency,
    repetitions,
  };
}

function createResourceLimitGate() {
  return gate("resource_limit_gate", async ({ context, toolName, args, state, runtime }) => {
    const configured = context?.resourceLimits && typeof context.resourceLimits === "object" ? context.resourceLimits : {};
    const limits = { ...DEFAULT_RESOURCE_LIMITS, ...configured };
    const requested = requestedResources(toolName, args);
    if (requested.concurrency > limits.maximumConcurrency) return deny("resource_limit_gate", "Requested concurrency exceeds the configured engagement limit.", { code: "CONCURRENCY_LIMIT_EXCEEDED", requestedConcurrency: requested.concurrency, limit: limits.maximumConcurrency });
    if (requested.repetitions > Math.max(1, limits.requestsPerSecond * 60)) return deny("resource_limit_gate", "Requested repetition burst exceeds the configured one-minute request budget.", { code: "REQUEST_BUDGET_EXCEEDED", repetitions: requested.repetitions, limit: limits.requestsPerSecond * 60 });
    for (const key of ["memoryBytes", "cpuPercent", "diskBytes", "outputBytes"]) {
      if (requested[key] > 0 && Number(limits[key]) > 0 && requested[key] > Number(limits[key])) return deny("resource_limit_gate", `Requested ${key} exceeds the configured limit.`, { code: "RESOURCE_LIMIT_EXCEEDED", resource: key, requested: requested[key], limit: limits[key] });
    }
    if (typeof runtime?.resourceUsage === "function") {
      let usage;
      try { usage = await runtime.resourceUsage({ context, toolName, args }); }
      catch (error) { usage = { error: error.message }; }
      if (usage?.error) return deny("resource_limit_gate", `Resource usage could not be verified: ${usage.error}`, { code: "RESOURCE_USAGE_UNAVAILABLE" });
      if (requested.processCount && Number(usage?.processCount || 0) + requested.processCount > limits.processCount) return deny("resource_limit_gate", "The project durable-process limit has been reached.", { code: "PROCESS_LIMIT_EXCEEDED", current: usage.processCount, limit: limits.processCount });
      state.resourceUsage = usage;
    }
    state.resourceLimits = limits;
    return allow("resource_limit_gate", "Memory, CPU, disk, output, process, concurrency, and request limits were assigned.", { limits, requested, usage: state.resourceUsage || null });
  });
}

module.exports = { DEFAULT_RESOURCE_LIMITS, createResourceLimitGate, requestedResources };
