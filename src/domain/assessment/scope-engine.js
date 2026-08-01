const net = require("net");
const dns = require("dns").promises;
const { domainToASCII } = require("url");

function normalizeHostname(value) {
  return domainToASCII(String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""));
}

function canonicalTarget(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    const url = new URL(candidate);
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();
    if (!["http", "https"].includes(scheme)) return null;
    const hostname = normalizeHostname(url.hostname);
    if (!hostname) return null;
    const port = Number(url.port || (scheme === "https" ? 443 : 80));
    const path = url.pathname || "/";
    return { raw: text, scheme, hostname, port, path, isIp: net.isIP(hostname) > 0 };
  } catch {
    return null;
  }
}

function ipv4Number(ip) {
  if (net.isIP(ip) !== 4) return null;
  return ip.split(".").reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function cidrContains(cidr, hostname) {
  const match = String(cidr || "").trim().match(/^([^/]+)\/(\d{1,2})$/);
  if (!match || net.isIP(match[1]) !== 4 || net.isIP(hostname) !== 4) return false;
  const bits = Number(match[2]);
  if (bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(match[1]) & mask) === (ipv4Number(hostname) & mask);
}

function isPrivateOrReservedIp(ip) {
  if (net.isIP(ip) === 4) {
    const value = ipv4Number(ip);
    const inCidr = (cidr) => cidrContains(cidr, ip);
    return ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"].some(inCidr) || value == null;
  }
  if (net.isIP(ip) === 6) {
    const normalized = ip.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
  }
  return true;
}

async function resolveTargetAddresses(rawTarget, { lookup = dns.lookup } = {}) {
  const target = typeof rawTarget === "object" && rawTarget?.hostname ? rawTarget : canonicalTarget(rawTarget);
  if (!target) return { ok: false, code: "TARGET_INVALID", reason: "The target could not be canonicalized." };
  let addresses;
  try {
    addresses = target.isIp
      ? [target.hostname]
      : (await lookup(target.hostname, { all: true, verbatim: true })).map((record) => String(record.address)).filter((address) => net.isIP(address));
  } catch (error) {
    return { ok: false, code: "DNS_RESOLUTION_FAILED", reason: `DNS resolution failed: ${error.message}`, target, addresses: [] };
  }
  const unique = [...new Set(addresses)].sort();
  if (!unique.length) return { ok: false, code: "DNS_EMPTY", reason: "DNS returned no usable addresses for the target." };
  const unsafe = unique.filter(isPrivateOrReservedIp);
  if (unsafe.length) return { ok: false, code: "DNS_PRIVATE_OR_RESERVED", reason: `Target resolution includes unsupported private or reserved addresses: ${unsafe.join(", ")}.`, target, addresses: unique };
  return { ok: true, target, addresses: unique, fingerprint: unique.join("|") };
}

function compareResolution(expected, actual) {
  const first = [...new Set(Array.isArray(expected) ? expected.map(String) : [])].sort();
  const second = [...new Set(Array.isArray(actual) ? actual.map(String) : [])].sort();
  const same = first.length === second.length && first.every((address, index) => address === second[index]);
  return { ok: same, code: same ? "DNS_STABLE" : "DNS_REBINDING_DETECTED", reason: same ? "DNS resolution is stable for this action." : "DNS resolution changed between policy evaluation and tool execution.", expected: first, actual: second };
}

function entryValue(entry) {
  if (typeof entry === "string") return entry;
  return entry?.value || entry?.url || entry?.host || entry?.hostname || entry?.pattern || "";
}

function matchesEntry(target, entry, { wildcard = false } = {}) {
  const raw = String(entryValue(entry) || "").trim();
  if (!raw || entry?.inScope === false || entry?.enabled === false) return false;
  if (raw.includes("/") && !raw.includes("://") && cidrContains(raw, target.hostname)) return true;
  const isWildcard = wildcard || raw.startsWith("*.");
  const normalizedRaw = raw.replace(/^\*\./, "");
  const configured = canonicalTarget(normalizedRaw);
  if (!configured) return false;
  const hostMatches = isWildcard
    ? target.hostname.endsWith(`.${configured.hostname}`) && target.hostname !== configured.hostname
    : target.hostname === configured.hostname;
  if (!hostMatches) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedRaw)) {
    if (target.scheme !== configured.scheme || target.port !== configured.port) return false;
    if (configured.path !== "/" && !(target.path === configured.path || target.path.startsWith(`${configured.path.replace(/\/$/, "")}/`))) return false;
  }
  const configuredPorts = Array.isArray(entry?.ports) ? entry.ports.map(Number) : [];
  if (configuredPorts.length && !configuredPorts.includes(target.port)) return false;
  return true;
}

