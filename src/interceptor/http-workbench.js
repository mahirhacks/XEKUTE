const MAX_RESPONSE_BYTES = 1_000_000;
const ALLOWED_MODES = new Set(["interceptor", "repeater", "intruder"]);
const { decodeHttpBody, headersWithDecodedBodyLength } = require("./http-body-decoder");

function parseRawHttpRequest(rawRequest) {
  const raw = String(rawRequest || "").replace(/\r\n/g, "\n");
  const splitAt = raw.indexOf("\n\n");
  const head = splitAt >= 0 ? raw.slice(0, splitAt) : raw;
  const body = splitAt >= 0 ? raw.slice(splitAt + 2) : "";
  const lines = head.split("\n");
  const requestLine = lines.shift()?.trim() || "";
  const match = requestLine.match(/^([A-Z]{1,16})\s+(\S+)\s+HTTP\/\d(?:\.\d)?$/i);
  if (!match) return { error: "Request line must look like: GET /path HTTP/1.1", code: "INVALID_REQUEST_LINE" };

  const method = match[1].toUpperCase();
  const requestTarget = match[2];
  const headers = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) return { error: `Invalid header line: ${line}`, code: "INVALID_HEADER" };
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }

  const headerValue = (name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || "";
  let url;
  try {
    if (/^https?:\/\//i.test(requestTarget)) {
      url = new URL(requestTarget);
    } else {
      const host = headerValue("host");
      if (!host) return { error: "Relative requests require a Host header", code: "MISSING_HOST" };
      const explicitScheme = headerValue("x-pointer-scheme").toLowerCase();
      const scheme = explicitScheme === "http" || explicitScheme === "https"
        ? explicitScheme
        : /:80$/.test(host) ? "http" : "https";
      url = new URL(requestTarget, `${scheme}://${host}`);
    }
  } catch {
    return { error: "Request URL is invalid", code: "INVALID_URL" };
  }

  if (!["http:", "https:"].includes(url.protocol)) return { error: "Only HTTP and HTTPS requests are supported", code: "INVALID_PROTOCOL" };
  return { ok: true, method, url, headers, body, raw };
}

function targetValue(target) {
  return typeof target === "string" ? target : String(target?.value || "");
}

