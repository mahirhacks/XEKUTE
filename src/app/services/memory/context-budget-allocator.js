"use strict";

const nodeCrypto = require("node:crypto");

const ALLOCATOR_VERSION = 1;
const SECTION_ORDER = Object.freeze([
  "authority",
  "checkpoint",
  "recent_tail",
  "investigation",
  "project",
  "evidence",
  "graph",
  "knowledge",
  "artifact",
]);

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : fallback;
}

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

function createContextBudgetAllocator({ estimate = null } = {}) {
  const estimateValue = typeof estimate === "function"
    ? estimate
    : (value) => Math.max(0, Math.ceil(Buffer.byteLength(JSON.stringify(value == null ? null : value), "utf8") / 4));

  function allocate(input = {}) {
    const contextWindow = number(input.contextWindowTokens ?? input.context_window_tokens);
    const promptBudget = number(input.promptBudgetTokens ?? input.prompt_budget_tokens, contextWindow || 16_000);
    const responseReserve = number(input.responseReserveTokens ?? input.response_reserve_tokens);
    const authorityMinimum = number(input.authorityMinimumTokens ?? input.authority_minimum_tokens);
    const hardCap = contextWindow > 0 ? Math.max(0, contextWindow - responseReserve) : promptBudget;
    const usableBudget = Math.min(promptBudget, hardCap);
    const requestedInput = input.requested && typeof input.requested === "object" ? input.requested : {};
    const requested = Object.fromEntries(SECTION_ORDER.map((section) => [section, number(requestedInput[section])]));
    const requiredInput = input.required && typeof input.required === "object" ? input.required : {};
    const required = Object.fromEntries(SECTION_ORDER.map((section) => [section, Boolean(requiredInput[section]) || section === "authority"]));
    const allocations = Object.fromEntries(SECTION_ORDER.map((section) => [section, 0]));
    const omitted = Object.fromEntries(SECTION_ORDER.map((section) => [section, 0]));
    const requiredMinimum = Math.max(authorityMinimum, required.authority ? requested.authority : 0);
    const requiredDemand = SECTION_ORDER.filter((section) => required[section] && section !== "authority")
      .reduce((sum, section) => sum + requested[section], 0) + requiredMinimum;
    const overflow = requiredDemand > usableBudget;
    let remaining = usableBudget;
    if (requiredMinimum > 0) {
      allocations.authority = Math.min(requiredMinimum, remaining);
      remaining -= allocations.authority;
      omitted.authority = Math.max(0, requested.authority - allocations.authority);
    }
    for (const section of SECTION_ORDER.filter((value) => value !== "authority" && required[value])) {
      allocations[section] = Math.min(requested[section], remaining);
      remaining -= allocations[section];
      omitted[section] = requested[section] - allocations[section];
    }
    // Optional sections are admitted in stable priority order. Their requests
    // are caps, not entitlements; an omitted amount is explicit in the result.
    const optionalPriority = Array.isArray(input.priority)
      ? [...new Set(input.priority.map(String).filter((section) => SECTION_ORDER.includes(section) && !required[section]))]
      : SECTION_ORDER.filter((section) => section !== "authority" && !required[section]);
    for (const section of optionalPriority) {
      allocations[section] = Math.min(requested[section], remaining);
      remaining -= allocations[section];
      omitted[section] = requested[section] - allocations[section];
    }
    for (const section of SECTION_ORDER) {
      if (!required[section] && !optionalPriority.includes(section)) omitted[section] = requested[section];
    }
    const requestedTokens = SECTION_ORDER.reduce((sum, section) => sum + requested[section], 0);
    const includedTokens = SECTION_ORDER.reduce((sum, section) => sum + allocations[section], 0);
    const omittedTokens = SECTION_ORDER.reduce((sum, section) => sum + omitted[section], 0);
    const responseReserveSatisfied = contextWindow <= 0 || usableBudget + responseReserve <= contextWindow;
    const authorityReserveSatisfied = allocations.authority >= authorityMinimum;
    return {
      ok: !overflow && responseReserveSatisfied && authorityReserveSatisfied,
      version: ALLOCATOR_VERSION,
      requested,
      allocations,
      omitted,
      requestedTokens,
      includedTokens,
      omittedTokens,
      usableBudget,
      remainingTokens: Math.max(0, remaining),
      responseReserveTokens: responseReserve,
      authorityMinimumTokens: authorityMinimum,
      responseReserveSatisfied,
      authorityReserveSatisfied,
      overflow,
      warnings: [
        ...(overflow ? [{ code: "MEMORY_CONTEXT_REQUIRED_BUDGET_OVERFLOW", message: "Required context exceeds the available prompt budget." }] : []),
        ...(!responseReserveSatisfied ? [{ code: "MEMORY_CONTEXT_RESPONSE_RESERVE_UNAVAILABLE", message: "The response reserve could not be retained." }] : []),
        ...(!authorityReserveSatisfied ? [{ code: "MEMORY_CONTEXT_AUTHORITY_RESERVE_UNAVAILABLE", message: "The authority minimum could not be retained." }] : []),
      ],
    };
  }

  function fit(value, budget) {
    const limit = Math.max(0, Math.floor(number(budget)));
    const originalTokens = estimateValue(value);
    if (originalTokens <= limit) return { value: clone(value), includedTokens: originalTokens, omittedTokens: 0, truncated: false };
    if (limit <= 0) return { value: null, includedTokens: 0, omittedTokens: originalTokens, truncated: true };
    if (typeof value === "string") {
      let width = Math.max(1, limit * 4);
      let clipped = value.slice(-width);
      while (width > 1 && estimateValue(clipped) > limit) {
        width -= 1;
        clipped = value.slice(-width);
      }
      const includedTokens = Math.min(limit, estimateValue(clipped));
      return { value: clipped, includedTokens, omittedTokens: Math.max(0, originalTokens - includedTokens), truncated: true };
    }
    if (Array.isArray(value)) {
      const output = [];
      let used = 0;
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const itemTokens = estimateValue(value[index]);
        if (output.length && used + itemTokens > limit) break;
        if (!output.length && itemTokens > limit) {
          const nested = fit(typeof value[index] === "string" ? value[index] : JSON.stringify(value[index]), limit);
          output.unshift(nested.value);
          used += nested.includedTokens;
          break;
        }
        output.unshift(clone(value[index]));
        used += itemTokens;
      }
      return { value: output, includedTokens: Math.min(limit, used), omittedTokens: Math.max(0, originalTokens - used), truncated: true };
    }
    const serialized = JSON.stringify(value == null ? null : value);
    const clipped = serialized.slice(-Math.max(2, limit * 4));
    const includedTokens = Math.min(limit, estimateValue(clipped));
    return { value: { truncated: true, serialized: clipped }, includedTokens, omittedTokens: Math.max(0, originalTokens - includedTokens), truncated: true };
  }

  return Object.freeze({ ALLOCATOR_VERSION, SECTION_ORDER, allocate, fit });
}

module.exports = Object.freeze({ ALLOCATOR_VERSION, SECTION_ORDER, createContextBudgetAllocator });
