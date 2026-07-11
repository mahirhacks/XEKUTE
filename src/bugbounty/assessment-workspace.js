const ASSESSMENT_VERSION = 2;

const ASSESSMENT_ITEM_FILES = {
  "in-scope": "scope/in-scope.json",
  "out-of-scope": "scope/out-of-scope.json",
  configurations: "scope/configurations.json",
  "active-recon": "recon/active-recon.json",
  "passive-recon": "recon/passive-recon.json",
  endpoints: "enumeration/endpoints.json",
  pages: "enumeration/pages.json",
  subdomains: "enumeration/subdomains.json",
  "raw-traffic": "traffic/raw.jsonl",
  "filtered-traffic": "traffic/filtered.jsonl",
  services: "vulnerability-scans/services.json",
  info: "vulnerability-scans/info.json",
  easy: "vulnerability-scans/easy.json",
  medium: "vulnerability-scans/medium.json",
  high: "vulnerability-scans/high.json",
  critical: "vulnerability-scans/critical.json",
  "wstg-checklists": "penetration-testing/wstg-checklist.json",
  "mitre-checklists": "penetration-testing/mitre-checklist.json",
  report: "report/report.md",
  settings: "settings.config",
};

const REQUIRED_DIRECTORIES = [
  "scope",
  "recon",
  "enumeration",
  "traffic",
  "vulnerability-scans",
  "penetration-testing",
  "report",
];

const EVIDENCE_TEMPLATE = {
  id: "",
  type: "request-response",
  title: "",
  filePath: "",
  capturedAt: "",
  capturedBy: "",
  sha256: "",
  redacted: false,
  notes: "",
};

const TARGET_TEMPLATE = {
  id: "",
  assetType: "web-application",
  value: "",
  scheme: "https",
  environment: "production",
  owner: "",
  businessFunction: "",
  criticality: "unknown",
  authenticationRequired: false,
  credentialsReference: "",
  allowedTechniques: [],
  prohibitedTechniques: [],
  testingWindow: "",
  rateLimitPerSecond: null,
  notes: "",
  tags: [],
};

const RECON_RUN_TEMPLATE = {
  id: "",
  startedAt: "",
  completedAt: "",
  operator: "",
  tool: "",
  toolVersion: "",
  commandReference: "",
  sourceIp: "",
  targetIds: [],
  status: "not-started",
  requestsSent: 0,
  rateLimitPerSecond: null,
  outputFiles: [],
  errors: [],
  notes: "",
};

function findingTemplate(severity) {
  return {
    id: "",
    title: "",
    severity,
    confidence: "unconfirmed",
    status: "draft",
    source: "manual",
    discoveredAt: "",
    reportedAt: "",
    researcher: "",
    asset: {
      targetId: "",
      host: "",
      url: "",
      endpoint: "",
      parameter: "",
      component: "",
      environment: "production",
    },
    classification: {
      vulnerabilityType: "",
      cweIds: [],
      owaspCategories: [],
      wstgIds: [],
      capecIds: [],
      mitreTechniqueIds: [],
    },
    cvss: {
      version: "3.1",
      vector: "",
      baseScore: null,
      temporalScore: null,
      environmentalScore: null,
    },
    description: "",
    technicalDetails: "",
    prerequisites: [],
    reproduction: {
      steps: [],
      request: "",
      response: "",
      payload: "",
      expectedResult: "",
      observedResult: "",
    },
    impact: {
      technical: "",
      business: "",
      confidentiality: "none",
      integrity: "none",
      availability: "none",
      affectedUsers: "",
      exploitability: "",
    },
    evidence: [],
    remediation: {
      recommendation: "",
      compensatingControls: [],
      references: [],
      owner: "",
      targetDate: "",
    },
    validation: {
      retestStatus: "not-tested",
      retestedAt: "",
      retestedBy: "",
      notes: "",
    },
    disclosure: {
      duplicateOf: "",
      externalTicket: "",
      vendorStatus: "",
      bountyAmount: null,
    },
    tags: [],
  };
}