function urlMatchesTarget(url, target) {
  const raw = targetValue(target).trim();
  if (!raw) return false;
  const withoutScheme = raw.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (withoutScheme.startsWith("*.")) {
    const domain = withoutScheme.slice(2).split("/")[0].toLowerCase();
    return url.hostname.toLowerCase().endsWith(`.${domain}`);
  }
  try {
    const scoped = new URL(/^https?:\/\//i.test(raw) ? raw : `${url.protocol}//${raw}`);
    if (scoped.hostname.toLowerCase() !== url.hostname.toLowerCase()) return false;
    if (scoped.port && scoped.port !== url.port) return false;
    const scopePath = scoped.pathname.replace(/\/$/, "");
    return !scopePath || scopePath === "" || url.pathname === scopePath || url.pathname.startsWith(`${scopePath}/`);
  } catch {
    return url.hostname.toLowerCase() === withoutScheme.toLowerCase();
  }
}

function rawResponseText(status, statusText, headers, body) {
  return [
    `HTTP/1.1 ${status} ${statusText || ""}`.trimEnd(),
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    body,
  ].join("\r\n");
}

function wrapIntruderSlot(name) {
  return `§${name}§`;
}

function intruderSlotPattern() {
  return /§([A-Za-z_][\w-]*)§/g;
}

function findIntruderSlots(rawRequest) {
  return [...new Set([...String(rawRequest || "").matchAll(intruderSlotPattern())].map((match) => match[1]))];
}

function buildIntruderRequests(rawRequest, rawPayloadSets, attackType = "sniper", maxRequests = 25) {
  const request = String(rawRequest || "");
  const slots = findIntruderSlots(request);
  if (!slots.length) return { error: "Add at least one named payload position such as §id§", code: "NO_PAYLOAD_POSITIONS" };
  let parsed;
  try { parsed = JSON.parse(String(rawPayloadSets || "{}")); } catch { return { error: "Payload sets must be valid JSON", code: "INVALID_PAYLOADS" }; }

  const payloads = {};
  if (Array.isArray(parsed)) {
    for (const slot of slots) payloads[slot] = parsed.map(String);
  } else if (parsed && typeof parsed === "object") {
    for (const slot of slots) payloads[slot] = Array.isArray(parsed[slot]) ? parsed[slot].map(String) : [];
  }
  if (slots.some((slot) => !payloads[slot]?.length)) {
    return { error: `Missing payload array for: ${slots.filter((slot) => !payloads[slot]?.length).join(", ")}`, code: "MISSING_PAYLOAD_SET" };
  }

  const render = (values) => request.replace(intruderSlotPattern(), (_match, name) => values[name] ?? "");
  const combinations = [];
  const base = Object.fromEntries(slots.map((slot) => [slot, payloads[slot][0]]));

  if (attackType === "sniper") {
    for (const slot of slots) {
      for (const payload of payloads[slot]) combinations.push({ ...base, [slot]: payload });
    }
  } else if (attackType === "battering-ram") {
    const shared = payloads[slots[0]];
    for (const payload of shared) combinations.push(Object.fromEntries(slots.map((slot) => [slot, payload])));
  } else if (attackType === "pitchfork") {
    const count = Math.max(...slots.map((slot) => payloads[slot].length));
    for (let index = 0; index < count; index += 1) {
      combinations.push(Object.fromEntries(slots.map((slot) => [slot, payloads[slot][Math.min(index, payloads[slot].length - 1)]])));
    }
  } else if (attackType === "cluster-bomb") {
    const visit = (index, values) => {
      if (combinations.length >= maxRequests) return;
      if (index >= slots.length) { combinations.push({ ...values }); return; }
      const slot = slots[index];
      for (const payload of payloads[slot]) visit(index + 1, { ...values, [slot]: payload });
    };
    visit(0, {});
  } else {
    return { error: "Unknown Intruder attack type", code: "INVALID_ATTACK_TYPE" };
  }

  const capped = combinations.length > maxRequests;
  return {
    ok: true,
    slots,
    requests: combinations.slice(0, maxRequests).map(render),
    capped,
    maxRequests,
  };
}

function createSecurityHttpWorkbench({ fs, path, fetchImpl = globalThis.fetch, assessmentWorkspace }) {
  async function run({ assessmentPath, rawRequest, mode = "repeater", projectProfile = null, runtimeSettings = null } = {}) {
    if (!ALLOWED_MODES.has(mode)) return { error: "Unknown security workbench mode", code: "INVALID_MODE" };
    const verification = assessmentWorkspace.verify(assessmentPath);
    if (verification.error) return verification;

    if (!projectProfile || !runtimeSettings) return { error: "App-managed project settings are required", code: "PROJECT_SETTINGS_REQUIRED" };
    const rules = projectProfile.rulesOfEngagement || {};
    const inScope = { targets: projectProfile.scope?.inScopeTargets || [], authorization: projectProfile.authorization || {} };
    const configuration = { safety: { requestTimeoutSeconds: Number(rules.requestTimeoutSeconds) || 15 } };
    const settings = runtimeSettings;

    const parsed = parseRawHttpRequest(rawRequest);
    if (parsed.error) return parsed;
    if (!(inScope.targets || []).some((target) => urlMatchesTarget(parsed.url, target))) {
      return { error: `${parsed.url.hostname} is not listed under Project Settings > Scope`, code: "OUT_OF_SCOPE" };
    }

    const headers = { ...parsed.headers };
    for (const name of Object.keys(headers)) {
      if (["host", "content-length", "connection", "proxy-connection", "transfer-encoding", "x-pointer-scheme"].includes(name.toLowerCase())) delete headers[name];
    }
    const timeoutSeconds = Math.max(1, Math.min(Number(settings.requests?.timeoutSeconds ?? configuration.safety?.requestTimeoutSeconds) || 15, 30));
    const responseLimit = Math.max(1024, Math.min(Number(settings.requests?.maximumResponseBytes) || MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const started = Date.now();
    try {
      const response = await fetchImpl(parsed.url, {
        method: parsed.method,
        headers,
        body: ["GET", "HEAD"].includes(parsed.method) ? undefined : parsed.body,
        redirect: "manual",
        signal: controller.signal,
      });
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > responseLimit) {
        return { error: `Response exceeds the ${responseLimit}-byte workbench limit`, code: "RESPONSE_TOO_LARGE" };
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > responseLimit) return { error: `Response exceeds the ${responseLimit}-byte workbench limit`, code: "RESPONSE_TOO_LARGE" };

      const contentEncoding = response.headers.get("content-encoding") || "";
      const body = await decodeHttpBody(bytes, contentEncoding);
      const displayHeaders = headersWithDecodedBodyLength(responseHeaders, body);

      const responseRaw = rawResponseText(response.status, response.statusText, displayHeaders, body);
      const durationMs = Date.now() - started;
      const trafficRecord = {
        tool: mode,
        requestId: `req-${Date.now().toString(36)}`,
        targetId: "",
        method: parsed.method,
        url: parsed.url.toString(),
        statusCode: response.status,
        durationMs,
        request: parsed.raw,
        response: responseRaw,
      };
      const logged = settings.logging?.logRawTraffic === false
        ? { ok: true, disabled: true }
        : assessmentWorkspace.appendTrafficRecord(verification.root, trafficRecord);
      if (logged.error) return logged;
      return { ok: true, url: parsed.url.toString(), status: response.status, durationMs, response: responseRaw, logged };
    } catch (error) {
      const message = error?.name === "AbortError" ? `Request timed out after ${timeoutSeconds}s` : error.message;
      return { error: message, code: error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "REQUEST_FAILED" };
    } finally {
      clearTimeout(timer);
    }
  }

  return { run };
}

module.exports = {
  buildIntruderRequests,
  createSecurityHttpWorkbench,
  findIntruderSlots,
  parseRawHttpRequest,
  urlMatchesTarget,
  wrapIntruderSlot,
};
