"use strict";

const PROFILE_VERSION = 1;
const MAX_TEXT_LENGTH = 20_000;
const MAX_LIST_ITEMS = 500;

const DEFAULT_PROHIBITED_ACTIONS = Object.freeze([
  "Denial of service or resource exhaustion",
  "Social engineering or phishing",
  "Destructive data modification",
  "Persistence outside the approved test window",
]);

const DEFAULT_STOP_CONDITIONS = Object.freeze([
  "Unexpected service impact or instability",
  "Redirect or resolution to an out-of-scope asset",
  "Sensitive credential or personal-data exposure",
  "Authorization is revoked or expires",
]);

function text(value, fallback = "", maximum = MAX_TEXT_LENGTH) {
  const normalized = String(value == null ? fallback : value).replace(/\u0000/g, "").trim();
  return normalized.slice(0, maximum);
}

function boolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function list(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .slice(0, MAX_LIST_ITEMS)
    .map((entry) => text(typeof entry === "string" ? entry : entry?.value || entry?.name || ""))
    .filter(Boolean);
}

function defaultProjectProfile(root, path, now = () => new Date()) {
  const projectName = path.basename(root);
  return {
    version: PROFILE_VERSION,
    project: {
      name: projectName,
      code: "",
      description: "",
      status: "draft",
      classification: "confidential",
      tags: [],
    },
    engagement: {
      name: projectName,
      programName: "",
      clientOrOwner: "",
      platform: "",
      engagementType: "penetration-test",
      environment: "production",
      methodology: "OWASP / evidence-led",
      timezone: "UTC",
      startDate: "",
      endDate: "",
      objective: "",
      successCriteria: [],
      deliverables: [],
    },
    authorization: {
      confirmed: false,
      authorizedBy: "",
      authorizationReference: "",
      signedAt: "",
      expiresAt: "",
      evidenceReferences: [],
    },
    contacts: {
      primary: "",
      emergency: "",
      escalationWindow: "",
      notificationPreferences: "",
      reportRecipients: [],
    },
    scope: {
      inScopeTargets: [],
      outOfScopeTargets: [],
      wildcardRules: [],
      thirdPartyAssets: [],
      notes: "",
    },
    rulesOfEngagement: {
      testingWindows: [],
      allowedTechniques: [],
      restrictedTechniques: [],
      prohibitedActions: [...DEFAULT_PROHIBITED_ACTIONS],
      sourceIpAddresses: [],
      maximumConcurrency: 1,
      requestsPerSecond: 2,
      requestTimeoutSeconds: 15,
      stopConditions: [...DEFAULT_STOP_CONDITIONS],
      emergencyStopContact: "",
      allowActiveRecon: false,
      allowAutomatedScanning: false,
      allowExploitValidation: false,
      requireApprovalForActive: true,
    },
    review: {
      scopeReviewed: false,
      rulesAccepted: false,
      exclusionsConfirmed: false,
      thirdPartyRiskReviewed: false,
      reviewedBy: "",
      reviewedAt: "",
    },
    dataHandling: {
      collectMinimumNecessary: true,
      redactSecrets: true,
      encryptAtRest: true,
      retentionDays: 30,
      classification: "confidential",
      deletionProcedure: "",
    },
    context: {
      background: "",
      applicationOverview: "",
      architecture: "",
      technologyStack: [],
      authentication: "",
      userRoles: [],
      testAccountReference: "",
      knownConstraints: [],
      repositories: [],
      documentation: [],
      notes: "",
    },
    metadata: {
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
    },
  };
}

