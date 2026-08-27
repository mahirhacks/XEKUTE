"use strict";

const nodeCrypto = require("node:crypto");

const DEFAULT_MAX_COOKIES = 2_000;

function text(value, fallback = "", maximum = 2_000) {
  return String(value == null ? fallback : value).replace(/[\u0000\r\n]/g, "").slice(0, maximum);
}

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function parseUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) return null;
    return parsed;
  } catch { return null; }
}

function defaultPath(urlPath = "/") {
  const value = String(urlPath || "/");
  if (!value.startsWith("/")) return "/";
  const slash = value.lastIndexOf("/");
  return slash <= 0 ? "/" : value.slice(0, slash) || "/";
}

function normalizePath(value, fallback = "/") {
  const path = text(value, fallback, 4_000);
  return path.startsWith("/") ? path : "/";
}

function normalizeSameSite(value) {
  const source = String(value || "").trim().toLowerCase();
  if (source === "strict") return "Strict";
  if (source === "none") return "None";
  return "Lax";
}

function epochSeconds(value, nowMs) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (Number.isFinite(number)) {
    // Browser storage APIs use seconds since Unix epoch. Millisecond input is
    // tolerated at the adapter boundary for imported browser state.
    return number > 100_000_000_000 ? number / 1_000 : number;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed / 1_000 : 0;
}

function siteForHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\.+/, "");
  if (!host || host === "localhost" || /^[0-9a-f:.]+$/i.test(host)) return host;
  const labels = host.split(".").filter(Boolean);
  return labels.length <= 2 ? host : labels.slice(-2).join(".");
}

function sameSiteContext(url, input = {}) {
  const explicit = String(input.sameSiteContext || input.siteContext || "").trim().toLowerCase();
  if (["same-site", "same_site", "same", "cross-site", "cross_site", "cross"].includes(explicit)) return explicit.startsWith("cross") ? "cross-site" : "same-site";
  const topLevel = parseUrl(input.topLevelSite || input.siteForCookies || "");
  if (!topLevel) return "same-site";
  return siteForHost(url.hostname) === siteForHost(topLevel.hostname) ? "same-site" : "cross-site";
}

function domainMatches(hostname, domain, hostOnly) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const cookieDomain = String(domain || "").toLowerCase().replace(/^\./, "").replace(/\.$/, "");
  if (!host || !cookieDomain) return false;
  if (hostOnly) return host === cookieDomain;
  return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
}

function pathMatches(requestPath, cookiePath) {
  const request = requestPath || "/";
  const cookie = cookiePath || "/";
  if (request === cookie) return true;
  if (!request.startsWith(cookie)) return false;
  if (cookie.endsWith("/")) return true;
  return request[cookie.length] === "/";
}

function cookieScopeKey(input = {}) {
  return [
    text(input.projectId || input.project_id, "", 240),
    text(input.sessionId || input.session_id, "", 240),
    text(input.identityId || input.identity_id, "", 240),
    text(input.browserContext || input.browser_context, "", 240),
    text(input.name, "", 256),
    text(input.domain, "", 512).toLowerCase().replace(/^\./, ""),
    normalizePath(input.path),
    text(input.partitionKey || input.partition_key, "", 2_000),
  ].join("\u001f");
}

