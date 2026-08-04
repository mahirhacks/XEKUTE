const fs = require("fs");
const path = require("path");
const { normalizeProfile, profileKey } = require("./operating-modes");
const ScopeEngine = require("../../domain/assessment/scope-engine");
const {
  DEFAULT_AUTHORITY_PERMISSIONS,
  DEFAULT_POLICY,
  ACTION_CLASSIFICATION,
  ACTIVE_COMMAND_RE,
  EXPLOIT_COMMAND_RE,
  SAFE_WORKSPACE_COMMAND_RE,
} = require("./runtime-policy-rules");

const WORKSPACE_MUTATION_TOOLS = new Set(ACTION_CLASSIFICATION.workspaceMutationTools);
const PROCESS_TOOLS = new Set(ACTION_CLASSIFICATION.processTools);
const PLAN_DOCUMENT_MUTATION_TOOLS = new Set(["create_file", "write_file", "patch_file"]);
const PLAN_DOCUMENT_EXTENSION_RE = /\.(?:md|markdown|txt|json|ya?ml)$/i;
const PLAN_DOCUMENT_DIRECTORY_RE = /(?:^|\/)(?:plans?|roadmaps?|tasks?)(?:\/|$)/i;
const PLAN_DOCUMENT_NAME_RE = /(?:^|\/)[^/]*(?:plan|roadmap|task)[^/]*\.(?:md|markdown|txt|json|ya?ml)$/i;

function isPlanFilePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((segment) => segment === "." || segment === "..")) return false;
  if (!PLAN_DOCUMENT_EXTENSION_RE.test(normalized)) return false;
  return PLAN_DOCUMENT_DIRECTORY_RE.test(normalized) || PLAN_DOCUMENT_NAME_RE.test(normalized);
}

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
    superMode: ["unrestricted", "full", "ask", "approve"].includes(input.superMode) ? input.superMode : "approve",
    permissions: { ...DEFAULT_AUTHORITY_PERMISSIONS, ...(input.permissions && typeof input.permissions === "object" ? input.permissions : {}) },
  };
}

function normalizeTestingWindows(value) {
  return (Array.isArray(value) ? value : []).map((entry) => {
    if (entry && typeof entry === "object") return entry;
    const raw = String(entry || "").trim();
    const structured = raw.match(/^([a-z,\s]+)\s*\|\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/i);
    if (!structured) return raw;
    return {
      days: structured[1].split(",").map((day) => day.trim()).filter(Boolean),
      start: structured[2],
      end: structured[3],
    };
  }).filter(Boolean);
}

