"use strict";

const { validateWorkspacePaths, isInside, pathCandidates } = require("./workspace-scope");
const { loadScopePolicy, targetFromArgs, evaluateNetworkTarget, evaluateRedirectTarget } = require("./network-scope");
const { resolveTargetAddresses } = require("../../../domain/scope/scope-engine");

const WORKSPACE_TOOLS = new Set([
  "read_file",
  "search_workspace",
  "apply_patch",
  "inspect_environment",
  "update_project_artifacts",
  "manage_state",
  "attack_graph",
  "exec_command",
]);

const NETWORK_TOOLS = new Set([
  "ingest_traffic",
  "replay_request",
  "run_test_case",
  "browser_action",
]);

function evaluateToolScope({ workspace, toolName, args = {}, normalizedTargets = [], projectProfile = null, toolMetadata = null } = {}) {
  const policy = loadScopePolicy(workspace, projectProfile);
  if (toolName === "browser_action" && ["list_pages", "close_page"].includes(String(args?.action || ""))) {
    return { ok: true, code: "SCOPE_NOT_REQUIRED", workspaceRoot: policy.workspaceRoot };
  }
  if (toolName === "browser_action" && String(args?.action || "") === "open_page" && !args?.url) {
    return { ok: true, code: "SCOPE_NOT_REQUIRED", workspaceRoot: policy.workspaceRoot };
  }
  if (toolName === "web_research") {
    return { ok: true, code: "PUBLIC_RESEARCH_ALLOWED", workspaceRoot: policy.workspaceRoot };
  }
  const targetTypes = Array.isArray(toolMetadata?.targetTypes) ? toolMetadata.targetTypes : [];
  const declaredTargets = declaredArgumentValues(args, toolMetadata?.targetArguments);
  const dynamicWorkspace = String(toolName || "").startsWith("mcp__") && targetTypes.some((type) => ["file", "workspace"].includes(String(type)));
  const dynamicNetwork = String(toolName || "").startsWith("mcp__") && targetTypes.some((type) => ["network", "domain", "host", "url"].includes(String(type)));
  if (WORKSPACE_TOOLS.has(toolName) || dynamicWorkspace) {
    const normalizedWorkspaceTargets = (Array.isArray(normalizedTargets) ? normalizedTargets : []).filter((target) => target?.kind === "file").map((target) => target.value);
    const workspaceArgs = normalizedWorkspaceTargets.length || declaredTargets.length
      ? { ...args, paths: [...(Array.isArray(args.paths) ? args.paths : []), ...declaredTargets, ...normalizedWorkspaceTargets] }
      : args;
    const workspaceDecision = validateWorkspacePaths(toolName, workspaceArgs, policy.workspaceRoot);
    if (!workspaceDecision.ok) return workspaceDecision;
  }
  if (NETWORK_TOOLS.has(toolName) || dynamicNetwork) {
    const normalizedNetworkTargets = (Array.isArray(normalizedTargets) ? normalizedTargets : []).filter((target) => target?.kind === "network").map((target) => target.value);
    const targets = normalizedNetworkTargets.length ? [...new Set(normalizedNetworkTargets)] : targetsFromArgsWithMetadata(args, toolMetadata);
    if (!targets.length) return { ...evaluateNetworkTarget("", policy), workspaceRoot: policy.workspaceRoot };
    const decisions = targets.map((target) => evaluateNetworkTarget(target, policy));
    const denied = decisions.find((decision) => !decision.ok);
    if (denied) return { ...denied, workspaceRoot: policy.workspaceRoot };
    if (decisions.length === 1) return { ...decisions[0], workspaceRoot: policy.workspaceRoot };
    return { ok: true, code: "TARGETS_IN_SCOPE", target: decisions[0].target, targets: decisions.map((decision) => decision.target), workspaceRoot: policy.workspaceRoot };
  }
  if (String(toolName || "").startsWith("mcp__") && !targetTypes.length) {
    return { ok: false, code: "MCP_SCOPE_METADATA_REQUIRED", reason: "The MCP tool has no declared target type and cannot be scoped safely.", remediation: "Add target_types and target_arguments to the selected skill mapping." };
  }
  return { ok: true, code: "SCOPE_NOT_REQUIRED", workspaceRoot: policy.workspaceRoot };
}