function findingBucket(severity) {
  return {
    schemaVersion: ASSESSMENT_VERSION,
    severity,
    description: `${severity} severity vulnerability findings`,
    findingTemplate: findingTemplate(severity),
    findings: [],
  };
}

const JSON_TEMPLATES = {
  "settings.config": {
    schemaVersion: ASSESSMENT_VERSION,
    listener: {
      enabled: false,
      bindAddress: "127.0.0.1",
      port: 8080,
      invisibleProxying: false,
      redirectToHost: "",
      redirectToPort: null,
      supportHttp2: true,
    },
    tls: {
      enabled: false,
      certificateMode: "project-ca",
      certificatePath: "",
      privateKeyPath: "",
      minimumVersion: "TLSv1.2",
      maximumVersion: "TLSv1.3",
      verifyUpstreamCertificates: true,
    },
    interception: {
      enabled: false,
      interceptRequests: true,
      interceptResponses: false,
      onlyInScope: true,
      automaticallyUpdateContentLength: true,
      automaticallyFixNewlines: true,
      excludedExtensions: ["gif", "jpg", "jpeg", "png", "css", "js", "ico", "svg"],
      rules: [],
    },
    upstreamProxy: {
      enabled: false,
      url: "",
      usernameReference: "",
      passwordReference: "",
      noProxyHosts: ["localhost", "127.0.0.1"],
    },
    requests: {
      timeoutSeconds: 15,
      followRedirects: false,
      maximumResponseBytes: 1000000,
      defaultHeaders: {},
    },
    intruder: {
      maximumRequestsPerRun: 25,
      delayBetweenRequestsMs: 500,
      stopOnError: true,
      attackType: "sniper",
    },
    logging: {
      logRawTraffic: true,
      logFilteredTraffic: true,
      includeBodies: true,
      redactAuthorizationHeaders: false,
      maximumRecordBytes: 1500000,
      timestampFormat: "DD/MM/YY-HH:mm:ss:SSS",
    },
    aiAnalysis: {
      includeRequest: true,
      includeResponse: true,
      maximumCharactersPerMessage: 14000,
      defaultChatMode: "ask",
    },
    authorization: {
      confirmed: false,
      authorizedBy: "",
      authorizationReference: "",
      signedAt: "",
      expiresAt: "",
    },
    authorizationGate: {
      authorizationConfirmed: false,
      scopeReviewed: false,
      rulesAccepted: false,
      overrideAuthorization: false,
      allowPassiveRecon: true,
      allowActiveRecon: false,
      allowAutomatedScanning: false,
      allowExploitValidation: false,
    },
  },
  "scope/in-scope.json": {
    schemaVersion: ASSESSMENT_VERSION,
    engagement: {
      name: "",
      programName: "",
      platform: "",
      engagementType: "bug-bounty",
      clientOrOwner: "",
      primaryContact: "",
      emergencyContact: "",
      timezone: "UTC",
      startDate: "",
      endDate: "",
    },
    authorization: {
      confirmed: false,
      authorizedBy: "",
      authorizationReference: "",
      signedAt: "",
      expiresAt: "",
      evidenceFiles: [],
    },
    rulesOfEngagement: {
      testingWindows: [],
      sourceIpAddresses: [],
      allowedTechniques: [],
      restrictedTechniques: [],
      concurrencyLimit: 1,
      defaultRateLimitPerSecond: 2,
    },
    targetTemplate: TARGET_TEMPLATE,
    targets: [],
    wildcardRules: [],
    assetOwnershipValidation: [],
    notes: "",
    lastReviewedAt: "",
    lastReviewedBy: "",
  },
  "scope/out-of-scope.json": {
    schemaVersion: ASSESSMENT_VERSION,
    policyReference: "",
    assetTemplate: {
      id: "",
      assetType: "",
      value: "",
      reason: "",
      owner: "",
      addedAt: "",
      expiresAt: "",
      notes: "",
    },
    assets: [],
    globalExclusions: [],
    prohibitedActions: [
      "denial-of-service",
      "social-engineering",
      "physical-access",
      "destructive-data-modification",
    ],
    sensitiveSystems: [],
    thirdPartyAssets: [],
    dataHandlingRestrictions: [],
    exceptionProcess: {
      contact: "",
      approvalRequired: true,
      approvalReference: "",
      approvedExceptions: [],
    },
    notes: "",
    lastReviewedAt: "",
    lastReviewedBy: "",
  },
  "scope/configurations.json": {
    schemaVersion: ASSESSMENT_VERSION,
    engagementId: "",
    operator: {
      name: "",
      handle: "",
      organization: "",
      contact: "",
    },
    authorizationGate: {
      authorizationConfirmed: false,
      scopeReviewed: false,
      rulesAccepted: false,
      overrideAuthorization: false,
      allowPassiveRecon: true,
      allowActiveRecon: false,
      allowAutomatedScanning: false,
      allowExploitValidation: false,
    },
    safety: {
      stopOnUnexpectedImpact: true,
      stopOnOutOfScopeRedirect: true,
      maximumConcurrency: 1,
      requestTimeoutSeconds: 15,
      retryLimit: 1,
      prohibitedStatusCodes: [],
      emergencyStopContact: "",
    },
    rateLimits: {
      requestsPerSecond: 2,
      burstSize: 2,
      delayBetweenHostsMs: 1000,
      respectRetryAfter: true,
    },
    network: {
      sourceIpAddresses: [],
      proxyUrl: "",
      userAgent: "Pointer Security Assessment",
      dnsResolvers: [],
      verifyTlsCertificates: true,
    },
    authentication: {
      credentialStorage: "external-reference-only",
      credentialReferences: [],
      testAccounts: [],
      sessionRefreshNotes: "",
      mfaHandlingNotes: "",
    },
    tooling: {
      allowedTools: [],
      blockedTools: [],
      versions: {},
      customHeaders: {},
    },
    evidence: {
      rootDirectory: "evidence",
      redactSecrets: true,
      hashArtifacts: true,
      timestampFormat: "ISO-8601",
      screenshotFormat: "png",
    },
    notifications: {
      notifyBeforeTesting: false,
      notifyOnCriticalFinding: true,
      notifyOnServiceImpact: true,
      contacts: [],
    },
    dataHandling: {
      collectMinimumNecessary: true,
      storeProductionData: false,
      encryptAtRest: true,
      retentionDays: 30,
      deletionProcedure: "",
    },
    reporting: {
      severityStandard: "CVSS 3.1",
      reportFormat: "markdown",
      includeRawTraffic: false,
      includeReproductionRequests: true,
    },
    stopConditions: [],
    notes: "",
  },
  "recon/active-recon.json": {
    schemaVersion: ASSESSMENT_VERSION,
    authorizationRequired: true,
    runTemplate: RECON_RUN_TEMPLATE,
    runs: [],
    techniques: [],
    discoveredAssetTemplate: { targetId: "", type: "", value: "", source: "", discoveredAt: "", confidence: "", inScope: null, notes: "" },
    discoveredAssets: [],
    findingTemplate: { id: "", category: "", title: "", asset: "", detail: "", confidence: "", evidence: [], tags: [] },
    findings: [],
    evidenceTemplate: EVIDENCE_TEMPLATE,
    evidence: [],
  },
  "recon/passive-recon.json": {
    schemaVersion: ASSESSMENT_VERSION,
    authorizationRequired: false,
    runTemplate: RECON_RUN_TEMPLATE,
    runs: [],
    sources: [],
    sourceTemplate: { name: "", type: "", url: "", queriedAt: "", terms: [], reliability: "", notes: "" },
    discoveredAssetTemplate: { targetId: "", type: "", value: "", source: "", firstSeen: "", lastSeen: "", confidence: "", inScope: null, notes: "" },
    discoveredAssets: [],
    findingTemplate: { id: "", category: "", title: "", asset: "", detail: "", confidence: "", evidence: [], tags: [] },
    findings: [],
    evidenceTemplate: EVIDENCE_TEMPLATE,
    evidence: [],
  },
  "enumeration/endpoints.json": {
    schemaVersion: ASSESSMENT_VERSION,
    endpointTemplate: {
      id: "", targetId: "", method: "GET", scheme: "https", host: "", port: 443, path: "", url: "",
      parameters: [], headers: {}, requestContentTypes: [], responseContentTypes: [], authentication: "unknown",
      authorizationRoles: [], statusCodes: [], technologies: [], discoveredBy: "", firstSeen: "", lastSeen: "",
      deprecated: false, tested: false, evidence: [], notes: "", tags: [],
    },
    parameterTemplate: { name: "", location: "query", dataType: "string", required: false, exampleRedacted: "", observedValues: [], notes: "" },
    endpoints: [],
    statistics: { total: 0, authenticated: 0, unauthenticated: 0, tested: 0, untested: 0 },
  },
  "enumeration/pages.json": {
    schemaVersion: ASSESSMENT_VERSION,
    pageTemplate: {
      id: "", targetId: "", url: "", path: "", title: "", statusCode: null, contentType: "", contentLength: null,
      authentication: "unknown", roles: [], technologies: [], forms: [], scripts: [], apiCalls: [], parameters: [],
      securityHeaders: {}, cacheControls: {}, discoveredBy: "", firstSeen: "", lastSeen: "", screenshotPath: "",
      tested: false, evidence: [], notes: "", tags: [],
    },
    pages: [],
    statistics: { total: 0, authenticated: 0, unauthenticated: 0, tested: 0, untested: 0 },
  },
  "enumeration/subdomains.json": {
    schemaVersion: ASSESSMENT_VERSION,
    subdomainTemplate: {
      id: "", targetId: "", hostname: "", rootDomain: "", inScope: null, source: "", firstSeen: "", lastSeen: "",
      dns: { a: [], aaaa: [], cname: [], mx: [], ns: [], txt: [] },
      resolvedIps: [], httpStatus: null, httpsStatus: null, title: "", technologies: [], cdn: "", cloudProvider: "",
      takeoverStatus: "not-checked", takeoverEvidence: [], live: null, tested: false, notes: "", tags: [],
    },
    subdomains: [],
    statistics: { total: 0, live: 0, inScope: 0, takeoverCandidates: 0, tested: 0 },
  },
  "vulnerability-scans/services.json": {
    schemaVersion: ASSESSMENT_VERSION,
    scanMetadata: { lastRunAt: "", scanner: "", scannerVersion: "", signaturesUpdatedAt: "", targetIds: [], notes: "" },
    serviceTemplate: {
      id: "", targetId: "", host: "", ip: "", port: null, transport: "tcp", protocol: "", service: "",
      product: "", version: "", latestKnownVersion: "", versionStatus: "unknown", endOfLife: null, endOfLifeDate: "",
      cpes: [], cveIds: [], advisories: [], tls: { enabled: false, version: "", cipher: "", certificateExpiresAt: "" },
      bannerRedacted: "", discoveredAt: "", lastCheckedAt: "", confidence: "", evidence: [], notes: "", tags: [],
    },
    services: [],
    statistics: { total: 0, current: 0, outdated: 0, endOfLife: 0, unknown: 0 },
  },
  "vulnerability-scans/info.json": findingBucket("info"),
  "vulnerability-scans/easy.json": findingBucket("easy"),
  "vulnerability-scans/medium.json": findingBucket("medium"),
  "vulnerability-scans/high.json": findingBucket("high"),
  "vulnerability-scans/critical.json": findingBucket("critical"),
  "penetration-testing/wstg-checklist.json": {
    schemaVersion: ASSESSMENT_VERSION,
    framework: { name: "OWASP Web Security Testing Guide", shortName: "WSTG", version: "", sourceUrl: "https://owasp.org/www-project-web-security-testing-guide/" },
    assessment: { targetIds: [], startedAt: "", completedAt: "", operator: "", reviewStatus: "not-started" },
    progress: { total: 0, notStarted: 0, inProgress: 0, passed: 0, failed: 0, notApplicable: 0, blocked: 0 },
    checkTemplate: {
      id: "", category: "", title: "", objective: "", targetIds: [], status: "not-started", tester: "",
      startedAt: "", completedAt: "", procedure: [], result: "", findingIds: [], evidence: [], notes: "", references: [],
    },
    categories: [],
    checks: [],
  },
  "penetration-testing/mitre-checklist.json": {
    schemaVersion: ASSESSMENT_VERSION,
    framework: { name: "MITRE ATT&CK", domain: "enterprise-attack", version: "", sourceUrl: "https://attack.mitre.org/" },
    assessment: { targetIds: [], startedAt: "", completedAt: "", operator: "", reviewStatus: "not-started" },
    progress: { total: 0, notStarted: 0, inProgress: 0, observed: 0, notObserved: 0, notApplicable: 0, blocked: 0 },
    checkTemplate: {
      techniqueId: "", tactic: "", technique: "", subTechnique: "", objective: "", applicability: "unknown",
      targetIds: [], status: "not-started", procedure: [], observations: "", detectionOpportunities: [],
      mitigationReferences: [], findingIds: [], evidence: [], notes: "", references: [],
    },
    tactics: [],
    checks: [],
  },
};