function normalizeCookie(input = {}, { url = "", nowMs = Date.now(), creationIndex = 0 } = {}) {
  const source = isRecord(input) ? input : {};
  const parsedUrl = parseUrl(source.url || url);
  const name = text(source.name, "", 256).trim();
  if (!name || /[()<>@,;:\\"/\[\]?={}\s]/.test(name)) return null;
  const rawValue = source.value === undefined || source.value === null ? "" : String(source.value);
  if (Buffer.byteLength(rawValue, "utf8") > 131_072) return null;
  const suppliedDomain = text(source.domain, "", 512).trim().toLowerCase().replace(/^\./, "");
  const domain = suppliedDomain || parsedUrl?.hostname?.toLowerCase().replace(/\.$/, "") || "";
  if (!domain) return null;
  const hostOnly = source.hostOnly === undefined ? !suppliedDomain : Boolean(source.hostOnly);
  const path = normalizePath(source.path, parsedUrl ? defaultPath(parsedUrl.pathname) : "/");
  const expires = epochSeconds(source.expires !== undefined ? source.expires : source.expirationDate, nowMs);
  const maxAge = source.maxAge === undefined || source.maxAge === null || source.maxAge === "" ? null : Number(source.maxAge);
  const effectiveExpires = Number.isFinite(maxAge) ? (maxAge <= 0 ? nowMs / 1_000 - 1 : nowMs / 1_000 + maxAge) : expires;
  const sameSite = normalizeSameSite(source.sameSite);
  const secure = Boolean(source.secure) || sameSite === "None";
  const partitionKey = text(source.partitionKey || source.partition_key, "", 2_000);
  return {
    name,
    value: rawValue,
    domain,
    path,
    hostOnly,
    secure,
    httpOnly: Boolean(source.httpOnly),
    sameSite,
    partitionKey,
    partitioned: Boolean(source.partitioned || partitionKey),
    expires: effectiveExpires > 0 ? effectiveExpires : effectiveExpires < 0 ? effectiveExpires : 0,
    origin: text(source.origin || source.url || (parsedUrl ? `${parsedUrl.protocol}//${parsedUrl.host}` : ""), "", 2_000),
    creationIndex: Number.isInteger(source.creationIndex) ? source.creationIndex : creationIndex,
  };
}

function parseSetCookie(header, url, { nowMs = Date.now(), creationIndex = 0 } = {}) {
  const input = String(header || "");
  const parts = input.split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const separator = parts[0].indexOf("=");
  if (separator <= 0) return null;
  const cookie = { name: parts[0].slice(0, separator), value: parts[0].slice(separator + 1), url };
  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=");
    const key = (equals >= 0 ? part.slice(0, equals) : part).trim().toLowerCase();
    const value = equals >= 0 ? part.slice(equals + 1).trim() : "";
    if (key === "domain") cookie.domain = value;
    else if (key === "path") cookie.path = value;
    else if (key === "expires") cookie.expires = value;
    else if (key === "max-age") cookie.maxAge = Number(value);
    else if (key === "samesite") cookie.sameSite = value;
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "partitioned") cookie.partitioned = true;
    else if (key === "partition-key") cookie.partitionKey = value;
  }
  return normalizeCookie(cookie, { url, nowMs, creationIndex });
}

function isExpired(cookie, nowMs = Date.now()) {
  return Number(cookie?.expires) !== 0 && Number(cookie?.expires) <= nowMs / 1_000;
}

