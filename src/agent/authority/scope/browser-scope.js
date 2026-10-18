"use strict";

const { getDomain } = require("tldts");
const ScopeEngine = require("../../../domain/scope/scope-engine");
const { loadScopePolicy, authenticationDependencyMatches } = require("./network-scope");
const { evaluateExclusions } = require("./scope-exclusions");

const READ = new Set(["observe", "screenshot", "scroll", "hover", "move", "wait", "extract", "list_pages"]);
const SENSITIVE = new Set(["type", "insert_text", "upload", "download"]);
const NAVIGATION = new Set(["navigate", "open_page"]);

function originOf(url) {
  try { const parsed = new URL(String(url || "")); return /^https?:$/.test(parsed.protocol) ? parsed.origin : ""; }
  catch { return ""; }
}

function classifyBrowserAction(input = {}, { element = null, fromOrigin = "" } = {}) {
  const action = String(input.action || "");
  if (NAVIGATION.has(action)) {
    const destination = originOf(input.url);
    if (!destination) return "read";
    return destination === fromOrigin ? "interact" : "sensitive";
  }
  if (READ.has(action) || action === "close_page") return "read";
  if (SENSITIVE.has(action)) return "sensitive";
  if (action === "press_key" && /^(enter|numpadenter)$/i.test(String(input.key || "").split("+").pop())) return "sensitive";
  if (["click", "double_click"].includes(action) && element?.submits) return "sensitive";
  return "interact";
}

// Cosmetic variants a redirect commonly introduces: http to https on the same
// host, the www. prefix, and default ports. Each is evaluated as if the user
// had written it into scope.
function cosmeticVariants(target) {
  const hosts = [target.hostname, target.hostname.startsWith("www.") ? target.hostname.slice(4) : `www.${target.hostname}`];
  const schemes = target.port === 443 || target.port === 80 ? ["https", "http"] : [target.scheme];
  return hosts.flatMap(hostname => schemes.map(scheme => ({ ...target, hostname, scheme, port: target.port === 443 || target.port === 80 ? (scheme === "https" ? 443 : 80) : target.port })));
}

function entryHosts(policy) {
  return [...policy.targets, ...policy.wildcardRules]
    .map(entry => ScopeEngine.canonicalTarget(String((typeof entry === "string" ? entry : entry?.value || entry?.url || entry?.host || entry?.hostname || entry?.pattern) || "").replace(/^\*\./, "")))
    .filter(target => target && !target.isIp)
    .map(target => target.hostname);
}

// Shared hosting suffixes (herokuapp.com, github.io, ...) are separate sites.
const siteOf = hostname => getDomain(hostname, { allowPrivateDomains: true });

function browserScopeStanding(url, { workspace = "", projectProfile = null, purpose = "assessment" } = {}) {
  const target = ScopeEngine.canonicalTarget(url);
  if (!target) return { standing: "denied", code: "TARGET_INVALID", reason: "The browser page has no HTTP or HTTPS address." };
  const origin = originOf(url);
  const local = target.hostname === "localhost" || target.hostname.endsWith(".localhost") || (target.isIp && ScopeEngine.isPrivateOrReservedIp(target.hostname));
  if (purpose === "research") {
    if (local) return { standing: "denied", code: "RESEARCH_PRIVATE_TARGET", reason: "Public research browsing cannot reach local or private network addresses.", origin };
    // Research is never a way around the assessment policy: excluded,
    // in-scope, and scope-related hosts belong to assessment tabs only.
    const assessment = browserScopeStanding(url, { workspace, projectProfile, purpose: "assessment" });
    if (["denied", "in_scope", "restricted"].includes(assessment.standing)) {
      return { standing: "denied", code: "RESEARCH_ASSESSMENT_TARGET", reason: `${target.hostname} belongs to the assessment policy. Use an assessment tab, where its scope rules apply.`, origin };
    }
    return { standing: "public", code: "PUBLIC_RESEARCH_ALLOWED", reason: "Public research browsing.", origin };
  }
  const policy = loadScopePolicy(workspace, projectProfile);
  if (!policy.configured) return { standing: "unconfigured", code: "SCOPE_NOT_CONFIGURED", reason: "No assessment scope is configured for this project.", origin };
  if (evaluateExclusions(url, policy.excludedTargets).matched) {
    return { standing: "denied", code: "TARGET_OUT_OF_SCOPE", reason: `${target.hostname} matches an out-of-scope rule.`, origin };
  }
  const exact = ScopeEngine.evaluateTarget(target, policy);
  if (exact.allowed || cosmeticVariants(target).some(variant => ScopeEngine.evaluateTarget(variant, policy).allowed)) {
    return { standing: "in_scope", code: "TARGET_IN_SCOPE", reason: `${target.hostname} is in scope.`, origin };
  }
  if (local) return { standing: "denied", code: "TARGET_PRIVATE_OUT_OF_SCOPE", reason: `${target.hostname} is a local or private address outside the reviewed scope.`, origin };
  const site = siteOf(target.hostname);
  const dependencies = Array.isArray(projectProfile?.scope?.authenticationDependencies) ? projectProfile.scope.authenticationDependencies : [];
  if ((site && entryHosts(policy).some(host => siteOf(host) === site)) || dependencies.some(dependency => authenticationDependencyMatches(url, dependency))) {
    return { standing: "restricted", code: "TARGET_RESTRICTED", reason: `${target.hostname} is related to the reviewed scope but not listed in it.`, origin };
  }
  return { standing: "off_scope", code: "TARGET_OUT_OF_SCOPE", reason: `${target.hostname} is outside the reviewed scope.`, origin };
}

