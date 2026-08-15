"use strict";

const { readPath } = require("./target-normalizer.js");

function escapeRegex(value) { return String(value).replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
function wildcardRegex(pattern, flags = "i") {
  const source = String(pattern).split("").map((character) => character === "*" ? ".*" : character === "?" ? "." : escapeRegex(character)).join("");
  return new RegExp(`^${source}$`, flags);
}
function matchesPattern(value, pattern, { caseSensitive = false } = {}) {
  if (pattern === undefined || pattern === null) return false;
  const actual = String(value ?? "");
  if (pattern instanceof RegExp) return pattern.test(actual);
  if (typeof pattern === "object" && !Array.isArray(pattern)) {
    if (typeof pattern.equals === "string") return caseSensitive ? actual === pattern.equals : actual.toLowerCase() === pattern.equals.toLowerCase();
    if (typeof pattern.glob === "string") return wildcardRegex(pattern.glob, caseSensitive ? "" : "i").test(actual);
    if (typeof pattern.regex === "string") {
      try { return new RegExp(pattern.regex, caseSensitive ? "" : "i").test(actual); } catch { return false; }
    }
    return false;
  }
  const expected = String(pattern);
  if (expected.includes("*") || expected.includes("?")) return wildcardRegex(expected, caseSensitive ? "" : "i").test(actual);
  return caseSensitive ? actual === expected : actual.toLowerCase() === expected.toLowerCase();
}

function anyMatch(values, patterns, options) {
  const actual = Array.isArray(values) ? values : [values];
  const expected = Array.isArray(patterns) ? patterns : [patterns];
  return actual.some((value) => expected.some((pattern) => matchesPattern(value, pattern, options)));
}

function normalizeRule(rule, index = 0) {
  if (typeof rule === "string") return { id: rule, tools: [rule] };
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return null;
  return {
    ...rule,
    id: String(rule.id || `rule-${index + 1}`),
    tools: rule.tools || rule.tool,
    operations: rule.operations || rule.operation,
    commands: rule.commands || rule.command,
    paths: rule.paths || rule.path,
    domains: rule.domains || rule.domain || rule.hosts || rule.host,
    arguments: rule.arguments || rule.argumentPatterns,
  };
}

function matchRule(ruleInput, invocation, index = 0) {
  const rule = normalizeRule(ruleInput, index);
  if (!rule) return { matched: false, rule: null, reasons: [] };
  const selectors = [];
  const reasons = [];
  const add = (declared, matched, reason) => {
    if (declared === undefined || declared === null || (Array.isArray(declared) && !declared.length)) return;
    selectors.push(Boolean(matched));
    if (matched) reasons.push(reason);
  };
  add(rule.tools, anyMatch(invocation.toolName, rule.tools), "tool");
  add(rule.operations, anyMatch(invocation.args?.operation || invocation.args?.action || "", rule.operations), "operation");
  add(rule.commands, anyMatch(invocation.args?.command || invocation.args?.executable || "", rule.commands, { caseSensitive: false }), "command");
  add(rule.paths, anyMatch((invocation.targets || []).filter((item) => item.kind === "file").map((item) => item.value), rule.paths, { caseSensitive: process.platform !== "win32" }), "path");
  const networkValues = (invocation.targets || []).filter((item) => item.kind === "network").flatMap((item) => {
    try { return [item.value, new URL(item.value).hostname]; } catch { return [item.value]; }
  });
  add(rule.domains, anyMatch(networkValues, rule.domains), "domain");
  if (rule.arguments && typeof rule.arguments === "object" && !Array.isArray(rule.arguments)) {
    for (const [expression, pattern] of Object.entries(rule.arguments)) {
      add(pattern, anyMatch(readPath(invocation.args, expression), pattern, { caseSensitive: true }), `argument:${expression}`);
    }
  }
  return { matched: selectors.length > 0 && selectors.every(Boolean), rule, reasons };
}

function findMatchingRule(rules, invocation) {
  for (let index = 0; index < (Array.isArray(rules) ? rules.length : 0); index += 1) {
    const result = matchRule(rules[index], invocation, index);
    if (result.matched) return result;
  }
  return { matched: false, rule: null, reasons: [] };
}

module.exports = { anyMatch, findMatchingRule, matchRule, matchesPattern, normalizeRule, wildcardRegex };
