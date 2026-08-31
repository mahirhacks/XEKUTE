"use strict";

const path = require("node:path");

const MAX_ASSETS = 80;
const MAX_FILE_BYTES = 2_000_000;

function safeRelativePath(value, fallback = "asset.txt") {
  const clean = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = clean.split("/").filter((part) => part && part !== "." && part !== "..").map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_"));
  return parts.join("/").slice(0, 180) || fallback;
}

function inScope(root, target, projectProfileProvider) {
  try {
    const profile = typeof projectProfileProvider === "function" ? projectProfileProvider(root) : null;
    const values = (profile?.scope?.inScopeTargets || []).map((entry) => typeof entry === "string" ? entry : entry?.value).filter(Boolean);
    if (!values.length) return false;
    const host = new URL(target).hostname.toLowerCase();
    return values.some((value) => {
      try { return new URL(value).hostname.toLowerCase() === host; } catch { return String(value).toLowerCase().includes(host); }
    });
  } catch {
    return false;
  }
}

function extractReferences(html, baseUrl) {
  const references = [];
  const pattern = /<(?:link|script|img|source|video|audio)[^>]+(?:href|src)=["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(String(html || "")))) {
    try {
      const url = new URL(match[1], baseUrl);
      if (["http:", "https:"].includes(url.protocol)) references.push(url.toString());
    } catch { /* Ignore malformed references. */ }
  }
  return [...new Set(references)].slice(0, MAX_ASSETS);
}

function createWebCloneService({ fs, path: pathApi, webResearch, projectProfileProvider = null } = {}) {
  async function build({ root, target, maxAssets = MAX_ASSETS } = {}) {
    if (!root || !fs.existsSync(root)) return { error: "Open an assessment before building WebClone." };
    let targetUrl;
    try {
      targetUrl = new URL(String(target || ""));
      if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error("Only HTTP and HTTPS targets are supported");
    } catch (error) { return { error: `Invalid WebClone target: ${error.message}` }; }
    if (!inScope(root, targetUrl.toString(), projectProfileProvider)) return { error: "WebClone target is not present in Project Settings scope." };

    const limit = Math.max(1, Math.min(Number(maxAssets) || MAX_ASSETS, MAX_ASSETS));
    const baseFolder = pathApi.join(root, "WebClone");
    fs.mkdirSync(pathApi.join(baseFolder, "assets"), { recursive: true });
    const page = await webResearch.fetchRawUrl(targetUrl.toString(), { maxBytes: MAX_FILE_BYTES });
    if (page.error) return page;
    const files = [];
    const writeText = (relative, content, contentType = "text/plain", source = "") => {
      const safe = safeRelativePath(relative);
      const full = pathApi.join(baseFolder, safe);
      const relativeCheck = pathApi.relative(baseFolder, full);
      if (relativeCheck.startsWith("..") || pathApi.isAbsolute(relativeCheck)) return;
      fs.mkdirSync(pathApi.dirname(full), { recursive: true });
      const value = String(content || "").slice(0, MAX_FILE_BYTES);
      fs.writeFileSync(full, value, "utf8");
      files.push({ path: `WebClone/${safe}`, bytes: Buffer.byteLength(value), contentType, ...(source ? { source } : {}) });
    };
    writeText("index.html", page.text, String(page.response?.headers?.get?.("content-type") || "text/html"), page.finalUrl);
    const queue = extractReferences(page.text, page.finalUrl).slice(0, limit);
    for (const reference of queue) {
      try {
        const parsed = new URL(reference);
        if (parsed.hostname !== targetUrl.hostname) continue;
        const fetched = await webResearch.fetchRawUrl(reference, { maxBytes: MAX_FILE_BYTES });
        if (fetched.error) continue;
        const contentType = String(fetched.response?.headers?.get?.("content-type") || "text/plain").split(";")[0];
        if (!/^(text\/|application\/(?:javascript|json|xhtml\+xml))/.test(contentType)) continue;
        const relative = `assets/${parsed.pathname.replace(/^\//, "") || `asset-${files.length}.txt`}`;
        writeText(relative, fetched.text, contentType, fetched.finalUrl || reference);
      } catch { /* Individual assets are best-effort. */ }
    }
    const manifest = { version: 1, target: targetUrl.toString(), finalUrl: page.finalUrl, builtAt: new Date().toISOString(), files };
    fs.writeFileSync(pathApi.join(baseFolder, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { ok: true, ...manifest, folder: baseFolder };
  }

  function readManifest(root) {
    try { return { ok: true, ...JSON.parse(fs.readFileSync(pathApi.join(root, "WebClone", "manifest.json"), "utf8")) }; }
    catch { return { ok: true, files: [], target: "", builtAt: "" }; }
  }

  function readFile(root, relativePath) {
    try {
      if (!root || !relativePath) return { error: "A WebClone assessment and file path are required." };
      const cloneRoot = pathApi.resolve(root, "WebClone");
      const normalized = String(relativePath).replace(/\\/g, "/").replace(/^WebClone\//i, "");
      const target = pathApi.resolve(cloneRoot, normalized);
      const relation = pathApi.relative(cloneRoot, target);
      if (!relation || relation.startsWith("..") || pathApi.isAbsolute(relation)) return { error: "The WebClone file path is invalid." };
      const stat = fs.statSync(target);
      if (!stat.isFile()) return { error: "The selected WebClone entry is not a file." };
      if (stat.size > MAX_FILE_BYTES) return { error: `WebClone file exceeds the ${MAX_FILE_BYTES}-byte preview limit.` };
      return { ok: true, content: fs.readFileSync(target, "utf8"), bytes: stat.size };
    } catch (error) { return { error: error.message }; }
  }

  return { build, readManifest, readFile };
}

module.exports = { createWebCloneService, extractReferences, safeRelativePath };