function normalizeProjectProfile(input, root, path, now = () => new Date(), previous = null) {
  const source = input && typeof input === "object" ? input : {};
  const defaults = defaultProjectProfile(root, path, now);
  const project = source.project || {};
  const engagement = source.engagement || {};
  const authorization = source.authorization || {};
  const contacts = source.contacts || {};
  const scope = source.scope || {};
  const rules = source.rulesOfEngagement || {};
  const review = source.review || {};
  const dataHandling = source.dataHandling || {};
  const context = source.context || {};

  return {
    version: PROFILE_VERSION,
    project: {
      name: text(project.name, defaults.project.name, 240),
      code: text(project.code, "", 120),
      description: text(project.description),
      status: ["draft", "active", "paused", "completed", "archived"].includes(project.status) ? project.status : defaults.project.status,
      classification: ["public", "internal", "confidential", "restricted"].includes(project.classification) ? project.classification : defaults.project.classification,
      tags: list(project.tags),
    },
    engagement: {
      name: text(engagement.name, defaults.engagement.name, 240),
      programName: text(engagement.programName, "", 240),
      clientOrOwner: text(engagement.clientOrOwner, "", 240),
      platform: text(engagement.platform, "", 240),
      engagementType: text(engagement.engagementType, defaults.engagement.engagementType, 120),
      environment: text(engagement.environment, defaults.engagement.environment, 120),
      methodology: text(engagement.methodology, defaults.engagement.methodology, 240),
      timezone: text(engagement.timezone, defaults.engagement.timezone, 120),
      startDate: text(engagement.startDate, "", 64),
      endDate: text(engagement.endDate, "", 64),
      objective: text(engagement.objective),
      successCriteria: list(engagement.successCriteria),
      deliverables: list(engagement.deliverables),
    },
    authorization: {
      confirmed: boolean(authorization.confirmed),
      authorizedBy: text(authorization.authorizedBy, "", 240),
      authorizationReference: text(authorization.authorizationReference, "", 500),
      signedAt: text(authorization.signedAt, "", 64),
      expiresAt: text(authorization.expiresAt, "", 64),
      evidenceReferences: list(authorization.evidenceReferences),
    },
    contacts: {
      primary: text(contacts.primary, "", 500),
      emergency: text(contacts.emergency, "", 500),
      escalationWindow: text(contacts.escalationWindow, "", 500),
      notificationPreferences: text(contacts.notificationPreferences),
      reportRecipients: list(contacts.reportRecipients),
    },
    scope: {
      inScopeTargets: list(scope.inScopeTargets),
      outOfScopeTargets: list(scope.outOfScopeTargets),
      wildcardRules: list(scope.wildcardRules),
      thirdPartyAssets: list(scope.thirdPartyAssets),
      notes: text(scope.notes),
    },
    rulesOfEngagement: {
      testingWindows: list(rules.testingWindows),
      allowedTechniques: list(rules.allowedTechniques),
      restrictedTechniques: list(rules.restrictedTechniques),
      prohibitedActions: list(rules.prohibitedActions, defaults.rulesOfEngagement.prohibitedActions),
      sourceIpAddresses: list(rules.sourceIpAddresses),
      maximumConcurrency: number(rules.maximumConcurrency, defaults.rulesOfEngagement.maximumConcurrency, 1, 100),
      requestsPerSecond: number(rules.requestsPerSecond, defaults.rulesOfEngagement.requestsPerSecond, 0.1, 1_000),
      requestTimeoutSeconds: number(rules.requestTimeoutSeconds, defaults.rulesOfEngagement.requestTimeoutSeconds, 1, 300),
      stopConditions: list(rules.stopConditions, defaults.rulesOfEngagement.stopConditions),
      emergencyStopContact: text(rules.emergencyStopContact, "", 500),
      allowActiveRecon: boolean(rules.allowActiveRecon),
      allowAutomatedScanning: boolean(rules.allowAutomatedScanning),
      allowExploitValidation: boolean(rules.allowExploitValidation),
      requireApprovalForActive: boolean(rules.requireApprovalForActive, true),
    },
    review: {
      scopeReviewed: boolean(review.scopeReviewed),
      rulesAccepted: boolean(review.rulesAccepted),
      exclusionsConfirmed: boolean(review.exclusionsConfirmed),
      thirdPartyRiskReviewed: boolean(review.thirdPartyRiskReviewed),
      reviewedBy: text(review.reviewedBy, "", 240),
      reviewedAt: text(review.reviewedAt, "", 64),
    },
    dataHandling: {
      collectMinimumNecessary: boolean(dataHandling.collectMinimumNecessary, true),
      redactSecrets: boolean(dataHandling.redactSecrets, true),
      encryptAtRest: boolean(dataHandling.encryptAtRest, true),
      retentionDays: number(dataHandling.retentionDays, defaults.dataHandling.retentionDays, 0, 3_650),
      classification: ["public", "internal", "confidential", "restricted"].includes(dataHandling.classification) ? dataHandling.classification : defaults.dataHandling.classification,
      deletionProcedure: text(dataHandling.deletionProcedure),
    },
    context: {
      background: text(context.background),
      applicationOverview: text(context.applicationOverview),
      architecture: text(context.architecture),
      technologyStack: list(context.technologyStack),
      authentication: text(context.authentication),
      userRoles: list(context.userRoles),
      testAccountReference: text(context.testAccountReference, "", 1_000),
      knownConstraints: list(context.knownConstraints),
      repositories: list(context.repositories),
      documentation: list(context.documentation),
      notes: text(context.notes),
    },
    metadata: {
      createdAt: text(previous?.metadata?.createdAt || source.metadata?.createdAt || defaults.metadata.createdAt, defaults.metadata.createdAt, 64),
      updatedAt: now().toISOString(),
    },
  };
}

