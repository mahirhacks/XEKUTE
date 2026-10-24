"use strict";

const MAX_APPLY_PATCH_DELETES = 3;

const SECURITY_SCANNER_RE = /\b(nmap|ncat|nping|masscan|nuclei|sqlmap|hydra|medusa|gobuster|dirbuster|dirb|ffuf|feroxbuster|wfuzz|nikto|wpscan|rustscan|naabu|katana|subfinder|amass|whatweb|wafw00f|testssl(?:\.sh)?|enum4linux|zap-cli)\b/i;
const HTTP_CLIENT_RE = /\b(curl|wget|httpie|httpx)\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b/i;
const OBSERVATIONAL_SCANNER_RE = /\b(Get-Command|Get-Help|where(?:\.exe)?|which|type|help)\b|--version(?:\s|$)|(?:^|\s)-(?:-help|h|v)(?:\s|$)/i;
const URL_RE = /https?:\/\/[^\s"'\\]+/gi;
const IPV4_RE = /(?<![a-z0-9_./])\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\/(?:3[0-2]|[12]?\d))?\b/gi;
const HOSTNAME_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|gov|edu|info|biz|test|local|lan|internal)\b/gi;
const LOOPBACK_RE = /^(?:127\.0\.0\.1|0\.0\.0\.0|localhost|::1)(?:[:/].*)?$/i;
const MAX_STATIC_TARGETS = 200;
const VARIABLE_RE = /\$\{([a-z_]\w*)\}|\$([a-z_]\w*)/gi;