const ACTION_VERB = { read: "read", interact: "interact with", sensitive: "act on" };

// One decision per agent browser action. Deliberate navigation to an unrelated
// site is denied; a tab that drifted there, or a related subdomain, asks once
// per tab ownership grant; sensitive actions ask under Ask for Approval.
function decideBrowserPolicy({ input = {}, tab = null, element = null, standing, profileId = "approve_for_me", granted = () => false } = {}) {
  const fromOrigin = originOf(tab?.url);
  const actionClass = classifyBrowserAction(input, { element, fromOrigin });
  const navigation = NAVIGATION.has(String(input.action || "")) && Boolean(originOf(input.url));
  const base = { actionClass, standing: standing.standing, origin: standing.origin || "", code: standing.code, reason: standing.reason };
  // Listing or closing tabs touches no page, so it never needs scope approval.
  if (["close_page", "list_pages"].includes(String(input.action || ""))) return { ...base, decision: "allow" };
  if (!navigation && !fromOrigin && !originOf(element?.frameUrl)) return { ...base, decision: "allow", standing: "blank", code: "BROWSER_BLANK_PAGE", reason: "The tab has no page loaded." };
  if (standing.standing === "denied" || standing.standing === "unconfigured") return { ...base, decision: "deny" };
  if (navigation && standing.standing === "off_scope") return { ...base, decision: "deny" };
  const grantKey = tab && base.origin ? `${tab.id}:${tab.controlGeneration}:${base.origin}` : "";
  const exception = standing.standing === "off_scope" || (standing.standing === "restricted" && actionClass !== "read");
  if (exception && !(grantKey && granted(grantKey))) {
    const host = (() => { try { return new URL(base.origin).hostname; } catch { return "this page"; } })();
    return { ...base, decision: "require_approval", grantKey, scopeException: true,
      reason: `The agent wants to ${ACTION_VERB[actionClass]} ${host}. ${standing.reason}` };
  }
  if (actionClass === "sensitive" && profileId === "ask_for_approval") {
    return { ...base, decision: "require_approval", scopeException: false, reason: `Ask for Approval requires confirmation before the agent ${input.action === "navigate" || input.action === "open_page" ? "opens a new site" : "types, submits, uploads, or downloads"}.` };
  }
  return { ...base, decision: "allow", ...(exception ? { grantKey } : {}) };
}

async function evaluateBrowserPolicyAsync({ workspace = "", projectProfile = null, input = {}, tab = null, element = null, profileId, granted, resolveAddresses = ScopeEngine.resolveTargetAddresses } = {}) {
  const purpose = input.action === "open_page" ? String(input.purpose || "assessment") : String(tab?.purpose || "assessment");
  const navigation = NAVIGATION.has(String(input.action || "")) && Boolean(originOf(input.url));
  const url = navigation ? input.url : (originOf(element?.frameUrl) ? element.frameUrl : tab?.url || "");
  let standing = originOf(url) ? browserScopeStanding(url, { workspace, projectProfile, purpose }) : { standing: "blank", code: "BROWSER_BLANK_PAGE", reason: "The tab has no page loaded." };
  if (navigation && ["in_scope", "restricted", "public"].includes(standing.standing)) {
    const target = ScopeEngine.canonicalTarget(url);
    let resolution;
    try { resolution = await resolveAddresses(target); }
    catch (error) { resolution = { ok: false, code: "DNS_RESOLUTION_FAILED", reason: `DNS resolution failed: ${error.message}` }; }
    const literalInScope = resolution?.code === "DNS_PRIVATE_OR_RESERVED" && target.isIp && standing.standing === "in_scope";
    if (!resolution?.ok && !literalInScope) standing = { ...standing, standing: "denied", code: resolution?.code || "DNS_RESOLUTION_FAILED", reason: resolution?.reason || "The destination could not be resolved safely." };
  }
  const transfer = { upload: "uploads", download: "downloads" }[input.action];
  if (transfer && projectProfile?.browser?.[transfer] === "blocked") {
    const code = transfer === "uploads" ? "BROWSER_UPLOAD_BLOCKED" : "BROWSER_DOWNLOAD_BLOCKED";
    return { ok: false, code, reason: `This project blocks agent browser ${transfer}. Change it in Settings › Project › Browser transfers.`, browserPolicy: { decision: "deny", code, actionClass: "sensitive", standing: standing.standing } };
  }
  const policy = decideBrowserPolicy({ input, tab, element, standing, profileId, granted });
  const scope = { ok: policy.decision !== "deny", code: policy.code, reason: policy.reason, browserPolicy: policy };
  if (policy.code === "SCOPE_NOT_CONFIGURED") scope.remediation = "Set a project scope in Settings › Project before the agent browses assessment targets.";
  return scope;
}

// A decision made before an action queued still holds at dispatch only if the
// fresh decision is no stricter: an allow must still allow, and an approved
// exception must still be the same exception.
function browserPolicyStillHolds(before, after) {
  if (!after?.ok) return false;
  const was = before?.browserPolicy, now = after.browserPolicy;
  if (now?.decision === "allow") return true;
  return now?.decision === "require_approval" && was?.decision === "require_approval" && (now.grantKey || "") === (was.grantKey || "");
}

module.exports = { browserPolicyStillHolds, classifyBrowserAction, browserScopeStanding, decideBrowserPolicy, evaluateBrowserPolicyAsync, originOf };
