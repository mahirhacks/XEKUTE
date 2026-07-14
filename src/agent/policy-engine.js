const fs = require("fs");
const path = require("path");
const { normalizeProfile } = require("./operating-modes");

const DEFAULT_AUTHORITY_PERMISSIONS = Object.freeze({
  workspaceRead: true, workspaceWrite: true, workspaceDelete: true,
  commandExecution: true, backgroundProcesses: true, terminalAccess: true,
  webResearch: true, outboundHttp: true, proxyInterception: true,
  trafficCapture: true, mapBuild: true, evidenceManagement: true,
  passiveRecon: true, activeRecon: true, automatedScanning: true,
  exploitValidation: true, customScripts: true, sensitiveDataAccess: true,
});

const DEFAULT_POLICY = Object.freeze({
  allowActiveTesting: false,
  allowAutomatedScanning: false,
  allowExploitValidation: false,
  requireApprovalForActive: true,
  maxRequestsPerSecond: 2,
  maxConcurrency: 1,
  requestTimeoutSeconds: 15,
  stopOnUnexpectedImpact: true,
  stopOnOutOfScope: true,
  authoritySuperMode: "approve",
  authorityPermissions: DEFAULT_AUTHORITY_PERMISSIONS,
});

const ACTIVE_COMMAND_RE = /\b(?:curl|wget|invoke-webrequest|httpx|nmap|ffuf|gobuster|dirb|katana|subfinder|amass|theharvester|nikto|sqlmap|testssl|gowitness|burp)\b/i;
const EXPLOIT_COMMAND_RE = /\b(?:sqlmap|metasploit|msfconsole|commix|dalfox|nuclei|xss|payload|exploit|reverse.?shell)\b/i;
const WORKSPACE_MUTATION_TOOLS = new Set(["write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"]);
const PROCESS_TOOLS = new Set(["run_command", "start_process", "read_process", "stop_process"]);

function readJson(filePath, fallback = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function normalizeAuthority(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    superMode: ["full", "ask", "approve"].includes(input.superMode) ? input.superMode : "approve",
    permissions: { ...DEFAULT_AUTHORITY_PERMISSIONS, ...(input.permissions && typeof input.permissions === "object" ? input.permissions : {}) },
  };
}

function loadPolicy(workspace, authorityOverride = null) {
  const root = path.resolve(String(workspace || "."));
  const config = readJson(path.join(root, "scope", "configurations.json"), {});
  const scope = readJson(path.join(root, "scope", "in-scope.json"), {});
  const engagement = readJson(path.join(root, "scope", "engagement.json"), {});
  const settings = readJson(path.join(root, "settings.config"), {});
  const gate = config.authorizationGate || {};
  const safety = config.safety || {};
  const rateLimits = config.rateLimits || {};
  const engagementAuthorization = engagement.authorization || {};
  const engagementReview = engagement.scopeReview || {};
  const engagementRules = engagement.rulesOfEngagement || {};
  const authority = normalizeAuthority(authorityOverride || settings.authority);
  const fullAuthority = authority.superMode === "full";
  return {
    ...DEFAULT_POLICY,
    allowActiveTesting: fullAuthority || (Boolean(gate.allowActiveRecon) && authority.permissions.activeRecon !== false),
    allowAutomatedScanning: fullAuthority || (Boolean(gate.allowAutomatedScanning) && authority.permissions.automatedScanning !== false),
    allowExploitValidation: fullAuthority || (Boolean(gate.allowExploitValidation) && authority.permissions.exploitValidation !== false),
    maxRequestsPerSecond: Number(rateLimits.requestsPerSecond) || DEFAULT_POLICY.maxRequestsPerSecond,
    maxConcurrency: Number(safety.maximumConcurrency) || DEFAULT_POLICY.maxConcurrency,
    requestTimeoutSeconds: Number(safety.requestTimeoutSeconds) || DEFAULT_POLICY.requestTimeoutSeconds,
    stopOnUnexpectedImpact: safety.stopOnUnexpectedImpact !== false,
    stopOnOutOfScope: safety.stopOnOutOfScope !== false,
    authorizationConfirmed: Boolean(scope.authorization?.confirmed && engagementAuthorization.confirmed !== false && gate.authorizationConfirmed),
    scopeReviewed: Boolean(gate.scopeReviewed && (engagementReview.reviewed !== false)),
    rulesAccepted: Boolean(gate.rulesAccepted && Array.isArray(engagementRules.allowedTechniques)),
    authorizationExpiresAt: String(engagementAuthorization.expiresAt || scope.authorization?.expiresAt || ""),
    testingWindows: Array.isArray(engagementRules.testingWindows) ? engagementRules.testingWindows : [],
    engagementStatus: String(engagement.status || "draft"),
    targets: Array.isArray(scope.targets) ? scope.targets : [],
    wildcardRules: Array.isArray(scope.wildcardRules) ? scope.wildcardRules : [],
    restrictedTechniques: Array.isArray(scope.rulesOfEngagement?.restrictedTechniques) ? scope.rulesOfEngagement.restrictedTechniques : (Array.isArray(engagementRules.restrictedTechniques) ? engagementRules.restrictedTechniques : []),
    authoritySuperMode: authority.superMode,
    authorityPermissions: fullAuthority ? Object.fromEntries(Object.keys(DEFAULT_AUTHORITY_PERMISSIONS).map((key) => [key, true])) : authority.permissions,
  };
}