function createProjectProfileStore({ fs, path, crypto, baseDirectory, now = () => new Date() }) {
  function resolveProjectRoot(rawRoot) {
    const root = path.resolve(String(rawRoot || ""));
    if (!rawRoot || !path.isAbsolute(String(rawRoot))) return { error: "Project path must be absolute", code: "PROJECT_PATH_INVALID" };
    if (root === path.parse(root).root) return { error: "A filesystem root cannot be used as a project", code: "PROJECT_PATH_UNSAFE" };
    try {
      if (!fs.statSync(root).isDirectory()) return { error: "Project path is not a folder", code: "PROJECT_NOT_DIRECTORY" };
    } catch {
      return { error: "Project folder does not exist", code: "PROJECT_NOT_FOUND" };
    }
    return { root };
  }

  function profilePath(root) {
    const identity = crypto.createHash("sha256").update(process.platform === "win32" ? root.toLowerCase() : root).digest("hex");
    return path.join(baseDirectory, `${identity}.json`);
  }

  function read(rawRoot) {
    const resolved = resolveProjectRoot(rawRoot);
    if (resolved.error) return resolved;
    const target = profilePath(resolved.root);
    let stored = null;
    let recoveredFromBackup = false;
    try {
      stored = JSON.parse(fs.readFileSync(target, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") {
        try {
          stored = JSON.parse(fs.readFileSync(`${target}.bak`, "utf8"));
          recoveredFromBackup = true;
        } catch {
          return { error: `Could not read project settings: ${error.message}`, code: "PROJECT_PROFILE_READ_FAILED" };
        }
      }
    }
    if (stored) {
      const storedRoot = stored?.projectRoot ? path.resolve(stored.projectRoot) : "";
      const rootsMatch = process.platform === "win32"
        ? storedRoot.toLowerCase() === resolved.root.toLowerCase()
        : storedRoot === resolved.root;
      if (storedRoot && !rootsMatch) {
        return { error: "Stored project profile does not match this folder", code: "PROJECT_PROFILE_MISMATCH" };
      }
    }
    const profile = normalizeProjectProfile(stored?.profile, resolved.root, path, now, stored?.profile);
    return {
      ok: true,
      root: resolved.root,
      exists: Boolean(stored),
      profile,
      storage: "app-managed",
      recoveredFromBackup,
    };
  }

  function save(rawRoot, input) {
    const resolved = resolveProjectRoot(rawRoot);
    if (resolved.error) return resolved;
    const current = read(resolved.root);
    if (current.error) return current;
    const profile = normalizeProjectProfile(input, resolved.root, path, now, current.exists ? current.profile : null);
    const target = profilePath(resolved.root);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    const payload = {
      version: PROFILE_VERSION,
      projectRoot: resolved.root,
      profile,
    };
    try {
      fs.mkdirSync(baseDirectory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      try { fs.copyFileSync(target, `${target}.bak`); } catch { /* First profile write. */ }
      try {
        fs.renameSync(temporary, target);
      } catch {
        fs.copyFileSync(temporary, target);
        fs.rmSync(temporary, { force: true });
      }
      return { ok: true, root: resolved.root, exists: true, profile, storage: "app-managed" };
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* Best-effort cleanup. */ }
      return { error: `Could not save project settings: ${error.message}`, code: "PROJECT_PROFILE_WRITE_FAILED" };
    }
  }

  return { read, save };
}

module.exports = {
  PROFILE_VERSION,
  DEFAULT_PROHIBITED_ACTIONS,
  DEFAULT_STOP_CONDITIONS,
  defaultProjectProfile,
  normalizeProjectProfile,
  createProjectProfileStore,
};
