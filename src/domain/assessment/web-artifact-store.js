"use strict";

const cryptoDefault = require("node:crypto");
const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const { extractJavaScriptMetadata, sanitizeUrl } = require("./javascript-artifact-store.js");

const DEFAULT_MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const WEB_EXTENSIONS = /\.(?:html?|css|js|mjs|cjs|map|json|webmanifest|graphql|gql|yaml|yml)(?:$|\?)/i;
const WEB_MIME = /(?:text\/html|text\/css|javascript|ecmascript|application\/(?:json|manifest\+json|graphql|yaml)|text\/(?:javascript|plain|yaml))/i;
const SECRET_KEY = /^(?:access_?token|refresh_?token|token|api_?key|authorization|auth|password|passwd|secret|session|session_?id|sid|jwt|signature|sig|client_?secret)$/i;

function headerValue(headers = {}, wanted = "") { const entry = Object.entries(headers || {}).find(([name]) => name.toLowerCase() === String(wanted).toLowerCase()); return entry ? String(entry[1]) : ""; }
function artifactType({ url = "", headers = {}, contentType = "" } = {}) {
  const type = String(contentType || headerValue(headers, "content-type")).split(";", 1)[0].trim().toLowerCase();
  if (/html/.test(type)) return "html";
  if (/css/.test(type)) return "css";
  if (/javascript|ecmascript/.test(type)) return "javascript";
  if (/json|manifest/.test(type)) return "json";
  if (/graphql/.test(type)) return "graphql";
  if (/yaml/.test(type)) return "yaml";
  try { const name = new URL(String(url)).pathname; const ext = name.split(".").pop().toLowerCase(); if (["html", "htm", "css", "js", "mjs", "cjs", "map", "json", "webmanifest", "graphql", "gql", "yaml", "yml"].includes(ext)) return ext === "htm" ? "html" : ext === "mjs" || ext === "cjs" ? "javascript" : ext; } catch { /* Invalid URLs are rejected by sanitizeUrl. */ }
  return "";
}
function isWebArtifactResponse(input = {}) {
  const declaredType = String(input.contentType || headerValue(input.headers, "content-type")).split(";", 1)[0].trim().toLowerCase();
  const hasExtension = WEB_EXTENSIONS.test(String(input.url || ""));
  // An explicit binary or unrelated MIME type wins over a tempting filename
  // extension.  Extension-only responses are accepted only when the server
  // omitted Content-Type entirely; this prevents binary/misleading responses
  // from entering the downloadable-artifact graph.
  if (declaredType) {
    if (/^(?:application\/octet-stream|application\/binary|image\/|audio\/|video\/|font\/)/i.test(declaredType)) return false;
    if (WEB_MIME.test(declaredType)) return true;
    return false;
  }
  return hasExtension;
}
function sanitizeArtifactUrl(raw) {
  const value = sanitizeUrl(raw);
  if (!value) return "";
  try { const url = new URL(value); for (const key of [...url.searchParams.keys()]) if (SECRET_KEY.test(key)) url.searchParams.set(key, "[REDACTED]"); return url.toString(); } catch { return ""; }
}
function extractWebMetadata(source, baseUrl, type) {
  const text = String(source || "").slice(0, DEFAULT_MAX_ARTIFACT_BYTES);
  const references = new Set();
  const add = (value) => { try { const url = sanitizeArtifactUrl(new URL(String(value), baseUrl).toString()); if (url) references.add(url); } catch { /* Ignore malformed references. */ } };
  if (type === "html") for (const match of text.matchAll(/\b(?:src|href|action|data)\s*=\s*["']([^"']+)["']/gi)) add(match[1]);
  if (type === "css") for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(match[1]);
  if (type === "json" || type === "yaml" || type === "graphql") for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+|(?:^|["'\s])(\/[^\s"'<>]+)/g)) add(match[0]);
  const javascript = type === "javascript" ? extractJavaScriptMetadata(text, baseUrl) : null;
  return { references: [...references].slice(0, 500), endpoints: javascript?.endpoints || [], imports: javascript?.imports || [], sourceMaps: javascript?.sourceMaps || [], signals: javascript?.signals || {} };
}

function createWebArtifactStore({ fs = fsDefault, path = pathDefault, crypto = cryptoDefault, now = () => new Date(), maxArtifactBytes = DEFAULT_MAX_ARTIFACT_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES } = {}) {
  const rootOf = (workspace) => path.resolve(String(workspace || ""));
  const manifestPath = (workspace) => path.join(rootOf(workspace), "traffic", "artifacts", "web", "manifest.json");
  const objectsDirectory = (workspace) => path.join(rootOf(workspace), "traffic", "artifacts", "web", "objects");
  const hash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
  function readManifest(workspace) { try { const value = JSON.parse(fs.readFileSync(manifestPath(workspace), "utf8")); return value?.kind === "xekute-web-artifact-manifest" && Array.isArray(value.artifacts) ? value : { kind: "xekute-web-artifact-manifest", schemaVersion: 1, updatedAt: "", totalBytes: 0, artifacts: [] }; } catch { return { kind: "xekute-web-artifact-manifest", schemaVersion: 1, updatedAt: "", totalBytes: 0, artifacts: [] }; } }
  function atomicWrite(target, content) { fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); const temp = `${target}.${crypto.randomBytes(5).toString("hex")}.tmp`; fs.writeFileSync(temp, content, { flag: "wx", mode: 0o600 }); try { fs.renameSync(temp, target); } finally { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } }
  function capture(workspace, input = {}) {
    const url = sanitizeArtifactUrl(input.url);
    if (!url) return { ok: false, code: "WEB_ARTIFACT_URL_INVALID", error: "Artifact URL must be HTTP or HTTPS." };
    const type = artifactType(input);
    if (!type || !isWebArtifactResponse(input)) return { ok: false, code: "NOT_WEB_ARTIFACT", skipped: true };
    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(String(input.content || ""), "utf8");
    const perFile = Math.max(1, Math.min(Number(maxArtifactBytes) || DEFAULT_MAX_ARTIFACT_BYTES, 64 * 1024 * 1024));
    if (!content.length) return { ok: false, code: "WEB_ARTIFACT_EMPTY", skipped: true };
    if (content.length > perFile) return { ok: false, code: "WEB_ARTIFACT_TOO_LARGE", skipped: true, byteLength: content.length, maxBytes: perFile };
    const manifest = readManifest(workspace);
    const total = Number(manifest.totalBytes) || 0;
    if (total + content.length > Math.max(perFile, Number(maxTotalBytes) || DEFAULT_MAX_TOTAL_BYTES)) return { ok: false, code: "WEB_ARTIFACT_TOTAL_LIMIT", skipped: true, byteLength: content.length };
    const digest = hash(content);
    const objectPath = path.join(objectsDirectory(workspace), `${digest}.${type}`);
    fs.mkdirSync(path.dirname(objectPath), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(objectPath)) atomicWrite(objectPath, content);
    const timestamp = now().toISOString();
    let artifact = manifest.artifacts.find((item) => item.sha256 === digest);
    const duplicate = Boolean(artifact);
    const metadata = extractWebMetadata(content.toString("utf8"), url, type);
    const urlRecord = { url, source: String(input.source || "unknown").slice(0, 120), statusCode: Number(input.statusCode) || null, contentType: String(input.contentType || headerValue(input.headers, "content-type") || "").slice(0, 200) };
    if (!artifact) {
      artifact = { id: `web:${type}:${digest}`, type, sha256: digest, byteLength: content.length, objectPath: path.relative(rootOf(workspace), objectPath).replace(/\\/g, "/"), firstSeen: timestamp, lastSeen: timestamp, urls: [urlRecord], ...metadata };
      manifest.artifacts.push(artifact);
    } else {
      artifact.lastSeen = timestamp;
      const existingUrl = (artifact.urls || []).find((entry) => entry.url === url);
      if (existingUrl) Object.assign(existingUrl, urlRecord);
      else artifact.urls = [...(artifact.urls || []), urlRecord].slice(0, 40);
      artifact.references = [...new Set([...(artifact.references || []), ...metadata.references])].slice(0, 500);
      artifact.endpoints = [...new Map([...(artifact.endpoints || []), ...metadata.endpoints].map((item) => [`${item.method}|${item.url}`, item])).values()].slice(0, 500);
      artifact.imports = [...new Set([...(artifact.imports || []), ...metadata.imports])].slice(0, 500);
      artifact.sourceMaps = [...new Set([...(artifact.sourceMaps || []), ...metadata.sourceMaps])].slice(0, 50);
      artifact.signals = Object.fromEntries(Object.keys({ ...(artifact.signals || {}), ...(metadata.signals || {}) }).map((key) => [key, Math.max(Number(artifact.signals?.[key]) || 0, Number(metadata.signals?.[key]) || 0)]));
    }
    manifest.totalBytes = manifest.artifacts.reduce((sum, item) => sum + (Number(item.byteLength) || 0), 0);
    manifest.updatedAt = timestamp;
    atomicWrite(manifestPath(workspace), `${JSON.stringify({ ...manifest, kind: "xekute-web-artifact-manifest" }, null, 2)}\n`);
    return { ok: true, artifactId: artifact.id, sha256: digest, type, duplicate, objectPath: artifact.objectPath, manifestPath: "traffic/artifacts/web/manifest.json" };
  }
  return Object.freeze({ capture, readManifest, manifestPath, objectsDirectory, isWebArtifactResponse, artifactType, extractWebMetadata });
}

module.exports = Object.freeze({ DEFAULT_MAX_ARTIFACT_BYTES, DEFAULT_MAX_TOTAL_BYTES, WEB_EXTENSIONS, WEB_MIME, artifactType, createWebArtifactStore, extractWebMetadata, isWebArtifactResponse, sanitizeArtifactUrl });