function toolNameOf(tool) {
  return String(tool?.toolName || tool?.action || "unknown");
}

function commandOf(tool) {
  return String(tool?.command || tool?.args?.command || "");
}

function targetOf(tool) {
  return String(tool?.target || tool?.args?.target || tool?.args?.url || tool?.url || commandOf(tool)).trim();
}

function targetIsInScope(tool, policy) {
  const targets = Array.isArray(policy?.targets) ? policy.targets : [];
  const wildcardRules = Array.isArray(policy?.wildcardRules) ? policy.wildcardRules : [];
  if (!targets.length && !wildcardRules.length) return { known: false, allowed: true };
  const value = targetOf(tool).toLowerCase();
  if (!value) return { known: false, allowed: true };
  const targetValues = targets.flatMap((target) => [target?.value, target?.host, target?.url, target?.hostname]).filter(Boolean).map((item) => String(item).toLowerCase());
  const wildcardValues = wildcardRules.map((item) => item && typeof item === "object" ? (item.pattern || item.value || item.host || "") : item).map(String).filter(Boolean).map((item) => item.toLowerCase().replace(/^\*\./, "."));
  const allowed = [...targetValues, ...wildcardValues].some((candidate) => {
    if (candidate.startsWith(".")) return value.includes(candidate);
    return value.includes(candidate);
  });
  return { known: true, allowed };
}

function classifyAction(tool) {
  const name = toolNameOf(tool);
  const command = commandOf(tool);
  if (name === "annotate_map_finding" || name === "record_hypothesis") return { risk: "evidence", capability: "evidence", authorityPermission: "evidenceManagement", active: false, mutatesAssessment: true };
  if (["get_map_overview", "get_map_node", "get_map_neighbors", "find_map_paths", "search_map_routes", "get_map_shared_objects", "get_map_evidence", "get_map_hypotheses"].includes(name)) return { risk: "read", capability: "observe", authorityPermission: "mapBuild", active: false };
  if (WORKSPACE_MUTATION_TOOLS.has(name)) return { risk: "workspace", capability: "workspace", authorityPermission: name === "delete_file" ? "workspaceDelete" : "workspaceWrite", active: false, mutatesWorkspace: true };
  if (PROCESS_TOOLS.has(name)) {
    const active = name === "run_command" || name === "start_process" ? ACTIVE_COMMAND_RE.test(command) : false;
    const exploit = active && EXPLOIT_COMMAND_RE.test(command);
    return { risk: exploit ? "exploit" : active ? "active" : "workspace", capability: active ? "active" : "workspace", authorityPermission: exploit ? "exploitValidation" : active ? "activeRecon" : name === "start_process" ? "backgroundProcesses" : "commandExecution", active, exploit };
  }
  if (["search_web", "fetch_url"].includes(name)) return { risk: "external-read", capability: "observe", authorityPermission: "webResearch", active: false };
  return { risk: "read", capability: "observe", authorityPermission: "workspaceRead", active: false };
}

