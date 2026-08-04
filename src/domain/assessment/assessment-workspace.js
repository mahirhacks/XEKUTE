const crypto = require("crypto");
const FindingGate = require("./finding-gate");

const ASSESSMENT_VERSION = 4;
const SECRET_NAME_PATTERN = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|password|passwd|secret|token|access_token|refresh_token|api[_-]?key|client_secret)$/i;

// Prompt defaults are pure data. They are injected from the composition root
// so the domain layer never statically imports application orchestration. The
// lazy fallback keeps the existing template behavior for callers that have not
// yet wired an explicit promptDefaults provider (e.g. existing tests).
function defaultPromptDefaults() {
  try {
    // Lazy require: only loads the application compiler when a caller needs the
    // real prompt defaults. Keeps the static import graph domain->application
    // absent while preserving the exact prior template output.
    return require("../../application/prompt/prompt-compiler").defaults();
  } catch {
    return { version: 1, modules: {}, overlays: {} };
  }
}

// Module-scope resolver used by the static JSON_TEMPLATES. The factory may
// override this with an injected provider for runtime settings.
let resolvePromptDefaults = defaultPromptDefaults;

function redactStructuredSecrets(value) {
  if (Array.isArray(value)) return value.map(redactStructuredSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_NAME_PATTERN.test(key) ? "[REDACTED]" : redactStructuredSecrets(child),
  ]));
}

function redactBodySecrets(body) {
  const text = String(body || "");
  if (!text) return text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return JSON.stringify(redactStructuredSecrets(parsed));
  } catch { /* fall through to form and text redaction */ }

  if (text.includes("=")) {
    try {
      const params = new URLSearchParams(text);
      let matched = false;
      for (const key of [...params.keys()]) {
        if (!SECRET_NAME_PATTERN.test(key)) continue;
        matched = true;
        params.set(key, "[REDACTED]");
      }
      if (matched) return params.toString();
    } catch { /* retain bounded regex fallback */ }
  }
  return text.replace(/((?:password|passwd|secret|token|access_token|refresh_token|api[_-]?key|client_secret)\s*[:=]\s*)[^&\s,;}]+/gi, "$1[REDACTED]");
}

function redactHttpMessage(rawMessage, marker = () => "[REDACTED]") {
  const message = String(rawMessage || "");
  const separator = message.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
  const splitAt = message.indexOf(separator);
  const head = splitAt >= 0 ? message.slice(0, splitAt) : message;
  const body = splitAt >= 0 ? message.slice(splitAt + separator.length) : "";
  const redactedHead = head.replace(/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token):(.*)$/gim, (_line, name, value) => {
    const clean = String(value || "").trim();
    return clean ? `${name}: ${marker(clean)}` : `${name}:`;
  });
  return splitAt >= 0 ? `${redactedHead}${separator}${redactBodySecrets(body)}` : redactedHead;
}

function redactUrlSecrets(rawUrl, marker = () => "[REDACTED]") {
  try {
    const url = new URL(String(rawUrl || ""));
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_NAME_PATTERN.test(key)) url.searchParams.set(key, marker(url.searchParams.get(key) || ""));
    }
    return url.toString();
  } catch {
    return String(rawUrl || "");
  }
}

function redactTrafficRecord(record = {}, marker = () => "[REDACTED]") {
  const next = { ...record, redacted: true };
  if (typeof next.request === "string") next.request = redactHttpMessage(next.request, marker);
  if (typeof next.response === "string") next.response = redactHttpMessage(next.response, marker);
  if (next.url) next.url = redactUrlSecrets(next.url, marker);
  for (const field of ["headers", "requestHeaders", "responseHeaders"]) {
    if (!next[field] || typeof next[field] !== "object") continue;
    next[field] = Object.fromEntries(Object.entries(next[field]).map(([name, value]) => [
      name,
      SECRET_NAME_PATTERN.test(name) ? marker(String(value || "")) : value,
    ]));
  }
  return next;
}

const ASSESSMENT_ITEM_FILES = {
  engagement: "scope/engagement.json",
  "in-scope": "scope/in-scope.json",
  "out-of-scope": "scope/out-of-scope.json",
  configurations: "scope/configurations.json",
  "active-recon": "recon/active-recon.json",
  "passive-recon": "recon/passive-recon.json",
  endpoints: "enumeration/endpoints.json",
  pages: "enumeration/pages.json",
  subdomains: "enumeration/subdomains.json",
  assets: "enumeration/assets.json",
  "raw-traffic": "traffic/raw.jsonl",
  "filtered-traffic": "traffic/filtered.jsonl",
  evidence: "evidence/index.jsonl",
  services: "vulnerability-scans/services.json",
  informational: "vulnerability-scans/info.json",
  low: "vulnerability-scans/easy.json",
  medium: "vulnerability-scans/medium.json",
  high: "vulnerability-scans/high.json",
  critical: "vulnerability-scans/critical.json",
  findings: "findings/findings.json",
  "wstg-checklists": "penetration-testing/wstg-checklist.json",
  "mitre-checklists": "penetration-testing/mitre-checklist.json",
  coverage: "penetration-testing/coverage.json",
  "asvs-checklists": "penetration-testing/asvs-checklist.json",
  runs: "runs/runs.json",
  report: "report/report.md",
  "pen-context": "pen_context.md",
  "agent-actions": "logs/agent-actions.jsonl",
  "agent-hypotheses": "logs/agent-hypotheses.jsonl",
  "agent-runs": "logs/agent-runs.jsonl",
  "agent-approvals": "logs/agent-approvals.jsonl",
  "tool-output": "logs/tool-output.jsonl",
  settings: "settings.config",
};

const REQUIRED_DIRECTORIES = [
  "scope",
  "recon",
  "enumeration",
  "traffic",
  "evidence",
  "vulnerability-scans",
  "findings",
  "penetration-testing",
  "runs",
  "logs",
  "report",
  "context/sources",
  "custom",
  "custom_scripts",
  "tools",
  "Map",
  "WebClone",
];

const RESERVED_ASSESSMENT_NAMES = new Set([
  ".pointer-assessment.json",
  "pen_context.md",
  "settings.config",
  ...REQUIRED_DIRECTORIES.flatMap((relativePath) => relativePath.split("/")),
  ...Object.values(ASSESSMENT_ITEM_FILES).flatMap((relativePath) => relativePath.split("/")),
].map((name) => name.toLowerCase()));

function validateCustomEntryPath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/");
  if (parts[0]?.toLowerCase() !== "custom" || parts.length < 2) return { error: "Custom entries must stay inside Custom", code: "INVALID_CUSTOM_PATH" };
  for (const name of parts.slice(1)) {
    const lower = name.toLowerCase();
    if (!name || name === "." || name === "..") return { error: "File and folder names cannot be empty, '.' or '..'", code: "INVALID_NAME" };
    if (RESERVED_ASSESSMENT_NAMES.has(lower)) return { error: `“${name}” is reserved by the assessment workspace. Choose a different name.`, code: "RESERVED_NAME", name };
    if (/[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) return { error: `“${name}” is not a valid cross-platform file or folder name.`, code: "INVALID_NAME", name };
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) return { error: `“${name}” is reserved by Windows. Choose a different name.`, code: "RESERVED_NAME", name };
  }
  return { ok: true, normalized };
}

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

