(function initSecurityInspector(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SecurityInspectorCodec = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSecurityInspector() {
  "use strict";

  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
  const COOKIE_ATTRIBUTES = new Set(["domain", "path", "expires", "max-age", "secure", "httponly", "samesite", "partitioned", "priority"]);

  function utf8Bytes(value) {
    const text = String(value ?? "");
    if (encoder) return encoder.encode(text);
    return Uint8Array.from(Buffer.from(text, "utf8"));
  }

  function utf8Text(bytes) {
    if (decoder) return decoder.decode(bytes);
    return Buffer.from(bytes).toString("utf8");
  }

  function bytesToBase64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const normalized = String(value || "").replace(/\s+/g, "");
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(normalized, "base64"));
    const binary = atob(normalized);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function toBase64Url(value) {
    return bytesToBase64(utf8Bytes(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  function base64UrlToBytes(value) {
    const raw = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    return base64ToBytes(raw + "=".repeat((4 - raw.length % 4) % 4));
  }

  function fromBase64Url(value) {
    return utf8Text(base64UrlToBytes(value));
  }

  function encodeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function decodeHtml(value) {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
    return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
      return named[lower] ?? match;
    });
  }

  function encodeTransform(value, format) {
    const text = String(value ?? "");
    if (format === "url") return encodeURI(text);
    if (format === "url-component") return encodeURIComponent(text);
    if (format === "base64") return bytesToBase64(utf8Bytes(text));
    if (format === "base64url") return toBase64Url(text);
    if (format === "html") return encodeHtml(text);
    if (format === "hex") return [...utf8Bytes(text)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (format === "json") return JSON.stringify(JSON.parse(text));
    throw new Error(`Unsupported transform: ${format}`);
  }

  function decodeTransform(value, format) {
    const text = String(value ?? "");
    if (format === "url") return decodeURI(text);
    if (format === "url-component") return decodeURIComponent(text.replace(/\+/g, " "));
    if (format === "base64") return utf8Text(base64ToBytes(text));
    if (format === "base64url") return fromBase64Url(text);
    if (format === "html") return decodeHtml(text);
    if (format === "hex") {
      const clean = text.replace(/(?:0x|\s|:|-)/gi, "");
      if (!clean || clean.length % 2 || /[^0-9a-f]/i.test(clean)) throw new Error("Hex input must contain complete byte pairs");
      return utf8Text(Uint8Array.from(clean.match(/.{2}/g), (pair) => parseInt(pair, 16)));
    }
    if (format === "json") return JSON.stringify(JSON.parse(text), null, 2);
    throw new Error(`Unsupported transform: ${format}`);
  }

  function parseJwt(token) {
    const value = String(token || "").trim().replace(/^Bearer\s+/i, "");
    const parts = value.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1]) throw new Error("JWT must contain header, payload, and signature segments");
    let header;
    let payload;
    try { header = JSON.parse(fromBase64Url(parts[0])); } catch { throw new Error("JWT header is not valid Base64URL JSON"); }
    try { payload = JSON.parse(fromBase64Url(parts[1])); } catch { throw new Error("JWT payload is not valid Base64URL JSON"); }
    return { token: value, parts, header, payload, signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` };
  }

  function analyzeJwt(parsed, nowSeconds = Math.floor(Date.now() / 1000)) {
    const warnings = [];
    const observations = [];
    const algorithm = String(parsed?.header?.alg || "missing");
    const payload = parsed?.payload || {};
    if (!parsed?.header?.alg) warnings.push("Algorithm claim is missing");
    if (algorithm.toLowerCase() === "none") warnings.push("Unsigned JWT uses alg=none");
    if (!parsed?.signature) warnings.push("Signature segment is empty");
    if (typeof payload.exp === "number") {
      const remaining = payload.exp - nowSeconds;
      observations.push(remaining >= 0 ? `Expires in ${remaining} seconds` : `Expired ${Math.abs(remaining)} seconds ago`);
      if (remaining < 0) warnings.push("Token is expired");
    } else warnings.push("No exp claim; token lifetime is unbounded by the token");
    if (typeof payload.nbf === "number" && payload.nbf > nowSeconds) warnings.push("Token is not active yet (nbf is in the future)");
    if (typeof payload.iat === "number" && payload.iat > nowSeconds + 60) warnings.push("Issued-at time is in the future");
    if (typeof payload.iat === "number" && typeof payload.exp === "number") observations.push(`Declared lifetime: ${payload.exp - payload.iat} seconds`);
    for (const key of ["iss", "sub", "aud", "jti", "scope", "role"]) if (payload[key] != null) observations.push(`${key}: ${Array.isArray(payload[key]) ? payload[key].join(", ") : payload[key]}`);
    return { algorithm, signed: Boolean(parsed?.signature), warnings, observations };
  }

  function findJwt(value) {
    const match = String(value || "").match(/(?:Bearer\s+)?(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/);
    return match ? match[1] : "";
  }

  function extractHeaderValues(raw, headerName) {
    const wanted = String(headerName || "").toLowerCase();
    return String(raw || "").split(/\r?\n/).flatMap((line) => {
      const separator = line.indexOf(":");
      return separator > 0 && line.slice(0, separator).trim().toLowerCase() === wanted ? [line.slice(separator + 1).trim()] : [];
    });
  }

  function splitPair(segment) {
    const index = segment.indexOf("=");
    return index < 0 ? [segment.trim(), ""] : [segment.slice(0, index).trim(), segment.slice(index + 1).trim()];
  }

  function safeDecode(value) {
    try { return decodeURIComponent(String(value || "").replace(/\+/g, " ")); } catch { return String(value || ""); }
  }

  function parseCookies(input) {
    const rows = [];
    for (const line of String(input || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      const segments = line.replace(/^(?:set-cookie|cookie)\s*:\s*/i, "").split(";").map((item) => item.trim()).filter(Boolean);
      const setCookieStyle = segments.slice(1).some((segment) => COOKIE_ATTRIBUTES.has(splitPair(segment)[0].toLowerCase()));
      const cookieSegments = setCookieStyle ? segments.slice(0, 1) : segments;
      const attributes = setCookieStyle ? Object.fromEntries(segments.slice(1).map((segment) => {
        const [name, value] = splitPair(segment);
        return [name.toLowerCase(), value || true];
      })) : {};
      for (const segment of cookieSegments) {
        const [name, value] = splitPair(segment);
        if (!name) continue;
        const notes = [];
        if (value.includes("%")) notes.push("URL encoded");
        if (findJwt(value)) notes.push("JWT value");
        if (setCookieStyle && !attributes.secure) notes.push("Secure missing");
        if (setCookieStyle && !attributes.httponly) notes.push("HttpOnly missing");
        if (setCookieStyle && !attributes.samesite) notes.push("SameSite missing");
        rows.push({ name, value, decodedValue: safeDecode(value), attributes: { ...attributes }, notes });
      }
    }
    return rows;
  }

  function transformCookieValues(input, mode) {
    return String(input || "").split(/\r?\n/).map((line) => line.split(";").map((segment) => {
      const [name, value] = splitPair(segment);
      if (!name || COOKIE_ATTRIBUTES.has(name.toLowerCase()) || !segment.includes("=")) return segment.trim();
      const transformed = mode === "encode" ? encodeURIComponent(safeDecode(value)) : safeDecode(value);
      return `${name}=${transformed}`;
    }).join("; ")).join("\n");
  }

  return {
    analyzeJwt,
    base64UrlToBytes,
    bytesToBase64,
    decodeTransform,
    encodeTransform,
    extractHeaderValues,
    findJwt,
    fromBase64Url,
    parseCookies,
    parseJwt,
    toBase64Url,
    transformCookieValues,
    utf8Bytes,
  };
});