async function evaluateToolScopeAsync({ workspace, toolName, args = {}, normalizedTargets = [], projectProfile = null, toolMetadata = null, resolveAddresses = resolveTargetAddresses, browserTarget = "" } = {}) {
  const action = args && typeof args === "object" ? args : {};
  const isBrowserFollowUp = toolName === "browser_action" && action.action !== "navigate" && !targetsFromArgsWithMetadata(action, toolMetadata).length && browserTarget;
  const scopedArgs = isBrowserFollowUp ? { ...action, url: browserTarget } : action;
  const decision = evaluateToolScope({ workspace, toolName, args: scopedArgs, normalizedTargets, projectProfile, toolMetadata });
  if (!decision.ok) return decision;
  const dynamicNetwork = String(toolName || "").startsWith("mcp__")
    && (Array.isArray(toolMetadata?.targetTypes) ? toolMetadata.targetTypes : []).some((type) => ["network", "domain", "host", "url"].includes(String(type)));
  if (!NETWORK_TOOLS.has(toolName) && !dynamicNetwork) return decision;
  const normalizedNetworkTargets = (Array.isArray(normalizedTargets) ? normalizedTargets : []).filter((target) => target?.kind === "network").map((target) => target.value);
  const targets = normalizedNetworkTargets.length ? [...new Set(normalizedNetworkTargets)] : targetsFromArgsWithMetadata(scopedArgs, toolMetadata);
  const resolvedAddresses = [];
  for (const target of targets) {
    let resolution;
    try { resolution = await resolveAddresses(target); }
    catch (error) { resolution = { ok: false, code: "DNS_RESOLUTION_FAILED", reason: `DNS resolution failed: ${error.message}` }; }
    if (!resolution?.ok) {
      return {
        ...decision,
        ok: false,
        code: resolution?.code || "DNS_RESOLUTION_FAILED",
        reason: resolution?.reason || "The target could not be resolved safely.",
        remediation: "Use a reviewed target whose DNS resolution is stable and outside reserved address ranges.",
        target,
        resolvedAddresses: resolution?.addresses || [],
      };
    }
    resolvedAddresses.push(...(resolution.addresses || []));
  }
  return { ...decision, resolvedAddresses: [...new Set(resolvedAddresses)] };
}

async function evaluateRedirectScopeAsync(initialTarget, redirectTarget, { workspace, projectProfile = null, resolveAddresses = resolveTargetAddresses } = {}) {
  const policy = loadScopePolicy(workspace, projectProfile);
  const decision = evaluateRedirectTarget(initialTarget, redirectTarget, policy);
  if (!decision.ok) return { ...decision, workspaceRoot: policy.workspaceRoot };
  let resolution;
  try { resolution = await resolveAddresses(redirectTarget); }
  catch (error) { resolution = { ok: false, code: "DNS_RESOLUTION_FAILED", reason: `DNS resolution failed: ${error.message}` }; }
  if (!resolution?.ok) {
    return {
      ...decision,
      ok: false,
      code: resolution?.code || "DNS_RESOLUTION_FAILED",
      reason: resolution?.reason || "The redirect destination could not be resolved safely.",
      remediation: "Stop the redirect chain or explicitly review a destination with safe DNS resolution.",
      workspaceRoot: policy.workspaceRoot,
      resolvedAddresses: resolution?.addresses || [],
    };
  }
  return { ...decision, workspaceRoot: policy.workspaceRoot, resolvedAddresses: resolution.addresses || [] };
}

function authenticationDependencyMatches(target, dependency) {
  const raw = String(dependency || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(target);
    const explicit = raw.includes("://") ? new URL(raw) : null;
    const wildcard = raw.startsWith("*.");
    const hostRule = (explicit ? explicit.hostname : raw.replace(/^\*\./, "")).toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (wildcard ? !(host === hostRule || host.endsWith(`.${hostRule}`)) : host !== hostRule) return false;
    if (explicit && explicit.protocol !== parsed.protocol) return false;
    if (explicit && explicit.pathname !== "/" && !parsed.pathname.startsWith(explicit.pathname)) return false;
    return true;
  } catch { return false; }
}

