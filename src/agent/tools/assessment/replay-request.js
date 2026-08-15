"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const REPLAY_REQUEST_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["request"],
  properties: {
    request: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string" },
        method: { type: "string" },
        headers: { type: "object" },
        body: { type: "string" },
        timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
        followRedirects: { type: "boolean" },
      },
    },
    identityId: { type: "string" },
    config: {
      type: "object",
      properties: {
        headers: { type: "object" },
        timeoutMs: { type: "integer", minimum: 100, maximum: 120000 },
        followRedirects: { type: "boolean" },
      },
    },
  },
});

const REPLAY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_REPLAY_REQUEST_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  NETWORK_FAILED: "REPLAY_REQUEST_NETWORK_FAILED",
  TIMEOUT: "REPLAY_REQUEST_TIMEOUT",
  IDENTITY_PROVIDER_UNAVAILABLE: "REPLAY_REQUEST_IDENTITY_PROVIDER_UNAVAILABLE",
  SCOPE_DENIED: "REPLAY_REQUEST_REDIRECT_SCOPE_DENIED",
  REDIRECT_LIMIT: "REPLAY_REQUEST_REDIRECT_LIMIT",
  STOPPED: "REPLAY_REQUEST_STOPPED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: REPLAY_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!isRecord(input.request) || typeof input.request.url !== "string" || input.request.url.trim() === "") {
    return invalidInput("request.url must be a non-empty string");
  }
  let url;
  try {
    url = new URL(input.request.url);
  } catch {
    return invalidInput("request.url must be a valid absolute URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) return invalidInput("request.url must use http or https");
  if (input.request.method !== undefined && (typeof input.request.method !== "string" || input.request.method.trim() === "")) {
    return invalidInput("request.method must be a non-empty string");
  }
  if (input.request.body !== undefined && typeof input.request.body !== "string") return invalidInput("request.body must be a string");
  if (input.identityId !== undefined && (typeof input.identityId !== "string" || input.identityId.trim() === "")) {
    return invalidInput("identityId must be a non-empty string");
  }
  for (const [label, obj] of [["request.headers", input.request.headers], ["config.headers", input.config?.headers]]) {
    if (obj !== undefined && !isRecord(obj)) return invalidInput(`${label} must be an object`);
  }
  return { ok: true };
}

function mergeHeaders(base, override) {
  return { ...(base || {}), ...(override || {}) };
}

const SECRET_HEADER_NAMES = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-refresh-token|x-session-token|x-token|x-csrf-token)$/i;

function safeRequestHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).filter(([name]) => !SECRET_HEADER_NAMES.test(name)));
}

function removeEntityHeaders(headers) {
  for (const name of Object.keys(headers || {})) {
    if (/^(?:content-length|content-type|transfer-encoding)$/i.test(name)) delete headers[name];
  }
}

function cookieMatchesUrl(cookie, url) {
  try {
    const parsed = new URL(url);
    const domain = String(cookie.domain || "").toLowerCase();
    const host = parsed.hostname.toLowerCase();
    if (cookie.url) {
      const expected = new URL(String(cookie.url));
      if (parsed.protocol !== expected.protocol || parsed.host !== expected.host) return false;
      if (expected.pathname !== "/" && parsed.pathname !== expected.pathname && !parsed.pathname.startsWith(`${expected.pathname}/`)) return false;
    }
    if (domain && !(host === domain.replace(/^\./, "") || (domain.startsWith(".") && host.endsWith(domain)))) return false;
    const cookiePath = String(cookie.path || "/");
    if (!parsed.pathname.startsWith(cookiePath.endsWith("/") ? cookiePath : `${cookiePath}/`) && parsed.pathname !== cookiePath) return false;
    if (cookie.secure && parsed.protocol !== "https:") return false;
    const expires = Number(cookie.expires ?? cookie.expirationDate);
    if (Number.isFinite(expires) && expires > 0 && expires < Date.now() / 1000) return false;
    return true;
  } catch { return false; }
}