function createSensitiveCookieJar({ crypto = nodeCrypto, now = () => new Date(), maxCookies = DEFAULT_MAX_COOKIES } = {}) {
  const cookies = new Map();
  let sequence = 0;

  function clockMs() {
    const value = now();
    return value instanceof Date ? value.getTime() : new Date(value).getTime();
  }

  function set(input = {}, options = {}) {
    const normalized = normalizeCookie(input, { ...options, nowMs: options.nowMs || clockMs(), creationIndex: ++sequence });
    if (!normalized) return { ok: false, code: "MEMORY_COOKIE_INVALID", error: "The cookie could not be normalized." };
    const key = cookieScopeKey({ ...input, ...options, ...normalized });
    if (isExpired(normalized, options.nowMs || clockMs())) {
      const existed = cookies.delete(key);
      return { ok: true, changed: existed, deleted: existed, key, cookie: null };
    }
    const prior = cookies.get(key);
    if (prior) normalized.creationIndex = prior.creationIndex;
    cookies.set(key, normalized);
    while (cookies.size > Math.max(1, Number(maxCookies) || DEFAULT_MAX_COOKIES)) {
      const oldest = [...cookies.entries()].sort((a, b) => a[1].creationIndex - b[1].creationIndex)[0];
      if (!oldest) break;
      cookies.delete(oldest[0]);
    }
    return { ok: true, changed: !prior || prior.value !== normalized.value || JSON.stringify({ ...prior, value: undefined }) !== JSON.stringify({ ...normalized, value: undefined }), deleted: false, key, cookie: { ...normalized } };
  }

  function applySetCookie(header, url, options = {}) {
    const parsed = parseSetCookie(header, url, { ...options, nowMs: options.nowMs || clockMs(), creationIndex: ++sequence });
    if (!parsed) return { ok: false, code: "MEMORY_COOKIE_INVALID", error: "The Set-Cookie header could not be parsed." };
    return set(parsed, options);
  }

  function remove(input = {}, options = {}) {
    const normalized = normalizeCookie({ ...input, value: "" }, { ...options, nowMs: options.nowMs || clockMs() });
    if (!normalized) return { ok: false, code: "MEMORY_COOKIE_INVALID", error: "The cookie identity could not be normalized." };
    const key = cookieScopeKey({ ...input, ...options, ...normalized });
    return { ok: true, changed: cookies.delete(key), key };
  }

  function list(options = {}) {
    const nowMs = options.nowMs || clockMs();
    return [...cookies.entries()]
      .filter(([, cookie]) => !isExpired(cookie, nowMs))
      .map(([key, cookie]) => ({ key, cookie: { ...cookie } }))
      .sort((a, b) => a.cookie.creationIndex - b.cookie.creationIndex);
  }

  function match(options = {}) {
    const url = parseUrl(options.url);
    if (!url) return { ok: false, code: "MEMORY_COOKIE_URL_INVALID", error: "A valid request URL is required for cookie matching." };
    const nowMs = options.nowMs || clockMs();
    const transportSecure = url.protocol === "https:" || url.protocol === "wss:";
    const method = String(options.method || "GET").toUpperCase();
    const siteContext = sameSiteContext(url, options);
    const results = [];
    for (const { key, cookie } of list({ nowMs })) {
      if (options.projectId && key.split("\u001f")[0] !== String(options.projectId)) continue;
      if (options.sessionId && key.split("\u001f")[1] !== String(options.sessionId)) continue;
      if (options.identityId && key.split("\u001f")[2] !== String(options.identityId)) continue;
      if (options.browserContext && key.split("\u001f")[3] !== String(options.browserContext)) continue;
      if (!domainMatches(url.hostname, cookie.domain, cookie.hostOnly)) continue;
      if (!pathMatches(url.pathname || "/", cookie.path)) continue;
      if (cookie.secure && !transportSecure) continue;
      if (cookie.partitioned && String(cookie.partitionKey || "") !== String(options.partitionKey || "")) continue;
      if (!cookie.partitioned && options.partitionKey) continue;
      if (cookie.sameSite === "Strict" && siteContext === "cross-site") continue;
      if (cookie.sameSite === "Lax" && siteContext === "cross-site" && !(options.isTopLevelNavigation === true && ["GET", "HEAD"].includes(method))) continue;
      results.push({ key, cookie: { ...cookie } });
    }
    results.sort((a, b) => b.cookie.path.length - a.cookie.path.length || a.cookie.creationIndex - b.cookie.creationIndex);
    return { ok: true, cookies: results };
  }

  function exportSafe(options = {}) {
    return list(options).map(({ key, cookie }) => ({
      key,
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      hostOnly: cookie.hostOnly,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      partitionKey: cookie.partitionKey,
      partitioned: cookie.partitioned,
      expires: cookie.expires,
      origin: cookie.origin,
      creationIndex: cookie.creationIndex,
    }));
  }

  function clear() { const changed = cookies.size > 0; cookies.clear(); return changed; }

  return Object.freeze({
    set,
    applySetCookie,
    remove,
    list,
    match,
    exportSafe,
    clear,
    size: () => cookies.size,
    cookieScopeKey,
    normalizeCookie,
    parseSetCookie,
    isExpired,
    crypto,
  });
}

module.exports = Object.freeze({
  DEFAULT_MAX_COOKIES,
  createSensitiveCookieJar,
  normalizeCookie,
  parseSetCookie,
  cookieScopeKey,
  isExpired,
  domainMatches,
  pathMatches,
});