function evaluateLoginNavigation(target, projectProfile = null, workspace = "") {
  let parsed;
  try { parsed = new URL(String(target || "")); } catch {
    return { ok: false, code: "LOGIN_TARGET_INVALID", reason: "The login target is not a valid URL.", remediation: "Use an http or https login URL reviewed for this project." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, code: "LOGIN_TARGET_INVALID", reason: "The login target must use http or https.", remediation: "Use an http or https login URL." };
  }
  const dependencies = Array.isArray(projectProfile?.scope?.authenticationDependencies)
    ? projectProfile.scope.authenticationDependencies
    : [];
  if (dependencies.some((dependency) => authenticationDependencyMatches(parsed.toString(), dependency))) {
    return { ok: true, code: "LOGIN_DEPENDENCY_ALLOWED", target: parsed.toString(), operatorControlled: true };
  }
  const policy = loadScopePolicy(workspace, projectProfile);
  if (policy.configured) {
    const normal = evaluateNetworkTarget(parsed.toString(), policy);
    if (normal.ok) return { ...normal, code: "LOGIN_TARGET_IN_SCOPE", operatorControlled: true };
  }
  return {
    ok: false,
    code: "LOGIN_TARGET_NOT_REVIEWED",
    reason: "The login host is not included in the reviewed assessment scope or authentication dependencies.",
    remediation: "Add the reviewed login or identity-provider host under Browser & Network authentication dependencies.",
    target: parsed.toString(),
  };
}

function readDeclaredValue(args, expression) {
  const key = String(expression || "").trim();
  if (!key) return undefined;
  if (Object.prototype.hasOwnProperty.call(args || {}, key)) return args[key];
  const segments = key.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let value = args;
  for (const segment of segments) {
    if (value === null || value === undefined) return undefined;
    value = value[segment];
  }
  return value;
}

function flattenStrings(value, output = []) {
  if (typeof value === "string" && value.trim()) output.push(value.trim());
  else if (Array.isArray(value)) for (const item of value) flattenStrings(item, output);
  return output;
}

function declaredArgumentValues(args = {}, targetArguments = []) {
  const values = [];
  for (const expression of Array.isArray(targetArguments) ? targetArguments : []) flattenStrings(readDeclaredValue(args, expression), values);
  return [...new Set(values)].slice(0, 100);
}

function targetFromArgsWithMetadata(args = {}, metadata = null) {
  return targetsFromArgsWithMetadata(args, metadata)[0] || "";
}

function targetsFromArgsWithMetadata(args = {}, metadata = null) {
  const direct = [];
  for (const expression of ["target", "url", "endpoint", "host", "domain", "ip", "origin", "request.url", "request.target", "urls", "targets"]) {
    flattenStrings(readDeclaredValue(args, expression), direct);
  }
  // A test case is a container for executable network actions. Surface only
  // the target-shaped fields of each nested step so the outer call cannot
  // hide an out-of-scope replay or browser navigation.
  const steps = Array.isArray(args?.testCase?.steps) ? args.testCase.steps : [];
  for (const step of steps) {
    const nested = step?.input && typeof step.input === "object" ? step.input : {};
    for (const expression of ["target", "url", "endpoint", "host", "domain", "ip", "origin", "request.url", "request.target", "urls", "targets"]) {
      flattenStrings(readDeclaredValue(nested, expression), direct);
    }
  }
  const declared = declaredArgumentValues(args, metadata?.targetArguments);
  return [...new Set([...direct, ...declared])].slice(0, 100);
}

module.exports = {
  WORKSPACE_TOOLS,
  NETWORK_TOOLS,
  loadScopePolicy,
  isInside,
  pathCandidates,
  validateWorkspacePaths,
  targetFromArgs,
  targetFromArgsWithMetadata,
  targetsFromArgsWithMetadata,
  evaluateNetworkTarget,
  evaluateToolScope,
  evaluateToolScopeAsync,
  evaluateRedirectScopeAsync,
  evaluateRedirectTarget,
  evaluateLoginNavigation,
};