function loadPolicy(workspace, authorityOverride = null, projectProfileOverride = null) {
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
  const outOfScope = readJson(path.join(root, "scope", "out-of-scope.json"), {});
  const authority = normalizeAuthority(authorityOverride || settings.authority);
  const fullAuthority = ["full", "unrestricted", "ask"].includes(authority.superMode);
  const projectProfile = projectProfileOverride && typeof projectProfileOverride === "object" ? projectProfileOverride : null;
  if (projectProfile) {
    const authorization = projectProfile.authorization || {};
    const review = projectProfile.review || {};
    const rules = projectProfile.rulesOfEngagement || {};
    const projectScope = projectProfile.scope || {};
    const projectEngagement = projectProfile.engagement || {};
    return {
      ...DEFAULT_POLICY,
      allowActiveTesting: Boolean(rules.allowActiveRecon) && (fullAuthority || authority.permissions.activeRecon !== false),
      allowAutomatedScanning: Boolean(rules.allowAutomatedScanning) && (fullAuthority || authority.permissions.automatedScanning !== false),
      allowExploitValidation: Boolean(rules.allowExploitValidation) && (fullAuthority || authority.permissions.exploitValidation !== false),
      requireApprovalForActive: rules.requireApprovalForActive !== false,
      maxRequestsPerSecond: Number(rules.requestsPerSecond) || DEFAULT_POLICY.maxRequestsPerSecond,
      maxConcurrency: Number(rules.maximumConcurrency) || DEFAULT_POLICY.maxConcurrency,
      requestTimeoutSeconds: Number(rules.requestTimeoutSeconds) || DEFAULT_POLICY.requestTimeoutSeconds,
      stopOnUnexpectedImpact: (rules.stopConditions || []).some((condition) => /impact|instability/i.test(String(condition))) || DEFAULT_POLICY.stopOnUnexpectedImpact,
      stopOnOutOfScope: (rules.stopConditions || []).some((condition) => /out.of.scope|redirect|resolution/i.test(String(condition))) || DEFAULT_POLICY.stopOnOutOfScope,
      authorizationConfirmed: Boolean(authorization.confirmed),
      scopeReviewed: Boolean(review.scopeReviewed && review.exclusionsConfirmed),
      rulesAccepted: Boolean(review.rulesAccepted),
      authorizationExpiresAt: String(authorization.expiresAt || ""),
      testingWindows: normalizeTestingWindows(rules.testingWindows),
      stopConditions: Array.isArray(rules.stopConditions) ? rules.stopConditions : [],
      timezone: String(projectEngagement.timezone || "UTC"),
      engagementStatus: String(projectProfile.project?.status || "draft"),
      targets: Array.isArray(projectScope.inScopeTargets) ? projectScope.inScopeTargets : [],
      wildcardRules: Array.isArray(projectScope.wildcardRules) ? projectScope.wildcardRules : [],
      excludedTargets: Array.isArray(projectScope.outOfScopeTargets) ? projectScope.outOfScopeTargets : [],
      allowedTechniques: Array.isArray(rules.allowedTechniques) ? rules.allowedTechniques : [],
      restrictedTechniques: Array.isArray(rules.restrictedTechniques) ? rules.restrictedTechniques : [],
      prohibitedTechniques: Array.isArray(rules.prohibitedActions) ? rules.prohibitedActions : [],
      authoritySuperMode: authority.superMode,
      authorityPermissions: fullAuthority ? Object.fromEntries(Object.keys(DEFAULT_AUTHORITY_PERMISSIONS).map((key) => [key, true])) : authority.permissions,
    };
  }
  return {
    ...DEFAULT_POLICY,
    allowActiveTesting: Boolean(gate.allowActiveRecon) && (fullAuthority || authority.permissions.activeRecon !== false),
    allowAutomatedScanning: Boolean(gate.allowAutomatedScanning) && (fullAuthority || authority.permissions.automatedScanning !== false),
    allowExploitValidation: Boolean(gate.allowExploitValidation) && (fullAuthority || authority.permissions.exploitValidation !== false),
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
    stopConditions: Array.isArray(engagementRules.stopConditions) ? engagementRules.stopConditions : [],
    timezone: String(engagement.engagement?.timezone || scope.engagement?.timezone || "UTC"),
    engagementStatus: String(engagement.status || "draft"),
    targets: Array.isArray(scope.targets) ? scope.targets : [],
    wildcardRules: Array.isArray(scope.wildcardRules) ? scope.wildcardRules : [],
    excludedTargets: Array.isArray(outOfScope.assets) ? outOfScope.assets : [],
    allowedTechniques: Array.isArray(engagementRules.allowedTechniques) ? engagementRules.allowedTechniques : [],
    restrictedTechniques: Array.isArray(scope.rulesOfEngagement?.restrictedTechniques) ? scope.rulesOfEngagement.restrictedTechniques : (Array.isArray(engagementRules.restrictedTechniques) ? engagementRules.restrictedTechniques : []),
    prohibitedTechniques: Array.isArray(engagementRules.prohibitedActions) ? engagementRules.prohibitedActions : [],
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

function normalizedTechniqueList(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(typeof item === "string" ? item : item?.id || item?.techniqueId || item?.value || item?.name || "").trim().toLowerCase()).filter(Boolean);
}

function targetIsInScope(tool, policy) {
  const explicit = tool?.args?.target || tool?.args?.url || tool?.target || tool?.url;
  const targets = explicit ? [ScopeEngine.canonicalTarget(explicit)].filter(Boolean) : ScopeEngine.extractCommandTargets(commandOf(tool));
  if (!targets.length) return { known: false, allowed: false, code: "TARGET_REQUIRED", reason: "Active actions require a canonical target argument." };
  const decisions = targets.map((target) => ScopeEngine.evaluateTarget(target, policy));
  const blocked = decisions.find((decision) => !decision.allowed);
  return blocked || { known: true, allowed: true, targets: decisions.map((decision) => decision.target), code: "TARGET_IN_SCOPE", reason: "Every canonical target is in scope." };
}

function evaluateStopConditions(result = {}, policy = DEFAULT_POLICY) {
  const triggered = [];
  if (result.outOfScope || result.scope?.allowed === false || result.redirectScope?.allowed === false) triggered.push("out-of-scope target or redirect");
  if (result.unexpectedImpact || result.serviceInstability) triggered.push("unexpected service impact or instability");
  if (result.sensitiveDataExposure) triggered.push("sensitive-data exposure");
  if (result.policyRevoked) triggered.push("policy revocation");
  if (result.emergencyStop) triggered.push("emergency stop");
  return { stop: triggered.length > 0, triggered, configured: Array.isArray(policy.stopConditions) ? policy.stopConditions : [] };
}

function classifyAction(tool) {
  const name = toolNameOf(tool);
  const command = commandOf(tool);
  if (ACTION_CLASSIFICATION.evidenceTools.includes(name)) return { risk: "evidence", capability: "evidence", authorityPermission: "evidenceManagement", active: false, mutatesAssessment: true };
  if (name === "request_operator_questions") return { risk: "read", capability: "observe", authorityPermission: "workspaceRead", active: false, operatorInteraction: true };
  if (ACTION_CLASSIFICATION.mapReadTools.includes(name)) return { risk: "read", capability: "observe", authorityPermission: "mapBuild", active: false };
  if (name === "run_security_tool") {
    const adapter = String(tool?.args?.adapter_id || "").toLowerCase();
    const exploit = ACTION_CLASSIFICATION.exploitAdapters.includes(adapter);
    const passive = ACTION_CLASSIFICATION.passiveAdapters.includes(adapter);
    return { risk: exploit ? "exploit" : passive ? "passive" : "active", capability: exploit ? "exploit" : passive ? "observe" : "active", authorityPermission: exploit ? "exploitValidation" : passive ? "passiveRecon" : "activeRecon", active: !passive, exploit, automated: true };
  }
  if (name === "run_traffsucker") {
    return { risk: "active", capability: "active", authorityPermission: "activeRecon", active: true, exploit: false, automated: true };
  }
  if (name === "run_custom_script") return { risk: "unclassified-external", capability: "active", authorityPermission: "customScripts", active: true, exploit: false, unclassifiedExternal: true };
  if (WORKSPACE_MUTATION_TOOLS.has(name)) return { risk: "workspace", capability: "workspace", authorityPermission: name === "delete_file" ? "workspaceDelete" : "workspaceWrite", active: false, mutatesWorkspace: true };
  if (PROCESS_TOOLS.has(name)) {
    const processStart = name === "run_command" || name === "start_process";
    const explicitlyActive = processStart ? ACTIVE_COMMAND_RE.test(command) : false;
    const unclassifiedExternal = processStart && !SAFE_WORKSPACE_COMMAND_RE.test(command) && !explicitlyActive;
    const active = explicitlyActive || unclassifiedExternal;
    const exploit = active && EXPLOIT_COMMAND_RE.test(command);
    return { risk: exploit ? "exploit" : unclassifiedExternal ? "unclassified-external" : active ? "active" : "workspace", capability: active ? "active" : "workspace", authorityPermission: exploit ? "exploitValidation" : active ? "activeRecon" : name === "start_process" ? "backgroundProcesses" : "commandExecution", active, exploit, unclassifiedExternal };
  }
  if (["search_web", "fetch_url"].includes(name)) return { risk: "external-read", capability: "observe", authorityPermission: "webResearch", active: false };
  if (name === "load_tool_schemas") return { risk: "read", capability: "observe", authorityPermission: "workspaceRead", active: false };
  return { risk: "read", capability: "observe", authorityPermission: "workspaceRead", active: false };
}

function isReconAction(tool, classification = {}) {
  const name = toolNameOf(tool);
  if (ACTION_CLASSIFICATION.mapReadTools.includes(name)) return true;
  if (["search_web", "fetch_url", "list_datasets", "run_traffsucker"].includes(name)) return true;
  if (name === "run_security_tool") {
    const adapter = String(tool?.args?.adapter_id || "").toLowerCase();
    if (ACTION_CLASSIFICATION.exploitAdapters.includes(adapter)) return false;
    return true;
  }
  if (classification.authorityPermission === "passiveRecon") return true;
  if (classification.mutatesAssessment || classification.exploit) return false;
  // Ordinary OS workspace actions count as approved under Approve-for-me.
  if (!classification.active) return true;
  // Active OS commands that look like recon scanners are still recon.
  if (classification.active && !classification.exploit && !classification.unclassifiedExternal) return true;
  return false;
}

function evaluateAction({ tool, profile: rawProfile, policy = DEFAULT_POLICY, approvalGranted = false } = {}) {
  const profile = normalizeProfile(rawProfile?.family || rawProfile, rawProfile?.key || rawProfile?.mode);
  const classification = classifyAction(tool);
  const result = { allowed: true, requiresApproval: false, reason: "Allowed by selected mode and policy.", profile: profileKey(profile), tool: toolNameOf(tool), ...classification };
  const permissions = { ...DEFAULT_AUTHORITY_PERMISSIONS, ...(policy.authorityPermissions || {}) };
  const mode = policy.authoritySuperMode;
  const unrestrictedMode = mode === "unrestricted";
  // full and ask carry "full authority / no restriction": they bypass the
  // policy gates (authorization, ROE, window, techniques, expiry) but ask still
  // prompts. approve is semi-restricted: recon auto-approves; other cyber needs approval.
  const gateBypassed = ["unrestricted", "full", "ask"].includes(mode);
  const permissionsForcedOn = gateBypassed;
  const autoApproveAll = ["unrestricted", "full"].includes(mode);
  const expectedTarget = String(tool?.args?.target || tool?.target || "");
  const actionApproval = approvalGranted && typeof approvalGranted === "object"
    ? String(approvalGranted.actionId || "") === String(tool?.callId || tool?.id || "")
      && (!approvalGranted.target || String(approvalGranted.target) === expectedTarget)
      && (!approvalGranted.capability || approvalGranted.capability === classification.capability)
      && (!approvalGranted.risk || approvalGranted.risk === classification.risk)
      && (!approvalGranted.expiresAt || (Number.isFinite(Date.parse(approvalGranted.expiresAt)) && Date.now() < Date.parse(approvalGranted.expiresAt)))
    : Boolean(approvalGranted) && !classification.active && !classification.exploit;
  const basicWorkspaceMutation = Boolean(
    classification.mutatesWorkspace
      && !classification.active
      && !classification.exploit
      && !classification.unclassifiedExternal,
  );
  const reconAutoApproved = mode === "approve" && isReconAction(tool, classification);
  const autoApproved = (autoApproveAll && (unrestrictedMode || (!classification.exploit && !classification.unclassifiedExternal)))
    || (mode === "approve" && (basicWorkspaceMutation || reconAutoApproved));
  const effectiveApproval = Boolean(actionApproval || basicWorkspaceMutation || autoApproved);

  if (!permissionsForcedOn && classification.authorityPermission && permissions[classification.authorityPermission] === false) {
    return { ...result, allowed: false, reason: `${classification.authorityPermission} is disabled in XEKUTE Authority settings.`, code: "AUTHORITY_PERMISSION_DISABLED" };
  }

  if (!unrestrictedMode && ["observe", "assess", "verify", "report"].includes(profile.capability) && (classification.active || classification.mutatesWorkspace || classification.mutatesAssessment)) {
    return { ...result, allowed: false, reason: `${profile.label} is read-only and cannot execute active commands or mutate workspace files.`, code: "MODE_READ_ONLY" };
  }
  if (profile.capability === "plan" && (classification.active || classification.mutatesAssessment || classification.exploit)) {
    return { ...result, allowed: false, reason: "Plan mode can read and write workspace files but cannot run active testing or mutate assessment evidence.", code: "MODE_PLAN_SCOPE" };
  }
  if (profile.key === "agent" && classification.exploit) {
    if (!gateBypassed && !policy.allowExploitValidation) return { ...result, allowed: false, reason: "Exploit validation is disabled by the assessment policy.", code: "POLICY_EXPLOIT_DISABLED" };
    if (!effectiveApproval && mode !== "unrestricted" && mode !== "full") {
      return { ...result, allowed: false, requiresApproval: true, reason: "Exploit validation requires an explicit approval confirmation for this run.", code: "EXPLOIT_APPROVAL_REQUIRED" };
    }
  }
  if (classification.exploit && !gateBypassed && !policy.allowExploitValidation) {
    return { ...result, allowed: false, reason: "The policy does not allow exploit-oriented commands.", code: "POLICY_EXPLOIT_DISABLED" };
  }
  if (classification.active && !gateBypassed && !policy.allowActiveTesting) {
    return { ...result, allowed: false, reason: "Active testing is disabled in the assessment policy. Enable allowActiveRecon after reviewing scope and limits.", code: "POLICY_ACTIVE_DISABLED" };
  }
  if (classification.active && !gateBypassed && policy.authorizationConfirmed === false) {
    return { ...result, allowed: false, reason: "Authorization has not been confirmed for this engagement.", code: "AUTHORIZATION_REQUIRED" };
  }
  if (classification.active && !gateBypassed && policy.scopeReviewed === false) {
    return { ...result, allowed: false, reason: "The target scope has not been reviewed and accepted.", code: "SCOPE_REVIEW_REQUIRED" };
  }
  if (classification.active && !gateBypassed && policy.rulesAccepted === false) {
    return { ...result, allowed: false, reason: "The Rules of Engagement have not been accepted.", code: "ROE_ACCEPTANCE_REQUIRED" };
  }
  if (classification.active && !gateBypassed) {
    const windowDecision = ScopeEngine.testingWindowAllows(policy.testingWindows, { timeZone: policy.timezone });
    if (!windowDecision.allowed) return { ...result, allowed: false, reason: windowDecision.reason, code: windowDecision.code };
    const techniqueIds = normalizedTechniqueList(tool?.args?.technique_ids);
    const restricted = normalizedTechniqueList(policy.restrictedTechniques);
    const prohibited = normalizedTechniqueList(policy.prohibitedTechniques);
    const allowed = normalizedTechniqueList(policy.allowedTechniques);
    if (toolNameOf(tool) === "run_security_tool" && !techniqueIds.length) return { ...result, allowed: false, reason: "Typed security actions require explicit technique identifiers for RoE matching.", code: "TECHNIQUE_REQUIRED" };
    if (techniqueIds.some((technique) => prohibited.includes(technique))) return { ...result, allowed: false, reason: "The proposed action uses a prohibited technique.", code: "TECHNIQUE_PROHIBITED" };
    if (techniqueIds.some((technique) => restricted.includes(technique))) return { ...result, allowed: false, reason: "The proposed action uses a restricted technique.", code: "TECHNIQUE_RESTRICTED" };
    if (allowed.length && techniqueIds.length && techniqueIds.some((technique) => !allowed.includes(technique))) return { ...result, allowed: false, reason: "The proposed technique is not in the engagement allowlist.", code: "TECHNIQUE_NOT_ALLOWED" };
  }
  if (classification.active && !gateBypassed && policy.authorizationExpiresAt) {
    const expiry = Date.parse(policy.authorizationExpiresAt);
    if (Number.isFinite(expiry) && Date.now() >= expiry) {
      return { ...result, allowed: false, reason: "The engagement authorization has expired.", code: "AUTHORIZATION_EXPIRED" };
    }
  }
  if (classification.active && !unrestrictedMode) {
    const scope = targetIsInScope(tool, policy);
    if (!scope.allowed) return { ...result, allowed: false, reason: scope.reason || "The requested target is not in scope.", code: scope.code || "TARGET_OUT_OF_SCOPE" };
  }
  if (!gateBypassed && classification.active && policy.allowAutomatedScanning === false && (classification.automated || /(?:nmap|ffuf|gobuster|dirb|katana|subfinder|amass|theharvester|nikto|gowitness)/i.test(commandOf(tool)))) {
    return { ...result, allowed: false, reason: "Automated scanning is disabled in the assessment policy.", code: "POLICY_AUTOMATION_DISABLED" };
  }
  if (classification.active && !gateBypassed && policy.requireApprovalForActive && !effectiveApproval && mode === "approve" && !reconAutoApproved) {
    return { ...result, allowed: false, requiresApproval: true, reason: "Active non-recon actions require approval under Approve for me.", code: "ACTIVE_APPROVAL_REQUIRED" };
  }
  const sensitive = classification.active || classification.exploit || classification.mutatesAssessment || ["commandExecution", "backgroundProcesses", "outboundHttp", "proxyInterception", "customScripts"].includes(classification.authorityPermission);
  if (mode === "ask" && sensitive && !effectiveApproval) {
    return { ...result, allowed: false, requiresApproval: true, reason: "XEKUTE Authority is set to Ask for Approval for this action.", code: "AUTHORITY_APPROVAL_REQUIRED" };
  }
  if (mode === "approve" && profile.key === "agent" && !reconAutoApproved && !basicWorkspaceMutation && sensitive && !effectiveApproval) {
    return { ...result, allowed: false, requiresApproval: true, reason: "Approve for me auto-approves recon and ordinary workspace actions; this action still needs approval.", code: "AUTHORITY_APPROVAL_REQUIRED" };
  }
  return result;
}

module.exports = {
  DEFAULT_AUTHORITY_PERMISSIONS,
  DEFAULT_POLICY,
  classifyAction,
  evaluateAction,
  isPlanFilePath,
  isOperatorQuestionsFilePath: require("../clarification/operator-questions").isOperatorQuestionsFilePath,
  loadPolicy,
  targetIsInScope,
  evaluateStopConditions,
};