function cookiesForUrl(identity, url) {
  const cookies = Array.isArray(identity?.storageState?.cookies) ? identity.storageState.cookies : Array.isArray(identity?.cookies) ? identity.cookies : [];
  return cookies.filter((cookie) => cookieMatchesUrl(cookie, url)).map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function headersForUrl(identity, url) {
  const output = {};
  for (const binding of Array.isArray(identity?.headerBindings) ? identity.headerBindings : []) {
    try {
      const actual = new URL(url);
      const expected = new URL(binding.origin);
      if (actual.protocol !== expected.protocol || actual.host !== expected.host) continue;
      if (expected.pathname !== "/" && actual.pathname !== expected.pathname && !actual.pathname.startsWith(`${expected.pathname.replace(/\/$/, "")}/`)) continue;
      for (const [name, value] of Object.entries(binding.headers || {})) output[name] = value;
    } catch { /* Ignore malformed imported bindings; vault normalization filters them. */ }
  }
  return output;
}

function identitySecretValues(identity) {
  const values = [];
  for (const cookie of Array.isArray(identity?.storageState?.cookies) ? identity.storageState.cookies : []) values.push(cookie?.value);
  for (const binding of Array.isArray(identity?.headerBindings) ? identity.headerBindings : []) for (const value of Object.values(binding?.headers || {})) values.push(value);
  for (const value of Object.values(identity?.unmappedTokens || {})) values.push(value);
  return values;
}

function createReplayRequestTool({ fetchImpl = globalThis.fetch, identityProvider = null, redirectGuard = null, maxRedirects = 10 } = {}) {
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;

  function resolveIdentity(identityId, executionContext) {
    if (!identityId) return { providerAvailable: true, found: true, identity: null };
    if (!identityProvider || typeof identityProvider.load !== "function") {
      return { providerAvailable: false, found: false, identity: null };
    }
    const identity = identityProvider.load(identityId, executionContext);
    return { providerAvailable: true, found: Boolean(identity), identity: identity || null };
  }

  const adapter = {
    name: "replay_request",
    inputSchema: REPLAY_REQUEST_INPUT_SCHEMA,
    async execute(input, executionContext, runtime = {}) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(REPLAY_ERROR_CODES.INVALID_CONTEXT, "replay_request requires a restricted tool execution context projection");
      }

      const identityResolution = resolveIdentity(input.identityId, executionContext);
      if (input.identityId && !identityResolution.providerAvailable) {
        return structuredFailure(
          REPLAY_ERROR_CODES.IDENTITY_PROVIDER_UNAVAILABLE,
          "no identity provider is configured for replay_request; wire one at composition",
          { identityId: input.identityId },
        );
      }
      if (input.identityId && !identityResolution.found) {
        return structuredFailure(REPLAY_ERROR_CODES.INVALID_INPUT, `identity not found: ${input.identityId}`, { identityId: input.identityId });
      }
      const url = input.request.url;
      let currentUrl = url;
      const method = String(input.request.method || "GET").toUpperCase();
      let currentMethod = method;
      let currentBody = input.request.body;
      const timeoutMs = input.request.timeoutMs || input.config?.timeoutMs || 30000;
      const followRedirects = input.request.followRedirects ?? input.config?.followRedirects ?? true;

      const identity = identityResolution.identity;
      const baseHeaders = safeRequestHeaders(mergeHeaders(input.request.headers, input.config?.headers));

      const startedAt = Date.now();
      let response;
      let redirectCount = 0;
      // Always walk redirects manually when following them. This is required
      // even without an injected scope guard so origin-bound cookies and
      // headers can be recomputed before every hop.
      const manualRedirects = followRedirects;
      while (true) {
        if (manualRedirects && typeof redirectGuard === "function") {
          let guard;
          try {
            guard = await redirectGuard(currentUrl, executionContext, { initialUrl: url, redirectCount });
          } catch (error) {
            return structuredFailure(REPLAY_ERROR_CODES.SCOPE_DENIED, `redirect scope could not be verified: ${error.message}`, { url: currentUrl });
          }
          if (guard && guard.ok === false) {
            return structuredFailure(REPLAY_ERROR_CODES.SCOPE_DENIED, guard.reason || "The redirect destination is outside the reviewed scope.", { url: currentUrl, scope: guard });
          }
        }
        try {
          const controller = new AbortController();
          const onAbort = () => controller.abort();
          if (runtime.signal) {
            if (runtime.signal.aborted) controller.abort();
            else runtime.signal.addEventListener("abort", onAbort, { once: true });
          }
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
          const identityHeaders = identity ? headersForUrl(identity, currentUrl) : {};
          const cookieHeader = identity ? cookiesForUrl(identity, currentUrl) : "";
          const requestHeaders = { ...baseHeaders, ...identityHeaders };
          if (cookieHeader) requestHeaders.Cookie = cookieHeader;
          response = await fetchFn(currentUrl, {
            method: currentMethod,
            headers: requestHeaders,
              body: currentMethod === "GET" || currentMethod === "HEAD" ? undefined : currentBody,
              redirect: "manual",
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
            runtime.signal?.removeEventListener?.("abort", onAbort);
          }
        } catch (error) {
          if (error?.name === "AbortError") {
            if (runtime.signal?.aborted) return structuredFailure(REPLAY_ERROR_CODES.STOPPED, "request stopped by the operator", { url: currentUrl });
            return structuredFailure(REPLAY_ERROR_CODES.TIMEOUT, `request timed out after ${timeoutMs}ms`, { url: currentUrl, timeoutMs });
          }
          return structuredFailure(REPLAY_ERROR_CODES.NETWORK_FAILED, error.message, { url: currentUrl });
        }
        const statusCode = response?.status ?? response?.statusCode ?? 0;
        if (!manualRedirects || statusCode < 300 || statusCode >= 400) break;
        const location = typeof response?.headers?.get === "function"
          ? response.headers.get("location")
          : response?.headers?.location || response?.headers?.Location;
        if (!location) break;
        if (redirectCount >= Math.max(0, Number(maxRedirects) || 10)) {
          return structuredFailure(REPLAY_ERROR_CODES.REDIRECT_LIMIT, "redirect limit exceeded", { url: currentUrl, maxRedirects });
        }
        try {
          const redirected = new URL(String(location), currentUrl);
          if (!["http:", "https:"].includes(redirected.protocol)) {
            return structuredFailure(REPLAY_ERROR_CODES.SCOPE_DENIED, "redirect destination must use http or https", { url: redirected.toString() });
          }
          currentUrl = redirected.toString();
          const switchToGet = statusCode === 303 && currentMethod !== "HEAD"
            || (statusCode === 301 || statusCode === 302) && currentMethod === "POST";
          if (switchToGet) {
            currentMethod = "GET";
            currentBody = undefined;
            removeEntityHeaders(baseHeaders);
          }
        } catch {
          return structuredFailure(REPLAY_ERROR_CODES.SCOPE_DENIED, "redirect destination is not a valid absolute URL", { url: currentUrl });
        }
        redirectCount += 1;
      }

      const finishedAt = Date.now();
      const status = response?.status ?? response?.statusCode ?? null;
      let bodyText = "";
      if (response && typeof response.text === "function") {
        try {
          bodyText = (await response.text()).slice(0, 100_000);
        } catch {
          bodyText = "";
        }
      }

      return {
        ok: true,
        value: {
          url,
          finalUrl: currentUrl,
          method,
          finalMethod: currentMethod,
          status,
          statusText: response?.statusText || null,
          headers: response?.headers ? Object.fromEntries(response.headers) : {},
          body: bodyText,
          identityId: input.identityId || null,
          startedAt,
          finishedAt,
          elapsedMs: finishedAt - startedAt,
          timedOut: false,
        },
      };
    },
  };

  return adapter;
}

module.exports = {
  REPLAY_REQUEST_INPUT_SCHEMA,
  REPLAY_ERROR_CODES,
  createReplayRequestTool,
  validateInput,
};
