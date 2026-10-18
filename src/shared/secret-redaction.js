"use strict";

const SECRET_KEY_RE = /(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|credential|session[_-]?token)/i;
const HEADER_SECRET_RE = /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi;
const TOKEN_ASSIGNMENT_RE = /(?<![A-Za-z0-9])(api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|auth[_-]?token|token|password|passwd|secret)\s*[=:]\s*(["']?)[^\s,;"']{4,}\2/gi;
const PRIVATE_KEY_RE = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;

function redactSecrets(value) {
  return String(value ?? "")
    .replace(PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]")
    .replace(HEADER_SECRET_RE, (_match, name) => `${name}: [REDACTED]`)
    .replace(BEARER_RE, (_match, scheme) => `${scheme} [REDACTED]`)
    .replace(TOKEN_ASSIGNMENT_RE, (_match, name) => `${name}=[REDACTED]`);
}

const REDACTED = "[REDACTED]";

// Tools whose `-p` flag carries a password. Everywhere else `-p` is a port, a
// directory, a proxy or a parameter name, so redacting it would hide what was run.
const PASSWORD_P_HEADS = new Set([
  "hydra", "medusa", "ncrack", "patator", "sshpass", "mysql", "mysqldump", "mysqladmin", "mysqlshow", "mariadb",
  "mongo", "mongosh", "crackmapexec", "cme", "nxc", "netexec", "evil-winrm", "smbmap", "rdesktop", "xfreerdp", "freerdp",
]);
const KEEP_P_HEADS = new Set([
  "nmap", "masscan", "rustscan", "naabu", "zmap", "ssh", "scp", "sftp", "nc", "ncat", "netcat", "curl", "wget", "sqlmap",
  "gobuster", "ffuf", "wfuzz", "feroxbuster", "dirb", "nikto", "mkdir", "cp", "mv", "ls", "rm", "tar", "git", "rsync",
  "docker", "psql", "pg_dump", "openssl", "ping", "traceroute", "telnet", "ftp", "python", "python3", "node", "ruby",
  "perl", "go", "pip", "pip3", "npm", "make", "dig", "host", "nslookup", "whois", "tcpdump", "tshark", "hping3", "arp-scan",
]);
const LDAP_HEADS = new Set(["ldapsearch", "ldapmodify", "ldapadd", "ldapdelete", "ldapwhoami", "ldappasswd", "ldapcompare"]);
const COMMAND_WRAPPERS = new Set(["sudo", "doas", "env", "nohup", "time", "timeout", "nice", "ionice", "stdbuf", "proxychains", "proxychains4", "command", "exec"]);

const SEGMENT_SPLIT_RE = /(\s*(?:;|&&|\|\||\||\r?\n)\s*)/;
const URL_USERINFO_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@'"]+):([^/\s@'"]+)@/gi;
const BARE_USERINFO_RE = /(^|[\s'"=])([A-Za-z0-9._$-]+(?:\/[A-Za-z0-9._$-]+)?):([^\s@:'"/]+)@(?=[A-Za-z0-9.-])/g;
const USER_FLAG_RE = /(^|\s)(-u|-U|--user|--username)(\s+|=)(["']?)([^\s"':%]+)([:%])([^\s"']+)\4/g;
const LONG_SECRET_FLAG_RE = /(--(?:password|passwd|pass|passphrase|token|api[-_]?key|apikey|secret|client[-_]?secret|cookie|hashes?|ntlm|auth[-_]?token|access[-_]?token|bearer|proxy-pass(?:word)?))(\s+|=)("[^"]*"|'[^']*'|\S+)/gi;
const SHORT_P_ATTACHED_RE = /(^|\s)-p([^\s=\-][^\s]*)/g;
const SHORT_P_SPACED_RE = /(^|\s)-p(\s+)("[^"]*"|'[^']*'|\S+)/g;
const QUOTED_HEADER_RE = /(-H|--header)(\s+|=)(["'])([^"':]*(?:key|token|secret|auth|pass|session|csrf|cookie|credential)[^"':]*):\s*([^"']*)\3/gi;
const FREERDP_PASSWORD_RE = /(^|\s)\/p:(\S+)/g;
const OPENSSL_PASS_RE = /\bpass:(\S+)/g;
const ENV_ASSIGNMENT_RE = /(^|[\s;&|])((?:\$env:)?[A-Za-z0-9_]*(?:PASS|PWD|SECRET|TOKEN|KEY|CRED|AUTH)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|]+)/gi;
const TOKEN_SHAPE_RE = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
const HOST_LIKE_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}|localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|local|lan|internal|test|example|co|edu|gov))$/i;

function commandHead(segment) {
  const tokens = String(segment).trim().split(/\s+/);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].replace(/^["']|["']$/g, "");
    if (!token || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (COMMAND_WRAPPERS.has(token.toLowerCase())) {
      while (index + 1 < tokens.length && tokens[index + 1].startsWith("-")) index += 1;
      if (token.toLowerCase() === "timeout" && /^\d/.test(tokens[index + 1] || "")) index += 1;
      continue;
    }
    return token.split(/[\\/]/).pop().toLowerCase().replace(/\.(?:exe|py|sh|ps1|bat|cmd)$/, "");
  }
  return "";
}

function isPortSpec(value) { return /^[0-9][0-9,-]*$/.test(value) || value === "-"; }
function stripQuotes(value) { return String(value).replace(/^["']|["']$/g, ""); }

function pValueIsSecret(head, rawValue) {
  const value = stripQuotes(rawValue);
  if (!value || value === REDACTED || isPortSpec(value)) return false;
  if (PASSWORD_P_HEADS.has(head)) return true;
  if (KEEP_P_HEADS.has(head)) return false;
  return !/^[~./\\]/.test(value);
}

function redactCommandSegment(segment, head) {
  let text = segment
    .replace(URL_USERINFO_RE, (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`)
    .replace(BARE_USERINFO_RE, (_m, lead, user) => `${lead}${user}:${REDACTED}@`)
    .replace(USER_FLAG_RE, (match, lead, flag, spacing, quote, user, separator, rest) => {
      if (separator === ":" && (rest.startsWith("//") || (HOST_LIKE_RE.test(user) && /^\d{1,5}(?:[/?#]|$)/.test(rest)))) return match;
      return `${lead}${flag}${spacing}${quote}${user}${separator}${REDACTED}${quote}`;
    })
    .replace(LONG_SECRET_FLAG_RE, (_m, flag, spacing) => `${flag}${spacing}${REDACTED}`)
    .replace(QUOTED_HEADER_RE, (_m, flag, spacing, quote, name) => `${flag}${spacing}${quote}${name}: ${REDACTED}${quote}`)
    .replace(FREERDP_PASSWORD_RE, (_m, lead) => `${lead}/p:${REDACTED}`)
    .replace(OPENSSL_PASS_RE, `pass:${REDACTED}`)
    .replace(ENV_ASSIGNMENT_RE, (_m, lead, name) => `${lead}${name}=${REDACTED}`)
    .replace(TOKEN_SHAPE_RE, REDACTED);
  text = text
    .replace(SHORT_P_ATTACHED_RE, (match, lead, value) => (pValueIsSecret(head, value) ? `${lead}-p${REDACTED}` : match))
    .replace(SHORT_P_SPACED_RE, (match, lead, spacing, value) => (pValueIsSecret(head, value) ? `${lead}-p${spacing}${REDACTED}` : match));
  if (LDAP_HEADS.has(head)) text = text.replace(/(^|\s)-w(\s+)("[^"]*"|'[^']*'|\S+)/g, (_m, lead, spacing) => `${lead}-w${spacing}${REDACTED}`);
  if (head === "redis-cli") text = text.replace(/(^|\s)-a(\s+)("[^"]*"|'[^']*'|\S+)/g, (_m, lead, spacing) => `${lead}-a${spacing}${REDACTED}`);
  if (head === "curl") text = text.replace(/(^|\s)(-b)(\s+)(["']?)([^\s"']*=[^\s"']*)\4/g, (_m, lead, flag, spacing) => `${lead}${flag}${spacing}${REDACTED}`);
  return text;
}

const RESIDUAL_SECRET_PATTERNS = [
  /(?:^|[\s;&|])--(?:password|passwd|pass|passphrase|token|api[-_]?key|apikey|secret|cookie|hashes?|ntlm)(?:\s+|=)(?!\[REDACTED\])\S/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:(?!\[REDACTED\])[^/\s@]+@/i,
  /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*(?!\[REDACTED\])[^\s'"]{4,}/i,
  TOKEN_SHAPE_RE,
];

function hasResidualCommandSecret(text) {
  return RESIDUAL_SECRET_PATTERNS.some((pattern) => { pattern.lastIndex = 0; return pattern.test(text); });
}

// Redacts credentials in a command line (or any command-shaped string). Pure and
// idempotent. It is deliberately not built on redactSecrets: that function's
// header rule runs to the end of the line, which would swallow the rest of a
// command. When something secret-shaped is still left after the rules ran, the
// whole argument list is withheld instead of risking a leak.
function redactCommandLine(value, { retainSecrets = false, head = "" } = {}) {
  const text = String(value ?? "");
  if (retainSecrets || !text) return text;
  const parts = text.split(SEGMENT_SPLIT_RE);
  let firstHead = "";
  const redacted = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    const segmentHead = (index === 0 && head ? String(head).toLowerCase() : "") || commandHead(part);
    if (!firstHead && segmentHead) firstHead = segmentHead;
    return redactCommandSegment(part, segmentHead);
  }).join("");
  return hasResidualCommandSecret(redacted) ? `${firstHead || "command"} [arguments withheld]` : redacted;
}

// Same rules for an argv array. The result is a display string; it is never executed.
function redactCommandArgv(executable, argv, options = {}) {
  const joined = [executable, ...(Array.isArray(argv) ? argv : [])].filter((part) => part != null && part !== "").map(String).join(" ");
  return redactCommandLine(joined, { ...options, head: options.head || String(executable || "").split(/[\\/]/).pop() });
}

// Assistant tool calls keep their full arguments in the ledger, and a command such
// as `curl -u admin:pass ...` is among them. Any copy of the ledger that leaves for
// a model goes through this first. Messages without tool calls are returned as is.
function redactArgumentValue(value, options, depth = 0) {
  if (depth > 6 || value == null) return value;
  if (typeof value === "string") return redactCommandLine(value, options);
  if (Array.isArray(value)) return value.map((item) => redactArgumentValue(item, options, depth + 1));
  if (typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = redactArgumentValue(child, options, depth + 1);
  if (typeof value.executable === "string" && Array.isArray(value.args)) {
    const full = redactCommandArgv(value.executable, value.args, options);
    const original = [value.executable, ...value.args].map(String).join(" ");
    if (full !== original) output.args = [full.slice(value.executable.length).trim() || "[arguments withheld]"];
  }
  return output;
}

function redactToolCallMessages(messages, { retainSecrets = false } = {}) {
  if (retainSecrets || !Array.isArray(messages)) return messages;
  return messages.map((message) => {
    if (!message || message.role !== "assistant" || !Array.isArray(message.tool_calls) || !message.tool_calls.length) return message;
    const options = { retainSecrets };
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => {
        const raw = call?.function?.arguments;
        if (raw == null) return call;
        let redacted;
        if (typeof raw === "string") {
          try { redacted = JSON.stringify(redactArgumentValue(JSON.parse(raw), options)); }
          catch { redacted = redactCommandLine(raw, options); }
        } else redacted = redactArgumentValue(raw, options);
        return { ...call, function: { ...call.function, arguments: redacted } };
      }),
    };
  });
}

function redactStructuredValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactStructuredValue(item, seen));
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : redactStructuredValue(child, seen);
  }
  return output;
}

function redactKnownSecrets(value, knownSecrets = [], seen = new WeakSet()) {
  const secrets = Array.isArray(knownSecrets)
    ? [...new Set(knownSecrets.map((secret) => String(secret || "")).filter((secret) => secret.length >= 4))]
    : [];
  const visit = (item) => {
    if (typeof item === "string") {
      let output = redactSecrets(item);
      for (const secret of secrets) output = output.split(secret).join("[REDACTED]");
      return output;
    }
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return "[CIRCULAR]";
    seen.add(item);
    if (Array.isArray(item)) return item.map(visit);
    const output = {};
    for (const [key, child] of Object.entries(item)) output[key] = SECRET_KEY_RE.test(key) ? "[REDACTED]" : visit(child);
    return output;
  };
  return visit(value);
}

module.exports = { SECRET_KEY_RE, redactCommandArgv, redactCommandLine, redactKnownSecrets, redactSecrets, redactStructuredValue, redactToolCallMessages };
