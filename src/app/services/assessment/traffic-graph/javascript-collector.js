"use strict";

const MAX_REDIRECTS = 10;
const DEFAULT_MAX_FILES = 250;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const WEB_CANDIDATE_RE = /\.(?:html?|css|js|mjs|cjs|map|json|webmanifest|graphql|gql|ya?ml)(?:$|\?)/i;

function isCandidateUrl(value = "") {
  try { return /^https?:$/.test(new URL(String(value)).protocol) && /\.(?:js|mjs|cjs)(?:$|\?)/i.test(new URL(String(value)).pathname); }
  catch { return false; }
}

function isCandidateWebUrl(value = "") {
  try {
    const parsed = new URL(String(value));
    const pathname = parsed.pathname || "/";
    const basename = pathname.split("/").pop() || "";
    return /^https?:$/.test(parsed.protocol) && (WEB_CANDIDATE_RE.test(pathname + parsed.search) || !basename.includes("."));
  } catch { return false; }
}

async function readBoundedBody(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length")) || 0;
  if (declared > maxBytes) return { ok: false, code: "JAVASCRIPT_ARTIFACT_TOO_LARGE", byteLength: declared };
  if (!response.body?.getReader) {
    const value = Buffer.from(await response.arrayBuffer());
    return value.length > maxBytes ? { ok: false, code: "JAVASCRIPT_ARTIFACT_TOO_LARGE", byteLength: value.length } : { ok: true, content: value };
  }
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel().catch(() => {}); return { ok: false, code: "JAVASCRIPT_ARTIFACT_TOO_LARGE", byteLength: size }; }
      chunks.push(Buffer.from(value));
    }
  } finally { try { reader.releaseLock(); } catch { /* Reader is already released. */ } }
  return { ok: true, content: Buffer.concat(chunks, size) };
}