const ENGAGEMENT_TEMPLATE = {
  schemaVersion: ASSESSMENT_VERSION,
  status: "draft",
  engagement: {
    name: "",
    programName: "",
    clientOrOwner: "",
    platform: "",
    engagementType: "bug-bounty",
    environment: "production",
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
  contacts: {
    primary: "",
    emergency: "",
    escalationWindow: "",
    notificationPreferences: [],
  },
  rulesOfEngagement: {
    testingWindows: [],
    allowedTechniques: [],
    restrictedTechniques: [],
    prohibitedActions: ["denial-of-service", "social-engineering", "destructive-data-modification"],
    sourceIpAddresses: [],
    maximumConcurrency: 1,
    requestsPerSecond: 2,
    stopConditions: ["unexpected service impact", "out-of-scope redirect", "credential exposure"],
    emergencyStopContact: "",
  },
  scopeReview: {
    reviewed: false,
    reviewedBy: "",
    reviewedAt: "",
    exclusionsConfirmed: false,
    thirdPartyRiskReviewed: false,
  },
  dataHandling: {
    collectMinimumNecessary: true,
    redactSecrets: true,
    encryptAtRest: true,
    retentionDays: 30,
    deletionProcedure: "",
  },
  notes: "",
  reviewHistory: [],
};

const ASSET_TEMPLATE = {
  id: "",
  assetType: "host",
  value: "",
  rootDomain: "",
  owner: "",
  environment: "production",
  source: "",
  firstSeen: "",
  lastSeen: "",
  inScope: null,
  scopeReason: "",
  status: "unknown",
  services: [],
  relationships: [],
  confidence: "unconfirmed",
  evidence: [],
  tags: [],
  notes: "",
};

const RUN_TEMPLATE = {
  id: "",
  type: "assessment",
  status: "planned",
  profile: "assist:planner",
  operator: "",
  createdAt: "",
  startedAt: "",
  completedAt: "",
  scopeSnapshotSha256: "",
  configurationSnapshotSha256: "",
  toolVersions: {},
  approvedBy: "",
  approvalReference: "",
  stopReason: "",
  actions: [],
  hypotheses: [],
  findings: [],
  evidenceIds: [],
  coverage: { tested: 0, passed: 0, failed: 0, blocked: 0, notApplicable: 0 },
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
      asvsIds: [],
      capecIds: [],
      mitreTechniqueIds: [],
    },
    cvss: {
      version: "4.0",
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
    verification: {
      verdict: "not-run",
      reproductionSuccessful: false,
      verifierModel: "",
      verifiedAt: "",
      supportedClaims: [],
      unsupportedClaims: [],
      missingEvidence: [],
      falsePositiveChecks: [],
      contradictoryEvidence: false,
      rationale: "",
    },
    claims: [],
    limitations: [],
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

const checklistCheck = (id, category, title, reference, extra = {}) => ({
  id, category, title, objective: "", targetIds: [], status: "not-tested", tester: "",
  startedAt: "", completedAt: "", procedure: [], result: "", findingIds: [], evidence: [], notes: "",
  references: reference ? [reference] : [], ...extra,
});

const WSTG_BASE = "https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing";
const WSTG_CHECKS = [
  ["WSTG-INFO-01", "Information Gathering", "Search-engine reconnaissance"], ["WSTG-INFO-02", "Information Gathering", "Fingerprint web server"], ["WSTG-INFO-03", "Information Gathering", "Review webserver metafiles"], ["WSTG-INFO-04", "Information Gathering", "Identify attack surface"], ["WSTG-INFO-05", "Information Gathering", "Review content for information leakage"], ["WSTG-INFO-06", "Information Gathering", "Identify application entry points"], ["WSTG-INFO-07", "Information Gathering", "Map execution paths"], ["WSTG-INFO-08", "Information Gathering", "Fingerprint framework"], ["WSTG-INFO-09", "Information Gathering", "Fingerprint application"], ["WSTG-INFO-10", "Information Gathering", "Map application architecture"],
  ["WSTG-CONF-01", "Configuration & Deployment", "Test network and infrastructure configuration"], ["WSTG-CONF-02", "Configuration & Deployment", "Test application platform configuration"], ["WSTG-CONF-03", "Configuration & Deployment", "Test file-extension handling"], ["WSTG-CONF-04", "Configuration & Deployment", "Review backup and unreferenced files"], ["WSTG-CONF-05", "Configuration & Deployment", "Enumerate administration interfaces"], ["WSTG-CONF-06", "Configuration & Deployment", "Test HTTP methods"], ["WSTG-CONF-07", "Configuration & Deployment", "Test HSTS"], ["WSTG-CONF-08", "Configuration & Deployment", "Test RIA cross-domain policy"], ["WSTG-CONF-09", "Configuration & Deployment", "Test file permissions"], ["WSTG-CONF-10", "Configuration & Deployment", "Test subdomain takeover"], ["WSTG-CONF-11", "Configuration & Deployment", "Test cloud storage"], ["WSTG-CONF-12", "Configuration & Deployment", "Test Content Security Policy"], ["WSTG-CONF-13", "Configuration & Deployment", "Test path confusion"], ["WSTG-CONF-14", "Configuration & Deployment", "Test HTTP security headers"],
  ["WSTG-IDNT-01", "Identity Management", "Test role definitions"], ["WSTG-IDNT-02", "Identity Management", "Test user registration"], ["WSTG-IDNT-03", "Identity Management", "Test account provisioning"], ["WSTG-IDNT-04", "Identity Management", "Test account enumeration"], ["WSTG-IDNT-05", "Identity Management", "Test username policy"],
  ["WSTG-ATHN-01", "Authentication", "Test credentials over encrypted channels"], ["WSTG-ATHN-02", "Authentication", "Test default credentials"], ["WSTG-ATHN-03", "Authentication", "Test account lockout"], ["WSTG-ATHN-04", "Authentication", "Test authentication bypass"], ["WSTG-ATHN-05", "Authentication", "Test remember-password behavior"], ["WSTG-ATHN-06", "Authentication", "Test browser cache weaknesses"], ["WSTG-ATHN-07", "Authentication", "Test weak authentication methods"], ["WSTG-ATHN-08", "Authentication", "Test weak security questions"], ["WSTG-ATHN-09", "Authentication", "Test password reset and change"], ["WSTG-ATHN-10", "Authentication", "Test alternate-channel authentication"], ["WSTG-ATHN-11", "Authentication", "Test multi-factor authentication"],
  ["WSTG-ATHZ-01", "Authorization", "Test path traversal and file inclusion"], ["WSTG-ATHZ-02", "Authorization", "Test authorization bypass"], ["WSTG-ATHZ-03", "Authorization", "Test privilege escalation"], ["WSTG-ATHZ-04", "Authorization", "Test insecure direct object references"], ["WSTG-ATHZ-05", "Authorization", "Test OAuth weaknesses"],
  ["WSTG-SESS-01", "Session Management", "Analyze session management"], ["WSTG-SESS-02", "Session Management", "Test cookie attributes"], ["WSTG-SESS-03", "Session Management", "Test session fixation"], ["WSTG-SESS-04", "Session Management", "Test exposed session variables"], ["WSTG-SESS-05", "Session Management", "Test CSRF"], ["WSTG-SESS-06", "Session Management", "Test logout"], ["WSTG-SESS-07", "Session Management", "Test session timeout"], ["WSTG-SESS-08", "Session Management", "Test session puzzling"], ["WSTG-SESS-09", "Session Management", "Test session hijacking"], ["WSTG-SESS-10", "Session Management", "Test JSON Web Tokens"], ["WSTG-SESS-11", "Session Management", "Test concurrent sessions"],
  ["WSTG-INPV-01", "Input Validation", "Test reflected cross-site scripting"], ["WSTG-INPV-02", "Input Validation", "Test stored cross-site scripting"], ["WSTG-INPV-03", "Input Validation", "Test HTTP verb tampering"], ["WSTG-INPV-04", "Input Validation", "Test HTTP parameter pollution"], ["WSTG-INPV-05", "Input Validation", "Test SQL injection"], ["WSTG-INPV-06", "Input Validation", "Test LDAP injection"], ["WSTG-INPV-07", "Input Validation", "Test XML injection"], ["WSTG-INPV-08", "Input Validation", "Test SSI injection"], ["WSTG-INPV-09", "Input Validation", "Test XPath injection"], ["WSTG-INPV-10", "Input Validation", "Test IMAP/SMTP injection"], ["WSTG-INPV-11", "Input Validation", "Test code injection"], ["WSTG-INPV-12", "Input Validation", "Test command injection"], ["WSTG-INPV-13", "Input Validation", "Test format-string injection"], ["WSTG-INPV-14", "Input Validation", "Test incubated vulnerabilities"], ["WSTG-INPV-15", "Input Validation", "Test HTTP response splitting"], ["WSTG-INPV-16", "Input Validation", "Test HTTP request smuggling"], ["WSTG-INPV-17", "Input Validation", "Test Host header injection"], ["WSTG-INPV-18", "Input Validation", "Test server-side template injection"], ["WSTG-INPV-19", "Input Validation", "Test server-side request forgery"], ["WSTG-INPV-20", "Input Validation", "Test mass assignment"], ["WSTG-INPV-21", "Input Validation", "Test CSV injection"], ["WSTG-INPV-22", "Input Validation", "Test prototype pollution"],
  ["WSTG-ERRH-01", "Error Handling", "Test improper error handling"], ["WSTG-ERRH-02", "Error Handling", "Test stack traces"],
  ["WSTG-CRYP-01", "Cryptography", "Test weak TLS"], ["WSTG-CRYP-02", "Cryptography", "Test padding oracle weaknesses"], ["WSTG-CRYP-03", "Cryptography", "Test sensitive information over unencrypted channels"], ["WSTG-CRYP-04", "Cryptography", "Test weak encryption"],
  ["WSTG-BUSL-01", "Business Logic", "Test business-logic data validation"], ["WSTG-BUSL-02", "Business Logic", "Test forged requests"], ["WSTG-BUSL-03", "Business Logic", "Test integrity checks"], ["WSTG-BUSL-04", "Business Logic", "Test process timing"], ["WSTG-BUSL-05", "Business Logic", "Test function-use limits"], ["WSTG-BUSL-06", "Business Logic", "Test workflow circumvention"], ["WSTG-BUSL-07", "Business Logic", "Test defenses against misuse"], ["WSTG-BUSL-08", "Business Logic", "Test unexpected file types"], ["WSTG-BUSL-09", "Business Logic", "Test malicious file upload"], ["WSTG-BUSL-10", "Business Logic", "Test payment functionality"],
  ["WSTG-CLNT-01", "Client-side", "Test DOM-based XSS"], ["WSTG-CLNT-02", "Client-side", "Test JavaScript execution"], ["WSTG-CLNT-03", "Client-side", "Test HTML injection"], ["WSTG-CLNT-04", "Client-side", "Test client-side redirects"], ["WSTG-CLNT-05", "Client-side", "Test CSS injection"], ["WSTG-CLNT-06", "Client-side", "Test client-side resource manipulation"], ["WSTG-CLNT-07", "Client-side", "Test CORS"], ["WSTG-CLNT-08", "Client-side", "Test cross-site flashing"], ["WSTG-CLNT-09", "Client-side", "Test clickjacking"], ["WSTG-CLNT-10", "Client-side", "Test WebSockets"], ["WSTG-CLNT-11", "Client-side", "Test web messaging"], ["WSTG-CLNT-12", "Client-side", "Test browser storage"], ["WSTG-CLNT-13", "Client-side", "Test cross-site script inclusion"], ["WSTG-CLNT-14", "Client-side", "Test reverse tabnabbing"], ["WSTG-CLNT-15", "Client-side", "Test client-side template injection"],
  ["WSTG-APIT-01", "API Testing", "API reconnaissance"], ["WSTG-APIT-02", "API Testing", "Test broken object-level authorization"], ["WSTG-APIT-03", "API Testing", "Test excessive data exposure"], ["WSTG-APIT-04", "API Testing", "Test broken function-level authorization"], ["WSTG-APIT-99", "API Testing", "Test GraphQL"],
].map(([id, category, title]) => checklistCheck(id, category, title, `${WSTG_BASE}/`));

const ASVS_CHECKS = [
  ["V1", "Architecture, Design and Threat Modeling", "Verify trust boundaries, threat model, and security requirements"],
  ["V2", "Authentication", "Verify authentication, password, MFA, and credential recovery controls"],
  ["V3", "Session Management", "Verify session binding, timeout, invalidation, and cookie protections"],
  ["V4", "Access Control", "Verify server-side authorization and object/function-level access checks"],
  ["V5", "Validation, Sanitization and Encoding", "Verify input validation, output encoding, and canonicalization"],
  ["V6", "Stored Cryptography", "Verify cryptographic algorithms, key management, and secret storage"],
  ["V7", "Error and Logging", "Verify safe errors, security events, audit trails, and alerting"],
  ["V8", "Data Protection", "Verify sensitive data minimization, transport, privacy, and retention"],
  ["V9", "Communications", "Verify TLS, certificate validation, and secure service-to-service communication"],
  ["V10", "Malicious Code", "Verify upload, deserialization, template, and code-execution defenses"],
  ["V11", "Business Logic", "Verify workflow integrity, transaction limits, and abuse resistance"],
  ["V12", "Files and Resources", "Verify file handling, path traversal, resource limits, and SSRF defenses"],
  ["V13", "API and Web Service", "Verify API authentication, authorization, schemas, and rate limits"],
  ["V14", "Configuration", "Verify secure defaults, headers, dependencies, and deployment configuration"],
].map(([id, category, title]) => checklistCheck(id, category, title, "https://github.com/OWASP/ASVS"));

const OWASP_TOP_10_2025 = [
  ["A01:2025", "Broken Access Control"], ["A02:2025", "Security Misconfiguration"], ["A03:2025", "Software Supply Chain Failures"], ["A04:2025", "Cryptographic Failures"], ["A05:2025", "Injection"], ["A06:2025", "Insecure Design"], ["A07:2025", "Authentication Failures"], ["A08:2025", "Software or Data Integrity Failures"], ["A09:2025", "Security Logging and Alerting Failures"], ["A10:2025", "Mishandling of Exceptional Conditions"],
].map(([id, title]) => checklistCheck(id, "OWASP Top 10:2025", title, "https://owasp.org/Top10/"));

const MITRE_TACTICS = ["Reconnaissance", "Resource Development", "Initial Access", "Execution", "Persistence", "Privilege Escalation", "Stealth", "Defense Impairment", "Credential Access", "Discovery", "Lateral Movement", "Collection", "Command and Control", "Exfiltration", "Impact"];
const MITRE_CHECKS = [
  ["T1595", "Reconnaissance", "Active Scanning"], ["T1592", "Reconnaissance", "Gather Victim Host Information"], ["T1589", "Reconnaissance", "Gather Victim Identity Information"], ["T1190", "Initial Access", "Exploit Public-Facing Application"], ["T1078", "Initial Access", "Valid Accounts"], ["T1133", "Initial Access", "External Remote Services"], ["T1059", "Execution", "Command and Scripting Interpreter"], ["T1203", "Execution", "Exploitation for Client Execution"], ["T1505.003", "Persistence", "Server Software Component: Web Shell"], ["T1098", "Persistence", "Account Manipulation"], ["T1068", "Privilege Escalation", "Exploitation for Privilege Escalation"], ["T1562", "Defense Impairment", "Impair Defenses"], ["T1552", "Credential Access", "Unsecured Credentials"], ["T1539", "Credential Access", "Steal Web Session Cookie"], ["T1606", "Credential Access", "Forge Web Credentials"], ["T1087", "Discovery", "Account Discovery"], ["T1046", "Discovery", "Network Service Discovery"], ["T1083", "Discovery", "File and Directory Discovery"], ["T1210", "Lateral Movement", "Exploitation of Remote Services"], ["T1530", "Collection", "Data from Cloud Storage"], ["T1119", "Collection", "Automated Collection"], ["T1071.001", "Command and Control", "Application Layer Protocol: Web Protocols"], ["T1105", "Command and Control", "Ingress Tool Transfer"], ["T1567", "Exfiltration", "Exfiltration Over Web Service"], ["T1499", "Impact", "Endpoint Denial of Service"], ["T1485", "Impact", "Data Destruction"],
].map(([techniqueId, tactic, technique]) => ({
  techniqueId, tactic, technique, subTechnique: techniqueId.includes(".") ? technique : "", objective: "Assess whether the application or its supporting environment exposes this adversary behavior.", applicability: "unknown", targetIds: [], status: "not-started", procedure: [], observations: "", detectionOpportunities: [], mitigationReferences: [], findingIds: [], evidence: [], notes: "", references: [`https://attack.mitre.org/techniques/${techniqueId.replace(".", "/")}/`],
}));

const JSON_TEMPLATES = {
  "scope/engagement.json": ENGAGEMENT_TEMPLATE,
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
      redactAuthorizationHeaders: true,
      maximumRecordBytes: 1500000,
      timestampFormat: "DD/MM/YY-HH:mm:ss:SSS",
    },
    aiAnalysis: {
      includeRequest: true,
      includeResponse: true,
      maximumCharactersPerMessage: 14000,
      defaultChatMode: "ask",
    },
    aiModels: {
      verifierModel: "",
      requireQualifiedModelForTestAgent: true,
      allowUnqualifiedTestAgentDeveloperOverride: false,
      qualification: {},
      temperatures: { planner: 0.1, agent: 0.1, ask: 0.2, verifier: 0, reporter: 0 },
    },
    aiPrompts: resolvePromptDefaults(),
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
    authority: {
      superMode: "ask",
      permissions: {
        workspaceRead: true,
        workspaceWrite: true,
        workspaceDelete: true,
        commandExecution: true,
        backgroundProcesses: true,
        terminalAccess: true,
        webResearch: true,
        outboundHttp: true,
        proxyInterception: true,
        trafficCapture: true,
        mapBuild: true,
        evidenceManagement: true,
        passiveRecon: true,
        activeRecon: false,
        automatedScanning: false,
        exploitValidation: false,
        customScripts: false,
        sensitiveDataAccess: false,
      },
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
      userAgent: "XEKUTE Security Assessment",
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
  "enumeration/assets.json": {
    schemaVersion: ASSESSMENT_VERSION,
    assetTemplate: ASSET_TEMPLATE,
    assets: [],
    relationships: [],
    statistics: { total: 0, inScope: 0, outOfScope: 0, unknownScope: 0, live: 0, stale: 0, untested: 0 },
    lastReconciledAt: "",
    reconciliationNotes: [],
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
  "vulnerability-scans/info.json": findingBucket("informational"),
  "vulnerability-scans/easy.json": findingBucket("low"),
  "vulnerability-scans/medium.json": findingBucket("medium"),
  "vulnerability-scans/high.json": findingBucket("high"),
  "vulnerability-scans/critical.json": findingBucket("critical"),
  "findings/findings.json": {
    schemaVersion: ASSESSMENT_VERSION,
    lifecycle: ["draft", "suspected", "confirmed", "reported", "accepted-risk", "remediated", "retest-required", "closed", "false-positive"],
    findingTemplate: findingTemplate("unassigned"),
    findings: [],
    deduplication: { keys: ["asset.host", "asset.endpoint", "classification.vulnerabilityType", "title"], duplicateOfRequired: true },
    statistics: { total: 0, draft: 0, suspected: 0, confirmed: 0, reported: 0, remediated: 0, retestRequired: 0, falsePositive: 0 },
    lastReconciledAt: "",
  },
  "penetration-testing/wstg-checklist.json": {
    schemaVersion: ASSESSMENT_VERSION,
    framework: { name: "OWASP Web Security Testing Guide", shortName: "WSTG", version: "5.0-development", stableVersion: "4.2", sourceUrl: "https://owasp.org/www-project-web-security-testing-guide/latest/", top10Version: "2025", top10SourceUrl: "https://owasp.org/Top10/", checkedAt: "2026-07-11" },
    assessment: { targetIds: [], startedAt: "", completedAt: "", operator: "", reviewStatus: "not-tested" },
    progress: { total: WSTG_CHECKS.length + OWASP_TOP_10_2025.length, notTested: WSTG_CHECKS.length + OWASP_TOP_10_2025.length, inProgress: 0, passed: 0, failed: 0, notApplicable: 0, blocked: 0 },
    checkTemplate: {
      id: "", category: "", title: "", objective: "", targetIds: [], status: "not-tested", tester: "",
      startedAt: "", completedAt: "", procedure: [], result: "", findingIds: [], evidence: [], notes: "", references: [],
    },
    categories: [...new Set(WSTG_CHECKS.map((check) => check.category)), "OWASP Top 10:2025"],
    checks: [...WSTG_CHECKS, ...OWASP_TOP_10_2025],
  },
  "penetration-testing/asvs-checklist.json": {
    schemaVersion: ASSESSMENT_VERSION,
    framework: { name: "OWASP Application Security Verification Standard", shortName: "ASVS", version: "5.0.0", sourceUrl: "https://github.com/OWASP/ASVS", checkedAt: "2026-07-12" },
    assessment: { targetIds: [], startedAt: "", completedAt: "", operator: "", reviewStatus: "not-tested" },
    progress: { total: ASVS_CHECKS.length, notTested: ASVS_CHECKS.length, inProgress: 0, passed: 0, failed: 0, notApplicable: 0, blocked: 0 },
    checkTemplate: {
      id: "", category: "", title: "", objective: "", targetIds: [], status: "not-tested", tester: "",
      startedAt: "", completedAt: "", procedure: [], result: "", findingIds: [], evidence: [], notes: "", references: [],
    },
    categories: [...new Set(ASVS_CHECKS.map((check) => check.category))],
    checks: ASVS_CHECKS,
  },
  "penetration-testing/mitre-checklist.json": {
    schemaVersion: ASSESSMENT_VERSION,
    framework: { name: "MITRE ATT&CK", domain: "enterprise-attack", version: "19.1", sourceUrl: "https://attack.mitre.org/", dataSourceUrl: "https://github.com/mitre-attack/attack-stix-data", checkedAt: "2026-07-11" },
    assessment: { targetIds: [], startedAt: "", completedAt: "", operator: "", reviewStatus: "not-started" },
    progress: { total: MITRE_CHECKS.length, notStarted: MITRE_CHECKS.length, inProgress: 0, observed: 0, notObserved: 0, notApplicable: 0, blocked: 0 },
    checkTemplate: {
      techniqueId: "", tactic: "", technique: "", subTechnique: "", objective: "", applicability: "unknown",
      targetIds: [], status: "not-started", procedure: [], observations: "", detectionOpportunities: [],
      mitigationReferences: [], findingIds: [], evidence: [], notes: "", references: [],
    },
    tactics: MITRE_TACTICS,
    checks: MITRE_CHECKS,
  },
  "penetration-testing/coverage.json": {
    schemaVersion: ASSESSMENT_VERSION,
    frameworks: [
      { id: "wstg", name: "OWASP WSTG 4.2", version: "4.2", source: "penetration-testing/wstg-checklist.json", status: "not-tested" },
      { id: "asvs", name: "OWASP ASVS 5.0.0", version: "5.0.0", source: "penetration-testing/asvs-checklist.json", status: "not-tested" },
      { id: "owasp-top-10", name: "OWASP Top 10", version: "2025", source: "penetration-testing/wstg-checklist.json", status: "not-tested" },
      { id: "mitre-attack", name: "MITRE ATT&CK (supplemental threat context)", version: "19.1", source: "penetration-testing/mitre-checklist.json", status: "not-tested", supplemental: true },
    ],
    matrixTemplate: { id: "", framework: "", frameworkVersion: "", control: "", title: "", status: "not-tested", procedure: [], reason: "", targetIds: [], findingIds: [], evidenceIds: [], lastTestedAt: "", tester: "", notes: "" },
    matrix: [],
    summary: { total: 0, tested: 0, passed: 0, failed: 0, blocked: 0, notApplicable: 0, notTested: 0 },
    gaps: [],
    lastUpdatedAt: "",
  },
  "runs/runs.json": {
    schemaVersion: ASSESSMENT_VERSION,
    runTemplate: RUN_TEMPLATE,
    activeRunId: "",
    runs: [],
    defaults: { profile: "assist:planner", requireApproval: true, pauseBetweenActions: false, retainToolOutput: true },
    statistics: { total: 0, planned: 0, running: 0, paused: 0, completed: 0, stopped: 0, failed: 0 },
  },
};

const JSONL_TEMPLATES = {
  "traffic/raw.jsonl": { recordType: "pointer-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "direction", "protocol", "method", "url", "statusCode", "headersRedacted", "bodyFile", "durationMs", "source", "tags"] },
  "traffic/filtered.jsonl": { recordType: "pointer-log-schema", schemaVersion: ASSESSMENT_VERSION, fields: ["timestamp", "requestId", "targetId", "filterReason", "findingIds", "method", "url", "statusCode", "parameterNames", "contentType", "evidenceFiles", "notes", "tags"] },
  "logs/agent-actions.jsonl": { recordType: "pointer-agent-action-log", schemaVersion: ASSESSMENT_VERSION, fields: ["runId", "type", "timestamp", "profile", "phase", "tool", "target", "risk", "allowed", "reason", "ok", "errorCode", "output", "claim"] },
  "logs/agent-hypotheses.jsonl": { recordType: "pointer-agent-hypothesis-log", schemaVersion: ASSESSMENT_VERSION, fields: ["id", "title", "question", "target", "expectedSignal", "rejectingSignal", "proposedTechnique", "evidencePlan", "stopConditions", "evidenceIds", "status", "source", "recordedAt"] },
  "logs/agent-runs.jsonl": { recordType: "pointer-agent-run-log", schemaVersion: ASSESSMENT_VERSION, fields: ["runId", "type", "timestamp", "profile", "status", "scopeSnapshotSha256", "configurationSnapshotSha256", "approvedBy", "approvalReference", "stopReason"] },
  "logs/agent-approvals.jsonl": { recordType: "pointer-agent-approval-log", schemaVersion: ASSESSMENT_VERSION, fields: ["runId", "timestamp", "operator", "profile", "actionId", "tool", "target", "capability", "risk", "decision", "reason", "scope", "expiresAt"] },
  "logs/tool-output.jsonl": { recordType: "pointer-tool-output-log", schemaVersion: ASSESSMENT_VERSION, fields: ["runId", "timestamp", "tool", "version", "command", "target", "exitCode", "outputPath", "sha256", "redacted", "truncated"] },
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

function createAssessmentWorkspace({ fs, path, now = () => new Date(), promptDefaults = null }) {
  // Prompt defaults are pure data. They are injected so the domain layer never
  // imports application orchestration; the composition root supplies the
  // application compiler's defaults, and tests may pass a deterministic stub.
  if (promptDefaults && typeof promptDefaults === "function") {
    resolvePromptDefaults = promptDefaults;
  }
  function atomicWriteJson(target, value) {
    const temporary = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
    const backup = `${target}.bak`;
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    const descriptor = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(descriptor, serialized, { encoding: "utf8" });
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    JSON.parse(fs.readFileSync(temporary, "utf8"));
    if (fs.existsSync(target)) fs.copyFileSync(target, backup);
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      if (!fs.existsSync(target)) throw error;
      fs.unlinkSync(target);
      try { fs.renameSync(temporary, target); }
      catch (replaceError) {
        if (fs.existsSync(backup)) fs.copyFileSync(backup, target);
        throw replaceError;
      }
    }
  }
  function projectRedactionMarker(root) {
    const target = path.join(root, "Map", ".correlation-key");
    let key;
    if (fs.existsSync(target)) {
      const value = fs.readFileSync(target, "utf8").trim();
      if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("Project correlation key is malformed");
      key = Buffer.from(value, "hex");
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const value = crypto.randomBytes(32).toString("hex");
      try { fs.writeFileSync(target, `${value}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        return projectRedactionMarker(root);
      }
      key = Buffer.from(value, "hex");
    }
    return (secret) => `[REDACTED:hmac:${crypto.createHmac("sha256", key).update(String(secret)).digest("hex").slice(0, 24)}]`;
  }

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
      { relativePath: "pen_context.md", type: "file", content: () => "# Penetration Testing Context\n\nNo context files have been imported yet.\n" },
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
        if (["penetration-testing/wstg-checklist.json", "penetration-testing/mitre-checklist.json"].includes(relativePath)) {
          const groupField = relativePath.includes("wstg") ? "categories" : "tactics";
          const idField = relativePath.includes("wstg") ? "id" : "techniqueId";
          if (!Array.isArray(parsed[groupField])) { parsed[groupField] = []; merged.changed = true; }
          for (const group of template[groupField]) {
            if (!parsed[groupField].includes(group)) { parsed[groupField].push(group); merged.changed = true; }
          }
          if (!Array.isArray(parsed.checks)) { parsed.checks = []; merged.changed = true; }
          const existing = new Map(parsed.checks.map((check) => [check?.[idField], check]));
          for (const expectedCheck of template.checks) {
            const current = existing.get(expectedCheck[idField]);
            if (!current) { parsed.checks.push(clone(expectedCheck)); merged.changed = true; continue; }
            const checkMerge = mergeMissingFields(current, expectedCheck, `checks.${expectedCheck[idField]}`);
            merged.changed ||= checkMerge.changed;
            merged.blocked.push(...checkMerge.blocked);
          }
        }
        if (relativePath === ".pointer-assessment.json" && Number(parsed.schemaVersion) < ASSESSMENT_VERSION) {
          parsed.schemaVersion = ASSESSMENT_VERSION;
          merged.changed = true;
        }
        if (["findings/findings.json", "vulnerability-scans/info.json", "vulnerability-scans/easy.json", "vulnerability-scans/medium.json", "vulnerability-scans/high.json", "vulnerability-scans/critical.json"].includes(relativePath)) {
          if (parsed.severity === "info") { parsed.severity = "informational"; merged.changed = true; }
          if (parsed.severity === "easy") { parsed.severity = "low"; merged.changed = true; }
          for (const finding of Array.isArray(parsed.findings) ? parsed.findings : []) {
            const normalizedSeverity = FindingGate.normalizeSeverity(finding.severity);
            if (normalizedSeverity !== finding.severity) { finding.severity = normalizedSeverity; merged.changed = true; }
            if (finding.cvss?.version === "3.1") finding.cvss.legacy = true;
          }
        }
        if (["penetration-testing/wstg-checklist.json", "penetration-testing/asvs-checklist.json"].includes(relativePath)) {
          for (const check of Array.isArray(parsed.checks) ? parsed.checks : []) {
            if (check.status === "not-started") { check.status = "not-tested"; merged.changed = true; }
          }
          if (parsed.assessment?.reviewStatus === "not-started") { parsed.assessment.reviewStatus = "not-tested"; merged.changed = true; }
        }
        if (relativePath === "penetration-testing/coverage.json") {
          for (const item of [...(Array.isArray(parsed.frameworks) ? parsed.frameworks : []), ...(Array.isArray(parsed.matrix) ? parsed.matrix : [])]) {
            if (item.status === "not-started") { item.status = "not-tested"; merged.changed = true; }
          }
        }
        if (merged.blocked.length) blocked.push({ path: relativePath, reason: "schema_type_mismatch", fields: merged.blocked });
        if (merged.changed) {
          atomicWriteJson(target, parsed);
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

  function sha256(value) {
    const input = Buffer.isBuffer(value) ? value : String(value ?? "");
    return crypto.createHash("sha256").update(input).digest("hex");
  }

  function appendJsonl(root, relativePath, record, maxBytes = 1_500_000) {
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) return { error: "Record exceeds the configured evidence limit", code: "RECORD_TOO_LARGE" };
    const target = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${serialized}\n`, "utf8");
    return { ok: true, path: relativePath, record };
  }

  function appendEvidenceRecord(rawRoot, record = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const capturedAt = String(record.capturedAt || now().toISOString());
    const request = String(record.request || "");
    const response = String(record.response || "");
    const content = String(record.content || `${request}\n${response}`);
    const entry = {
      id: String(record.id || record.requestId || `evidence-${Date.now().toString(36)}`).slice(0, 160),
      type: String(record.type || "request-response"),
      title: String(record.title || record.url || "Captured evidence").slice(0, 300),
      capturedAt,
      capturedBy: String(record.capturedBy || record.tool || "XEKUTE").slice(0, 160),
      source: String(record.source || record.tool || "unknown").slice(0, 120),
      requestId: String(record.requestId || ""),
      targetId: String(record.targetId || ""),
      host: String(record.host || ""),
      url: String(record.url || "").slice(0, 2000),
      sha256: String(record.sha256 || sha256(content)),
      requestSha256: request ? sha256(request) : "",
      responseSha256: response ? sha256(response) : "",
      redacted: record.redacted !== false,
      redactionProfile: String(record.redactionProfile || "default"),
      filePath: String(record.filePath || ""),
      findingIds: Array.isArray(record.findingIds) ? record.findingIds.map(String).slice(0, 50) : [],
      notes: String(record.notes || "").slice(0, 2000),
    };
    try {
      return appendJsonl(verification.root, "evidence/index.jsonl", entry);
    } catch (error) {
      return { error: error.message, code: "EVIDENCE_WRITE_FAILED" };
    }
  }

  function readJsonl(rawRoot, relativePath, { limit = 500, maxBytes = 20 * 1024 * 1024 } = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const target = path.join(verification.root, ...relativePath.split("/"));
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
    const boundedBytes = Math.max(1024 * 1024, Math.min(Number(maxBytes) || 20 * 1024 * 1024, 50 * 1024 * 1024));
    try {
      if (!fs.existsSync(target)) return { ok: true, path: relativePath, records: [], invalidCount: 0, truncated: false };
      const stat = fs.statSync(target);
      const start = Math.max(0, stat.size - boundedBytes);
      const buffer = Buffer.alloc(stat.size - start);
      const descriptor = fs.openSync(target, "r");
      try { fs.readSync(descriptor, buffer, 0, buffer.length, start); } finally { fs.closeSync(descriptor); }
      let text = buffer.toString("utf8");
      if (start > 0) { const newline = text.indexOf("\n"); text = newline >= 0 ? text.slice(newline + 1) : ""; }
      const records = []; let invalidCount = 0;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)); } catch { invalidCount += 1; }
      }
      return { ok: true, path: relativePath, records: records.slice(-boundedLimit).reverse(), invalidCount, truncated: start > 0 || records.length > boundedLimit };
    } catch (error) { return { error: error.message, code: "JSONL_READ_FAILED" }; }
  }

  function appendFinding(rawRoot, finding = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const target = path.join(verification.root, "findings", "findings.json");
    try {
      const document = JSON.parse(fs.readFileSync(target, "utf8"));
      const severity = FindingGate.normalizeSeverity(finding.severity);
      const entry = { ...findingTemplate(severity), ...finding, severity };
      entry.id = String(entry.id || `finding-${Date.now().toString(36)}`).slice(0, 160);
      entry.status = String(entry.status || "draft");
      entry.confidence = String(entry.confidence || "unconfirmed");
      entry.discoveredAt = entry.discoveredAt || now().toISOString();
      entry.evidence = Array.isArray(entry.evidence) ? entry.evidence.map(String).slice(0, 100) : [];
      const evidenceResult = readJsonl(verification.root, "evidence/index.jsonl", { limit: 2000 });
      for (const record of evidenceResult.records || []) {
        if (!record.filePath) continue;
        try {
          const artifact = path.resolve(verification.root, ...String(record.filePath).replace(/\\/g, "/").split("/"));
          const relative = path.relative(verification.root, artifact);
          record.hashValid = !relative.startsWith("..") && !path.isAbsolute(relative) && fs.existsSync(artifact) && sha256(fs.readFileSync(artifact)) === record.sha256;
        } catch { record.hashValid = false; }
      }
      const scopeDocument = JSON.parse(fs.readFileSync(path.join(verification.root, "scope", "in-scope.json"), "utf8"));
      const outDocument = JSON.parse(fs.readFileSync(path.join(verification.root, "scope", "out-of-scope.json"), "utf8"));
      const gate = FindingGate.validateFindingCandidate(entry, {
        evidenceRecords: evidenceResult.records || [],
        scope: { targets: scopeDocument.targets || [], wildcardRules: scopeDocument.wildcardRules || [], excludedTargets: outDocument.assets || [] },
      });
      if (!gate.ok) return { error: gate.errors.map((item) => item.message).join(" "), code: gate.errors[0]?.code || "FINDING_GATE_FAILED", gate };
      Object.assign(entry, gate.candidate);
      const duplicate = (document.findings || []).find((current) => current.id === entry.id);
      if (duplicate) return { error: `Finding already exists: ${entry.id}`, code: "FINDING_EXISTS", finding: duplicate };
      const normalized = (value) => String(value || "").trim().toLowerCase();
      const duplicateByFingerprint = normalized(entry.title) && (document.findings || []).find((current) => normalized(current.title) === normalized(entry.title)
        && normalized(current.asset?.host || current.asset?.url) === normalized(entry.asset?.host || entry.asset?.url)
        && normalized(current.asset?.endpoint) === normalized(entry.asset?.endpoint)
        && normalized(current.classification?.vulnerabilityType) === normalized(entry.classification?.vulnerabilityType));
      if (duplicateByFingerprint) return { ok: true, duplicateOf: duplicateByFingerprint.id, finding: duplicateByFingerprint, path: "findings/findings.json" };
      document.findings = [...(Array.isArray(document.findings) ? document.findings : []), entry];
      document.statistics = { ...(document.statistics || {}), total: document.findings.length };
      atomicWriteJson(target, document);
      return { ok: true, finding: entry, path: "findings/findings.json" };
    } catch (error) { return { error: error.message, code: "FINDING_WRITE_FAILED" }; }
  }

  function createRun(rawRoot, input = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const target = path.join(verification.root, "runs", "runs.json");
    try {
      const document = JSON.parse(fs.readFileSync(target, "utf8"));
      const hashFile = (relativePath) => {
        try { return sha256(fs.readFileSync(path.join(verification.root, ...relativePath.split("/")))); } catch { return ""; }
      };
      const entry = {
        ...clone(RUN_TEMPLATE),
        ...input,
        id: String(input.id || `run-${Date.now().toString(36)}`).slice(0, 160),
        createdAt: input.createdAt || now().toISOString(),
        scopeSnapshotSha256: input.scopeSnapshotSha256 || sha256(["scope/in-scope.json", "scope/out-of-scope.json", "scope/engagement.json"].map(hashFile).join("|")),
        configurationSnapshotSha256: input.configurationSnapshotSha256 || hashFile("scope/configurations.json"),
      };
      document.runs = [...(Array.isArray(document.runs) ? document.runs : []), entry];
      document.activeRunId = entry.status === "running" ? entry.id : document.activeRunId || "";
      document.statistics = { ...(document.statistics || {}), total: document.runs.length };
      atomicWriteJson(target, document);
      return { ok: true, run: entry, path: "runs/runs.json" };
    } catch (error) { return { error: error.message, code: "RUN_WRITE_FAILED" }; }
  }

  function updateRun(rawRoot, runId, patch = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const target = path.join(verification.root, "runs", "runs.json");
    try {
      const document = JSON.parse(fs.readFileSync(target, "utf8"));
      const index = (document.runs || []).findIndex((run) => run.id === String(runId));
      if (index < 0) return { error: `Run not found: ${runId}`, code: "RUN_NOT_FOUND" };
      const allowed = ["status", "startedAt", "completedAt", "approvedBy", "approvalReference", "stopReason", "actions", "hypotheses", "findings", "evidenceIds", "coverage", "notes"];
      document.runs[index] = { ...document.runs[index], ...Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)).map((key) => [key, patch[key]])) };
      if (["completed", "inconclusive", "stopped", "failed"].includes(document.runs[index].status) && document.activeRunId === runId) document.activeRunId = "";
      atomicWriteJson(target, document);
      return { ok: true, run: document.runs[index], path: "runs/runs.json" };
    } catch (error) { return { error: error.message, code: "RUN_UPDATE_FAILED" }; }
  }

  function generateReport(rawRoot) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const readJson = (relativePath, fallback = {}) => {
      try { return JSON.parse(fs.readFileSync(path.join(verification.root, ...relativePath.split("/")), "utf8")); } catch { return fallback; }
    };
    const engagement = readJson("scope/engagement.json");
    const scope = readJson("scope/in-scope.json");
    const assets = readJson("enumeration/assets.json");
    const findings = readJson("findings/findings.json");
    const coverage = readJson("penetration-testing/coverage.json");
    const runs = readJson("runs/runs.json");
    const evidence = readJsonl(verification.root, "evidence/index.jsonl", { limit: 500 });
    const stamp = now().toISOString();
    const safeTitle = String(engagement.engagement?.name || verification.name || "Security Assessment");
    const findingRows = (findings.findings || []).map((finding) => `| ${finding.id || ""} | ${String(finding.title || "").replace(/\|/g, "\\|")} | ${finding.severity || ""} | ${finding.confidence || ""} | ${finding.status || ""} | ${(finding.evidence || []).join(", ")} |`);
    const coverageItems = Array.isArray(coverage.matrix) ? coverage.matrix : [];
    const positiveControls = coverageItems.filter((item) => item.status === "passed");
    const untestedItems = coverageItems.filter((item) => ["not-tested", "in-progress", "blocked"].includes(item.status));
    const details = (findings.findings || []).flatMap((finding) => [
      `### ${finding.id || "Unnumbered"}: ${finding.title || "Untitled finding"}`,
      "",
      `- Affected asset/component: ${finding.asset?.url || finding.asset?.host || "not recorded"}${finding.asset?.endpoint ? ` ${finding.asset.endpoint}` : ""}`,
      `- Preconditions/authentication state: ${(Array.isArray(finding.prerequisites) ? finding.prerequisites.join("; ") : finding.preconditions) || finding.authenticationState || "not recorded"}`,
      `- Expected behavior: ${finding.reproduction?.expectedResult || "not recorded"}`,
      `- Observed behavior: ${finding.reproduction?.observedResult || "not recorded"}`,
      `- Evidence IDs: ${(finding.evidence || []).join(", ") || "none"}`,
      `- Technical impact: ${finding.impact?.technical || finding.technicalImpact || "not recorded"}`,
      `- Business impact: ${finding.impact?.business || finding.businessImpact || "not recorded"}`,
      `- Confidence/verifier: ${finding.confidence || "unconfirmed"}; ${finding.verification?.verdict || "not run"}`,
      `- References: ${[...(finding.classification?.cweIds || []), ...(finding.classification?.wstgIds || []), ...(finding.classification?.asvsIds || []), ...(finding.classification?.capecIds || []), ...(finding.classification?.mitreTechniqueIds || [])].filter(Boolean).join(", ") || "none"}`,
      `- Remediation: ${finding.remediation?.recommendation || (typeof finding.remediation === "string" ? finding.remediation : "") || "not recorded"}`,
      `- Retest criteria/status: ${finding.validation?.retestCriteria || finding.retestCriteria || finding.validation?.retestStatus || "not recorded"}`,
      `- Limitations/disclosure: ${(finding.limitations || []).join("; ") || "none recorded"}; ${finding.disclosure?.vendorStatus || finding.disclosureState || "not recorded"}`,
      "",
    ]);
    const report = [
      `# ${safeTitle}`,
      "",
      `Generated: ${stamp}`,
      `Assessment status: ${engagement.status || "draft"}`,
      "",
      "## Executive Summary",
      "",
      `- In-scope targets: ${(scope.targets || []).length}`,
      `- Discovered assets: ${(assets.assets || []).length}`,
      `- Findings: ${(findings.findings || []).length}`,
      `- Evidence records: ${evidence.records?.length || 0}`,
      `- Runs: ${(runs.runs || []).length}`,
      `- Coverage tested: ${coverage.summary?.tested || 0}/${coverage.summary?.total || 0}`,
      "",
      "## Authorization and Rules of Engagement",
      "",
      `- Authorization confirmed: ${engagement.authorization?.confirmed ? "yes" : "no"}`,
      `- Scope reviewed: ${engagement.scopeReview?.reviewed ? "yes" : "no"}`,
      `- Exclusions confirmed: ${engagement.scopeReview?.exclusionsConfirmed ? "yes" : "no"}`,
      `- Testing windows: ${(engagement.rulesOfEngagement?.testingWindows || []).join(", ") || "not configured"}`,
      `- Rate/concurrency: ${engagement.rulesOfEngagement?.requestsPerSecond || 0} req/s, ${engagement.rulesOfEngagement?.maximumConcurrency || 1} concurrent`,
      "",
      "## Methodology",
      "",
      "- Planning, execution, and post-execution follow the NIST SP 800-115 assessment lifecycle.",
      "- Web and API coverage is tracked against OWASP WSTG 4.2 and OWASP ASVS 5.0.0.",
      "- MITRE ATT&CK mappings are supplemental adversary context and do not prove application-testing coverage.",
      "- Scanner output is treated as a lead until reproduction, evidence, false-positive review, and any required independent verification pass.",
      "",
      "## Findings",
      "",
      "| ID | Title | Severity | Confidence | Status | Evidence |",
      "| --- | --- | --- | --- | --- | --- |",
      ...(findingRows.length ? findingRows : ["| — | No findings recorded | — | — | — | — |"]),
      "",
      "## Detailed Findings",
      "",
      ...(details.length ? details : ["No detailed findings were recorded.", ""]),
      "## Positive Control Observations",
      "",
      ...(positiveControls.length ? positiveControls.map((item) => `- ${item.id || item.control || "procedure"}: no issue was observed under the recorded procedure and tested conditions (evidence: ${(item.evidenceIds || []).join(", ") || "not linked"}).`) : ["- No passed control observations are recorded."]),
      "",
      "## Coverage",
      "",
      `- Tested: ${coverage.summary?.tested || 0}`,
      `- Passed: ${coverage.summary?.passed || 0}`,
      `- Failed: ${coverage.summary?.failed || 0}`,
      `- Blocked: ${coverage.summary?.blocked || 0}`,
      `- Not applicable: ${coverage.summary?.notApplicable || 0}`,
      `- Not tested: ${coverage.summary?.notTested || 0}`,
      "",
      "### Untested and blocked areas",
      "",
      ...(untestedItems.length ? untestedItems.map((item) => `- ${item.id || item.control || "coverage item"}: ${item.status}${item.reason ? ` — ${item.reason}` : ""}`) : ["- No matrix-level gaps are recorded; verify checklist-level coverage separately."]),
      "",
      "## Risk Methodology and Remediation Priorities",
      "",
      "- New findings use CVSS 4.0 where sufficient metrics exist; legacy CVSS 3.1 records remain identified as legacy.",
      "- Prioritize verified critical/high findings first, then exposed medium findings and systemic control gaps. Informational and low observations remain context-dependent.",
      "- Technical severity, business impact, exploit preconditions, confidence, and verifier status are reported separately.",
      "",
      "## Retest Status",
      "",
      `- Findings requiring retest: ${(findings.findings || []).filter((finding) => ["retest-required", "remediated"].includes(finding.status)).length}`,
      `- Closed after retest: ${(findings.findings || []).filter((finding) => finding.status === "closed").length}`,
      "",
      "## Limitations and Retest Notes",
      "",
      `- Untested coverage items: ${coverage.summary?.notTested || 0}`,
      `- Blocked coverage items: ${coverage.summary?.blocked || 0}`,
      `- Inconclusive or stopped runs: ${(runs.runs || []).filter((run) => ["inconclusive", "stopped", "failed"].includes(run.status)).length}`,
      "- This export is generated from current local records; validate scope, evidence integrity, disclosure state, and retest status before client delivery.",
      "- A passed procedure or no-issue observation means only that no issue was observed under the documented tested conditions. It does not guarantee the absence of vulnerabilities.",
      "",
    ].join("\n");
    try {
      const exportDir = path.join(verification.root, "report", "exports");
      fs.mkdirSync(exportDir, { recursive: true });
      const fileName = `report-${stamp.replace(/[:.]/g, "-")}.md`;
      const target = path.join(exportDir, fileName);
      fs.writeFileSync(target, report, "utf8");
      return { ok: true, path: path.relative(verification.root, target).replace(/\\/g, "/"), generatedAt: stamp, summary: { findings: (findings.findings || []).length, evidence: evidence.records?.length || 0, assets: (assets.assets || []).length, runs: (runs.runs || []).length } };
    } catch (error) { return { error: error.message, code: "REPORT_GENERATION_FAILED" }; }
  }

  function appendTrafficRecord(rawRoot, record, { filtered = false } = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const date = now();
    const timestamp = formatTrafficTimestamp(date);
    const settingsResult = readSettings(verification.root);
    const logging = settingsResult?.settings?.logging || {};
    const shouldRedact = logging.redactAuthorizationHeaders !== false;
    let inputRecord;
    try {
      inputRecord = shouldRedact
        ? redactTrafficRecord(record, projectRedactionMarker(verification.root))
        : { ...record, redacted: false };
    } catch (error) {
      return { error: error.message, code: "TRAFFIC_REDACTION_FAILED" };
    }
    const safeRecord = {
      recordType: "http-exchange",
      schemaVersion: ASSESSMENT_VERSION,
      timestamp,
      isoTimestamp: date.toISOString(),
      ...inputRecord,
    };
    const serialized = JSON.stringify(safeRecord);
    const maximumRecordBytes = Math.max(64_000, Math.min(16_000_000, Number(logging.maximumRecordBytes) || 1_500_000));
    if (Buffer.byteLength(serialized, "utf8") > maximumRecordBytes) {
      return { error: `Traffic record exceeds the ${maximumRecordBytes} byte log limit`, code: "RECORD_TOO_LARGE" };
    }
    const relativePath = filtered ? "traffic/filtered.jsonl" : "traffic/raw.jsonl";
    const target = path.join(verification.root, ...relativePath.split("/"));
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `${serialized}\n`, "utf8");
      const evidence = appendEvidenceRecord(verification.root, {
          id: safeRecord.requestId,
          type: "request-response",
          title: safeRecord.url || safeRecord.requestId || "HTTP exchange",
          capturedAt: safeRecord.isoTimestamp,
          capturedBy: safeRecord.tool || safeRecord.source || "traffic",
          source: safeRecord.source || safeRecord.tool || "traffic",
          requestId: safeRecord.requestId,
          targetId: safeRecord.targetId,
          url: safeRecord.url,
          request: safeRecord.request,
          response: safeRecord.response,
          redacted: shouldRedact,
          notes: filtered ? "Indexed from filtered traffic" : "Indexed from Traffic/Raw",
        });
      return { ok: true, path: relativePath, timestamp, record: safeRecord, evidence };
    } catch (error) {
      return { error: error.message, code: "TRAFFIC_LOG_FAILED" };
    }
  }

  function deleteTrafficRecords(rawRoot, { requestIds = [] } = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const ids = new Set((Array.isArray(requestIds) ? requestIds : []).map(String).filter(Boolean));
    if (!ids.size) return { ok: true, deleted: 0 };

    const target = path.join(verification.root, "traffic", "raw.jsonl");
    try {
      if (!fs.existsSync(target)) return { ok: true, deleted: 0 };
      const content = fs.readFileSync(target, "utf8");
      let deleted = 0;
      const kept = [];
      for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record?.recordType === "http-exchange" && ids.has(String(record.requestId))) {
            deleted += 1;
            continue;
          }
        } catch {
          // keep malformed lines
        }
        kept.push(line);
      }
      fs.writeFileSync(target, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
      return { ok: true, deleted };
    } catch (error) {
      return { error: error.message, code: "TRAFFIC_DELETE_FAILED" };
    }
  }

  function readTrafficHistory(rawRoot, { limit = 500, maxBytes = 20 * 1024 * 1024 } = {}) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const target = path.join(verification.root, "traffic", "raw.jsonl");
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
    const boundedBytes = Math.max(1024 * 1024, Math.min(Number(maxBytes) || 20 * 1024 * 1024, 50 * 1024 * 1024));

    try {
      if (!fs.existsSync(target)) return { ok: true, path: "traffic/raw.jsonl", records: [], truncated: false, invalidCount: 0 };
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

  function deleteCustomEntries(rawRoot, relativePaths = []) {
    const verification = verify(rawRoot);
    if (verification.error) return verification;
    const requested = [...new Set((Array.isArray(relativePaths) ? relativePaths : []).map((value) => String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")).filter(Boolean))].slice(0, 100);
    if (!requested.length) return { error: "Select at least one Custom item", code: "NO_SELECTION" };
    const customRoot = path.resolve(verification.root, "custom");
    const resolved = [];
    for (const relativePath of requested) {
      const validated = validateCustomEntryPath(`custom/${relativePath}`);
      if (validated.error) return validated;
      const target = path.resolve(verification.root, ...validated.normalized.split("/"));
      if (target === customRoot || !target.startsWith(`${customRoot}${path.sep}`)) return { error: "Only Custom items can be deleted", code: "UNSAFE_DELETE" };
      if (!fs.existsSync(target)) return { error: `Custom item no longer exists: ${relativePath}`, code: "NOT_FOUND" };
      resolved.push({ relativePath, target });
    }
    const roots = resolved.filter((entry) => !resolved.some((candidate) => candidate !== entry && entry.relativePath.startsWith(`${candidate.relativePath}/`)));
    try {
      for (const entry of roots) fs.rmSync(entry.target, { recursive: true, force: false });
      return { ok: true, deleted: roots.map((entry) => entry.relativePath), requestedCount: requested.length };
    } catch (error) { return { error: `Could not delete Custom items: ${error.message}`, code: "DELETE_FAILED" }; }
  }

  return {
    verify,
    repair,
    appendTrafficRecord,
    appendEvidenceRecord,
    readJsonl,
    appendFinding,
    createRun,
    updateRun,
    generateReport,
    deleteTrafficRecords,
    deleteCustomEntries,
    readTrafficHistory,
    readSettings,
    writeSettings,
    requiredDirectories: [...REQUIRED_DIRECTORIES],
  };
}

module.exports = {
  ASSESSMENT_ITEM_FILES,
  ASSESSMENT_VERSION,
  JSON_TEMPLATES,
  REQUIRED_DIRECTORIES,
  RESERVED_ASSESSMENT_NAMES,
  createAssessmentWorkspace,
  formatTrafficTimestamp,
  redactHttpMessage,
  redactTrafficRecord,
  validateCustomEntryPath,
};
