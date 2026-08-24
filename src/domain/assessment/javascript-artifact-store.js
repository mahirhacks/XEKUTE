"use strict";

const DEFAULT_MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const MAX_URLS_PER_ARTIFACT = 100;
const MAX_ENDPOINTS_PER_ARTIFACT = 500;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function headerValue(headers = {}, wanted = "") {
  const entry = Object.entries(headers || {}).find(([name]) => name.toLowerCase() === String(wanted).toLowerCase());
  return entry ? String(entry[1]) : "";
}

function sanitizeUrl(rawUrl = "") {
  try {
    const url = new URL(String(rawUrl));
    if (!/^https?:$/.test(url.protocol)) return "";
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:access_?token|refresh_?token|token|api_?key|key|authorization|auth|password|passwd|secret|session|session_?id|sid|jwt|signature|sig|client_?secret)$/i.test(name)) {
        url.searchParams.set(name, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

function isJavaScriptResponse({ url = "", headers = {}, contentType = "" } = {}) {
  const type = String(contentType || headerValue(headers, "content-type")).split(";", 1)[0].trim().toLowerCase();
  if (/(?:javascript|ecmascript|x-javascript|typescript)/i.test(type)) return true;
  if (type && /^(?:application\/octet-stream|application\/binary|image\/|audio\/|video\/|font\/)/i.test(type)) return false;
  if (type && !/^text\/plain$/i.test(type)) return false;
  try { return /\.(?:js|mjs|cjs)(?:$|\?)/i.test(new URL(String(url)).pathname); }
  catch { return /\.(?:js|mjs|cjs)(?:$|\?)/i.test(String(url)); }
}

function resolveHttpUrl(value, baseUrl) {
  try {
    const url = new URL(String(value), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return "";
    return sanitizeUrl(url.toString());
  } catch {
    return "";
  }
}

function extractJavaScriptMetadata(source, baseUrl) {
  const text = String(source || "").slice(0, DEFAULT_MAX_ARTIFACT_BYTES);
  const imports = new Set();
  const sourceMaps = new Set();
  const endpoints = new Map();
  const addImport = (value) => { const resolved = resolveHttpUrl(value, baseUrl); if (resolved) imports.add(resolved); };
  const addEndpoint = (value, method = "GET", confidence = 0.7, extractor = "javascript-literal") => {
    const resolved = resolveHttpUrl(value, baseUrl);
    if (!resolved || endpoints.size >= MAX_ENDPOINTS_PER_ARTIFACT) return;
    const normalizedMethod = String(method || "GET").toUpperCase();
    const key = `${normalizedMethod}|${resolved}`;
    const candidate = { url: resolved, method: normalizedMethod, confidence, extractor };
    const existing = endpoints.get(key);
    if (!existing || candidate.confidence > existing.confidence) endpoints.set(key, candidate);
  };

  for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g)) addImport(match[1]);
  for (const match of text.matchAll(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) addImport(match[1]);
  for (const match of text.matchAll(/\/\/[#@]\s*sourceMappingURL\s*=\s*([^\s]+)/g)) {
    const resolved = resolveHttpUrl(match[1], baseUrl);
    if (resolved) sourceMaps.add(resolved);
  }
  for (const match of text.matchAll(/\bfetch\s*\(\s*(["'`])([^"'`]+)\1\s*(?:,\s*\{([\s\S]{0,500}?)\})?/g)) {
    const method = match[3]?.match(/\bmethod\s*:\s*["']([A-Z]+)["']/i)?.[1] || "GET";
    addEndpoint(match[2], method, match[3] ? 0.94 : 0.88, "fetch");
  }
  for (const match of text.matchAll(/\baxios\.(get|post|put|patch|delete|head|options)\s*\(\s*(["'`])([^"'`]+)\2/g)) {
    addEndpoint(match[3], match[1], 0.95, `axios.${match[1].toLowerCase()}`);
  }
  for (const match of text.matchAll(/\.open\s*\(\s*(["'])((?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS))\1\s*,\s*(["'`])([^"'`]+)\3/gi)) {
    addEndpoint(match[4], match[2], 0.93, "xmlhttprequest.open");
  }
  for (const match of text.matchAll(/\b(?:url|uri|endpoint|baseURL|action)\s*:\s*(["'`])(\/[^"'`\s]+)\1/g)) {
    addEndpoint(match[2], "GET", 0.62, "named-url-property");
  }

  return {
    imports: [...imports].sort().slice(0, 500),
    sourceMaps: [...sourceMaps].sort().slice(0, 20),
    endpoints: [...endpoints.values()].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method)),
    signals: {
      fetchCalls: (text.match(/\bfetch\s*\(/g) || []).length,
      axiosCalls: (text.match(/\baxios\.(?:get|post|put|patch|delete|head|options)\s*\(/gi) || []).length,
      websocketReferences: (text.match(/\b(?:WebSocket|wss?:\/\/)/gi) || []).length,
      graphqlReferences: (text.match(/\bgraphql\b/gi) || []).length,
      storageReferences: (text.match(/\b(?:localStorage|sessionStorage|indexedDB)\b/g) || []).length,
      authorizationReferences: (text.match(/\b(?:authorization|bearer|access[_-]?token|refresh[_-]?token)\b/gi) || []).length,
    },
  };
}

function createJavascriptArtifactStore({ fs, path, crypto, now = () => new Date(), maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES } = {}) {
  if (!fs || !path || !crypto?.createHash || !crypto?.randomBytes) throw new TypeError("fs, path, and crypto are required");
  const queues = new Map();
  const rootOf = (workspace) => path.resolve(String(workspace || ""));
  const manifestPath = (workspace) => path.join(rootOf(workspace), "traffic", "artifacts", "javascript", "manifest.json");
  const objectsDirectory = (workspace) => path.join(rootOf(workspace), "traffic", "artifacts", "javascript", "objects");
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

  function emptyManifest() {
    return { kind: "xekute-javascript-artifact-manifest", schemaVersion: 1, updatedAt: "", artifacts: [] };
  }

  function readManifest(workspace) {
    const target = manifestPath(workspace);
    try {
      if (!fs.existsSync(target)) return emptyManifest();
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      if (parsed?.kind !== "xekute-javascript-artifact-manifest" || !Array.isArray(parsed.artifacts)) throw new Error("invalid JavaScript artifact manifest");
      return parsed;
    } catch (error) {
      return { ...emptyManifest(), error: error.message, corruptPath: target };
    }
  }

  function atomicWrite(target, content) {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      fs.writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, target);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  function enqueue(workspace, task) {
    const root = rootOf(workspace);
    const previous = queues.get(root) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    queues.set(root, next);
    next.finally(() => { if (queues.get(root) === next) queues.delete(root); }).catch(() => {});
    return next;
  }

  function capture(workspace, input = {}) {
    return enqueue(workspace, async () => {
      const sanitizedUrl = sanitizeUrl(input.url);
      if (!sanitizedUrl) return { ok: false, code: "JAVASCRIPT_ARTIFACT_URL_INVALID", error: "JavaScript artifact URL must be HTTP or HTTPS." };
      if (!isJavaScriptResponse(input)) return { ok: false, code: "NOT_JAVASCRIPT", skipped: true };
      const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(String(input.content || ""), "utf8");
      const limit = Math.max(1, Math.min(Number(maxArtifactBytes) || DEFAULT_MAX_ARTIFACT_BYTES, 64 * 1024 * 1024));
      if (!content.length) return { ok: false, code: "JAVASCRIPT_ARTIFACT_EMPTY", skipped: true };
      if (content.length > limit) return { ok: false, code: "JAVASCRIPT_ARTIFACT_TOO_LARGE", skipped: true, byteLength: content.length, maxBytes: limit };
      const digest = hash(content);
      const objectDir = objectsDirectory(workspace);
      const objectTarget = path.join(objectDir, `${digest}.js`);
      fs.mkdirSync(objectDir, { recursive: true, mode: 0o700 });
      if (!fs.existsSync(objectTarget)) {
        const temporary = `${objectTarget}.${crypto.randomBytes(6).toString("hex")}.tmp`;
        try {
          fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
          fs.renameSync(temporary, objectTarget);
        } finally {
          if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
        }
      }

      const timestamp = now().toISOString();
      const manifest = readManifest(workspace);
      if (manifest.error) {
        const damaged = manifest.corruptPath;
        try { fs.renameSync(damaged, `${damaged}.damaged-${Date.now()}`); } catch { /* Preserve best-effort recovery. */ }
      }
      const working = manifest.error ? emptyManifest() : manifest;
      let artifact = working.artifacts.find((item) => item.sha256 === digest);
      const duplicate = Boolean(artifact);
      const metadata = extractJavaScriptMetadata(content.toString("utf8"), sanitizedUrl);
      const source = String(input.source || "passive-proxy").slice(0, 80);
      const captureIdentity = input.captureIdentity && typeof input.captureIdentity === "object"
        ? {
            id: String(input.captureIdentity.id || "").slice(0, 120),
            label: String(input.captureIdentity.label || "").slice(0, 160),
            role: String(input.captureIdentity.role || "").slice(0, 120),
          }
        : null;
      const urlRecord = {
        url: sanitizedUrl,
        firstSeen: timestamp,
        lastSeen: timestamp,
        statusCode: Number(input.statusCode) || null,
        contentType: String(input.contentType || headerValue(input.headers, "content-type") || "application/javascript").slice(0, 200),
        etag: String(headerValue(input.headers, "etag") || "").slice(0, 500),
        lastModified: String(headerValue(input.headers, "last-modified") || "").slice(0, 200),
        source,
        ...(captureIdentity?.id || captureIdentity?.label ? { captureIdentity } : {}),
      };
      if (!artifact) {
        artifact = {
          id: `javascript:${digest}`,
          sha256: digest,
          objectPath: `traffic/artifacts/javascript/objects/${digest}.js`,
          byteLength: content.length,
          firstSeen: timestamp,
          lastSeen: timestamp,
          urls: [urlRecord],
          imports: metadata.imports,
          sourceMaps: metadata.sourceMaps,
          endpoints: metadata.endpoints,
          signals: metadata.signals,
        };
        working.artifacts.push(artifact);
      } else {
        artifact.lastSeen = timestamp;
        const existingUrl = artifact.urls.find((item) => item.url === sanitizedUrl && (item.captureIdentity?.id || "") === (captureIdentity?.id || ""));
        if (existingUrl) Object.assign(existingUrl, urlRecord, { firstSeen: existingUrl.firstSeen || timestamp });
        else if (artifact.urls.length < MAX_URLS_PER_ARTIFACT) artifact.urls.push(urlRecord);
        artifact.imports = [...new Set([...(artifact.imports || []), ...metadata.imports])].sort().slice(0, 500);
        artifact.sourceMaps = [...new Set([...(artifact.sourceMaps || []), ...metadata.sourceMaps])].sort().slice(0, 20);
        const endpoints = new Map([...(artifact.endpoints || []), ...metadata.endpoints].map((item) => [`${item.method}|${item.url}`, item]));
        artifact.endpoints = [...endpoints.values()].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method)).slice(0, MAX_ENDPOINTS_PER_ARTIFACT);
        artifact.signals = Object.fromEntries(Object.keys(metadata.signals).map((key) => [key, Math.max(Number(artifact.signals?.[key]) || 0, Number(metadata.signals[key]) || 0)]));
      }
      working.artifacts.sort((a, b) => a.sha256.localeCompare(b.sha256));
      working.updatedAt = timestamp;
      working.contentHash = `sha256:${hash(canonicalJson(working.artifacts.map((item) => ({
        sha256: item.sha256,
        byteLength: item.byteLength,
        urls: (item.urls || []).map((entry) => ({ url: entry.url, source: entry.source, captureIdentity: entry.captureIdentity || null })),
        imports: item.imports || [], sourceMaps: item.sourceMaps || [], endpoints: item.endpoints || [], signals: item.signals || {},
      }))))}`;
      atomicWrite(manifestPath(workspace), `${JSON.stringify(working, null, 2)}\n`);
      return { ok: true, artifactId: artifact.id, sha256: digest, objectPath: artifact.objectPath, duplicate, manifestPath: "traffic/artifacts/javascript/manifest.json" };
    });
  }

  async function flush(workspace = "") {
    if (workspace) await (queues.get(rootOf(workspace)) || Promise.resolve());
    else await Promise.all([...queues.values()].map((job) => job.catch(() => {})));
    return { ok: true };
  }

  return Object.freeze({ capture, flush, readManifest, manifestPath, objectsDirectory, isJavaScriptResponse, sanitizeUrl });
}

module.exports = {
  DEFAULT_MAX_ARTIFACT_BYTES,
  createJavascriptArtifactStore,
  extractJavaScriptMetadata,
  isJavaScriptResponse,
  sanitizeUrl,
};