function createJavascriptCollector({ artifacts, webArtifacts = null, assessmentMap, authorizeUrl, fetchImpl = globalThis.fetch, onEvent = () => {} } = {}) {
  if (!artifacts?.capture || !artifacts?.readManifest) throw new TypeError("JavaScript artifact store is required");
  if (typeof fetchImpl !== "function") throw new TypeError("fetch implementation is required");

  function seedUrls(workspace, extraSeeds = []) {
    const manifest = artifacts.readManifest(workspace);
    const values = new Set(extraSeeds.filter(isCandidateWebUrl));
    for (const artifact of manifest.artifacts || []) {
      (artifact.urls || []).forEach((entry) => { if (isCandidateUrl(entry.url)) values.add(entry.url); });
      (artifact.imports || []).forEach((url) => { if (isCandidateUrl(url)) values.add(url); });
    }
    for (const artifact of webArtifacts?.readManifest?.(workspace)?.artifacts || []) {
      for (const entry of artifact.urls || []) {
        try { if (entry?.url && /^https?:$/.test(new URL(entry.url).protocol)) values.add(entry.url); } catch { /* Ignore malformed persisted references. */ }
      }
      for (const reference of artifact.references || []) if (isCandidateWebUrl(reference)) values.add(reference);
    }
    const mapped = assessmentMap?.read?.(workspace);
    for (const node of mapped?.graph?.nodes || []) {
      if (node.type === "JavaScript") (node.urls || []).forEach((entry) => { if (isCandidateUrl(entry.url)) values.add(entry.url); });
      if (["HTML", "CSS", "JSON", "GraphQL", "WebArtifact"].includes(node.type)) (node.urls || []).forEach((entry) => { if (isCandidateWebUrl(entry.url)) values.add(entry.url); });
      if (node.type === "Route" && !String(node.template || "").includes("{") && /\.(?:js|mjs|cjs)$/i.test(String(node.template || ""))) {
        const candidate = `${node.origin}${node.template}`;
        if (isCandidateUrl(candidate)) values.add(candidate);
      }
    }
    return [...values].sort();
  }

  async function fetchWithScope(workspace, initialUrl, headers = {}) {
    let current = initialUrl;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const decision = await authorizeUrl(current, { workspace, initialUrl, redirect });
      if (!decision?.ok) return { ok: false, code: decision?.code || "OUT_OF_SCOPE", error: decision?.reason || "Web artifact URL is outside the reviewed assessment scope.", remediation: decision?.remediation || "Review the project scope before deep collection.", url: current };
      let response;
      try { response = await fetchImpl(current, { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(30_000) }); }
      catch (error) { return { ok: false, code: error.name === "TimeoutError" ? "JAVASCRIPT_FETCH_TIMEOUT" : "JAVASCRIPT_FETCH_FAILED", error: error.message, url: current }; }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, code: "WEB_ARTIFACT_REDIRECT_INVALID", error: "Redirect response omitted Location.", url: current };
        current = new URL(location, current).toString();
        continue;
      }
      return { ok: true, response, url: current };
    }
    return { ok: false, code: "WEB_ARTIFACT_REDIRECT_LIMIT", error: "Web artifact request exceeded the redirect limit.", url: current };
  }

  async function collect({ workspace, seeds = [], force = false, maxFiles = DEFAULT_MAX_FILES, maxFileBytes = DEFAULT_MAX_FILE_BYTES, maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES } = {}) {
    const fileLimit = Math.max(1, Math.min(Number(maxFiles) || DEFAULT_MAX_FILES, 1000));
    const perFileLimit = Math.max(1024, Math.min(Number(maxFileBytes) || DEFAULT_MAX_FILE_BYTES, 64 * 1024 * 1024));
    const totalLimit = Math.max(perFileLimit, Math.min(Number(maxTotalBytes) || DEFAULT_MAX_TOTAL_BYTES, 1024 * 1024 * 1024));
    const initialManifest = artifacts.readManifest(workspace);
    const metadataByUrl = new Map();
    for (const artifact of initialManifest.artifacts || []) for (const entry of artifact.urls || []) metadataByUrl.set(entry.url, entry);
    const queue = seedUrls(workspace, Array.isArray(seeds) ? seeds : []);
    const queued = new Set(queue);
    const visited = new Set();
    const results = [];
    let downloadedBytes = 0;
    onEvent({ type: "status", status: "running", workspace, queued: queue.length });

    while (queue.length && visited.size < fileLimit && downloadedBytes < totalLimit) {
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      const prior = metadataByUrl.get(url);
      const headers = { accept: "text/html,text/css,application/javascript,application/json,application/manifest+json,application/graphql,text/plain;q=0.8,*/*;q=0.1", "user-agent": "XEKUTE-Graph-Collector/1.0" };
      if (!force && prior?.etag) headers["if-none-match"] = prior.etag;
      if (!force && prior?.lastModified) headers["if-modified-since"] = prior.lastModified;
      const fetched = await fetchWithScope(workspace, url, headers);
      if (!fetched.ok) { results.push({ url, ok: false, code: fetched.code, error: fetched.error }); onEvent({ type: "progress", workspace, processed: visited.size, queued: queue.length, result: results.at(-1) }); continue; }
      if (fetched.response.status === 304) { results.push({ url, ok: true, unchanged: true, statusCode: 304 }); continue; }
      if (!fetched.response.ok) { results.push({ url, ok: false, code: "JAVASCRIPT_FETCH_HTTP_ERROR", statusCode: fetched.response.status }); continue; }
      const remaining = Math.min(perFileLimit, totalLimit - downloadedBytes);
      const body = await readBoundedBody(fetched.response, remaining);
      if (!body.ok) { results.push({ url, ok: false, code: body.code, byteLength: body.byteLength }); continue; }
      downloadedBytes += body.content.length;
      const contentType = fetched.response.headers.get("content-type") || "application/octet-stream";
      const webCaptured = webArtifacts?.capture && webArtifacts.isWebArtifactResponse?.({ url: fetched.url, headers: Object.fromEntries(fetched.response.headers.entries()), contentType })
        ? await webArtifacts.capture(workspace, {
          url: fetched.url,
          content: body.content,
          headers: Object.fromEntries(fetched.response.headers.entries()),
          contentType,
          statusCode: fetched.response.status,
          source: "active-deep-collect",
        })
        : null;
      const captured = artifacts.isJavaScriptResponse?.({ url: fetched.url, headers: Object.fromEntries(fetched.response.headers.entries()), contentType })
        ? await artifacts.capture(workspace, {
        url: fetched.url,
        content: body.content,
        headers: Object.fromEntries(fetched.response.headers.entries()),
        contentType,
        statusCode: fetched.response.status,
        source: "active-deep-collect",
      }) : webCaptured;
      results.push({ url: fetched.url, ok: Boolean((captured || webCaptured)?.ok), code: captured?.code || webCaptured?.code || "", artifactId: captured?.artifactId || webCaptured?.artifactId || "", duplicate: Boolean(captured?.duplicate || webCaptured?.duplicate), byteLength: body.content.length });
      const latest = captured?.artifactId ? artifacts.readManifest(workspace).artifacts.find((item) => item.id === captured.artifactId) : null;
      for (const imported of latest?.imports || []) {
        if (isCandidateUrl(imported) && !queued.has(imported) && !visited.has(imported) && queued.size < fileLimit * 4) { queue.push(imported); queued.add(imported); }
      }
      const latestWeb = webArtifacts?.readManifest?.(workspace)?.artifacts?.find((item) => item.id === webCaptured?.artifactId);
      for (const reference of [...(latestWeb?.references || []), ...(latestWeb?.endpoints || []).map((item) => item.url)]) {
        if (isCandidateWebUrl(reference) && !queued.has(reference) && !visited.has(reference) && queued.size < fileLimit * 4) { queue.push(reference); queued.add(reference); }
      }
      onEvent({ type: "progress", workspace, processed: visited.size, queued: queue.length, downloadedBytes, result: results.at(-1) });
    }
    await artifacts.flush(workspace);
    const summary = {
      ok: true,
      status: "completed",
      processed: visited.size,
      downloaded: results.filter((item) => item.ok && !item.unchanged).length,
      unchanged: results.filter((item) => item.unchanged || item.duplicate).length,
      failed: results.filter((item) => !item.ok).length,
      downloadedBytes,
      remaining: queue.length,
      truncated: queue.length > 0 || downloadedBytes >= totalLimit,
      results: results.slice(0, 500),
    };
    onEvent({ type: "status", workspace, ...summary });
    return summary;
  }

  return Object.freeze({ collect, seedUrls });
}

module.exports = { createJavascriptCollector, isCandidateUrl, isCandidateWebUrl, readBoundedBody };