function evaluateTarget(rawTarget, { targets = [], wildcardRules = [], excludedTargets = [] } = {}) {
  const target = typeof rawTarget === "object" && rawTarget?.hostname ? rawTarget : canonicalTarget(rawTarget);
  if (!target) return { known: false, allowed: false, code: "TARGET_INVALID", reason: "The action has no canonical HTTP/HTTPS target." };
  if ((excludedTargets || []).some((entry) => matchesEntry(target, entry, { wildcard: String(entryValue(entry)).startsWith("*.") }))) {
    return { known: true, allowed: false, target, code: "TARGET_OUT_OF_SCOPE", reason: "The canonical target matches an out-of-scope rule." };
  }
  const entries = [...(Array.isArray(targets) ? targets : []), ...(Array.isArray(wildcardRules) ? wildcardRules : [])];
  if (!entries.length) return { known: false, allowed: false, target, code: "SCOPE_EMPTY", reason: "No reviewed in-scope target matches are configured." };
  const allowed = entries.some((entry) => matchesEntry(target, entry, { wildcard: String(entryValue(entry)).startsWith("*.") || Boolean(entry?.includeSubdomains) }));
  return { known: true, allowed, target, code: allowed ? "TARGET_IN_SCOPE" : "TARGET_OUT_OF_SCOPE", reason: allowed ? "Canonical target is in scope." : "Canonical target is not present in the reviewed allowlist." };
}

function extractCommandTargets(command) {
  const value = String(command || "");
  const values = new Set();
  for (const match of value.matchAll(/https?:\/\/[^\s"'<>|;&]+/gi)) values.add(match[0]);
  for (const match of value.matchAll(/(?:^|\s)(?:-u|--url|--host|-h|--target|-d)\s+(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/gi)) values.add(match[1] || match[2] || match[3]);
  return [...values].map(canonicalTarget).filter(Boolean);
}

function zonedParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  } catch {
    return zonedParts(date, "UTC");
  }
}

function testingWindowAllows(windows, { now = new Date(), timeZone = "UTC" } = {}) {
  if (!Array.isArray(windows) || !windows.length) return { allowed: true, reason: "No testing window restriction is configured." };
  const parts = zonedParts(now, timeZone);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const day = String(parts.weekday || "").toLowerCase().slice(0, 3);
  const parseTime = (value) => { const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
  for (const entry of windows) {
    const object = typeof entry === "string" ? { start: entry.split("-")[0], end: entry.split("-")[1] } : entry || {};
    const days = Array.isArray(object.days) ? object.days.map((value) => String(value).toLowerCase().slice(0, 3)) : [];
    if (days.length && !days.includes(day)) continue;
    const start = parseTime(object.start);
    const end = parseTime(object.end);
    if (start == null || end == null) continue;
    const within = start <= end ? minute >= start && minute <= end : minute >= start || minute <= end;
    if (within) return { allowed: true, reason: "Current time is inside an approved testing window." };
  }
  return { allowed: false, code: "OUTSIDE_TESTING_WINDOW", reason: `Current time is outside all approved testing windows (${timeZone}).` };
}

module.exports = { normalizeHostname, canonicalTarget, cidrContains, isPrivateOrReservedIp, resolveTargetAddresses, compareResolution, evaluateTarget, extractCommandTargets, testingWindowAllows };
