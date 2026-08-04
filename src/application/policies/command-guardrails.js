/* Deterministic protection for generic command execution. */

const PROTECTED_ASSESSMENT_PATH_RE = /^(?:scope|recon|enumeration|findings|vulnerability-scans|penetration-testing|evidence|runs|logs|traffic|map|report)(?:\/|$)|^settings\.config$/i;
const PROTECTED_ASSESSMENT_COMMAND_RE = /(?:^|[\s"'`])(?:\.\/?|\.\\)?(?:scope|recon|enumeration|findings|vulnerability-scans|penetration-testing|evidence|runs|logs|traffic|map|report)[\\/]|settings\.config/i;
const DESTRUCTIVE_COMMAND_PATTERNS = Object.freeze([
  /\brm\s+-[^\n]*r[^\n]*f|\brm\s+-rf\b/i,
  /\brmdir\s+\/s\b|\bdel\s+\/s\b/i,
  /\bremove-item\b[^\n]*\b-recurse\b/i,
  /\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[^\s]*f/i,
  /\bformat(?:\.com)?\b|\bshutdown\b|\brestart-computer\b/i,
  /(?:curl|wget|invoke-webrequest)[^\n|]*\|\s*(?:sh|bash|zsh|pwsh|powershell|iex)\b/i,
]);

function commandGuardReason(command, { isSecurityCommand = () => false } = {}) {
  const value = String(command || "").trim();
  if (!value) return "Command is empty.";
  if (isSecurityCommand(value)) return "Security CLI commands must use run_security_tool so scope, rate limits, evidence capture, and adapter policy remain enforced.";
  if (/&&|\|\||[;\r\n]|(?:^|\s)\|(?:\s|$)/.test(value)) return "Run one bounded workspace command per tool call; shell command chains are not allowed.";
  if (PROTECTED_ASSESSMENT_COMMAND_RE.test(value)) return "Commands cannot address schema-managed assessment resources. Use read tools for inspection and ingest_assessment_records or another typed adapter for changes.";
  if (DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(value))) return "Potentially destructive command blocked. Use scoped workspace tools or ask the user for a safer explicit action.";
  return "";
}

module.exports = { PROTECTED_ASSESSMENT_PATH_RE, PROTECTED_ASSESSMENT_COMMAND_RE, DESTRUCTIVE_COMMAND_PATTERNS, commandGuardReason };