function literalLoopBindings(text) {
  if (!/\bforeach\s*\(/i.test(text) || /@["'][ \t]*\r?\n/.test(text)) return [];
  const structure = text.replace(/<#[\s\S]*?#>|#[^\r\n]*|'(?:''|[^'])*'|"(?:`[\s\S]|""|[^"`])*"/g, match => " ".repeat(match.length));
  if (structure.includes("`")) return [];
  const headers = /\bforeach\s*\(\s*\$([a-z_]\w*)\s+in\s+@\(([^()]*)\)\s*\)\s*\{/gi;
  const literal = /'(?:''|[^'])*'|"(?:""|[^"$`])*"/g;
  const bindings = [];
  for (const header of structure.matchAll(headers)) {
    const listStart = header.index + header[0].indexOf("@(") + 2;
    const listEnd = listStart + header[2].length;
    const list = text.slice(listStart, listEnd), parts = [...list.matchAll(literal)];
    if (!parts.length || parts.length > MAX_STATIC_TARGETS) continue;
    let cursor = 0, valid = true;
    for (const [index, part] of parts.entries()) {
      const separator = list.slice(cursor, part.index);
      if (!(index ? /^\s*,\s*$/ : /^\s*$/).test(separator)) valid = false;
      cursor = part.index + part[0].length;
    }
    if (!valid || !/^\s*$/.test(list.slice(cursor))) continue;
    const bodyStart = header.index + header[0].length;
    let depth = 1, bodyEnd = bodyStart;
    for (; bodyEnd < structure.length; bodyEnd++) {
      if (structure[bodyEnd] === "{") depth++;
      if (structure[bodyEnd] === "}" && --depth === 0) break;
    }
    if (depth) continue;
    const name = header[1].toLowerCase(), body = structure.slice(bodyStart, bodyEnd);
    const variable = `\\$(?:(?:(?:global|script|local|private):)?${name}\\b|\\{(?:(?:global|script|local|private):)?${name}\\})`;
    const assignment = new RegExp(`(?:${variable})(?:\\s*\\[[^\\]]*\\]|\\.\\w+)*\\s*(?:=(?!=)|[+*/%\\-]=|\\+\\+|--)|(?:\\+\\+|--)\\s*${variable}|\\bforeach\\s*\\(\\s*${variable}`, "i");
    if (assignment.test(body) || /\b(?:Set-Variable|New-Variable|Remove-Variable|Clear-Variable|Set-Item|Invoke-Expression|iex)\b|^\s*\.\s+/im.test(body)) continue;
    bindings.push({ name, listStart, listEnd, bodyStart, bodyEnd,
      values: parts.map(part => part[0].slice(1, -1).replaceAll(part[0][0].repeat(2), part[0][0])),
    });
  }
  return bindings.sort((a, b) => b.bodyStart - a.bodyStart);
}

function expandLoopUrl(url, offset, bindings, usedBindings, quote) {
  const location = url.split(/[?#]/, 1)[0];
  const names = [...new Set([...location.matchAll(VARIABLE_RE)].map(match => (match[1] || match[2]).toLowerCase()))];
  if (names.length && quote !== '"') return [url];
  let urls = [url];
  const used = [];
  for (const name of names) {
    const binding = bindings.find(candidate => candidate.name === name && offset >= candidate.bodyStart && offset < candidate.bodyEnd);
    if (!binding || urls.length * binding.values.length > MAX_STATIC_TARGETS) return [url];
    urls = urls.flatMap(candidate => binding.values.map(value => candidate.replace(VARIABLE_RE, (token, braced, plain) => (braced || plain).toLowerCase() === name ? value : token)));
    used.push(binding);
  }
  for (const binding of used) usedBindings.add(binding);
  return urls;
}

function commandText(args = {}) {
  return [
    args.command,
    args.executable,
    Array.isArray(args.args) ? args.args.join(" ") : "",
  ].filter(Boolean).join(" ");
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function isLoopbackTarget(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (LOOPBACK_RE.test(text)) return true;
  try {
    const host = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`).hostname;
    return LOOPBACK_RE.test(host);
  } catch {
    return false;
  }
}

function extractNetworkTargetsFromCommand(text) {
  const value = String(text || "");
  const found = [], usedBindings = new Set(), bindings = literalLoopBindings(value);
  let withoutUrls = value.replace(URL_RE, (match, offset) => {
    found.push(...expandLoopUrl(match.replace(/[),.;]+$/, ""), offset, bindings, usedBindings, value[offset - 1]));
    return " ".repeat(match.length);
  });
  for (const binding of usedBindings) withoutUrls = withoutUrls.slice(0, binding.listStart) + " ".repeat(binding.listEnd - binding.listStart) + withoutUrls.slice(binding.listEnd);
  for (const match of withoutUrls.match(IPV4_RE) || []) found.push(match);
  for (const match of withoutUrls.match(HOSTNAME_RE) || []) found.push(match);
  return unique(found).filter((target) => !isLoopbackTarget(target) && !/\.(?:js|cjs|mjs|ts|json|md|txt|ps1|bat|cmd)$/i.test(target));
}

function isObservationalScannerUse(text) {
  return OBSERVATIONAL_SCANNER_RE.test(String(text || ""));
}

function isDestructiveWipeCommand(text) {
  const value = String(text || "");
  const recursivePs = /\bRemove-Item\b/i.test(value) && /-Recurse\b/i.test(value);
  const recursiveUnix = /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\b/i.test(value);
  const recursiveCmd = /\b(?:del|rd|rmdir)\s+\/s\b/i.test(value);
  if (!recursivePs && !recursiveUnix && !recursiveCmd) return false;
  if (recursivePs && /,/.test(value)) return true;
  if (/(?:^|\s)['"]?(?:\.|\*|All|\.\*)['"]?(?:\s|$|,|;)/.test(value)) return true;
  if (/-Path\s+['"]?(?:\.|\*)['"]?(?:\s|$|,|;)/i.test(value)) return true;
  if (recursiveUnix && /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+['"]?(?:\.|\*|\/|~)['"]?(?:\s|$)/i.test(value)) return true;
  return false;
}

function applyPatchDeleteCount(args = {}) {
  const operations = Array.isArray(args.operations) ? args.operations : [];
  return operations.filter((operation) => String(operation?.kind || "").toLowerCase() === "delete").length;
}

function inspectExecCommand(args = {}) {
  const text = commandText(args);
  const scanner = SECURITY_SCANNER_RE.test(text);
  const httpClient = HTTP_CLIENT_RE.test(text);
  const observational = isObservationalScannerUse(text);
  const networkTargets = extractNetworkTargetsFromCommand(text);
  const unresolvedNetworkTargets = networkTargets.filter(target => target.split(/[?#]/, 1)[0].includes("$"));
  const wipe = isDestructiveWipeCommand(text);
  const requiresNetworkScope = ((scanner && !observational) || httpClient) && !wipe;
  return {
    text,
    scanner,
    httpClient,
    observational,
    networkTargets,
    unresolvedNetworkTargets,
    wipe,
    requiresNetworkScope,
  };
}

function evaluateMutationSafety(toolName, args = {}) {
  if (toolName === "apply_patch") {
    const deletes = applyPatchDeleteCount(args);
    if (deletes > MAX_APPLY_PATCH_DELETES) {
      return {
        ok: false,
        code: "MASS_DELETE_DENIED",
        reason: `apply_patch may delete at most ${MAX_APPLY_PATCH_DELETES} files per call. Mass workspace wipes are blocked.`,
        remediation: "Ask the operator to confirm specific paths, then delete at most three files per apply_patch call.",
      };
    }
  }
  if (toolName === "exec_command" && isDestructiveWipeCommand(commandText(args))) {
    return {
      ok: false,
      code: "DESTRUCTIVE_WIPE_DENIED",
      reason: "Recursive workspace wipes through exec_command are blocked.",
      remediation: "Do not empty the workspace. If a single generated directory must be removed, name that directory explicitly and avoid targeting the workspace root or multiple top-level trees.",
    };
  }
  return { ok: true, code: "MUTATION_SAFETY_OK" };
}

module.exports = {
  MAX_APPLY_PATCH_DELETES,
  commandText,
  extractNetworkTargetsFromCommand,
  inspectExecCommand,
  isDestructiveWipeCommand,
  applyPatchDeleteCount,
  evaluateMutationSafety,
};
