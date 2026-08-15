"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ScopeEngine = require("../../../domain/scope/scope-engine");
const { evaluateExclusions } = require("./scope-exclusions");

function readJson(filePath, fallback = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function entriesFrom(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function loadScopePolicy(workspace, projectProfile = null) {
  const root = path.resolve(String(workspace || "."));
  const profileScope = projectProfile?.scope && typeof projectProfile.scope === "object" ? projectProfile.scope : {};
  const inScope = readJson(path.join(root, "scope", "in-scope.json"), {});
  const outOfScope = readJson(path.join(root, "scope", "out-of-scope.json"), {});
  const settings = readJson(path.join(root, "settings.config"), {});
  const targets = [
    ...entriesFrom(profileScope.inScopeTargets),
    ...entriesFrom(inScope.targets),
    ...entriesFrom(settings.targets),
  ];
  const wildcardRules = [
    ...entriesFrom(profileScope.wildcardRules),
    ...entriesFrom(inScope.wildcardRules),
  ];
  const excludedTargets = [
    ...entriesFrom(profileScope.outOfScopeTargets),
    ...entriesFrom(profileScope.exclusions),
    ...entriesFrom(outOfScope.targets),
    ...entriesFrom(outOfScope.exclusions),
    ...entriesFrom(settings.excludedTargets),
  ];
  return {
    workspaceRoot: root,
    targets,
    wildcardRules,
    excludedTargets,
    configured: targets.length > 0 || wildcardRules.length > 0,
  };
}

function targetFromArgs(args = {}) {
  const direct = args.target || args.url || args.endpoint || args.host || args.domain || args.ip || args.origin || args.request?.url || args.request?.target;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (Array.isArray(args.urls) && args.urls.length) return String(args.urls[0] || "").trim();
  if (Array.isArray(args.targets) && args.targets.length) return String(args.targets[0] || "").trim();
  return "";
}

function evaluateNetworkTarget(target, policy) {
  if (!policy?.configured) {
    return {
      ok: false,
      code: "SCOPE_NOT_CONFIGURED",
      reason: "No assessment scope is configured for this network-capable tool.",
      remediation: "Configure at least one reviewed target under Scope, then retry.",
    };
  }
  if (!target) {
    return {
      ok: false,
      code: "TARGET_REQUIRED",
      reason: "This network-capable tool requires a concrete target from the configured assessment scope.",
      remediation: "Provide a target or add one to the reviewed scope.",
    };
  }
  const decision = ScopeEngine.evaluateTarget(target, policy);
  if (!decision.allowed) {
    return {
      ok: false,
      code: decision.code || "TARGET_OUT_OF_SCOPE",
      reason: decision.reason || "The target is outside the configured assessment scope.",
      remediation: "Use a target explicitly included in Scope and not listed in exclusions.",
      target: decision.target,
    };
  }
  return { ok: true, code: "TARGET_IN_SCOPE", target: decision.target };
}

function evaluateRedirectTarget(initialTarget, redirectTarget, policy) {
  const initial = ScopeEngine.evaluateTarget(initialTarget, policy);
  if (!initial.allowed) {
    return {
      ok: false,
      code: initial.code || "TARGET_OUT_OF_SCOPE",
      reason: initial.reason || "The initial target is not in the reviewed scope.",
      remediation: "Stop the request or review the initial target before following redirects.",
      initialTarget,
      redirectTarget,
    };
  }
  const exclusion = evaluateExclusions(redirectTarget, policy?.excludedTargets);
  if (exclusion.matched) {
    return {
      ok: false,
      code: "TARGET_OUT_OF_SCOPE",
      reason: exclusion.reason,
      remediation: "Stop the redirect chain or add the destination explicitly after review.",
      initialTarget,
      redirectTarget,
    };
  }
  // A redirect inherits the already-reviewed request intent, but it does not
  // bypass the normal scope allowlist. Re-evaluate the concrete destination
  // so host/path rules, exclusions, and explicit subdomain requirements still
  // apply to every hop.
  const inherited = ScopeEngine.evaluateTarget(redirectTarget, policy);
  if (!inherited.allowed) {
    return {
      ok: false,
      code: inherited.code || "TARGET_OUT_OF_SCOPE",
      reason: inherited.reason || "The redirect destination is not a valid inherited target.",
      remediation: "Stop the redirect chain or explicitly review the destination.",
      initialTarget,
      redirectTarget,
    };
  }
  return { ok: true, code: "REDIRECT_INHERITED", initialTarget, redirectTarget, target: inherited.target };
}

module.exports = { loadScopePolicy, targetFromArgs, evaluateNetworkTarget, evaluateRedirectTarget };
