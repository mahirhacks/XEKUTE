"use strict";

const MAX_APPLY_PATCH_DELETES = 3;

const SECURITY_SCANNER_RE = /\b(nmap|ncat|nping|masscan|nuclei|sqlmap|hydra|medusa|gobuster|dirbuster|dirb|ffuf|feroxbuster|wfuzz|nikto|wpscan|rustscan|naabu|katana|subfinder|amass|whatweb|wafw00f|testssl(?:\.sh)?|enum4linux|zap-cli)\b/i;
const HTTP_CLIENT_RE = /\b(curl|wget|httpie|httpx)\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b/i;
const OBSERVATIONAL_SCANNER_RE = /\b(Get-Command|Get-Help|where(?:\.exe)?|which|type|help)\b|--version(?:\s|$)|(?:^|\s)-(?:-help|h|v)(?:\s|$)/i;
const URL_RE = /https?:\/\/[^\s"'\\]+/gi;
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)(?:\/(?:3[0-2]|[12]?\d))?\b/g;
const HOSTNAME_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|dev|gov|edu|info|biz|test|local|lan|internal)\b/gi;
const LOOPBACK_RE = /^(?:127\.0\.0\.1|0\.0\.0\.0|localhost|::1)(?:[:/].*)?$/i;

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
  const found = [];
  for (const match of value.match(URL_RE) || []) found.push(match.replace(/[),.;]+$/, ""));
  for (const match of value.match(IPV4_RE) || []) found.push(match);
  for (const match of value.match(HOSTNAME_RE) || []) found.push(match);
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
  const wipe = isDestructiveWipeCommand(text);
  const requiresNetworkScope = ((scanner && !observational) || httpClient) && !wipe;
  return {
    text,
    scanner,
    httpClient,
    observational,
    networkTargets,
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