function evaluateAction({ tool, profile: rawProfile, policy = DEFAULT_POLICY, approvalGranted = false } = {}) {
  const profile = normalizeProfile(rawProfile?.family || rawProfile, rawProfile?.key || rawProfile?.mode);
  const classification = classifyAction(tool);
  const result = { allowed: true, requiresApproval: false, reason: "Allowed by selected mode and policy.", profile: `${profile.family}:${profile.key}`, tool: toolNameOf(tool), ...classification };
  const permissions = { ...DEFAULT_AUTHORITY_PERMISSIONS, ...(policy.authorityPermissions || {}) };
  const fullAuthority = policy.authoritySuperMode === "full";
  const autoApprove = fullAuthority || policy.authoritySuperMode === "approve";
  const effectiveApproval = Boolean(approvalGranted || autoApprove);

  if (!fullAuthority && classification.authorityPermission && permissions[classification.authorityPermission] === false) {
    return { ...result, allowed: false, reason: `${classification.authorityPermission} is disabled in Pointer Authority settings.`, code: "AUTHORITY_PERMISSION_DISABLED" };
  }

  if (profile.family === "testing" && (profile.capability === "observe" || profile.capability === "assess") && (classification.active || classification.mutatesWorkspace)) {
    return { ...result, allowed: false, reason: `${profile.label} is read-only and cannot execute active commands or mutate workspace files.`, code: "MODE_READ_ONLY" };
  }
  if (profile.family === "testing" && profile.capability === "exploit") {
    if (!policy.allowExploitValidation) return { ...result, allowed: false, reason: "Exploit validation is disabled by the assessment policy.", code: "POLICY_EXPLOIT_DISABLED" };
    if (!effectiveApproval) return { ...result, allowed: false, requiresApproval: true, reason: "Exploit validation requires an explicit approval confirmation for this run.", code: "EXPLOIT_APPROVAL_REQUIRED" };
  }
  if (classification.exploit && !policy.allowExploitValidation) {
    return { ...result, allowed: false, reason: "The policy does not allow exploit-oriented commands.", code: "POLICY_EXPLOIT_DISABLED" };
  }
  if (classification.active && !policy.allowActiveTesting) {
    return { ...result, allowed: false, reason: "Active testing is disabled in the assessment policy. Enable allowActiveRecon after reviewing scope and limits.", code: "POLICY_ACTIVE_DISABLED" };
  }
  if (classification.active && policy.authorizationConfirmed === false) {
    return { ...result, allowed: false, reason: "Authorization has not been confirmed for this engagement.", code: "AUTHORIZATION_REQUIRED" };
  }
  if (classification.active && policy.scopeReviewed === false) {
    return { ...result, allowed: false, reason: "The target scope has not been reviewed and accepted.", code: "SCOPE_REVIEW_REQUIRED" };
  }
  if (classification.active && policy.rulesAccepted === false) {
    return { ...result, allowed: false, reason: "The Rules of Engagement have not been accepted.", code: "ROE_ACCEPTANCE_REQUIRED" };
  }
  if (classification.active && policy.authorizationExpiresAt) {
    const expiry = Date.parse(policy.authorizationExpiresAt);
    if (Number.isFinite(expiry) && Date.now() >= expiry) {
      return { ...result, allowed: false, reason: "The engagement authorization has expired.", code: "AUTHORIZATION_EXPIRED" };
    }
  }
  if (classification.active) {
    const scope = targetIsInScope(tool, policy);
    if (scope.known && !scope.allowed) {
      return { ...result, allowed: false, reason: "The requested target is not present in the reviewed in-scope allowlist.", code: "TARGET_OUT_OF_SCOPE" };
    }
  }
  if (classification.exploit && profile.family === "assist") {
    return { ...result, allowed: false, reason: "Safe mode has zero exploit authority. Switch to Testing mode for an explicitly authorized validation.", code: "SAFE_MODE_EXPLOIT_BLOCK" };
  }
  if (classification.active && profile.family === "assist") {
    return { ...result, allowed: false, reason: "Safe mode blocks sensitive active commands. Switch to Testing mode for an approved active test.", code: "SAFE_MODE_ACTIVE_BLOCK" };
  }
  if (classification.active && policy.allowAutomatedScanning === false && /(?:nmap|ffuf|gobuster|dirb|katana|subfinder|amass|theharvester|nikto|gowitness)/i.test(commandOf(tool))) {
    return { ...result, allowed: false, reason: "Automated scanning is disabled in the assessment policy.", code: "POLICY_AUTOMATION_DISABLED" };
  }
  if (classification.active && policy.requireApprovalForActive && !effectiveApproval) {
    return { ...result, allowed: false, requiresApproval: true, reason: "Active actions require the Testing → Execution mode or an explicit approval.", code: "ACTIVE_APPROVAL_REQUIRED" };
  }
  const sensitive = classification.active || classification.exploit || classification.mutatesWorkspace || classification.mutatesAssessment || ["commandExecution", "backgroundProcesses", "outboundHttp", "proxyInterception", "customScripts"].includes(classification.authorityPermission);
  if (policy.authoritySuperMode === "ask" && sensitive && !effectiveApproval) {
    return { ...result, allowed: false, requiresApproval: true, reason: "Pointer Authority is set to Ask for Approval for this action.", code: "AUTHORITY_APPROVAL_REQUIRED" };
  }
  return result;
}

module.exports = {
  DEFAULT_AUTHORITY_PERMISSIONS,
  DEFAULT_POLICY,
  classifyAction,
  evaluateAction,
  loadPolicy,
};
