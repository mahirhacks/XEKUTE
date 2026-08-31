const { getDomain } = require("tldts");
const { createTrafficGraphStore, GRAPH_MANIFEST } = require("./traffic-graph-store.js");

// Domain extraction seam: `tldts` is the default adapter; callers/tests may
// inject a deterministic extractor to keep domain rules pure and testable.
function defaultDomainExtractor() {
  return function registrableDomain(hostname = "") {
    const host = String(hostname).toLowerCase().replace(/^\.+|\.+$/g, "");
    if (!host || host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return host;
    return getDomain(host, { allowPrivateDomains: true }) || host;
  };
}

const DEFAULT_LIMITS = Object.freeze({ maxBytes: 100 * 1024 * 1024, maxRecords: 50000 });
const MAP_SCHEMA_VERSION = 5;
const MAP_BUILDER_VERSION = "0.8.0";
const STATIC_EXTENSIONS = new Set([
  "css", "js", "mjs", "map", "png", "jpg", "jpeg", "gif", "svg", "ico", "webp",
  "woff", "woff2", "ttf", "eot", "mp3", "mp4", "webm", "avi", "mov",
]);
const SENSITIVE_FIELD_PATTERN = /(?:email|phone|address|token|secret|password|passwd|ssn|credit|card|account|dob|birth|api[_-]?key)/i;
const HIGH_VALUE_PATH_PATTERN = /\/(?:api|admin|user|account|customer|payment|order|upload|download|reset-password|settings|graphql)(?:\/|$)/i;
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PRIORITY_HIGH_THRESHOLD = 70;
const PRIORITY_ELEVATED_THRESHOLD = 40;

function priorityTier(score) {
  if (score >= PRIORITY_HIGH_THRESHOLD) return "high";
  if (score >= PRIORITY_ELEVATED_THRESHOLD) return "elevated";
  if (score >= 15) return "normal";
  return "low";
}

function priorityFactor(id, label, points) {
  return { id, label, points };
}

function applyPriority(node, factors = [], evidenceMultiplier = 1) {
  const rawScore = factors.reduce((total, factor) => total + Number(factor.points || 0), 0);
  const priorityScore = Math.max(0, Math.min(100, Math.round(rawScore * evidenceMultiplier)));
  node.priorityScore = priorityScore;
  // `riskScore` is retained for existing graph snapshots, IPC consumers, and
  // visual mode compatibility. It now represents deterministic investigation priority.
  node.riskScore = priorityScore;
  node.priorityTier = priorityTier(priorityScore);
  node.priorityFactors = factors;
  return node;
}

function identityDifferential(route) {
  const profiles = new Map();
  for (const variant of route.variants || []) {
    const profile = `${variant.statusCode || 0}:${variant.responseSchemaHash || "unknown"}`;
    for (const identityId of variant.identityIds || []) {
      if (!profiles.has(identityId)) profiles.set(identityId, new Set());
      profiles.get(identityId).add(profile);
    }
  }
  const identities = [...profiles.keys()].sort();
  const profileKeys = new Set([...profiles.values()].flatMap((values) => [...values]));
  const hasDifferential = identities.length > 1 && profileKeys.size > 1;
  const roles = new Set((route.variants || []).flatMap((variant) => variant.actorRoles || []).filter((role) => role && role !== "unknown"));
  return { identityCount: identities.length, profileCount: profileKeys.size, roleCount: roles.size, hasDifferential };
}

function calculateRoutePriority(route) {
  const factors = [];
  const tags = [];
  const add = (id, label, points, tag = id) => { factors.push(priorityFactor(id, label, points)); tags.push(tag); };
  const hasObjectIdentifier = (route.parameters || []).some((item) => item.category === "id" || /(?:^|_)id$/i.test(item.name));
  const hasSensitiveResponse = (route.sensitiveFields || []).length > 0;
  const securityRelevantPath = HIGH_VALUE_PATH_PATTERN.test(route.template || "");
  const stateChanging = STATE_CHANGING_METHODS.has(route.method);
  const anonymousAccessObserved = (route.authTypes || []).includes("none");
  const differential = identityDifferential(route);

  if (stateChanging) add("state_changing", "State-changing endpoint", 14);
  if (hasObjectIdentifier) add("object_identifier", "Object identifier accepted", 14);
  if (hasSensitiveResponse) add("sensitive_response", "Sensitive-looking response fields observed", Math.min(20, 8 + (route.sensitiveFields || []).length * 2));
  if (securityRelevantPath) add("security_relevant_route", "Security-relevant route family", 10);
  if ((route.statusCodes || []).some((status) => status >= 500)) add("server_error_observed", "Server error observed", 12);
  if ((route.variants || []).length > 1 && !differential.hasDifferential) add("behavior_variants", "Multiple observed response variants", Math.min(8, ((route.variants || []).length - 1) * 3));
  if (anonymousAccessObserved && hasObjectIdentifier) add("anonymous_object_reference", "Anonymous object-reference access observed", 20);
  if (anonymousAccessObserved && stateChanging) add("anonymous_state_change", "Anonymous state-changing access observed", 16);
  if (anonymousAccessObserved && hasSensitiveResponse) add("anonymous_sensitive_response", "Anonymous response contains sensitive-looking fields", 14);
  if (differential.hasDifferential) {
    add("identity_response_differential", "Different identities received different response profiles", 10);
    if (hasObjectIdentifier) add("object_access_differential", "Object route differs across identities", 8);
    if (hasSensitiveResponse) add("sensitive_data_differential", "Sensitive response shape differs across identities", 6);
  }
  if (differential.roleCount > 1) add("multi_role_coverage", "Multiple account roles observed", 3);
  if ((route.entryPointReasons || []).length) tags.push("entry_point");
  if (!route.observed) tags.push("discovered_reference");

  const evidenceMultiplier = route.observed ? 1 : Math.max(0.35, Math.min(0.7, Number(route.confidence) || 0.55));
  applyPriority(route, factors, evidenceMultiplier);
  route.riskTags = [...new Set(tags)];
  route.priorityEvidence = route.observed ? "observed" : "discovered";
  return route;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseRawMessage(raw = "") {
  const normalized = String(raw || "").replace(/\r\n/g, "\n");
  const splitAt = normalized.indexOf("\n\n");
  const head = splitAt >= 0 ? normalized.slice(0, splitAt) : normalized;
  const body = splitAt >= 0 ? normalized.slice(splitAt + 2) : "";
  const lines = head.split("\n");
  const startLine = lines.shift() || "";
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return { startLine, headers, body };
}

function singularize(value) {
  const clean = String(value || "item").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase() || "item";
  if (clean.endsWith("ies") && clean.length > 3) return `${clean.slice(0, -3)}y`;
  if (clean.endsWith("sses")) return clean.slice(0, -2);
  if (clean.endsWith("s") && !clean.endsWith("ss")) return clean.slice(0, -1);
  return clean;
}

function classifyDynamicSegment(segment) {
  if (/^\d+$/.test(segment)) return "id";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return "id";
  if (/^[0-9a-f]{24}$/i.test(segment)) return "id";
  if (/^\d{4}-\d{2}-\d{2}(?:t.*)?$/i.test(segment)) return "date";
  if (/^[^/@]+@[^/@]+\.[^/@]+$/.test(segment)) return "email";
  if (/^[0-9a-f]{16,}$/i.test(segment)) return "token";
  if (segment.length >= 24 && /^[a-z0-9_=-]+$/i.test(segment)) return "token";
  return "";
}

function normalizeRoutePath(pathname = "/") {
  const parts = String(pathname || "/").split("/");
  const parameters = [];
  const normalized = parts.map((part, index) => {
    if (!part) return part;
    let decoded = part;
    try { decoded = decodeURIComponent(part); } catch { /* preserve malformed paths */ }
    const kind = classifyDynamicSegment(decoded);
    if (!kind) return part;
    const previous = parts[index - 1] || "item";
    const base = singularize(previous);
    const name = kind === "id" ? `${base}_id` : kind === "token" ? `${base}_token` : kind;
    parameters.push({ name, location: "path", category: kind, observedValue: decoded });
    return `{${name}}`;
  }).join("/");
  const template = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  return { template: template || "/", parameters };
}

function inferValueSchema(value, sensitiveFields, prefix = "") {
  if (Array.isArray(value)) return [value.length ? inferValueSchema(value[0], sensitiveFields, `${prefix}[]`) : "unknown"];
  if (value === null) return "null";
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      if (SENSITIVE_FIELD_PATTERN.test(key)) sensitiveFields.add(fieldPath);
      result[key] = inferValueSchema(value[key], sensitiveFields, fieldPath);
    }
    return result;
  }
  if (typeof value === "string") {
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "email";
    if (/^https?:\/\//i.test(value)) return "url";
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "date-time";
  }
  return typeof value;
}

function responseShape(parsedResponse) {
  const contentType = String(parsedResponse.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const body = parsedResponse.body || "";
  const sensitiveFields = new Set();
  let schema = { type: contentType || "unknown", lengthBucket: Math.ceil(body.length / 1024) };
  let title = "";
  if (contentType.includes("json") || /^\s*[\[{]/.test(body)) {
    try { schema = inferValueSchema(JSON.parse(body), sensitiveFields); } catch { /* retain coarse schema */ }
  } else if (contentType.includes("html") || /<html[\s>]/i.test(body)) {
    title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
    schema = {
      type: "html",
      title: Boolean(title),
      forms: (body.match(/<form\b/gi) || []).length,
      inputs: (body.match(/<input\b/gi) || []).length,
      links: (body.match(/<a\b/gi) || []).length,
    };
  }
  return { contentType: contentType || "unknown", schema, sensitiveFields: [...sensitiveFields], title };
}

function routeVisibility(url, method, contentType) {
  const extension = url.pathname.split("/").pop()?.split(".").pop()?.toLowerCase() || "";
  if (STATIC_EXTENSIONS.has(extension)) return { visibility: "hidden", reason: "static_asset", relevance: "low" };
  if (/(?:google-analytics|googletagmanager|doubleclick|segment\.io|telemetry)/i.test(url.hostname)) {
    return { visibility: "hidden", reason: "third_party_telemetry", relevance: "low" };
  }
  const high = HIGH_VALUE_PATH_PATTERN.test(url.pathname) || STATE_CHANGING_METHODS.has(method) || contentType.includes("json");
  return { visibility: "visible", reason: "", relevance: high ? "high" : "medium" };
}

function referencedUrls(rawText, baseUrl, limit = 250) {
  const text = String(rawText || "").slice(0, 2_000_000);
  const candidates = new Set();
  const collect = (pattern) => {
    let match;
    while (candidates.size < limit && (match = pattern.exec(text))) candidates.add(match[1] || match[0]);
  };
  collect(/\b(?:href|src|action|data-url|data-endpoint)\s*=\s*["']([^"'#<>]+)["']/gi);
  collect(/\bhttps?:\/\/[^\s"'`<>\\)\]]+/gi);
  collect(/["'`](\/(?!\/)[^\s"'`<>]*)["'`]/g);
  const resolved = [];
  for (const candidate of candidates) {
    try {
      const url = new URL(String(candidate).replace(/[),.;]+$/, ""), baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      url.hash = "";
      if (!resolved.includes(url.toString())) resolved.push(url.toString());
    } catch { /* ignore non-URL response values */ }
  }
  return resolved.slice(0, limit);
}

function extractBodyReferences(rawText, baseUrl, { contentType = "", location = "response.body", limit = 250 } = {}) {
  const text = String(rawText || "").slice(0, 2_000_000);
  const references = new Map();
  const add = (rawValue, method, methodConfidence, confidence, extractor, selector) => {
    if (!rawValue || references.size >= limit) return;
    try {
      const target = new URL(String(rawValue).replace(/[),.;]+$/, ""), baseUrl);
      if (!/^https?:$/.test(target.protocol)) return;
      target.hash = "";
      if (extractor === "bounded-regex-fallback" && [...references.values()].some((item) => item.url === target.toString())) return;
      const key = `${String(method || "GET").toUpperCase()}|${target.toString()}`;
      const candidate = {
        key,
        url: target.toString(),
        method: String(method || "GET").toUpperCase(),
        methodConfidence,
        confidence,
        observationType: "discovered",
        provenance: { location, extractor, selector },
      };
      const existing = references.get(key);
      if (!existing || candidate.confidence > existing.confidence) references.set(key, candidate);
    } catch { /* bounded extractors may encounter non-URL literals */ }
  };

  if (String(contentType).includes("html") || /<(?:html|body|a|form|script|link)\b/i.test(text)) {
    const tagPattern = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    let tagMatch;
    while (references.size < limit && (tagMatch = tagPattern.exec(text))) {
      const tag = tagMatch[1].toLowerCase();
      const attributes = {};
      for (const match of tagMatch[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
      if (tag === "form" && attributes.action) add(attributes.action, attributes.method || "GET", attributes.method ? 1 : 0.9, 0.98, "html-tag-parser", "form[action]");
      if (attributes.href && ["a", "area", "link"].includes(tag)) add(attributes.href, "GET", 0.95, 0.94, "html-tag-parser", `${tag}[href]`);
      if (attributes.src && ["img", "script", "iframe", "source", "video", "audio"].includes(tag)) add(attributes.src, "GET", 0.98, 0.92, "html-tag-parser", `${tag}[src]`);
      if (attributes["data-url"]) add(attributes["data-url"], "GET", 0.65, 0.65, "html-tag-parser", `${tag}[data-url]`);
      if (attributes["data-endpoint"]) add(attributes["data-endpoint"], "GET", 0.65, 0.65, "html-tag-parser", `${tag}[data-endpoint]`);
    }
  }

  if (String(contentType).includes("json") || /^\s*[\[{]/.test(text)) {
    try {
      const visit = (value, depth = 0) => {
        if (depth > 8 || references.size >= limit || value == null) return;
        if (typeof value === "string") { if (/^(?:https?:\/\/|\/)/i.test(value)) add(value, "GET", 0.55, 0.72, "json-parser", "string-value"); return; }
        if (Array.isArray(value)) { value.slice(0, 100).forEach((item) => visit(item, depth + 1)); return; }
        if (typeof value === "object") Object.values(value).slice(0, 100).forEach((item) => visit(item, depth + 1));
      };
      visit(JSON.parse(text));
    } catch { /* malformed JSON falls through to bounded literal extraction */ }
  }

  const fetchPattern = /\bfetch\s*\(\s*(["'`])([^"'`]+)\1\s*(?:,\s*\{([\s\S]{0,300}?)\})?/gi;
  let fetchMatch;
  while (references.size < limit && (fetchMatch = fetchPattern.exec(text))) {
    const explicitMethod = fetchMatch[3]?.match(/\bmethod\s*:\s*["']([A-Z]+)["']/i)?.[1];
    add(fetchMatch[2], explicitMethod || "GET", explicitMethod ? 1 : 0.9, 0.9, "javascript-static-call", "fetch()");
  }
  const axiosPattern = /\baxios\.(get|post|put|patch|delete|head|options)\s*\(\s*(["'`])([^"'`]+)\2/gi;
  let axiosMatch;
  while (references.size < limit && (axiosMatch = axiosPattern.exec(text))) add(axiosMatch[3], axiosMatch[1], 1, 0.94, "javascript-static-call", `axios.${axiosMatch[1]}()`);

  for (const value of referencedUrls(text, baseUrl, limit)) add(value, "GET", 0.45, 0.5, "bounded-regex-fallback", "url-literal");
  return [...references.values()].slice(0, limit);
}

function routeResourceName(template = "/") {
  const segment = String(template).split("/").filter((part) => part && !part.startsWith("{")).at(-1) || "object";
  return singularize(segment);
}

function classifyApplicationAction(observation = {}) {
  const method = String(observation.method || "GET").toUpperCase();
  const template = String(observation.template || "/");
  const resource = routeResourceName(template) || "application";
  if (/\/(?:logout|log-out|signout|sign-out)(?:\/|$)/i.test(template)) return { kind: "logout", resource, mutating: true, label: `Sign out via ${template}` };
  if (/\/(?:login|log-in|signin|sign-in|authenticate|authentication|oauth(?:\/callback)?|session|token)(?:\/|$)/i.test(template)) return { kind: "authenticate", resource, mutating: method !== "GET", label: `Authenticate via ${template}` };
  if (method === "POST") return { kind: "create", resource, mutating: true, label: `Create ${resource}` };
  if (["PUT", "PATCH"].includes(method)) return { kind: "update", resource, mutating: true, label: `Update ${resource}` };
  if (method === "DELETE") return { kind: "delete", resource, mutating: true, label: `Delete ${resource}` };
  return { kind: "read", resource, mutating: false, label: `Read ${resource}` };
}

function lifecycleStateForAction(action = {}) {
  if (action.kind === "create") return "created";
  if (action.kind === "update") return "updated";
  if (action.kind === "delete") return "deleted";
  if (action.kind === "authenticate") return "authenticated";
  if (action.kind === "logout") return "anonymous";
  return "unchanged";
}

function collectIdentifierValues(value, namespace, output, depth = 0) {
  if (depth > 8 || output.size >= 250 || value == null) return;
  if (Array.isArray(value)) {
    value.slice(0, 100).forEach((item) => collectIdentifierValues(item, namespace, output, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const identifierKey = /(?:^id$|[_-]id$|Id$|uuid$|objectId$|identifier$)/.test(key);
    const normalizedKey = key.toLowerCase() === "id" ? `${namespace}_id` : key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();
    if (identifierKey && ["string", "number"].includes(typeof child)) {
      const clean = String(child).trim();
      if (clean && clean.length <= 160) output.add(`${normalizedKey}|${clean}`);
    }
    collectIdentifierValues(child, namespace, output, depth + 1);
  }
}

function bodyIdentifierValues(body, contentType, namespace) {
  const output = new Set();
  const text = String(body || "").trim();
  if (!text || text.length > 2_000_000) return output;
  if (String(contentType).includes("json") || /^[\[{]/.test(text)) {
    try { collectIdentifierValues(JSON.parse(text), namespace, output); } catch { /* not valid JSON */ }
  } else if (String(contentType).includes("x-www-form-urlencoded")) {
    try {
      for (const [key, value] of new URLSearchParams(text)) {
        if (/(?:^id$|[_-]id$|Id$|uuid$|objectId$|identifier$)/.test(key) && value.length <= 160) output.add(`${key.toLowerCase()}|${value}`);
      }
    } catch { /* malformed form body */ }
  }
  return output;
}

function graphVerification(nodes, edges, { evidenceIds = new Set(), stableNodeId = null, secretValues = [] } = {}) {
  const ids = new Set();
  let duplicateNodes = 0;
  const issues = [];
  for (const node of nodes) {
    if (ids.has(node.id)) { duplicateNodes += 1; issues.push({ code: "DUPLICATE_NODE_ID", id: node.id }); }
    ids.add(node.id);
    if (stableNodeId && node.canonicalKey && node.id !== stableNodeId(node.type.toLowerCase(), node.canonicalKey)) issues.push({ code: "NON_DETERMINISTIC_NODE_ID", id: node.id });
    if (node.observationType === "observed" && !(node.evidenceRefs || node.evidenceIds || []).length) issues.push({ code: "OBSERVED_NODE_WITHOUT_EVIDENCE", id: node.id });
    if (node.observationType === "inferred" && Number(node.confidence) >= 1) issues.push({ code: "INFERRED_CONFIDENCE_INVALID", id: node.id });
    for (const evidenceId of node.evidenceRefs || node.evidenceIds || []) if (!evidenceIds.has(evidenceId)) issues.push({ code: "UNKNOWN_NODE_EVIDENCE", id: node.id, evidenceId });
  }
  const danglingEdges = edges.filter((edge) => !ids.has(edge.source) || !ids.has(edge.target));
  danglingEdges.forEach((edge) => issues.push({ code: "DANGLING_EDGE", id: edge.id }));
  const equivalentEdges = new Set();
  let duplicateEdges = 0;
  let selfEdges = 0;
  for (const edge of edges) {
    const equivalent = `${edge.source}|${edge.type}|${edge.target}`;
    if (equivalentEdges.has(equivalent)) { duplicateEdges += 1; issues.push({ code: "DUPLICATE_EQUIVALENT_EDGE", id: edge.id }); }
    equivalentEdges.add(equivalent);
    if (edge.source === edge.target) { selfEdges += 1; issues.push({ code: "FORBIDDEN_SELF_EDGE", id: edge.id }); }
    if (stableNodeId && edge.id !== stableNodeId("edge", equivalent)) issues.push({ code: "NON_DETERMINISTIC_EDGE_ID", id: edge.id });
    if (edge.observationType === "inferred" && Number(edge.confidence) >= 1) issues.push({ code: "INFERRED_EDGE_CONFIDENCE_INVALID", id: edge.id });
    for (const evidenceId of edge.evidenceIds || []) if (!evidenceIds.has(evidenceId)) issues.push({ code: "UNKNOWN_EDGE_EVIDENCE", id: edge.id, evidenceId });
    const correlation = edge.correlation?.fingerprint;
    if (correlation && !/^hmac:[0-9a-f]{64}$/i.test(correlation)) issues.push({ code: "UNSCOPED_CORRELATION_FINGERPRINT", id: edge.id });
  }
  const exposedRoutes = new Set(edges.filter((edge) => edge.type === "EXPOSES").map((edge) => edge.target));
  const orphanRoutes = nodes.filter((node) => node.type === "Route" && !exposedRoutes.has(node.id));
  orphanRoutes.forEach((node) => issues.push({ code: "ORPHAN_ROUTE", id: node.id }));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  }
  let components = 0;
  const visited = new Set();
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    components += 1;
    const pending = [node.id];
    while (pending.length) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      adjacency.get(current)?.forEach((neighbor) => { if (!visited.has(neighbor)) pending.push(neighbor); });
    }
  }
  const isolatedNodes = nodes.filter((node) => (adjacency.get(node.id)?.size || 0) === 0);
  const serialized = JSON.stringify({ nodes, edges });
  let leakedSecrets = 0;
  for (const secret of secretValues) {
    if (secret && String(secret).length >= 6 && serialized.includes(String(secret))) { leakedSecrets += 1; issues.push({ code: "RAW_SECRET_LEAK" }); }
  }
  return {
    verified: issues.length === 0,
    checkedNodes: nodes.length,
    checkedEdges: edges.length,
    issueCount: issues.length,
    issues: issues.slice(0, 100),
    duplicateNodes,
    duplicateEdges,
    selfEdges,
    danglingEdges: danglingEdges.length,
    orphanRoutes: orphanRoutes.length,
    isolatedNodes: isolatedNodes.length,
    leakedSecrets,
    components,
    passes: ["stable-identity", "edge-uniqueness", "edge-endpoints", "host-route-ownership", "origin-confidence", "evidence-integrity", "secret-leak-scan", "reference-resolution", "component-analysis"],
  };
}

function decorateGraphForAgent(graph) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return graph;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const routeNodes = graph.nodes.filter((node) => node.type === "Route");
  const edges = graph.edges;
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    outgoing.get(edge.source)?.push(edge);
    incoming.get(edge.target)?.push(edge);
  }

  for (const route of routeNodes) {
    const incomingNavigation = (incoming.get(route.id) || []).filter((edge) => edge.type !== "EXPOSES").length;
    const auth = route.authTypes?.filter(Boolean) || [];
    const authText = auth.length ? `Authentication observed: ${auth.join(", ")}.` : "No authenticated traffic observed.";
    const entryText = route.entryPointReasons?.length ? "Marked as an entry point." : "Not marked as an observed entry point.";
    const priorityText = route.riskTags?.length ? `Investigation signals: ${route.riskTags.join(", ")}.` : "No investigation signals recorded.";
    const factorText = route.priorityFactors?.length ? `Priority ${route.priorityScore || 0}/100 (${route.priorityTier || "low"}) from ${route.priorityFactors.map((factor) => factor.label).join("; ")}.` : "Priority is low because no scored signals were observed.";
    route.aiSummary = `${route.method} ${route.host}${route.template} observed ${route.observedCount || 0} time(s). ${authText} ${entryText} ${priorityText} ${factorText} Incoming navigational relationships: ${incomingNavigation}.`;
  }
  for (const state of graph.nodes.filter((node) => node.type === "ApplicationState")) {
    state.aiSummary = `${state.label} is a ${state.observationType || "derived"} ${state.stateKind || "application"} state at ${Math.round((Number(state.confidence) || 0) * 100)}% confidence, supported by ${state.evidenceRefs?.length || 0} traffic reference(s) and connected to ${state.actionIds?.length || 0} action(s).`;
  }
  for (const action of graph.nodes.filter((node) => node.type === "Action")) {
    action.aiSummary = `${action.label} maps to ${action.method || "HTTP"} ${action.host || ""}${action.template || ""}. Observed ${action.observedCount || 0} time(s): ${action.successfulCount || 0} success-class and ${action.rejectedCount || 0} rejected/error outcome(s). It requires ${action.preconditionStateIds?.length || 0} observed state(s) and produces ${action.resultingStateIds?.length || 0} derived state(s).`;
  }

  const centrality = {};
  const calculateReach = (startId) => {
    const visited = new Set([startId]);
    const queue = [startId];
    while (queue.length && visited.size <= 500) {
      const current = queue.shift();
      for (const edge of outgoing.get(current) || []) {
        if ((Number(edge.confidence) || 0) < 0.4 || visited.has(edge.target)) continue;
        visited.add(edge.target); queue.push(edge.target);
      }
    }
    return Math.max(0, visited.size - 1);
  };
  for (const node of graph.nodes) {
    const degree = (outgoing.get(node.id)?.length || 0) + (incoming.get(node.id)?.length || 0);
    centrality[node.id] = { degree, downstreamReach: calculateReach(node.id), blastRadius: Math.min(100, degree * 4 + calculateReach(node.id) * 2) };
  }

  const communityGroups = new Map();
  for (const node of graph.nodes) {
    let key = node.host ? `host:${node.host}` : "";
    if (!key) {
      const neighbor = [...(incoming.get(node.id) || []), ...(outgoing.get(node.id) || [])]
        .map((edge) => nodeById.get(edge.source === node.id ? edge.target : edge.source))
        .find((item) => item?.host);
      key = neighbor?.host ? `host:${neighbor.host}` : `${node.type || "node"}:${node.label || node.id}`;
    }
    if (!communityGroups.has(key)) communityGroups.set(key, []);
    communityGroups.get(key).push(node);
  }
  const communities = [...communityGroups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, members], index) => {
    const ranked = members.slice().sort((left, right) => (centrality[right.id]?.degree || 0) - (centrality[left.id]?.degree || 0) || left.id.localeCompare(right.id));
    const label = key.startsWith("host:") ? key.slice(5) : ranked[0]?.label || key;
    members.forEach((node) => { node.communityIndex = index; node.communityLabel = label; });
    return { id: `community:${index + 1}`, index, label, nodeCount: members.length, representativeNodeId: ranked[0]?.id || "", nodeTypes: [...new Set(members.map((node) => node.type))].sort() };
  });

  const hypotheses = [];
  const seenHypotheses = new Set();
  for (const edge of edges.filter((item) => item.type === "SHARES_OBJECT")) {
    const left = nodeById.get(edge.source); const right = nodeById.get(edge.target);
    if (!left || !right || left.type !== "Route" || right.type !== "Route") continue;
    const leftAuth = (left.authTypes || []).some((value) => value && value !== "none");
    const rightAuth = (right.authTypes || []).some((value) => value && value !== "none");
    if (leftAuth === rightAuth) continue;
    const authenticated = leftAuth ? left : right;
    const other = leftAuth ? right : left;
    const key = `${authenticated.id}|${other.id}`;
    if (seenHypotheses.has(key)) continue;
    seenHypotheses.add(key);
    const identifier = (authenticated.parameters || other.parameters || []).find((item) => item.category === "id" || /(?:^|_)id$/i.test(item.name));
    hypotheses.push({
      id: `hypothesis:idor:${key.replace(/[^a-zA-Z0-9:_-]/g, "_")}`,
      hypothesis: "possible_idor",
      routes: [other.id, authenticated.id],
      basis: `Shared object correlation${edge.correlation?.namespace ? ` in ${edge.correlation.namespace}` : ""}; asymmetric authentication evidence.`,
      confidence: Math.min(0.9, Math.max(0.35, (Number(edge.confidence) || 0) * 0.75)),
      status: "untested",
      suggestedTest: `Request ${authenticated.method} ${authenticated.template} using an object identifier from a different authorized context${identifier ? ` (${identifier.name})` : ""}. Compare authorization and response ownership behavior.`,
      evidenceIds: edge.evidenceIds?.slice(0, 8) || [],
      provenance: "inferred",
    });
  }
  graph.hypotheses = hypotheses.slice(0, 100);
  graph.analysis = {
    entryPoints: routeNodes.filter((node) => (node.entryPointReasons || []).length).map((node) => node.id),
    centrality,
    queryCapabilities: ["overview", "node", "neighbors", "paths", "search", "workflow", "state_model", "identity_diff", "variants", "anomalies", "shared_objects", "evidence", "hypotheses", "annotate_finding"],
  };
  graph.communities = communities;
  graph.agentInterface = { version: "1.0", summary: "Query this graph through bounded Map tools; do not load the entire graph for a single hypothesis." };
  return graph;
}

function createAssessmentMap({ fs, path, crypto, assessmentWorkspace, projectProfileProvider = null, intelligence = null, javascriptArtifacts = null, webArtifacts = null, graphStore = null, now = () => new Date(), domainExtractor } = {}) {
  if (!crypto?.createHash || !crypto?.createHmac || !crypto?.randomBytes) throw new TypeError("crypto hashing, HMAC, and random bytes are required");
  const registrableDomain = typeof domainExtractor === "function" ? domainExtractor : defaultDomainExtractor();
  const hash = (value, length = 20) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
  const nodeId = (type, key) => `${type}:${hash(`${type}|${key}`)}`;
  const snapshots = graphStore || createTrafficGraphStore({ fs, path, crypto, now });
  const mapRelativePath = GRAPH_MANIFEST;

  function attachIntelligenceProjection(graph, root) {
    if (!graph || !intelligence?.status) return graph;
    try {
      const status = intelligence.status(root);
      graph.intelligence = {
        status: status.status || "unknown",
        overview: status.overview || null,
        estimate: status.estimate || null,
      };
    } catch {
      graph.intelligence = { status: "unavailable", overview: null };
    }
    return graph;
  }

  function projectCorrelationKey(root) {
    const target = path.join(root, "traffic", "graph", "cache", ".correlation-key");
    const legacyTarget = path.join(root, "Map", ".correlation-key");
    try {
      if (fs.existsSync(target)) {
        const value = fs.readFileSync(target, "utf8").trim();
        if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
        throw new Error("Map correlation key is malformed");
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (fs.existsSync(legacyTarget)) {
        const legacyValue = fs.readFileSync(legacyTarget, "utf8").trim();
        if (!/^[0-9a-f]{64}$/i.test(legacyValue)) throw new Error("Legacy Map correlation key is malformed");
        try { fs.writeFileSync(target, `${legacyValue}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
        return Buffer.from(legacyValue, "hex");
      }
      const value = crypto.randomBytes(32).toString("hex");
      try { fs.writeFileSync(target, `${value}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        return projectCorrelationKey(root);
      }
      return Buffer.from(value, "hex");
    } catch (error) {
      throw new Error(`Could not initialize the project correlation key: ${error.message}`);
    }
  }

  function verifiedRoot(rawRoot, _options = {}) {
    const verification = assessmentWorkspace.verify(rawRoot);
    if (verification.error) return verification;
    return { ok: true, root: verification.root, notice: verification.valid ? null : verification };
  }

  function read(rawRoot, options = {}) {
    const verified = verifiedRoot(rawRoot, options);
    if (verified.error) return verified;
    try {
      const stored = snapshots.read(verified.root);
      if (stored.error || !stored.exists) return stored;
      const graph = stored.graph;
      graph.annotations = readAgentAnnotations(verified.root);
      decorateGraphForAgent(graph);
      attachIntelligenceProjection(graph, verified.root);
      return { ...stored, ok: true, exists: true, graph };
    } catch (error) {
      return { error: `Could not read the application Map: ${error.message}`, code: "MAP_READ_FAILED" };
    }
  }

  function mapScope(root) {
    let profile = null;
    try { profile = typeof projectProfileProvider === "function" ? projectProfileProvider(root) : null; } catch { profile = null; }
    return {
      inScope: { targets: profile?.scope?.inScopeTargets || [], wildcardRules: profile?.scope?.wildcardRules || [] },
      outOfScope: { assets: profile?.scope?.outOfScopeTargets || [] },
    };
  }

  function readAgentAnnotations(root) {
    try {
      const target = path.join(root, "Map", "agent-annotations.json");
      const value = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : [];
      return Array.isArray(value) ? value.slice(0, 500) : [];
    } catch { return []; }
  }

  function hostMatches(host, rawPattern) {
    const pattern = String(rawPattern || "").toLowerCase().trim().replace(/^https?:\/\//, "").split("/")[0].replace(/:\d+$/, "");
    const candidate = String(host || "").toLowerCase().replace(/:\d+$/, "");
    if (!pattern || !candidate) return false;
    if (pattern.startsWith("*.")) return candidate.endsWith(pattern.slice(1)) && candidate !== pattern.slice(2);
    return candidate === pattern;
  }

  function scopeStatus(root, host) {
    const { inScope, outOfScope } = mapScope(root);
    const inAssets = Array.isArray(inScope.targets) ? inScope.targets : [];
    const outAssets = Array.isArray(outOfScope.assets) ? outOfScope.assets : [];
    const wildcards = Array.isArray(inScope.wildcardRules) ? inScope.wildcardRules : [];
    const outMatch = outAssets.some((asset) => hostMatches(host, asset?.value || asset?.host || asset));
    if (outMatch) return { status: "out-of-scope", reason: "Matched Project Settings exclusions" };
    const inMatch = inAssets.some((asset) => hostMatches(host, asset?.value || asset?.host || asset))
      || wildcards.some((rule) => hostMatches(host, rule?.pattern || rule?.value || rule));
    if (inMatch) return { status: "in-scope", reason: "Matched Project Settings scope" };
    if (!inAssets.length && !wildcards.length) return { status: "unknown", reason: "No in-scope targets are configured" };
    return { status: "out-of-scope", reason: "No matching in-scope target" };
  }

  function loadQueryableGraph(rawRoot) {
    const result = read(rawRoot);
    if (result.error || !result.graph) return result.error ? result : { error: "No application Map exists. Build it from Traffic/Raw first.", code: "MAP_NOT_BUILT" };
    result.graph.annotations = readAgentAnnotations(verifiedRoot(rawRoot).root);
    decorateGraphForAgent(result.graph);
    return { ok: true, root: verifiedRoot(rawRoot).root, graph: result.graph };
  }

  function mapOverview(rawRoot) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const { graph, root } = loaded;
    const highPriority = graph.nodes.filter((node) => Number(node.priorityScore ?? node.riskScore) >= PRIORITY_HIGH_THRESHOLD).map((node) => node.id);
    return { ok: true, overview: { hosts: graph.stats?.hosts ?? graph.nodes.filter((node) => node.type === "Host").length, routes: graph.stats?.routes ?? graph.nodes.filter((node) => node.type === "Route").length, observations: graph.stats?.observations || 0, variants: graph.stats?.variants || 0, states: graph.stats?.states || 0, actions: graph.stats?.actions || 0, workflows: graph.stats?.stateWorkflows || 0, stateAnomalies: graph.stats?.stateAnomalies || 0, highPriority: highPriority.length, highPriorityNodes: highPriority, highRisk: highPriority.length, highRiskNodes: highPriority, components: graph.verification?.components || graph.analysis?.components || 0, builtAt: graph.builtAt, verification: graph.verification }, analysis: graph.analysis, graphMeta: { schemaVersion: graph.schemaVersion, builderVersion: graph.builderVersion }, root };
  }

  function mapGetNode(rawRoot, id) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const node = loaded.graph.nodes.find((item) => item.id === String(id || ""));
    if (!node) return { error: `Map node not found: ${id || "missing id"}`, code: "MAP_NODE_NOT_FOUND" };
    return { ok: true, node: { ...node, centrality: loaded.graph.analysis?.centrality?.[node.id] || null }, scope: scopeStatus(loaded.root, node.host || node.label) };
  }

  function mapNeighbors(rawRoot, id, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const nodeId = String(id || "");
    if (!loaded.graph.nodes.some((node) => node.id === nodeId)) return { error: `Map node not found: ${nodeId || "missing id"}`, code: "MAP_NODE_NOT_FOUND" };
    const minConfidence = Number.isFinite(Number(options.minConfidence)) ? Math.max(0, Math.min(1, Number(options.minConfidence))) : 0;
    const edgeTypes = Array.isArray(options.edgeTypes) && options.edgeTypes.length ? new Set(options.edgeTypes.map(String)) : null;
    const edges = loaded.graph.edges.filter((edge) => (edge.source === nodeId || edge.target === nodeId) && (!edgeTypes || edgeTypes.has(edge.type)) && Number(edge.confidence || 0) >= minConfidence).slice(0, 100);
    const nodeById = new Map(loaded.graph.nodes.map((node) => [node.id, node]));
    const neighbors = edges.map((edge) => nodeById.get(edge.source === nodeId ? edge.target : edge.source)).filter(Boolean).map((node) => ({ ...node, scope: scopeStatus(loaded.root, node.host || node.label) }));
    return { ok: true, nodeId, edges, neighbors, warnings: neighbors.filter((node) => node.scope.status === "out-of-scope").map((node) => `${node.id} is out of scope`) };
  }

  function mapFindPaths(rawRoot, from, to, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const start = String(from || ""); const goal = String(to || "");
    const maxHops = Math.max(1, Math.min(8, Math.round(Number(options.maxHops) || 5)));
    const minConfidence = Number.isFinite(Number(options.minConfidence)) ? Math.max(0, Math.min(1, Number(options.minConfidence))) : 0;
    const nodeById = new Map(loaded.graph.nodes.map((node) => [node.id, node]));
    if (!nodeById.has(start) || !nodeById.has(goal)) return { error: "Both from and to must be valid Map node IDs", code: "MAP_NODE_NOT_FOUND" };
    const outgoing = new Map(loaded.graph.nodes.map((node) => [node.id, []]));
    loaded.graph.edges.filter((edge) => Number(edge.confidence || 0) >= minConfidence).forEach((edge) => outgoing.get(edge.source)?.push(edge));
    const paths = []; const queue = [[start, []]];
    while (queue.length && paths.length < 50) {
      const [current, pathEdges] = queue.shift();
      if (current === goal && pathEdges.length) { paths.push({ nodeIds: [start, ...pathEdges.map((edge) => edge.target)], edges: pathEdges }); continue; }
      if (pathEdges.length >= maxHops) continue;
      for (const edge of outgoing.get(current) || []) {
        if (pathEdges.some((item) => item.target === edge.target)) continue;
        queue.push([edge.target, [...pathEdges, edge]]);
      }
    }
    return { ok: true, from: start, to: goal, maxHops, paths, warnings: paths.flatMap((item) => item.nodeIds).map((id) => nodeById.get(id)).filter((node) => scopeStatus(loaded.root, node?.host || node?.label).status === "out-of-scope").map((node) => `${node.id} is out of scope`).filter((value, index, all) => all.indexOf(value) === index) };
  }

  function mapSearchRoutes(rawRoot, pattern, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const needle = String(pattern || "").toLowerCase();
    const tags = Array.isArray(options.tags) ? options.tags.map((tag) => String(tag).toLowerCase()) : [];
    const routes = loaded.graph.nodes.filter((node) => node.type === "Route" && (!needle || [node.id, node.label, node.host, node.template, node.method, node.aiSummary].some((value) => String(value || "").toLowerCase().includes(needle))) && tags.every((tag) => (node.riskTags || []).map(String).map((value) => value.toLowerCase()).includes(tag))).slice(0, 100);
    return { ok: true, query: pattern || "", routes: routes.map((node) => ({ ...node, scope: scopeStatus(loaded.root, node.host) })) };
  }

  function mapSearchNodes(rawRoot, pattern, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const needle = String(pattern || "").trim().toLowerCase();
    const types = new Set((Array.isArray(options.types) ? options.types : []).map((value) => String(value).toLowerCase()));
    const limit = Math.max(1, Math.min(Number(options.limit) || 30, 100));
    const nodes = loaded.graph.nodes.filter((node) => (!types.size || types.has(String(node.type).toLowerCase())) && (!needle || [node.label, node.type, node.host, node.template, node.method, node.aiSummary, node.communityLabel, ...(node.riskTags || [])].some((value) => String(value || "").toLowerCase().includes(needle)))).slice(0, limit);
    return { ok: true, query: pattern || "", nodes, count: nodes.length };
  }

  function mapWorkflow(rawRoot, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const limit = Math.max(1, Math.min(Number(options.limit) || 30, 100));
    const nodeById = new Map(loaded.graph.nodes.map((node) => [node.id, node]));
    const transitions = loaded.graph.edges.filter((edge) => edge.type === "FOLLOWED_BY").sort((left, right) => (right.transitionCount || right.supportCount || 0) - (left.transitionCount || left.supportCount || 0) || left.id.localeCompare(right.id)).slice(0, limit).map((edge) => ({ edge, from: nodeById.get(edge.source), to: nodeById.get(edge.target) }));
    return { ok: true, transitions, entryPoints: (loaded.graph.analysis?.entryPoints || []).map((id) => nodeById.get(id)).filter(Boolean).slice(0, limit) };
  }

  function mapStateModel(rawRoot, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const limit = Math.max(1, Math.min(Number(options.limit) || 30, 100));
    const model = loaded.graph.stateModel || { states: [], actions: [], entities: [], identities: [], transitions: [], workflows: [], anomalies: [] };
    const confidence = Number.isFinite(Number(options.minConfidence)) ? Math.max(0, Math.min(1, Number(options.minConfidence))) : 0;
    const bounded = (items = []) => items.filter((item) => Number(item.confidence ?? 1) >= confidence).slice(0, limit);
    return {
      ok: true,
      version: model.version || 1,
      derivation: model.derivation || "deterministic-traffic-projection",
      summary: {
        states: model.states?.length || 0, actions: model.actions?.length || 0, entities: model.entities?.length || 0,
        identities: model.identities?.length || 0, transitions: model.transitions?.length || 0,
        workflows: model.workflows?.length || 0, anomalies: model.anomalies?.length || 0,
      },
      states: bounded(model.states), actions: bounded(model.actions), entities: bounded(model.entities), identities: bounded(model.identities),
      transitions: bounded(model.transitions), workflows: bounded(model.workflows), anomalies: bounded(model.anomalies),
      pagination: { limit, truncated: ["states", "actions", "entities", "identities", "transitions", "workflows", "anomalies"].some((key) => (model[key]?.length || 0) > limit) },
    };
  }

  function mapVariants(rawRoot, id, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const limit = Math.max(1, Math.min(Number(options.limit) || 30, 100));
    const routes = loaded.graph.nodes.filter((node) => node.type === "Route" && (!id || node.id === id || node.template === id));
    return { ok: true, routes: routes.slice(0, limit).map((route) => ({ route: { id: route.id, label: route.label, host: route.host, template: route.template, method: route.method }, variants: (route.variants || []).slice(0, limit) })) };
  }

  function mapIdentityDiff(rawRoot, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const limit = Math.max(1, Math.min(Number(options.limit) || 30, 100));
    const differences = [];
    for (const route of loaded.graph.nodes.filter((node) => node.type === "Route" && (node.variants || []).length > 1)) {
      const identities = new Set(route.variants.flatMap((variant) => variant.identityIds || []).filter(Boolean));
      const roles = new Set(route.variants.map((variant) => variant.actorRole).filter((value) => value && value !== "unknown"));
      const statuses = new Set(route.variants.map((variant) => variant.statusCode).filter(Number.isFinite));
      const schemas = new Set(route.variants.map((variant) => variant.responseSchemaHash).filter(Boolean));
      if (identities.size < 2 && roles.size < 2 && !(statuses.size > 1 || schemas.size > 1)) continue;
      differences.push({ route: { id: route.id, label: route.label, host: route.host, template: route.template, method: route.method }, identityIds: [...identities].sort(), roles: [...roles].sort(), statusCodes: [...statuses].sort(), responseSchemaCount: schemas.size, variantCount: route.variants.length, riskScore: route.riskScore });
    }
    differences.sort((left, right) => right.riskScore - left.riskScore || right.variantCount - left.variantCount || left.route.id.localeCompare(right.route.id));
    return { ok: true, differences: differences.slice(0, limit), count: differences.length };
  }

  function mapAnomalies(rawRoot, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const limit = Math.max(1, Math.min(Number(options.limit) || 30, 100));
    const anomalies = loaded.graph.nodes.filter((node) => node.type === "Route").map((route) => {
      const reasons = [];
      if ((route.variants || []).length > 1) reasons.push("response_variants");
      if ((route.statusCodes || []).some((status) => status >= 500)) reasons.push("server_error");
      if ((route.riskTags || []).includes("object_identifier") && (route.authTypes || []).includes("none")) reasons.push("anonymous_object_reference");
      if ((route.variants || []).some((variant) => (variant.identityIds || []).length) && new Set((route.variants || []).flatMap((variant) => variant.identityIds || [])).size > 1) reasons.push("multi_identity_behavior");
      return reasons.length ? { route: { id: route.id, label: route.label, host: route.host, template: route.template, method: route.method }, reasons, riskScore: route.riskScore, statusCodes: route.statusCodes, variantCount: route.variants?.length || 0 } : null;
    }).filter(Boolean).sort((left, right) => right.riskScore - left.riskScore || right.variantCount - left.variantCount || left.route.id.localeCompare(right.route.id));
    return { ok: true, anomalies: anomalies.slice(0, limit), count: anomalies.length };
  }

  function mapSharedObjects(rawRoot, id) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const edges = loaded.graph.edges.filter((edge) => edge.type === "SHARES_OBJECT" && (!id || edge.source === id || edge.target === id));
    return { ok: true, objects: edges.map((edge) => ({ edgeId: edge.id, source: edge.source, target: edge.target, correlation: edge.correlation, confidence: edge.confidence, evidenceIds: edge.evidenceIds })) };
  }

  function redactEvidence(raw) {
    return String(raw || "");
  }

  function mapEvidence(rawRoot, evidenceId, options = {}) {
    const verified = verifiedRoot(rawRoot); if (verified.error) return verified;
    const history = assessmentWorkspace.readTrafficHistory(verified.root, { limit: 50000 });
    const ids = new Set((Array.isArray(evidenceId) ? evidenceId : [evidenceId]).filter(Boolean).map(String).slice(0, 10));
    const maxChars = Math.max(1000, Math.min(Number(options.maxChars) || 100_000, 250_000));
    const records = (history.records || []).filter((record) => ids.has(String(record.requestId))).map((record) => ({ ...record, request: redactEvidence(record.request).slice(0, maxChars), response: redactEvidence(record.response).slice(0, maxChars), redacted: false }));
    return { ok: true, evidence: records, missing: [...ids].filter((id) => !records.some((record) => String(record.requestId) === id)) };
  }

  function mapHypotheses(rawRoot, options = {}) {
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const status = options.status ? String(options.status) : "";
    const annotations = Array.isArray(loaded.graph.annotations) ? loaded.graph.annotations : [];
    const annotated = (loaded.graph.hypotheses || []).map((item) => {
      const match = annotations.find((annotation) => annotation.hypothesis === item.hypothesis && (annotation.routes || []).some((id) => (item.routes || []).includes(id)));
      return match ? { ...item, status: match.status, result: match.result, annotationId: match.id, provenance: match.source } : item;
    });
    const extra = annotations.filter((annotation) => !annotated.some((item) => item.annotationId === annotation.id)).map((annotation) => ({ ...annotation, provenance: annotation.source }));
    return { ok: true, hypotheses: [...annotated, ...extra].filter((item) => !status || item.status === status).slice(0, 100) };
  }

  function mapAnnotateFinding(rawRoot, input = {}) {
    const verified = verifiedRoot(rawRoot); if (verified.error) return verified;
    const loaded = loadQueryableGraph(rawRoot); if (loaded.error) return loaded;
    const routeIds = Array.isArray(input.routes) ? input.routes.map(String) : [];
    const routes = routeIds.map((id) => loaded.graph.nodes.find((node) => node.id === id)).filter(Boolean);
    const outOfScope = routes.filter((node) => scopeStatus(verified.root, node.host).status === "out-of-scope");
    if (outOfScope.length) return { error: "Annotation refused because one or more routes are out of scope", code: "OUT_OF_SCOPE", routes: outOfScope.map((node) => node.id) };
    if (!input.hypothesis && !input.title) return { error: "Annotation requires a hypothesis or title", code: "MISSING_FINDING" };
    const target = path.join(verified.root, "Map", "agent-annotations.json");
    let annotations = [];
    try { if (fs.existsSync(target)) annotations = JSON.parse(fs.readFileSync(target, "utf8")); } catch { annotations = []; }
    if (!Array.isArray(annotations)) annotations = [];
    const annotation = { id: String(input.id || `agent-finding:${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString("hex")}`), hypothesis: String(input.hypothesis || input.title), title: String(input.title || input.hypothesis), routes: routeIds, basis: String(input.basis || ""), result: String(input.result || ""), status: String(input.status || "untested"), evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.slice(0, 50).map(String) : [], source: "agent-asserted", createdAt: now().toISOString() };
    const next = [...annotations.filter((item) => item.id !== annotation.id), annotation];
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try { fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); fs.renameSync(temporary, target); } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); }
    return { ok: true, annotation, path: "Map/agent-annotations.json" };
  }

  function trafficRecords(root, limits) {
    const target = path.join(root, "traffic", "raw.jsonl");
    const result = { records: [], totalRecords: 0, invalidCount: 0, truncated: false, snapshotHash: `sha256:${hash("", 64)}`, bytesConsidered: 0 };
    try {
      const size = fs.statSync(target).size;
      if (!size) return result;
      const start = Math.max(0, size - limits.maxBytes);
      const buffer = Buffer.alloc(size - start);
      const descriptor = fs.openSync(target, "r");
      try { fs.readSync(descriptor, buffer, 0, buffer.length, start); } finally { fs.closeSync(descriptor); }
      let text = buffer.toString("utf8");
      if (start > 0) text = text.slice(Math.max(0, text.indexOf("\n") + 1));
      result.bytesConsidered = Buffer.byteLength(text, "utf8");
      result.snapshotHash = `sha256:${hash(text, 64)}`;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record?.recordType === "http-exchange") result.records.push(record);
        } catch { result.invalidCount += 1; }
      }
      result.totalRecords = result.records.length;
      if (result.records.length > limits.maxRecords) result.records = result.records.slice(-limits.maxRecords);
      result.truncated = start > 0 || result.totalRecords > limits.maxRecords;
      return result;
    } catch (error) {
      if (error.code === "ENOENT") return result;
      throw error;
    }
  }

  function parseObservation(record, index, fingerprint) {
    const request = parseRawMessage(record.request);
    const response = parseRawMessage(record.response);
    const requestParts = request.startLine.match(/^([A-Z]+)\s+(\S+)/i);
    const method = String(record.method || requestParts?.[1] || "GET").toUpperCase();
    let url;
    try {
      url = new URL(record.url || requestParts?.[2] || "/", `${request.headers["x-pointer-scheme"] || "https"}://${request.headers.host || "unknown.invalid"}`);
    } catch { return null; }
    const normalized = normalizeRoutePath(url.pathname);
    const queryParameters = [...new Set([...url.searchParams.keys()])].sort().map((name) => ({ name, location: "query", category: /(?:^id$|[_-]id$|uuid$|identifier$)/i.test(name) ? "id" : "value" }));
    const responseMeta = responseShape(response);
    const visibility = routeVisibility(url, method, responseMeta.contentType);
    const statusCode = Number(record.statusCode || response.startLine.match(/^HTTP\/\S+\s+(\d{3})/)?.[1]) || null;
    const evidenceId = String(record.requestId || `exchange:${hash(canonicalJson({ method, url: url.toString(), request: record.request, response: record.response }), 32)}`);
    const authType = request.headers.authorization ? request.headers.authorization.split(/\s+/)[0].toLowerCase() : request.headers.cookie ? "cookie" : "none";
    const secret = request.headers.authorization || request.headers.cookie || "";
    let jwtSubject = "";
    if (/^bearer\s+/i.test(request.headers.authorization || "")) {
      const token = String(request.headers.authorization).replace(/^bearer\s+/i, "");
      try { jwtSubject = String(JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"))?.sub || ""); } catch { /* opaque bearer token */ }
    }
    const captureIdentity = record.captureIdentity && typeof record.captureIdentity === "object"
      ? { id: String(record.captureIdentity.id || "").slice(0, 120), label: String(record.captureIdentity.label || "").slice(0, 160), role: String(record.captureIdentity.role || "").slice(0, 120) }
      : null;
    const credentialEpoch = secret ? `credential:${fingerprint("credential", secret)}` : "";
    const sessionId = captureIdentity?.id
      ? `identity:${fingerprint("capture-identity", captureIdentity.id)}`
      : jwtSubject
      ? `session:${fingerprint("jwt-subject", jwtSubject)}`
      : secret
        ? `session:${fingerprint("credential-session", secret)}`
        : `anonymous:${fingerprint("anonymous-exchange", evidenceId)}`;
    const sessionResolution = captureIdentity?.id ? "explicit-capture-identity" : jwtSubject ? "unverified-jwt-subject" : secret ? "credential-epoch" : "unresolved-anonymous";
    const sessionConfidence = captureIdentity?.id ? 0.98 : jwtSubject ? 0.74 : secret ? 0.78 : 0.15;
    const requestShape = {
      method,
      template: normalized.template,
      query: queryParameters.map((item) => `${item.name}:${item.category}`),
      contentType: String(request.headers["content-type"] || "").split(";")[0].toLowerCase(),
      authType,
    };
    const responseSchemaHash = hash(canonicalJson(responseMeta.schema));
    const variantKey = canonicalJson({ authType, statusCode, requestShape, responseSchemaHash });
    const observedAt = record.isoTimestamp || record.timestamp || "";
    const host = url.hostname.toLowerCase();
    const origin = url.origin.toLowerCase();
    const effectivePort = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    const routeKey = `${url.protocol.replace(":", "").toUpperCase()}|${host}|${effectivePort}|${method}|${normalized.template}`;
    const resourceName = routeResourceName(normalized.template);
    const rawObjectReferences = [];
    const addObjectReference = (raw, direction) => {
      const separator = String(raw).indexOf("|");
      if (separator <= 0) return;
      const namespace = String(raw).slice(0, separator).replace(/[^a-z0-9_]+/gi, "_").toLowerCase();
      const value = String(raw).slice(separator + 1).trim();
      if (!value || /^(?:true|false|null|undefined)$/i.test(value) || /^\d{10,13}$/.test(value)) return;
      if (/^(?:page|page_id|limit|offset|count|status|status_code)$/i.test(namespace)) return;
      const valueType = /^-?\d+(?:\.\d+)?$/.test(value) ? "number" : /^[0-9a-f-]{32,36}$/i.test(value) ? "uuid" : "string";
      rawObjectReferences.push({
        namespace,
        fingerprint: `hmac:${fingerprint("identifier", `${namespace}|${value}`)}`,
        valueType,
        direction,
        lowEntropy: valueType === "number" && Math.abs(Number(value)) <= 10,
      });
    };
    normalized.parameters.filter((item) => item.category === "id").forEach((item) => addObjectReference(`${item.name}|${item.observedValue}`, "target"));
    for (const [name, value] of url.searchParams) {
      if (/(?:^id$|[_-]id$|uuid$|identifier$)/i.test(name) && value.length <= 160) addObjectReference(`${name.toLowerCase() === "id" ? `${resourceName}_id` : name.toLowerCase()}|${value}`, "target");
    }
    const requestContentType = String(request.headers["content-type"] || "").split(";")[0].toLowerCase();
    bodyIdentifierValues(request.body, requestContentType, resourceName).forEach((value) => addObjectReference(value, "consumed"));
    bodyIdentifierValues(response.body, responseMeta.contentType, resourceName).forEach((value) => addObjectReference(value, "produced"));

    const references = [];
    const addReference = (reference, type, overrides = {}) => {
      if (!reference?.url) return;
      const candidate = { ...reference, ...overrides, type, key: `${type}|${reference.method}|${reference.url}` };
      if (!references.some((item) => item.key === candidate.key)) references.push(candidate);
    };
    extractBodyReferences(response.body, url, { contentType: responseMeta.contentType, location: "response.body" }).forEach((reference) => addReference(reference, "LINKS_TO"));
    extractBodyReferences(request.body, url, { contentType: requestContentType, location: "request.body" }).forEach((reference) => addReference(reference, "REFERENCES", { confidence: Math.min(reference.confidence, 0.72) }));
    const locationHeader = response.headers.location;
    if (locationHeader) {
      try {
        const target = new URL(locationHeader, url); target.hash = "";
        const redirectMethod = [307, 308].includes(statusCode) ? method : "GET";
        addReference({ url: target.toString(), method: redirectMethod, methodConfidence: 0.98, confidence: 1, observationType: "observed", provenance: { location: "response.headers", extractor: "http-header-parser", selector: "Location" } }, "REDIRECTS_TO");
      } catch { /* malformed Location header */ }
    }
    const linkHeader = response.headers.link || "";
    for (const match of linkHeader.matchAll(/<([^>]+)>/g)) {
      try {
        const target = new URL(match[1], url); target.hash = "";
        addReference({ url: target.toString(), method: "GET", methodConfidence: 0.8, confidence: 0.95, observationType: "observed", provenance: { location: "response.headers", extractor: "http-header-parser", selector: "Link" } }, "LINKS_TO");
      } catch { /* malformed Link header */ }
    }
    let referrerUrl = "";
    try { if (request.headers.referer || request.headers.referrer) referrerUrl = new URL(request.headers.referer || request.headers.referrer, url).toString(); } catch { /* malformed referrer */ }
    return {
      evidenceId,
      sourceIndex: index,
      source: "traffic/raw.jsonl",
      observedAt,
      method,
      url: url.toString(),
      host,
      authority: url.host.toLowerCase(),
      origin,
      port: effectivePort,
      scheme: url.protocol.replace(":", ""),
      path: url.pathname,
      template: normalized.template,
      routeKey,
      routeFingerprint: hash(routeKey, 64),
      parameters: [...normalized.parameters.map(({ observedValue, ...item }) => item), ...queryParameters],
      requestShape,
      requestShapeHash: hash(canonicalJson(requestShape), 64),
      responseSchema: responseMeta.schema,
      responseSchemaHash,
      sensitiveFields: responseMeta.sensitiveFields,
      title: responseMeta.title,
      statusCode,
      contentType: responseMeta.contentType,
      authType,
      authState: authType === "none" ? "anonymous" : "authenticated",
      authSignals: {
        setCookie: Boolean(response.headers["set-cookie"]),
        clearsCookie: /(?:max-age\s*=\s*0|expires\s*=\s*thu,?\s*0?1\s+jan\s+1970)/i.test(String(response.headers["set-cookie"] || "")),
        tokenShape: responseMeta.sensitiveFields.some((field) => /(?:^|\.)(?:access_?token|refresh_?token|id_?token|token)$/i.test(field)),
      },
      sessionId,
      sessionResolution,
      sessionConfidence,
      credentialEpoch,
      captureIdentity,
      variantKey,
      durationMs: Number(record.durationMs) || 0,
      tool: record.tool || record.source || "traffic",
      visibility: visibility.visibility,
      filterReason: visibility.reason,
      relevance: visibility.relevance,
      truncated: Boolean(record.truncated),
      references,
      referrerUrl,
      objectReferences: [...new Map(rawObjectReferences.map((item) => [`${item.namespace}|${item.fingerprint}|${item.direction}`, item])).values()],
    };
  }

  function build(rawRoot, options = {}) {
    const verified = verifiedRoot(rawRoot, options);
    if (verified.error) return verified;
    const limits = {
      maxBytes: Math.max(1024 * 1024, Math.min(Number(options.maxBytes) || DEFAULT_LIMITS.maxBytes, 250 * 1024 * 1024)),
      maxRecords: Math.max(1, Math.min(Number(options.maxRecords) || DEFAULT_LIMITS.maxRecords, 100000)),
    };
    try {
      const projectKey = projectCorrelationKey(verified.root);
      const fingerprint = (purpose, value) => crypto.createHmac("sha256", projectKey).update(`${purpose}|${String(value)}`).digest("hex");
      const projectNamespace = hash(path.resolve(verified.root).toLowerCase(), 32);
      const stableNodeId = (type, key) => nodeId(type, `${projectNamespace}|${key}`);
      const traffic = trafficRecords(verified.root, limits);
      const observations = traffic.records.map((record, index) => parseObservation(record, index, fingerprint)).filter(Boolean);
      const sourceIdCounts = new Map();
      traffic.records.forEach((record) => { if (record.requestId) sourceIdCounts.set(String(record.requestId), (sourceIdCounts.get(String(record.requestId)) || 0) + 1); });
      const duplicateSourceIds = [...sourceIdCounts].filter(([, count]) => count > 1).map(([id]) => id);
      const routeMap = new Map();
      const hostMap = new Map();
      const edgeMap = new Map();
      const auxiliaryNodes = [];
      let droppedReferenceRoutes = 0;
      let passiveSeededAssets = 0;

      const addEdge = (source, target, type, confidence, evidenceId = "", details = {}) => {
        if (!source || !target || source === target) return;
        const key = `${source}|${type}|${target}`;
        let edge = edgeMap.get(key);
        if (!edge) {
          edge = {
            id: stableNodeId("edge", key), source, target, type,
            observationType: details.observationType || "observed",
            semantic: details.semantic !== false,
            confidence, observedCount: 0, supportCount: 0, distinctSessions: 0,
            evidenceIds: [], evidenceSample: [], provenanceSamples: [],
            _sessionIds: new Set(),
          };
          edgeMap.set(key, edge);
        }
        edge.observedCount += 1;
        edge.confidence = Math.max(edge.confidence, confidence);
        const originRank = { inferred: 0, discovered: 1, observed: 2 };
        if ((originRank[details.observationType] ?? 0) > (originRank[edge.observationType] ?? 0)) edge.observationType = details.observationType;
        if (evidenceId && !edge.evidenceIds.includes(evidenceId)) {
          if (edge.evidenceIds.length < 100) edge.evidenceIds.push(evidenceId);
          if (edge.evidenceSample.length < 12) edge.evidenceSample.push(evidenceId);
          edge.supportCount += 1;
        } else if (!evidenceId && edge.supportCount === 0) edge.supportCount = 1;
        if (details.sessionId) edge._sessionIds.add(details.sessionId);
        edge.distinctSessions = edge._sessionIds.size;
        if (details.trustBoundary) edge.trustBoundary = details.trustBoundary;
        if (details.correlation) edge.correlation = details.correlation;
        if (details.actionId) edge.actionId = details.actionId;
        if (details.workflowId) edge.workflowId = details.workflowId;
        if (details.outcome) edge.outcome = details.outcome;
        if (details.identityId) edge.identityId = details.identityId;
        if (details.provenance && edge.provenanceSamples.length < 12) {
          const sample = { trafficId: evidenceId || "", ...details.provenance };
          if (!edge.provenanceSamples.some((item) => canonicalJson(item) === canonicalJson(sample))) edge.provenanceSamples.push(sample);
        }
      };

      const ensureHost = (hostname, { observed = false, discoveredBy = "", evidenceId = "", confidence = 0.8 } = {}) => {
        const host = String(hostname || "").toLowerCase();
        if (!host) return null;
        if (!hostMap.has(host)) {
          hostMap.set(host, {
            id: stableNodeId("host", host), canonicalKey: host, type: "Host", label: host, host,
            observationType: "discovered", confidence, evidenceRefs: [],
            observed: false, discovered: true, discoveredBy: [], observedCount: 0, routeCount: 0, riskScore: 0, priorityScore: 0, priorityTier: "low", priorityFactors: [],
          });
        }
        const node = hostMap.get(host);
        if (observed) { node.observed = true; node.discovered = false; node.observationType = "observed"; node.confidence = 1; }
        else node.confidence = Math.max(node.confidence, Math.min(confidence, 0.99));
        if (discoveredBy && !node.discoveredBy.includes(discoveredBy)) node.discoveredBy.push(discoveredBy);
        if (evidenceId && !node.evidenceRefs.includes(evidenceId)) node.evidenceRefs.push(evidenceId);
        return node;
      };

      const ensureRoute = (urlValue, methodValue = "GET", { observed = false, discoveredBy = "", evidenceId = "", confidence = 0.75, methodConfidence = 0.5 } = {}) => {
        let url;
        try { url = urlValue instanceof URL ? urlValue : new URL(urlValue); } catch { return null; }
        if (!/^https?:$/.test(url.protocol)) return null;
        const method = String(methodValue || "GET").toUpperCase();
        const normalized = normalizeRoutePath(url.pathname);
        const host = url.hostname.toLowerCase();
        const origin = url.origin.toLowerCase();
        const scheme = url.protocol.replace(":", "").toUpperCase();
        const effectivePort = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
        const routeKey = `${scheme}|${host}|${effectivePort}|${method}|${normalized.template}`;
        const hostNode = ensureHost(host, { observed, discoveredBy, evidenceId, confidence });
        let route = routeMap.get(routeKey);
        if (!route) {
          if (!observed && routeMap.size >= 10000) { droppedReferenceRoutes += 1; return null; }
          const queryParameters = [...new Set([...url.searchParams.keys()])].sort().map((name) => ({
            name, location: "query", category: /(?:^id$|[_-]id$|uuid$|identifier$)/i.test(name) ? "id" : "value",
          }));
          const visibility = routeVisibility(url, method, "");
          route = {
            id: stableNodeId("route", routeKey), canonicalKey: routeKey, type: "Route", label: `${method} ${normalized.template}`,
            method, host, authority: url.host.toLowerCase(), origin, scheme: url.protocol.replace(":", ""),
            port: effectivePort,
            template: normalized.template, routeFingerprint: hash(routeKey, 64),
            observationType: "discovered", confidence: Math.min(confidence, 0.99), methodConfidence: Math.min(methodConfidence, 0.99), semantic: true,
            observed: false, discovered: true, discoveredBy: [], evidenceIds: [], evidenceRefs: [], observedCount: 0,
            firstSeen: "", lastSeen: "", statusCodes: [], contentTypes: [], authTypes: [],
            parameters: [...normalized.parameters.map(({ observedValue, ...item }) => item), ...queryParameters],
            sensitiveFields: [], riskTags: [], riskScore: 0, priorityScore: 0, priorityTier: "low", priorityFactors: [], relevance: visibility.relevance,
            visibility: visibility.visibility, filterReason: visibility.reason, variants: [], entryPointReasons: [],
          };
          routeMap.set(routeKey, route);
          hostNode.routeCount += 1;
        }
        if (observed) { route.observed = true; route.discovered = false; route.observationType = "observed"; route.confidence = 1; route.methodConfidence = 1; }
        else { route.confidence = Math.max(route.confidence, Math.min(confidence, 0.99)); route.methodConfidence = Math.max(route.methodConfidence, Math.min(methodConfidence, 0.99)); }
        if (discoveredBy && !route.discoveredBy.includes(discoveredBy)) route.discoveredBy.push(discoveredBy);
        if (evidenceId && route.evidenceIds.length < 100 && !route.evidenceIds.includes(evidenceId)) { route.evidenceIds.push(evidenceId); route.evidenceRefs.push(evidenceId); }
        return route;
      };
      const addEntryPoint = (route, type, observationType, confidence, evidenceId = "") => {
        if (!route) return;
        const existing = route.entryPointReasons.find((reason) => reason.type === type);
        if (existing) {
          existing.confidence = Math.max(existing.confidence, confidence);
          if (evidenceId && !existing.evidenceRefs.includes(evidenceId)) existing.evidenceRefs.push(evidenceId);
        } else route.entryPointReasons.push({ type, observationType, confidence, evidenceRefs: evidenceId ? [evidenceId] : [] });
      };
      const resolveReferencedRoute = (urlValue, methodValue = "GET", metadata = {}) => {
        let url;
        try { url = new URL(urlValue); } catch { return null; }
        const normalized = normalizeRoutePath(url.pathname);
        const origin = url.origin.toLowerCase();
        const preferredMethod = String(methodValue || "GET").toUpperCase();
        const candidates = [...routeMap.values()].filter((route) => route.origin === origin && route.template === normalized.template);
        const exact = candidates.find((route) => route.method === preferredMethod);
        if (exact) {
          if (metadata.discoveredBy && !exact.discoveredBy.includes(metadata.discoveredBy)) exact.discoveredBy.push(metadata.discoveredBy);
          if (metadata.evidenceId && exact.evidenceIds.length < 100 && !exact.evidenceIds.includes(metadata.evidenceId)) { exact.evidenceIds.push(metadata.evidenceId); exact.evidenceRefs.push(metadata.evidenceId); }
          if (!exact.observed) {
            exact.confidence = Math.max(exact.confidence, Math.min(Number(metadata.confidence) || 0.75, 0.99));
            exact.methodConfidence = Math.max(exact.methodConfidence, Math.min(Number(metadata.methodConfidence) || 0.5, 0.99));
          }
          return exact;
        }
        return ensureRoute(url, preferredMethod, metadata);
      };

      // Pass 1: materialize every directly observed host and route.
      for (const observation of observations) {
        const host = ensureHost(observation.host, { observed: true, discoveredBy: observation.source, evidenceId: observation.evidenceId, confidence: 1 });
        host.observedCount += 1;
        const route = ensureRoute(observation.url, observation.method, { observed: true, discoveredBy: observation.source, evidenceId: observation.evidenceId });
        if (!route) continue;
        if (route.method === "GET" && route.template === "/") addEntryPoint(route, "root-route", "observed", 0.95, observation.evidenceId);
        route.observedCount += 1;
        if (observation.observedAt && (!route.firstSeen || observation.observedAt < route.firstSeen)) route.firstSeen = observation.observedAt;
        if (observation.observedAt && observation.observedAt > route.lastSeen) route.lastSeen = observation.observedAt;
        route.statusCodes = [...new Set([...route.statusCodes, observation.statusCode].filter(Number.isFinite))].sort((a, b) => a - b);
        route.contentTypes = [...new Set([...route.contentTypes, observation.contentType].filter(Boolean))].sort();
        route.authTypes = [...new Set([...route.authTypes, observation.authType].filter(Boolean))].sort();
        route.sensitiveFields = [...new Set([...route.sensitiveFields, ...observation.sensitiveFields])].sort();
        for (const parameter of observation.parameters) {
          if (!route.parameters.some((item) => item.name === parameter.name && item.location === parameter.location)) route.parameters.push(parameter);
        }
        let variant = route.variants.find((item) => item.fingerprint === hash(observation.variantKey, 64));
        if (!variant) {
          variant = {
            id: stableNodeId("variant", `${observation.routeKey}|${observation.variantKey}`), fingerprint: hash(observation.variantKey, 64),
            observationType: "observed", confidence: 1,
            actorRole: observation.captureIdentity?.role || "unknown",
            actorRoles: observation.captureIdentity?.role ? [observation.captureIdentity.role] : [],
            identityIds: observation.captureIdentity?.id ? [observation.captureIdentity.id] : [],
            authenticationState: observation.authState, authType: observation.authType,
            requestShapeHash: observation.requestShapeHash, responseSchemaHash: observation.responseSchemaHash,
            responseSchema: observation.responseSchema, statusCode: observation.statusCode,
            sensitiveFields: observation.sensitiveFields, occurrenceCount: 0,
            representativeEvidenceId: observation.evidenceId, evidenceIds: [], evidenceRefs: [],
          };
          route.variants.push(variant);
        }
        variant.occurrenceCount += 1;
        if (observation.captureIdentity?.id && !variant.identityIds.includes(observation.captureIdentity.id)) variant.identityIds.push(observation.captureIdentity.id);
        if (observation.captureIdentity?.role && !variant.actorRoles.includes(observation.captureIdentity.role)) variant.actorRoles.push(observation.captureIdentity.role);
        if (variant.actorRole === "unknown" && observation.captureIdentity?.role) variant.actorRole = observation.captureIdentity.role;
        if (variant.evidenceIds.length < 100 && !variant.evidenceIds.includes(observation.evidenceId)) { variant.evidenceIds.push(observation.evidenceId); variant.evidenceRefs.push(observation.evidenceId); }
      }

      // Pass 2: resolve references only after every observed route is known.
      for (const observation of observations) {
        const current = routeMap.get(observation.routeKey);
        if (!current) continue;
        for (const reference of observation.references || []) {
          const target = resolveReferencedRoute(reference.url, reference.method, {
            discoveredBy: reference.provenance?.extractor || reference.type.toLowerCase(), evidenceId: observation.evidenceId,
            confidence: reference.confidence, methodConfidence: reference.methodConfidence,
          });
          if (!target) continue;
          if (!target.observed && registrableDomain(current.host) !== registrableDomain(target.host)) {
            target.visibility = "hidden";
            target.filterReason = "external_reference";
            target.relevance = "low";
          }
          const trustBoundary = current.origin === target.origin
            ? "same-origin"
            : current.host === target.host
              ? "same-host-cross-origin"
              : registrableDomain(current.host) === registrableDomain(target.host)
                ? "same-site-cross-host"
                : "external-third-party";
          addEdge(current.id, target.id, reference.type, reference.confidence, observation.evidenceId, {
            observationType: reference.observationType || "discovered", provenance: reference.provenance,
            sessionId: observation.sessionId, trustBoundary,
          });
          if (reference.type === "REDIRECTS_TO") {
            addEntryPoint(target, /(?:login|signin|auth)/i.test(current.template) ? "post-auth-redirect" : "redirect-destination", reference.observationType || "observed", reference.confidence, observation.evidenceId);
          }
          if (current.host !== target.host) {
            addEdge(ensureHost(current.host).id, ensureHost(target.host, { discoveredBy: reference.type.toLowerCase(), evidenceId: observation.evidenceId, confidence: reference.confidence }).id, "REFERENCES_HOST", reference.confidence, observation.evidenceId, {
              observationType: reference.observationType || "discovered", provenance: reference.provenance,
              sessionId: observation.sessionId, trustBoundary,
            });
          }
        }
        if (observation.referrerUrl) {
          const referrer = ensureRoute(observation.referrerUrl, "GET", { discoveredBy: "referer", evidenceId: observation.evidenceId, confidence: 0.98, methodConfidence: 0.9 });
          if (referrer) addEdge(referrer.id, current.id, "REFERRED_TO", 0.98, observation.evidenceId, {
            observationType: "observed", sessionId: observation.sessionId,
            provenance: { location: "request.headers", extractor: "http-header-parser", selector: "Referer" },
          });
          if (referrer && registrableDomain(referrer.host) !== registrableDomain(current.host)) addEntryPoint(current, "external-referrer", "observed", 0.98, observation.evidenceId);
        }
      }

      // Pass 3: shared identifiers can bridge routes discovered in otherwise separate exchanges.
      const routesByObject = new Map();
      for (const observation of observations) {
        const route = routeMap.get(observation.routeKey);
        if (!route) continue;
        for (const objectReference of observation.objectReferences || []) {
          const key = `${objectReference.namespace}|${objectReference.fingerprint}`;
          if (!routesByObject.has(key)) routesByObject.set(key, { reference: objectReference, routes: new Map() });
          const group = routesByObject.get(key);
          if (!group.routes.has(route.id)) group.routes.set(route.id, { evidenceIds: [], directions: new Set(), sessions: new Set() });
          const record = group.routes.get(route.id);
          if (record.evidenceIds.length < 20 && !record.evidenceIds.includes(observation.evidenceId)) record.evidenceIds.push(observation.evidenceId);
          record.directions.add(objectReference.direction);
          record.sessions.add(observation.sessionId);
        }
      }
      for (const group of routesByObject.values()) {
        const entries = [...group.routes.entries()];
        if (entries.length < 2 || entries.length > 25) continue;
        for (let left = 0; left < entries.length; left += 1) {
          for (let right = left + 1; right < entries.length; right += 1) {
            const [leftId, leftRecord] = entries[left]; const [rightId, rightRecord] = entries[right];
            const producedConsumed = (leftRecord.directions.has("produced") && [...rightRecord.directions].some((direction) => ["consumed", "target"].includes(direction)))
              || (rightRecord.directions.has("produced") && [...leftRecord.directions].some((direction) => ["consumed", "target"].includes(direction)));
            const sharedSession = [...leftRecord.sessions].some((sessionId) => rightRecord.sessions.has(sessionId) && !sessionId.startsWith("anonymous:"));
            if (group.reference.lowEntropy && !producedConsumed) continue;
            const confidence = Math.min(0.96, 0.62 + (producedConsumed ? 0.25 : 0) + (sharedSession ? 0.08 : 0));
            if (confidence < 0.6) continue;
            const [source, target] = leftId.localeCompare(rightId) <= 0 ? [leftId, rightId] : [rightId, leftId];
            const correlation = {
              namespace: group.reference.namespace,
              fingerprint: group.reference.fingerprint,
              valueType: group.reference.valueType,
              signals: [producedConsumed ? "producer-consumer" : "same-namespaced-value", sharedSession ? "shared-session" : ""].filter(Boolean),
            };
            const provenance = { location: "request-response-correlation", extractor: "object-correlator", selector: group.reference.namespace };
            addEdge(source, target, "SHARES_OBJECT", confidence, leftRecord.evidenceIds[0], { observationType: "inferred", provenance, correlation });
            rightRecord.evidenceIds.slice(0, 2).forEach((evidenceId) => addEdge(source, target, "SHARES_OBJECT", confidence, evidenceId, { observationType: "inferred", provenance, correlation }));
          }
        }
      }

      // Pass 4: aggregate request-level transitions after sorting each resolved logical session.
      const observationsBySession = new Map();
      for (const observation of observations) {
        if (observation.sessionId.startsWith("anonymous:")) continue;
        const sessionKey = `${registrableDomain(observation.host)}|${observation.sessionId}`;
        if (!observationsBySession.has(sessionKey)) observationsBySession.set(sessionKey, []);
        observationsBySession.get(sessionKey).push(observation);
      }
      for (const sessionObservations of observationsBySession.values()) {
        sessionObservations.sort((left, right) => {
          const leftTime = Date.parse(left.observedAt); const rightTime = Date.parse(right.observedAt);
          if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
          return left.sourceIndex - right.sourceIndex;
        });
        const firstRoute = routeMap.get(sessionObservations[0]?.routeKey);
        if (firstRoute) addEntryPoint(firstRoute, "first-in-session", "observed", sessionObservations[0].sessionConfidence, sessionObservations[0].evidenceId);
        for (let index = 1; index < sessionObservations.length; index += 1) {
          const previousObservation = sessionObservations[index - 1]; const observation = sessionObservations[index];
          const previous = routeMap.get(previousObservation.routeKey); const current = routeMap.get(observation.routeKey);
          if (!previous || !current || previous.id === current.id) continue;
          const previousTime = Date.parse(previousObservation.observedAt); const currentTime = Date.parse(observation.observedAt);
          const gapMs = Number.isFinite(previousTime) && Number.isFinite(currentTime) ? Math.max(0, currentTime - previousTime) : null;
          if (gapMs != null && gapMs > 15 * 60 * 1000) continue;
          const directEvidence = [...edgeMap.values()].some((edge) => edge.source === previous.id && edge.target === current.id && ["REDIRECTS_TO", "REFERRED_TO"].includes(edge.type));
          const confidence = Math.min(0.98, 0.42 + Math.min(previousObservation.sessionConfidence, observation.sessionConfidence) * 0.32 + (gapMs != null && gapMs <= 60_000 ? 0.1 : 0) + (directEvidence ? 0.14 : 0));
          addEdge(previous.id, current.id, "FOLLOWED_BY", confidence, observation.evidenceId, {
            observationType: "inferred", sessionId: observation.sessionId,
            provenance: { location: "traffic.timeline", extractor: "transition-aggregator", selector: gapMs == null ? "source-order" : `${gapMs}ms-gap` },
          });
        }
      }

      // Pass 5: preserve application topology across subdomains using Public Suffix List semantics.
      for (const host of [...hostMap.values()]) {
        const parentName = registrableDomain(host.host);
        if (!parentName || parentName === host.host) continue;
        const parent = ensureHost(parentName, { discoveredBy: "public-suffix-correlation", confidence: 0.99 });
        addEdge(host.id, parent.id, "SUBDOMAIN_OF", 0.99, host.evidenceRefs[0] || "", {
          observationType: "discovered", provenance: { location: "hostname", extractor: "public-suffix-list", selector: "registrable-domain" },
          trustBoundary: "same-site-cross-host",
        });
      }

      // Pass 6: tag entry points without inventing semantic ROOT_OF relationships.
      const incomingApplicationEdges = new Set([...edgeMap.values()]
        .filter((edge) => edge.semantic && ["LINKS_TO", "REDIRECTS_TO", "REFERRED_TO", "REFERENCES", "FOLLOWED_BY"].includes(edge.type))
        .map((edge) => edge.target));
      for (const route of routeMap.values()) {
        if (!incomingApplicationEdges.has(route.id)) addEntryPoint(route, "no-observed-incoming-navigation", "inferred", 0.45);
        if (/^\/(?:login|signin|app|dashboard|oauth\/callback|api|graphql|index\.html)(?:\/|$)/i.test(route.template)) addEntryPoint(route, "known-start-path", "inferred", 0.55);
      }

      // Supplement the Map from passive-recon even when Traffic/Raw exists so
      // passive discoveries are not dropped once live traffic is present. Each
      // asset yields a Host node (and a Route node when the value is a URL),
      // preserving per-asset discoveredBy provenance.
      const passiveRef = path.join(verified.root, "recon", "passive-recon.json");
      let passiveAssets = [];
      try {
        const passiveDoc = JSON.parse(fs.readFileSync(passiveRef, "utf8"));
        passiveAssets = Array.isArray(passiveDoc?.discoveredAssets) ? passiveDoc.discoveredAssets : [];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      let passiveSeeded = 0;
      for (const asset of passiveAssets) {
        const value = String(asset?.value || asset?.host || "").trim();
        if (!value) continue;
        const source = String(asset?.source || asset?.discoveredBy || "passive-recon").slice(0, 160);
        const routeNode = ensureRoute(value, "GET", { discoveredBy: source, confidence: 0.6, methodConfidence: 0.4 });
        if (!routeNode) {
          const hostNode = ensureHost(value, { discoveredBy: source, confidence: 0.6 });
          if (hostNode && !hostNode.discoveredBy.includes(source)) hostNode.discoveredBy.push(source);
        }
        passiveSeeded += 1;
      }
      passiveSeededAssets = passiveSeeded;

      // Pass 7: merge content-addressed JavaScript artifacts. Script bodies
      // remain in the artifact store; the graph receives only deterministic
      // metadata, endpoint hints, and source pointers.
      let javascriptManifest = { artifacts: [], contentHash: "" };
      try {
        if (javascriptArtifacts?.readManifest) javascriptManifest = javascriptArtifacts.readManifest(verified.root);
        else {
          const manifestTarget = path.join(verified.root, "traffic", "artifacts", "javascript", "manifest.json");
          if (fs.existsSync(manifestTarget)) javascriptManifest = JSON.parse(fs.readFileSync(manifestTarget, "utf8"));
        }
      } catch { javascriptManifest = { artifacts: [], contentHash: "", error: "unreadable" }; }
      const javascriptNodes = new Map();
      const javascriptByUrl = new Map();
      for (const artifact of Array.isArray(javascriptManifest.artifacts) ? javascriptManifest.artifacts : []) {
        if (!/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ""))) continue;
        const firstUrl = (artifact.urls || []).find((entry) => entry?.url)?.url || "";
        let label = `script ${artifact.sha256.slice(0, 12)}`;
        let scriptHost = "";
        try { const parsed = new URL(firstUrl); label = parsed.pathname.split("/").filter(Boolean).at(-1) || label; scriptHost = parsed.hostname.toLowerCase(); } catch { /* Keep hash label. */ }
        const scriptNode = {
          id: stableNodeId("javascript", artifact.sha256), canonicalKey: artifact.sha256,
          type: "JavaScript", label, host: scriptHost, observationType: "discovered", confidence: 1,
          contentHash: `sha256:${artifact.sha256}`, byteLength: Number(artifact.byteLength) || 0,
          urlCount: (artifact.urls || []).length, importCount: (artifact.imports || []).length,
          endpointCount: (artifact.endpoints || []).length, sourceMapCount: (artifact.sourceMaps || []).length,
          urls: (artifact.urls || []).map((entry) => ({ url: entry.url, source: entry.source, captureIdentity: entry.captureIdentity || null })).slice(0, 100),
          signals: artifact.signals || {}, sourceRef: artifact.objectPath || "",
        };
        const scriptFactors = [];
        if (Number(artifact.signals?.authorizationReferences)) scriptFactors.push(priorityFactor("authorization_references", "Authorization logic referenced", 10));
        if (Number(artifact.signals?.storageReferences)) scriptFactors.push(priorityFactor("storage_references", "Browser storage referenced", 8));
        if (Number(artifact.signals?.graphqlReferences)) scriptFactors.push(priorityFactor("graphql_references", "GraphQL capability referenced", 10));
        if (Number(artifact.sourceMaps?.length)) scriptFactors.push(priorityFactor("source_map_reference", "Source map reference discovered", 8));
        if (Number(artifact.endpoints?.length) >= 5) scriptFactors.push(priorityFactor("endpoint_concentration", "Multiple endpoint declarations discovered", 6));
        applyPriority(scriptNode, scriptFactors);
        scriptNode.riskTags = scriptFactors.map((factor) => factor.id);
        scriptNode.priorityEvidence = "discovered";
        javascriptNodes.set(artifact.sha256, scriptNode);
        auxiliaryNodes.push(scriptNode);
        for (const entry of artifact.urls || []) {
          if (!entry?.url) continue;
          javascriptByUrl.set(entry.url, scriptNode);
          const scriptRoute = ensureRoute(entry.url, "GET", { discoveredBy: entry.source || "javascript-artifact", confidence: 0.96, methodConfidence: 0.99 });
          if (scriptRoute) addEdge(scriptRoute.id, scriptNode.id, "SERVES_SCRIPT", 0.98, "", { observationType: "discovered", provenance: { location: "javascript.manifest", extractor: "content-addressed-artifact", selector: artifact.sha256 } });
        }
        for (const endpoint of artifact.endpoints || []) {
          const target = resolveReferencedRoute(endpoint.url, endpoint.method, { discoveredBy: endpoint.extractor || "javascript-analysis", confidence: Number(endpoint.confidence) || 0.7, methodConfidence: Number(endpoint.confidence) || 0.7 });
          if (target) addEdge(scriptNode.id, target.id, "DECLARES_ENDPOINT", Number(endpoint.confidence) || 0.7, "", { observationType: "discovered", provenance: { location: "javascript.source", extractor: endpoint.extractor || "javascript-analysis", selector: endpoint.method || "GET" } });
        }
        for (const sourceMapUrl of artifact.sourceMaps || []) {
          const sourceMapRoute = ensureRoute(sourceMapUrl, "GET", { discoveredBy: "source-map-reference", confidence: 0.9, methodConfidence: 0.99 });
          if (sourceMapRoute) addEdge(scriptNode.id, sourceMapRoute.id, "REFERENCES_SOURCE_MAP", 0.9, "", { observationType: "discovered", provenance: { location: "javascript.source", extractor: "sourceMappingURL", selector: sourceMapUrl } });
        }
      }
      for (const artifact of Array.isArray(javascriptManifest.artifacts) ? javascriptManifest.artifacts : []) {
        const sourceNode = javascriptNodes.get(artifact.sha256);
        if (!sourceNode) continue;
        for (const importedUrl of artifact.imports || []) {
          const importedNode = javascriptByUrl.get(importedUrl);
          if (importedNode) addEdge(sourceNode.id, importedNode.id, "IMPORTS_SCRIPT", 0.96, "", { observationType: "discovered", provenance: { location: "javascript.source", extractor: "static-import", selector: importedUrl } });
          else {
            const importRoute = ensureRoute(importedUrl, "GET", { discoveredBy: "javascript-import", confidence: 0.88, methodConfidence: 0.99 });
            if (importRoute) addEdge(sourceNode.id, importRoute.id, "IMPORTS_SCRIPT_RESOURCE", 0.88, "", { observationType: "discovered", provenance: { location: "javascript.source", extractor: "static-import", selector: importedUrl } });
          }
        }
      }

      // Pass 8: project the generic web-artifact manifest. JavaScript already
      // has a richer typed projection above, so it is skipped here to avoid
      // duplicate script nodes. HTML, CSS, source maps, manifests, JSON,
      // GraphQL, and YAML remain first-class, provenance-linked graph nodes.
      let webManifest = { artifacts: [], contentHash: "" };
      try {
        if (webArtifacts?.readManifest) webManifest = webArtifacts.readManifest(verified.root);
        else {
          const manifestTarget = path.join(verified.root, "traffic", "artifacts", "web", "manifest.json");
          if (fs.existsSync(manifestTarget)) webManifest = JSON.parse(fs.readFileSync(manifestTarget, "utf8"));
        }
      } catch { webManifest = { artifacts: [], contentHash: "", error: "unreadable" }; }
      const webNodes = new Map();
      for (const artifact of Array.isArray(webManifest.artifacts) ? webManifest.artifacts : []) {
        if (!/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || "")) || String(artifact.type || "").toLowerCase() === "javascript") continue;
        const firstUrl = (artifact.urls || []).find((entry) => entry?.url)?.url || "";
        let label = `${artifact.type || "web"} ${artifact.sha256.slice(0, 12)}`;
        let artifactHost = "";
        try {
          const parsed = new URL(firstUrl);
          label = parsed.pathname.split("/").filter(Boolean).at(-1) || label;
          artifactHost = parsed.hostname.toLowerCase();
        } catch { /* Keep hash-based label. */ }
        const node = {
          id: stableNodeId("web-artifact", artifact.sha256),
          canonicalKey: artifact.sha256,
          type: "WebArtifact",
          artifactType: String(artifact.type || "unknown").slice(0, 40),
          label,
          host: artifactHost,
          observationType: "discovered",
          confidence: 1,
          contentHash: `sha256:${artifact.sha256}`,
          byteLength: Number(artifact.byteLength) || 0,
          urlCount: (artifact.urls || []).length,
          referenceCount: (artifact.references || []).length,
          endpointCount: (artifact.endpoints || []).length,
          importCount: (artifact.imports || []).length,
          sourceMapCount: (artifact.sourceMaps || []).length,
          urls: (artifact.urls || []).map((entry) => ({ url: entry.url, source: entry.source, statusCode: entry.statusCode || null })).slice(0, 100),
          signals: artifact.signals || {},
          sourceRef: artifact.objectPath || "",
        };
        const factors = [];
        if (node.endpointCount) factors.push(priorityFactor("downloadable_endpoints", "Downloadable artifact declares endpoints", Math.min(16, node.endpointCount * 2)));
        if (node.referenceCount) factors.push(priorityFactor("artifact_references", "Artifact references additional resources", Math.min(10, node.referenceCount)));
        if (node.artifactType === "html") factors.push(priorityFactor("html_entrypoint", "HTML artifact may expose application entry points", 5));
        applyPriority(node, factors);
        node.riskTags = factors.map((factor) => factor.id);
        node.priorityEvidence = "discovered";
        webNodes.set(artifact.sha256, node);
        auxiliaryNodes.push(node);
        for (const entry of artifact.urls || []) {
          if (!entry?.url) continue;
          const artifactRoute = ensureRoute(entry.url, "GET", { discoveredBy: entry.source || "web-artifact", confidence: 0.94, methodConfidence: 0.98 });
          if (artifactRoute) addEdge(artifactRoute.id, node.id, "SERVES_ARTIFACT", 0.96, "", { observationType: "discovered", provenance: { location: "web.manifest", extractor: "content-addressed-artifact", selector: artifact.sha256 } });
        }
        for (const reference of [...(artifact.references || []), ...(artifact.endpoints || []).map((item) => item.url), ...(artifact.sourceMaps || [])]) {
          const target = resolveReferencedRoute(reference, "GET", { discoveredBy: "web-artifact-reference", confidence: 0.76, methodConfidence: 0.82 });
          if (target) addEdge(node.id, target.id, "REFERENCES_ARTIFACT", 0.76, "", { observationType: "discovered", provenance: { location: "web.artifact", extractor: "bounded-artifact-reference", selector: String(reference).slice(0, 240) } });
        }
      }

      for (const route of routeMap.values()) {
        calculateRoutePriority(route);
        const host = ensureHost(route.host);
        if (route.priorityScore > (host.priorityScore ?? host.riskScore ?? 0)) {
          applyPriority(host, [priorityFactor("highest_route_priority", `Highest route priority: ${route.label}`, route.priorityScore)]);
          host.priorityEvidence = route.priorityEvidence;
        }
        route.variants.sort((a, b) => b.occurrenceCount - a.occurrenceCount || String(a.id).localeCompare(String(b.id)));
      }

      for (const route of routeMap.values()) addEdge(hostMap.get(route.host).id, route.id, "EXPOSES", route.confidence, route.evidenceRefs[0] || "", {
        observationType: route.observationType, provenance: { location: "route.host", extractor: "host-route-materializer", selector: route.host },
      });

      // Typed projections make identity differences, parameters, response
      // variants, and business objects queryable without exposing raw values.
      const identityNodes = new Map();
      for (const observation of observations) {
        const identity = observation.captureIdentity;
        if (!identity?.id) continue;
        if (!identityNodes.has(identity.id)) {
          const node = {
            id: stableNodeId("identity", identity.id), canonicalKey: identity.id, type: "Identity",
            label: identity.label || identity.id, role: identity.role || "user",
            observationType: "derived", confidence: 0.98, observedCount: 0, riskScore: 0, priorityScore: 0, priorityTier: "low", priorityFactors: [],
          };
          identityNodes.set(identity.id, node); auxiliaryNodes.push(node);
        }
        const node = identityNodes.get(identity.id); node.observedCount += 1;
        const route = routeMap.get(observation.routeKey);
        if (route) addEdge(node.id, route.id, "ACCESSED_AS", 0.98, observation.evidenceId, { observationType: "observed", sessionId: observation.sessionId, provenance: { location: "traffic.captureIdentity", extractor: "proxy-capture-context", selector: identity.role || "identity" } });
      }

      for (const route of routeMap.values()) {
        for (const parameter of route.parameters || []) {
          const canonicalKey = `${route.canonicalKey}|${parameter.location}|${parameter.name}`;
          const parameterNode = {
            id: stableNodeId("parameter", canonicalKey), canonicalKey, type: "Parameter",
            label: `${parameter.location}:${parameter.name}`, name: parameter.name, location: parameter.location,
            category: parameter.category || "value", host: route.host, observationType: "derived", confidence: route.confidence,
            riskScore: 0,
          };
          applyPriority(parameterNode, parameter.category === "id"
            ? [priorityFactor("object_identifier", "Object identifier parameter", 20)]
            : []);
          parameterNode.riskTags = parameterNode.priorityFactors.map((factor) => factor.id);
          parameterNode.priorityEvidence = route.priorityEvidence;
          auxiliaryNodes.push(parameterNode);
          addEdge(route.id, parameterNode.id, "ACCEPTS_PARAMETER", route.confidence, route.evidenceRefs[0] || "", { observationType: route.observationType, provenance: { location: parameter.location, extractor: "parameter-normalizer", selector: parameter.name } });
        }
        for (const variant of route.variants || []) {
          const canonicalKey = `${route.canonicalKey}|${variant.fingerprint}`;
          const variantNode = {
            id: stableNodeId("responsevariant", canonicalKey), canonicalKey, type: "ResponseVariant",
            label: `${variant.statusCode || 0} · ${(variant.identityIds || []).length ? variant.identityIds.join(", ") : variant.authenticationState}`,
            host: route.host, statusCode: variant.statusCode, authenticationState: variant.authenticationState,
            actorRole: variant.actorRole, actorRoles: variant.actorRoles || [], identityIds: variant.identityIds || [],
            occurrenceCount: variant.occurrenceCount, responseSchemaHash: variant.responseSchemaHash,
            observationType: "derived", confidence: 1, riskScore: 0,
          };
          applyPriority(variantNode, variant.statusCode >= 500
            ? [priorityFactor("server_error_observed", "Server error response variant", 12)]
            : []);
          variantNode.riskTags = variantNode.priorityFactors.map((factor) => factor.id);
          variantNode.priorityEvidence = "observed";
          auxiliaryNodes.push(variantNode);
          addEdge(route.id, variantNode.id, "RETURNS_VARIANT", 1, variant.representativeEvidenceId || "", { observationType: "observed", provenance: { location: "traffic.response", extractor: "response-variant-cluster", selector: variant.responseSchemaHash } });
        }
      }

      for (const [key, group] of routesByObject.entries()) {
        if (!group.routes.size) continue;
        const canonicalKey = key;
        const objectNode = {
          id: stableNodeId("businessobject", canonicalKey), canonicalKey, type: "BusinessObject",
          label: group.reference.namespace, namespace: group.reference.namespace,
          valueType: group.reference.valueType, lowEntropy: Boolean(group.reference.lowEntropy),
          routeCount: group.routes.size, observationType: "derived", confidence: group.routes.size > 1 ? 0.9 : 0.72,
          riskScore: 0,
        };
        applyPriority(objectNode, group.routes.size > 1
          ? [priorityFactor("shared_business_object", "Business object appears across multiple routes", 24)]
          : [priorityFactor("business_object", "Business object reference observed", 8)]);
        objectNode.riskTags = objectNode.priorityFactors.map((factor) => factor.id);
        objectNode.priorityEvidence = "observed";
        auxiliaryNodes.push(objectNode);
        for (const [routeId, relation] of group.routes.entries()) {
          const types = relation.directions.has("produced") ? ["PRODUCES_OBJECT"] : [];
          if (relation.directions.has("consumed")) types.push("CONSUMES_OBJECT");
          if (relation.directions.has("target")) types.push("TARGETS_OBJECT");
          for (const type of types) addEdge(routeId, objectNode.id, type, objectNode.confidence, relation.evidenceIds[0] || "", { observationType: "inferred", provenance: { location: "request-response-correlation", extractor: "business-object-projector", selector: group.reference.namespace } });
        }
      }

      // Pass 9: derive an application state model from observed identities,
      // route semantics, response outcomes, and correlated business objects.
      // This pass never treats a derived state or anomaly as a verified finding.
      const stateNodes = new Map();
      const actionNodes = new Map();
      const workflowNodes = [];
      const stateSteps = new Map();
      const stateAnomalies = [];
      const objectNodesByKey = new Map(auxiliaryNodes.filter((node) => node.type === "BusinessObject").map((node) => [node.canonicalKey, node]));
      const objectsByRoute = new Map();
      for (const edge of edgeMap.values()) {
        if (!["PRODUCES_OBJECT", "CONSUMES_OBJECT", "TARGETS_OBJECT"].includes(edge.type)) continue;
        if (!objectsByRoute.has(edge.source)) objectsByRoute.set(edge.source, new Set());
        objectsByRoute.get(edge.source).add(edge.target);
      }
      const ensureIdentity = (key, label, role, confidence = 0.9) => {
        const identityKey = String(key || "anonymous");
        if (identityNodes.has(identityKey)) return identityNodes.get(identityKey);
        const node = {
          id: stableNodeId("identity", identityKey), canonicalKey: identityKey, type: "Identity",
          label: String(label || (identityKey === "anonymous" ? "Anonymous" : "Authenticated session")),
          role: String(role || (identityKey === "anonymous" ? "anonymous" : "unknown")),
          observationType: "derived", confidence, observedCount: 0, riskScore: 0, priorityScore: 0, priorityTier: "low", priorityFactors: [],
        };
        identityNodes.set(identityKey, node); auxiliaryNodes.push(node);
        return node;
      };
      const ensureState = ({ key, label, stateKind, resource = "", lifecycle = "", host = "", identityNode, confidence = 0.8, observationType = "derived", evidenceId = "", routeId = "", actionId = "" }) => {
        if (!stateNodes.has(key)) {
          const node = {
            id: stableNodeId("applicationstate", key), canonicalKey: key, type: "ApplicationState", label,
            stateKind, resource, lifecycle, host, identityId: identityNode?.id || "", identityLabel: identityNode?.label || "",
            role: identityNode?.role || "unknown", observationType, confidence, observedCount: 0,
            evidenceRefs: [], routeIds: [], actionIds: [], anomalyIds: [], candidateTests: [],
            riskScore: 0, priorityScore: 0, priorityTier: "low", priorityFactors: [],
          };
          stateNodes.set(key, node); auxiliaryNodes.push(node);
        }
        const node = stateNodes.get(key);
        node.observedCount += 1;
        node.confidence = Math.max(node.confidence, confidence);
        if (evidenceId && node.evidenceRefs.length < 100 && !node.evidenceRefs.includes(evidenceId)) node.evidenceRefs.push(evidenceId);
        if (routeId && !node.routeIds.includes(routeId)) node.routeIds.push(routeId);
        if (actionId && !node.actionIds.includes(actionId)) node.actionIds.push(actionId);
        return node;
      };
      const ensureAction = (observation, route) => {
        const semantics = classifyApplicationAction(observation);
        const key = route.canonicalKey;
        if (!actionNodes.has(key)) {
          const node = {
            id: stableNodeId("action", key), canonicalKey: key, type: "Action", label: semantics.label,
            actionKind: semantics.kind, resource: semantics.resource, mutating: semantics.mutating,
            method: route.method, host: route.host, template: route.template, routeId: route.id,
            observationType: "derived", confidence: route.confidence, observedCount: 0, successfulCount: 0, rejectedCount: 0,
            statusCodes: [], identityIds: [], preconditionStateIds: [], resultingStateIds: [], entityIds: [], evidenceRefs: [], anomalyIds: [], candidateTests: [],
            riskScore: route.riskScore || 0, priorityScore: route.priorityScore || 0, priorityTier: route.priorityTier || "low", priorityFactors: route.priorityFactors || [],
          };
          actionNodes.set(key, node); auxiliaryNodes.push(node);
          addEdge(route.id, node.id, "IMPLEMENTS_ACTION", route.confidence, route.evidenceRefs[0] || "", { observationType: "derived", provenance: { location: "route.method", extractor: "application-state-model", selector: route.method } });
        }
        return actionNodes.get(key);
      };
      const orderedObservations = observations.slice().sort((left, right) => {
        const leftTime = Date.parse(left.observedAt); const rightTime = Date.parse(right.observedAt);
        if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
        return left.sourceIndex - right.sourceIndex;
      });
      for (const observation of orderedObservations) {
        const route = routeMap.get(observation.routeKey);
        if (!route) continue;
        const explicitIdentity = observation.captureIdentity;
        const actorKey = explicitIdentity?.id || (observation.authState === "authenticated" ? "authenticated-session" : "anonymous");
        const actor = ensureIdentity(actorKey, explicitIdentity?.label || (observation.authState === "authenticated" ? "Authenticated session" : "Anonymous"), explicitIdentity?.role || (observation.authState === "authenticated" ? "unknown" : "anonymous"), explicitIdentity?.id ? 0.98 : observation.sessionConfidence);
        // Explicit capture identities were counted by the typed-identity pass;
        // synthetic anonymous/session actors are first materialized here.
        if (!explicitIdentity?.id) actor.observedCount += 1;
        const action = ensureAction(observation, route);
        const successful = Number(observation.statusCode) >= 200 && Number(observation.statusCode) < 400;
        action.observedCount += 1;
        if (successful) action.successfulCount += 1; else action.rejectedCount += 1;
        if (Number.isFinite(observation.statusCode) && !action.statusCodes.includes(observation.statusCode)) action.statusCodes.push(observation.statusCode);
        if (!action.identityIds.includes(actor.id)) action.identityIds.push(actor.id);
        if (action.evidenceRefs.length < 100 && !action.evidenceRefs.includes(observation.evidenceId)) action.evidenceRefs.push(observation.evidenceId);
        const authLifecycle = observation.authState === "authenticated" ? "authenticated" : "anonymous";
        const beforeState = ensureState({
          key: `authentication|${actorKey}|${observation.host}|${authLifecycle}`,
          label: authLifecycle === "authenticated" ? `Authenticated · ${actor.label}` : "Anonymous",
          stateKind: "authentication", lifecycle: authLifecycle, host: observation.host, identityNode: actor,
          confidence: explicitIdentity?.id ? 0.98 : Math.max(0.55, observation.sessionConfidence), observationType: "observed",
          evidenceId: observation.evidenceId, routeId: route.id, actionId: action.id,
        });
        if (!action.preconditionStateIds.includes(beforeState.id)) action.preconditionStateIds.push(beforeState.id);
        addEdge(actor.id, beforeState.id, "HAS_STATE", beforeState.confidence, observation.evidenceId, { observationType: "observed", identityId: actor.id, provenance: { location: "traffic.request", extractor: "authentication-state-projector", selector: observation.authType } });
        addEdge(beforeState.id, action.id, "REQUIRES_STATE", beforeState.confidence, observation.evidenceId, { observationType: "derived", identityId: actor.id, provenance: { location: "traffic.request", extractor: "application-state-model", selector: authLifecycle } });
        const entityIds = [...(objectsByRoute.get(route.id) || [])];
        for (const entityId of entityIds) {
          if (!action.entityIds.includes(entityId)) action.entityIds.push(entityId);
          addEdge(action.id, entityId, action.mutating ? "MUTATES_ENTITY" : "READS_ENTITY", action.mutating ? 0.88 : 0.82, observation.evidenceId, { observationType: "derived", identityId: actor.id, provenance: { location: "request-response-correlation", extractor: "application-state-model", selector: action.actionKind } });
          addEdge(actor.id, entityId, "ACTED_ON_ENTITY", 0.72, observation.evidenceId, { observationType: "derived", identityId: actor.id, provenance: { location: "traffic.captureIdentity", extractor: "application-state-model", selector: action.actionKind } });
        }
        let afterState = beforeState;
        if (successful && action.actionKind !== "read") {
          const lifecycle = lifecycleStateForAction(action);
          let resultActor = actor;
          let resultActorKey = actorKey;
          let confidence = 0.84;
          let stateKind = "entity-lifecycle";
          let label = `${action.resource} · ${lifecycle}`;
          if (["authenticate", "logout"].includes(action.actionKind)) {
            stateKind = "authentication";
            if (action.actionKind === "authenticate" && actorKey === "anonymous") {
              resultActorKey = "authenticated-session";
              resultActor = ensureIdentity(resultActorKey, "Authenticated session", "unknown", 0.72);
            }
            label = action.actionKind === "logout" ? "Anonymous" : `Authenticated · ${resultActor.label}`;
            confidence = observation.authSignals?.setCookie || observation.authSignals?.tokenShape || observation.authSignals?.clearsCookie ? 0.92 : 0.74;
          }
          afterState = ensureState({
            key: `${stateKind}|${resultActorKey}|${observation.host}|${action.resource}|${lifecycle}`,
            label, stateKind, resource: stateKind === "entity-lifecycle" ? action.resource : "", lifecycle, host: observation.host,
            identityNode: resultActor, confidence, observationType: "derived", evidenceId: observation.evidenceId, routeId: route.id, actionId: action.id,
          });
          if (!action.resultingStateIds.includes(afterState.id)) action.resultingStateIds.push(afterState.id);
          addEdge(action.id, afterState.id, "PRODUCES_STATE", confidence, observation.evidenceId, { observationType: "derived", actionId: action.id, identityId: resultActor.id, outcome: lifecycle, provenance: { location: "traffic.response", extractor: "application-state-model", selector: String(observation.statusCode || "unknown") } });
          addEdge(beforeState.id, afterState.id, "TRANSITIONS_TO", confidence, observation.evidenceId, { observationType: "derived", actionId: action.id, identityId: actor.id, outcome: lifecycle, provenance: { location: "traffic.exchange", extractor: "application-state-model", selector: `${observation.method}:${observation.statusCode}` } });
        } else {
          addEdge(action.id, beforeState.id, "PRESERVES_STATE", successful ? 0.9 : 0.96, observation.evidenceId, { observationType: "observed", actionId: action.id, identityId: actor.id, outcome: successful ? "read" : "rejected", provenance: { location: "traffic.response", extractor: "application-state-model", selector: String(observation.statusCode || "unknown") } });
        }
        stateSteps.set(observation.sourceIndex, { actionId: action.id, routeId: route.id, beforeStateId: beforeState.id, afterStateId: afterState.id, identityId: actor.id, evidenceId: observation.evidenceId, statusCode: observation.statusCode, observedAt: observation.observedAt });
      }

      const stateProjectionNodeById = new Map([...actionNodes.values(), ...stateNodes.values()].map((node) => [node.id, node]));
      const addStateAnomaly = (kind, basisKey, input) => {
        const anomaly = {
          id: stableNodeId("stateanomaly", `${kind}|${basisKey}`), kind, status: "candidate", confidence: input.confidence,
          title: input.title, basis: input.basis, actionIds: input.actionIds || [], stateIds: input.stateIds || [],
          routeIds: input.routeIds || [], entityIds: input.entityIds || [], identityIds: input.identityIds || [],
          evidenceRefs: [...new Set(input.evidenceRefs || [])].slice(0, 20), candidateTest: input.candidateTest,
        };
        stateAnomalies.push(anomaly);
        for (const nodeId of [...(anomaly.actionIds || []), ...(anomaly.stateIds || [])]) {
          const node = stateProjectionNodeById.get(nodeId);
          if (!node) continue;
          if (!node.anomalyIds.includes(anomaly.id)) node.anomalyIds.push(anomaly.id);
          if (anomaly.candidateTest && !node.candidateTests.includes(anomaly.candidateTest)) node.candidateTests.push(anomaly.candidateTest);
        }
      };
      for (const action of actionNodes.values()) {
        const anonymousStates = action.preconditionStateIds.map((id) => stateProjectionNodeById.get(id)).filter((state) => state?.lifecycle === "anonymous");
        if (action.mutating && action.successfulCount > 0 && anonymousStates.length) addStateAnomaly("anonymous_state_change", action.id, {
          confidence: 0.82, title: "Successful state change observed from an anonymous state",
          basis: "A state-changing HTTP action returned a success-class response while the request carried no observed authentication material.",
          actionIds: [action.id], stateIds: anonymousStates.map((state) => state.id), routeIds: [action.routeId], evidenceRefs: action.evidenceRefs,
          candidateTest: "Replay the action anonymously and with an authenticated identity, then compare authorization, ownership, and persisted side effects.",
        });
        const route = routeMap.get(action.canonicalKey);
        const differential = route ? identityDifferential(route) : { hasDifferential: false };
        if (differential.hasDifferential) addStateAnomaly("identity_response_differential", action.id, {
          confidence: 0.86, title: "Identity-dependent action outcome observed",
          basis: "Different configured identities produced different status or response-schema profiles for the same normalized action.",
          actionIds: [action.id], stateIds: action.preconditionStateIds, routeIds: [action.routeId], identityIds: action.identityIds, evidenceRefs: action.evidenceRefs,
          candidateTest: "Repeat the action with each authorized test identity and compare object ownership, authorization outcome, and resulting state.",
        });
      }
      const identitiesByObject = new Map();
      for (const observation of observations) {
        if (!observation.captureIdentity?.id) continue;
        for (const reference of observation.objectReferences || []) {
          const objectNode = objectNodesByKey.get(`${reference.namespace}|${reference.fingerprint}`);
          if (!objectNode) continue;
          if (!identitiesByObject.has(objectNode.id)) identitiesByObject.set(objectNode.id, new Map());
          const identities = identitiesByObject.get(objectNode.id);
          if (!identities.has(observation.captureIdentity.id)) identities.set(observation.captureIdentity.id, []);
          if (identities.get(observation.captureIdentity.id).length < 10) identities.get(observation.captureIdentity.id).push(observation.evidenceId);
        }
      }
      for (const [entityId, identities] of identitiesByObject) {
        if (identities.size < 2) continue;
        const identityGraphIds = [...identities.keys()].map((id) => identityNodes.get(id)?.id).filter(Boolean);
        addStateAnomaly("cross_identity_entity", entityId, {
          confidence: 0.78, title: "Business object observed across multiple identities",
          basis: "The same privacy-preserving business-object fingerprint appeared in traffic captured under more than one configured identity.",
          entityIds: [entityId], identityIds: identityGraphIds, evidenceRefs: [...identities.values()].flat(),
          candidateTest: "Verify whether each identity is authorized to read or mutate this object; compare owner and non-owner outcomes without assuming an access-control flaw.",
        });
      }

      const workflows = [];
      for (const [sessionKey, sessionObservations] of observationsBySession.entries()) {
        const steps = sessionObservations.map((observation) => stateSteps.get(observation.sourceIndex)).filter(Boolean).slice(0, 500);
        if (!steps.length) continue;
        const identityIds = [...new Set(steps.map((step) => step.identityId).filter(Boolean))];
        const workflowId = stableNodeId("workflow", sessionKey);
        const workflow = {
          id: workflowId, label: `Workflow · ${identityIds.map((id) => auxiliaryNodes.find((node) => node.id === id)?.label).filter(Boolean).join(", ") || "session"}`,
          observationType: "derived", confidence: Math.min(...sessionObservations.map((item) => Math.max(0.15, item.sessionConfidence))),
          identityIds, actionIds: [...new Set(steps.map((step) => step.actionId))], stateIds: [...new Set(steps.flatMap((step) => [step.beforeStateId, step.afterStateId]))],
          firstSeen: steps[0].observedAt || "", lastSeen: steps.at(-1).observedAt || "", observedCount: steps.length,
          steps: steps.map((step, index) => ({ index: index + 1, ...step })),
        };
        workflows.push(workflow);
        const node = { ...workflow, type: "Workflow", canonicalKey: sessionKey, evidenceRefs: steps.map((step) => step.evidenceId).slice(0, 100), riskScore: 0, priorityScore: 0, priorityTier: "low", priorityFactors: [] };
        workflowNodes.push(node); auxiliaryNodes.push(node);
        workflow.actionIds.forEach((actionId) => addEdge(node.id, actionId, "CONTAINS_ACTION", workflow.confidence, steps.find((step) => step.actionId === actionId)?.evidenceId || "", { observationType: "derived", workflowId, provenance: { location: "traffic.timeline", extractor: "application-state-model", selector: "ordered-session" } }));
        addEdge(node.id, steps[0].beforeStateId, "STARTS_IN", workflow.confidence, steps[0].evidenceId, { observationType: "derived", workflowId, provenance: { location: "traffic.timeline", extractor: "application-state-model", selector: "first-state" } });
        addEdge(node.id, steps.at(-1).afterStateId, "ENDS_IN", workflow.confidence, steps.at(-1).evidenceId, { observationType: "derived", workflowId, provenance: { location: "traffic.timeline", extractor: "application-state-model", selector: "last-state" } });
      }

      const stateModel = {
        version: 1,
        derivation: "deterministic-traffic-projection",
        states: [...stateNodes.values()].map((node) => ({ id: node.id, label: node.label, stateKind: node.stateKind, resource: node.resource, lifecycle: node.lifecycle, host: node.host, identityId: node.identityId, confidence: node.confidence, observationType: node.observationType, evidenceRefs: node.evidenceRefs, actionIds: node.actionIds, routeIds: node.routeIds, anomalyIds: node.anomalyIds, candidateTests: node.candidateTests })),
        actions: [...actionNodes.values()].map((node) => ({ id: node.id, label: node.label, actionKind: node.actionKind, resource: node.resource, mutating: node.mutating, method: node.method, host: node.host, template: node.template, routeId: node.routeId, observedCount: node.observedCount, successfulCount: node.successfulCount, rejectedCount: node.rejectedCount, identityIds: node.identityIds, preconditionStateIds: node.preconditionStateIds, resultingStateIds: node.resultingStateIds, entityIds: node.entityIds, evidenceRefs: node.evidenceRefs, anomalyIds: node.anomalyIds, candidateTests: node.candidateTests })),
        entities: auxiliaryNodes.filter((node) => node.type === "BusinessObject").map((node) => ({ id: node.id, label: node.label, namespace: node.namespace, confidence: node.confidence })),
        identities: [...identityNodes.values()].map((node) => ({ id: node.id, label: node.label, role: node.role, confidence: node.confidence })),
        transitions: [...edgeMap.values()].filter((edge) => edge.type === "TRANSITIONS_TO").map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, actionId: edge.actionId, identityId: edge.identityId, outcome: edge.outcome, confidence: edge.confidence, evidenceIds: edge.evidenceIds })),
        workflows,
        anomalies: stateAnomalies.sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id)),
      };

      for (const edge of edgeMap.values()) {
        if (edge.type === "FOLLOWED_BY") {
          edge.transitionCount = edge.supportCount;
          edge.confidence = Math.min(0.98, edge.confidence * 0.75 + Math.min(0.18, Math.log2(edge.distinctSessions + 1) * 0.07) + Math.min(0.1, Math.max(0, edge.supportCount - 1) * 0.02));
        }
        edge.evidenceIds.sort(); edge.evidenceSample.sort();
        delete edge._sessionIds;
      }

      const routes = [...routeMap.values()].sort((a, b) => b.riskScore - a.riskScore || b.observedCount - a.observedCount || a.label.localeCompare(b.label));
      const hosts = [...hostMap.values()].sort((a, b) => a.label.localeCompare(b.label));
      const typedNodes = auxiliaryNodes.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
      const edges = [...edgeMap.values()].sort((a, b) => a.type.localeCompare(b.type) || a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
      const evidenceIds = new Set(observations.map((observation) => observation.evidenceId));
      const secretValues = traffic.records.flatMap((record) => {
        const headers = parseRawMessage(record.request).headers;
        return [headers.authorization, headers.cookie].filter(Boolean);
      });
      const verification = { ...graphVerification([...hosts, ...routes, ...typedNodes], edges, { evidenceIds, stableNodeId, secretValues }), sourceComplete: !traffic.truncated, referencesComplete: droppedReferenceRoutes === 0, droppedReferenceRoutes };
      if (duplicateSourceIds.length) {
        verification.verified = false;
        verification.duplicateSourceIds = duplicateSourceIds.length;
        verification.issues.push(...duplicateSourceIds.slice(0, 20).map((id) => ({ code: "DUPLICATE_SOURCE_ID", id })));
        verification.issueCount = verification.issues.length;
      }
      if (!verification.verified) return { error: "The Map connectivity audit found invalid node or edge references", code: "MAP_VERIFICATION_FAILED", verification };
      const builtAt = now().toISOString();
      const warnings = [];
      if (traffic.invalidCount) warnings.push(`${traffic.invalidCount} malformed Traffic/Raw line${traffic.invalidCount === 1 ? " was" : "s were"} skipped`);
      if (traffic.records.length !== observations.length) warnings.push(`${traffic.records.length - observations.length} HTTP exchange${traffic.records.length - observations.length === 1 ? " was" : "s were"} unparseable`);
      if (traffic.truncated) warnings.push("Traffic/Raw exceeded the configured processing window; only the retained snapshot was analyzed");
      if (droppedReferenceRoutes) warnings.push(`${droppedReferenceRoutes} discovered route reference${droppedReferenceRoutes === 1 ? " was" : "s were"} dropped at the graph safety limit`);
      const passReports = [
        { pass: 0, name: "input-validation-and-snapshot", processed: traffic.totalRecords, failed: traffic.invalidCount },
        { pass: 1, name: "parse-and-redact", processed: observations.length, failed: traffic.records.length - observations.length },
        { pass: 2, name: "normalize-and-materialize", processed: routes.filter((route) => route.observed).length, failed: 0 },
        { pass: 3, name: "resolve-references", processed: edges.filter((edge) => ["LINKS_TO", "REDIRECTS_TO", "REFERRED_TO", "REFERENCES"].includes(edge.type)).length, failed: droppedReferenceRoutes },
        { pass: 4, name: "resolve-sessions", processed: observationsBySession.size, failed: observations.filter((observation) => observation.sessionResolution === "unresolved-anonymous").length },
        { pass: 5, name: "correlate-objects", processed: edges.filter((edge) => edge.type === "SHARES_OBJECT").length, failed: 0 },
        { pass: 6, name: "aggregate-workflows", processed: edges.filter((edge) => edge.type === "FOLLOWED_BY").length, failed: 0 },
        { pass: 7, name: "project-javascript-artifacts", processed: javascriptNodes.size, failed: javascriptManifest.error ? 1 : 0 },
        { pass: 8, name: "project-web-artifacts", processed: webNodes.size, failed: webManifest.error ? 1 : 0 },
        { pass: 9, name: "project-typed-entities", processed: typedNodes.length - javascriptNodes.size - webNodes.size, failed: 0 },
        { pass: 10, name: "derive-application-state-model", processed: stateModel.states.length + stateModel.actions.length + stateModel.workflows.length, failed: 0 },
        { pass: 11, name: "validate-integrity-and-provenance", processed: verification.checkedNodes + verification.checkedEdges, failed: verification.issueCount },
      ];
      const graph = {
        kind: "xekute-application-behavior-map",
        schemaVersion: MAP_SCHEMA_VERSION,
        schemaVersionName: "4.0.0",
        builderVersion: MAP_BUILDER_VERSION,
        philosophy: "live-deduplicated-evidence-preserving",
        analysisModel: "auditable-multi-pass-connectivity",
        builtAt,
        project: { name: path.basename(verified.root), rootHash: hash(verified.root, 32), namespace: projectNamespace },
        source: {
          path: traffic.records.length ? "traffic/raw.jsonl" : "recon/passive-recon.json",
          origin: traffic.records.length
            ? (passiveSeededAssets ? "traffic+passive" : "traffic")
            : (passiveSeededAssets ? "passive-seed" : "empty"),
          seededFromPassive: passiveSeededAssets,
          totalRecords: traffic.totalRecords, recordsConsidered: traffic.records.length,
          processedCount: observations.length, failedCount: traffic.invalidCount + (traffic.records.length - observations.length),
          invalidRecords: traffic.invalidCount, truncated: traffic.truncated, completeSourceProcessed: !traffic.truncated,
          bytesConsidered: traffic.bytesConsidered, snapshotHash: traffic.snapshotHash, warnings,
          javascriptManifestPath: "traffic/artifacts/javascript/manifest.json",
          javascriptSnapshotHash: javascriptManifest.contentHash || "",
          javascriptArtifacts: javascriptNodes.size,
          webManifestPath: "traffic/artifacts/web/manifest.json",
          webSnapshotHash: webManifest.contentHash || "",
          webArtifacts: webNodes.size,
        },
        passReports,
        stats: {
          hosts: hosts.length, routes: routes.length, observations: observations.length,
          variants: routes.reduce((sum, route) => sum + route.variants.length, 0),
          transitions: edges.filter((edge) => edge.type === "FOLLOWED_BY").length,
          relationships: edges.filter((edge) => !["EXPOSES", "FOLLOWED_BY"].includes(edge.type)).length,
          subdomains: edges.filter((edge) => edge.type === "SUBDOMAIN_OF").length,
          observedRoutes: routes.filter((route) => route.observed).length,
          discoveredRoutes: routes.filter((route) => !route.observed).length,
          droppedReferenceRoutes,
          components: verification.components,
          hiddenRoutes: routes.filter((route) => route.visibility === "hidden").length,
          highPriorityRoutes: routes.filter((route) => (route.priorityScore ?? route.riskScore) >= PRIORITY_HIGH_THRESHOLD).length,
          highRiskRoutes: routes.filter((route) => (route.priorityScore ?? route.riskScore) >= PRIORITY_HIGH_THRESHOLD).length,
          javascriptArtifacts: javascriptNodes.size,
          webArtifacts: webNodes.size,
          identities: typedNodes.filter((node) => node.type === "Identity").length,
          parameters: typedNodes.filter((node) => node.type === "Parameter").length,
          responseVariantNodes: typedNodes.filter((node) => node.type === "ResponseVariant").length,
          businessObjects: typedNodes.filter((node) => node.type === "BusinessObject").length,
          states: stateModel.states.length,
          actions: stateModel.actions.length,
          stateTransitions: stateModel.transitions.length,
          stateWorkflows: stateModel.workflows.length,
          stateAnomalies: stateModel.anomalies.length,
        },
        filters: { defaultVisibility: "relevant", hiddenEvidencePreserved: true },
        annotations: readAgentAnnotations(verified.root),
        verification,
        stateModel,
        nodes: [...hosts, ...routes, ...typedNodes],
        edges,
      };
      decorateGraphForAgent(graph);
      attachIntelligenceProjection(graph, verified.root);
      const stored = snapshots.persist(verified.root, graph);
      return stored?.error ? stored : { ...stored, ok: true, exists: true };
    } catch (error) {
      return { error: `Could not build the application Map: ${error.message}`, code: "MAP_BUILD_FAILED" };
    }
  }

  return {
    build,
    read,
    mapRelativePath,
    getOverview: mapOverview,
    getNode: mapGetNode,
    getNeighbors: mapNeighbors,
    findPaths: mapFindPaths,
    searchRoutes: mapSearchRoutes,
    searchNodes: mapSearchNodes,
    getWorkflow: mapWorkflow,
    getStateModel: mapStateModel,
    getVariants: mapVariants,
    getIdentityDiff: mapIdentityDiff,
    getAnomalies: mapAnomalies,
    getSharedObjects: mapSharedObjects,
    getEvidence: mapEvidence,
    getHypotheses: mapHypotheses,
    annotateFinding: mapAnnotateFinding,
  };
}

module.exports = {
  PRIORITY_ELEVATED_THRESHOLD,
  PRIORITY_HIGH_THRESHOLD,
  calculateRoutePriority,
  canonicalJson,
  createAssessmentMap,
  defaultDomainExtractor,
  normalizeRoutePath,
  parseRawMessage,
};