const JSONL_TEMPLATES = {
  "traffic/raw.jsonl": { recordType: "pointer-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "direction", "protocol", "method", "url", "statusCode", "headersRedacted", "bodyFile", "durationMs", "source", "tags"] },
  "traffic/filtered.jsonl": { recordType: "pointer-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "filterReason", "findingIds", "method", "url", "statusCode", "parameterNames", "contentType", "evidenceFiles", "notes", "tags"] },
};

const REPORT_TEMPLATE = `# Security Assessment Report

## Document Control

## Executive Summary

## Engagement Authorization

## Scope and Exclusions

## Rules of Engagement

## Methodology

## Attack Surface Summary

## Findings Summary

## Detailed Findings

## Risk and Business Impact

## Remediation Roadmap

## Retest Results

## Limitations

## Evidence Index

## Appendix
`;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatTrafficTimestamp(date) {
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return [
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${pad(date.getFullYear() % 100)}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(date.getMilliseconds(), 3)}`,
  ].join("-");
}

function collectSchemaIssues(actual, expected, prefix = "") {
  if (!isPlainObject(actual) || !isPlainObject(expected)) return [prefix || "$"];
  const issues = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      issues.push(fieldPath);
      continue;
    }
    const actualValue = actual[key];
    if (isPlainObject(expectedValue)) {
      if (!isPlainObject(actualValue)) issues.push(fieldPath);
      else issues.push(...collectSchemaIssues(actualValue, expectedValue, fieldPath));
    } else if (Array.isArray(expectedValue) && !Array.isArray(actualValue)) {
      issues.push(fieldPath);
    } else if (expectedValue !== null && !Array.isArray(expectedValue) && typeof actualValue !== typeof expectedValue) {
      issues.push(fieldPath);
    }
  }
  return issues;
}

function mergeMissingFields(actual, expected, prefix = "") {
  const blocked = [];
  let changed = false;
  if (!isPlainObject(actual) || !isPlainObject(expected)) return { changed, blocked: [prefix || "$"] };

  for (const [key, expectedValue] of Object.entries(expected)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      actual[key] = clone(expectedValue);
      changed = true;
      continue;
    }
    const actualValue = actual[key];
    if (isPlainObject(expectedValue)) {
      if (!isPlainObject(actualValue)) blocked.push(fieldPath);
      else {
        const nested = mergeMissingFields(actualValue, expectedValue, fieldPath);
        changed ||= nested.changed;
        blocked.push(...nested.blocked);
      }
    } else if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) blocked.push(fieldPath);
    } else if (expectedValue !== null && typeof actualValue !== typeof expectedValue) {
      blocked.push(fieldPath);
    }
  }
  return { changed, blocked };
}

function createAssessmentWorkspace({ fs, path, now = () => new Date() }) {
  function resolveRoot(rawRoot) {
    const value = String(rawRoot || "").trim();
    if (!value) return { error: "Missing assessment folder", code: "MISSING_PATH" };
    if (!path.isAbsolute(value)) return { error: "Assessment folder must be an absolute path", code: "INVALID_PATH" };
    const root = path.resolve(value);
    if (root === path.parse(root).root) return { error: "A drive or filesystem root cannot be used as an assessment folder", code: "UNSAFE_PATH" };
    return { root };
  }

  function manifestTemplate(root) {
    return {
      schemaVersion: ASSESSMENT_VERSION,
      name: path.basename(root),
      assessmentType: "bug-bounty",
      status: "draft",
      createdAt: now().toISOString(),
      updatedAt: "",
      owner: "",
      scopeFiles: ["scope/in-scope.json", "scope/out-of-scope.json", "scope/configurations.json"],
      reportFile: "report/report.md",
      tags: [],
    };
  }

  function schemaTemplates(root) {
    return { ".pointer-assessment.json": manifestTemplate(root), ...JSON_TEMPLATES };
  }

  function expectedEntries(root) {
    return [
      ...REQUIRED_DIRECTORIES.map((relativePath) => ({ relativePath, type: "directory" })),
      ...Object.entries(schemaTemplates(root)).map(([relativePath, template]) => ({
        relativePath,
        type: "file",
        content: () => `${JSON.stringify(template, null, 2)}\n`,
      })),
      ...Object.entries(JSONL_TEMPLATES).map(([relativePath, template]) => ({
        relativePath,
        type: "file",
        content: () => `${JSON.stringify(template)}\n`,
      })),
      { relativePath: "report/report.md", type: "file", content: () => REPORT_TEMPLATE },
    ];
  }

  function entryStatus(root, entry) {
    const target = path.join(root, ...entry.relativePath.split("/"));
    if (!fs.existsSync(target)) return { ...entry, target, reason: "missing" };
    let stat;
    try { stat = fs.lstatSync(target); } catch { return { ...entry, target, reason: "unreadable" }; }
    const correctType = entry.type === "directory" ? stat.isDirectory() : stat.isFile();
    return correctType ? null : { ...entry, target, reason: "wrong_type" };
  }

  function schemaIssues(root) {
    const issues = [];
    for (const [relativePath, template] of Object.entries(schemaTemplates(root))) {
      const target = path.join(root, ...relativePath.split("/"));
      if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) continue;
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(target, "utf8")); } catch {
        issues.push({ path: relativePath, type: "file", reason: "invalid_json", fields: [] });
        continue;
      }
      const fields = collectSchemaIssues(parsed, template);
      if (relativePath === ".pointer-assessment.json" && Number(parsed.schemaVersion) < ASSESSMENT_VERSION && !fields.includes("schemaVersion")) {
        fields.unshift("schemaVersion");
      }
      if (fields.length) issues.push({ path: relativePath, type: "file", reason: "missing_fields", fields });
    }
    return issues;
  }

  function verify(rawRoot) {
    const resolved = resolveRoot(rawRoot);
    if (resolved.error) return resolved;
    const { root } = resolved;
    if (!fs.existsSync(root)) return { error: "Assessment folder does not exist", code: "NOT_FOUND", root };
    let rootStat;
    try { rootStat = fs.lstatSync(root); } catch (error) { return { error: error.message, code: "UNREADABLE", root }; }
    if (!rootStat.isDirectory()) return { error: "Assessment path is not a folder", code: "NOT_DIRECTORY", root };

    const entries = expectedEntries(root);
    const structural = entries.map((entry) => entryStatus(root, entry)).filter(Boolean).map((entry) => ({
      path: entry.relativePath,
      type: entry.type,
      reason: entry.reason,
      fields: [],
    }));
    const missing = [...structural, ...schemaIssues(root)];
    const fileMissingCount = structural.filter((item) => item.reason === "missing").length;
    const schemaIssueCount = missing.filter((item) => ["missing_fields", "invalid_json"].includes(item.reason)).length;
    return {
      ok: true,
      root,
      name: path.basename(root),
      schemaVersion: ASSESSMENT_VERSION,
      valid: missing.length === 0,
      expectedCount: entries.length,
      missingCount: missing.length,
      fileMissingCount,
      schemaIssueCount,
      missing,
    };
  }

  function repair(rawRoot, { createRoot = false } = {}) {
    const resolved = resolveRoot(rawRoot);
    if (resolved.error) return resolved;
    const { root } = resolved;
    try {
      if (!fs.existsSync(root)) {
        if (!createRoot) return { error: "Assessment folder does not exist", code: "NOT_FOUND", root };
        fs.mkdirSync(root, { recursive: true });
      }
      if (!fs.lstatSync(root).isDirectory()) return { error: "Assessment path is not a folder", code: "NOT_DIRECTORY", root };

      const created = [];
      const updated = [];
      const blocked = [];
      const entries = expectedEntries(root);
      for (const entry of entries.filter((item) => item.type === "directory")) {
        const status = entryStatus(root, entry);
        if (!status) continue;
        if (status.reason !== "missing") {
          blocked.push({ path: entry.relativePath, reason: status.reason });
          continue;
        }
        fs.mkdirSync(status.target, { recursive: true });
        created.push(entry.relativePath);
      }

      for (const entry of entries.filter((item) => item.type === "file")) {
        const status = entryStatus(root, entry);
        if (!status) continue;
        if (status.reason !== "missing") {
          blocked.push({ path: entry.relativePath, reason: status.reason });
          continue;
        }
        fs.mkdirSync(path.dirname(status.target), { recursive: true });
        fs.writeFileSync(status.target, entry.content(), { encoding: "utf8", flag: "wx" });
        created.push(entry.relativePath);
      }

      for (const [relativePath, template] of Object.entries(schemaTemplates(root))) {
        const target = path.join(root, ...relativePath.split("/"));
        if (!fs.existsSync(target) || !fs.lstatSync(target).isFile()) continue;
        let parsed;
        try { parsed = JSON.parse(fs.readFileSync(target, "utf8")); } catch {
          blocked.push({ path: relativePath, reason: "invalid_json" });
          continue;
        }
        const merged = mergeMissingFields(parsed, template);
        if (relativePath === ".pointer-assessment.json" && Number(parsed.schemaVersion) < ASSESSMENT_VERSION) {
          parsed.schemaVersion = ASSESSMENT_VERSION;
          merged.changed = true;
        }
        if (merged.blocked.length) blocked.push({ path: relativePath, reason: "schema_type_mismatch", fields: merged.blocked });
        if (merged.changed) {
          fs.writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
          updated.push(relativePath);
        }
      }

      const verification = verify(root);
      return {
        ...verification,
        repaired: true,
        created,
        updated,
        blocked,
      };
    } catch (error) {
      return { error: error.message, code: "REPAIR_FAILED", root };
    }
  }

  function appendTrafficRecord(rawRoot, record, { filtered = false } = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    if (!verification.valid) return { error: "Assessment structure is incomplete or outdated", code: "ASSESSMENT_INCOMPLETE", verification };
    const date = now();
    const timestamp = formatTrafficTimestamp(date);
    const safeRecord = {
      recordType: "http-exchange",
      schemaVersion: ASSESSMENT_VERSION,
      timestamp,
      isoTimestamp: date.toISOString(),
      ...record,
    };
    const serialized = JSON.stringify(safeRecord);
    if (Buffer.byteLength(serialized, "utf8") > 1_500_000) {
      return { error: "Traffic record exceeds the 1.5 MB log limit", code: "RECORD_TOO_LARGE" };
    }
    const relativePath = filtered ? "traffic/filtered.jsonl" : "traffic/raw.jsonl";
    const target = path.join(verification.root, ...relativePath.split("/"));
    try {
      fs.appendFileSync(target, `${serialized}\n`, "utf8");
      return { ok: true, path: relativePath, timestamp, record: safeRecord };
    } catch (error) {
      return { error: error.message, code: "TRAFFIC_LOG_FAILED" };
    }
  }

  function readTrafficHistory(rawRoot, { limit = 500, maxBytes = 20 * 1024 * 1024 } = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const target = path.join(verification.root, "traffic", "raw.jsonl");
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
    const boundedBytes = Math.max(1024 * 1024, Math.min(Number(maxBytes) || 20 * 1024 * 1024, 50 * 1024 * 1024));

    try {
      const size = fs.statSync(target).size;
      if (!size) return { ok: true, path: "traffic/raw.jsonl", records: [], truncated: false, invalidCount: 0 };
      const start = Math.max(0, size - boundedBytes);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      const descriptor = fs.openSync(target, "r");
      try {
        fs.readSync(descriptor, buffer, 0, length, start);
      } finally {
        fs.closeSync(descriptor);
      }

      let text = buffer.toString("utf8");
      if (start > 0) {
        const firstCompleteLine = text.indexOf("\n");
        text = firstCompleteLine >= 0 ? text.slice(firstCompleteLine + 1) : "";
      }

      let invalidCount = 0;
      const records = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record?.recordType === "http-exchange") records.push(record);
        } catch {
          invalidCount += 1;
        }
      }

      return {
        ok: true,
        path: "traffic/raw.jsonl",
        records: records.slice(-boundedLimit).reverse(),
        truncated: start > 0 || records.length > boundedLimit,
        invalidCount,
      };
    } catch (error) {
      return { error: `Could not read Traffic/Raw: ${error.message}`, code: "TRAFFIC_HISTORY_READ_FAILED" };
    }
  }

  function readSettings(rawRoot) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const target = path.join(verification.root, "settings.config");
    try {
      return { ok: true, root: verification.root, settings: JSON.parse(fs.readFileSync(target, "utf8")) };
    } catch (error) {
      return { error: `Could not read settings.config: ${error.message}`, code: "SETTINGS_READ_FAILED" };
    }
  }

  function writeSettings(rawRoot, nextSettings) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    if (!nextSettings || typeof nextSettings !== "object" || Array.isArray(nextSettings)) {
      return { error: "settings.config must contain a JSON object", code: "SETTINGS_INVALID" };
    }
    const target = path.join(verification.root, "settings.config");
    try {
      fs.writeFileSync(target, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
      return { ok: true, root: verification.root, settings: nextSettings };
    } catch (error) {
      return { error: `Could not write settings.config: ${error.message}`, code: "SETTINGS_WRITE_FAILED" };
    }
  }

  return { verify, repair, appendTrafficRecord, readTrafficHistory, readSettings, writeSettings, requiredDirectories: [...REQUIRED_DIRECTORIES] };
}

module.exports = {
  ASSESSMENT_ITEM_FILES,
  ASSESSMENT_VERSION,
  JSON_TEMPLATES,
  REQUIRED_DIRECTORIES,
  createAssessmentWorkspace,
  formatTrafficTimestamp,
};
