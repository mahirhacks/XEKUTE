"use strict";

const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const { execFile: execFileDefault } = require("node:child_process");
const { redactSecrets } = require("../../../../shared/secret-redaction.js");

const PROFILE_VERSION = 1;
const SSH_HOST_RE = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.:-]*[a-zA-Z0-9])?$/;
const SSH_USER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const REMOTE_COMMAND_RE = /^[a-zA-Z0-9_./~+@%=-]{1,1000}$/;

function clean(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, "").trim().slice(0, maximum); }
function failure(code, message) { return { ok: false, error: { code, message, retryable: false } }; }
function posixQuote(value) { return `'${String(value).replace(/'/g, `'"'"'`)}'`; }

function createKaliAccessService({
  fs = fsDefault,
  path = pathDefault,
  home = () => process.env.USERPROFILE || process.env.HOME || process.cwd(),
  execFile = execFileDefault,
} = {}) {
  function filePath() { return path.join(home(), ".xekute", "kali-access.json"); }
  function emptyProfile() {
    return { version: PROFILE_VERSION, enabled: false, host: "", port: 22, username: "kali", identityFile: "", acceptNewHostKey: true, updatedAt: "" };
  }
  function normalize(input = {}, { requireConnection = false } = {}) {
    const value = input?.profile && typeof input.profile === "object" ? input.profile : input;
    const profile = {
      version: PROFILE_VERSION,
      enabled: value.enabled === true,
      host: clean(value.host, 253),
      port: Number(value.port || 22),
      username: clean(value.username || "kali", 64),
      identityFile: clean(value.identityFile, 32_768),
      acceptNewHostKey: value.acceptNewHostKey !== false,
      updatedAt: clean(value.updatedAt, 80),
    };
    if (!profile.enabled && !requireConnection) return { ok: true, value: profile };
    if (!SSH_HOST_RE.test(profile.host)) return failure("KALI_SSH_HOST_INVALID", "Enter a valid Kali hostname or IP address.");
    if (!SSH_USER_RE.test(profile.username)) return failure("KALI_SSH_USER_INVALID", "Enter a valid Kali SSH username.");
    if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) return failure("KALI_SSH_PORT_INVALID", "SSH port must be between 1 and 65535.");
    if (profile.identityFile) {
      try { if (!path.isAbsolute(profile.identityFile) || !fs.statSync(profile.identityFile).isFile()) throw new Error("not a file"); }
      catch { return failure("KALI_SSH_KEY_INVALID", "The selected SSH private-key file does not exist."); }
    }
    return { ok: true, value: profile };
  }
  function read() {
    try {
      if (!fs.existsSync(filePath())) return { ok: true, value: emptyProfile(), filePath: filePath() };
      const parsed = JSON.parse(fs.readFileSync(filePath(), "utf8"));
      const normalized = normalize(parsed);
      return normalized.ok ? { ok: true, value: normalized.value, filePath: filePath() } : normalized;
    } catch (error) { return failure("KALI_ACCESS_CONFIG_INVALID", error.message); }
  }
  function atomicWrite(value) {
    const target = filePath();
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`); } catch { /* Primary remains authoritative. */ }
    try { fs.renameSync(temporary, target); }
    catch (error) {
      try { fs.copyFileSync(temporary, target); fs.rmSync(temporary, { force: true }); }
      catch { try { fs.rmSync(temporary, { force: true }); } catch {} throw error; }
    }
    try { fs.chmodSync(target, 0o600); } catch { /* Windows profile permissions apply. */ }
  }
  function save(input = {}) {
    const normalized = normalize(input);
    if (!normalized.ok) return normalized;
    const value = { ...normalized.value, updatedAt: new Date().toISOString() };
    try { atomicWrite(value); return { ok: true, value, filePath: filePath() }; }
    catch (error) { return failure("KALI_ACCESS_WRITE_FAILED", error.message); }
  }
  function sshExecutable() { return process.platform === "win32" ? path.join(process.env.WINDIR || "C:\\Windows", "System32", "OpenSSH", "ssh.exe") : "ssh"; }
  function sshArgs(profile, remoteCommand) {
    const args = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"];
    args.push("-o", profile.acceptNewHostKey ? "StrictHostKeyChecking=accept-new" : "StrictHostKeyChecking=yes");
    args.push("-p", String(profile.port));
    if (profile.identityFile) args.push("-i", profile.identityFile);
    args.push(`${profile.username}@${profile.host}`, remoteCommand);
    return args;
  }
  async function test(input = {}) {
    const normalized = normalize(input, { requireConnection: true });
    if (!normalized.ok) return normalized;
    const started = Date.now();
    return new Promise((resolve) => execFile(sshExecutable(), sshArgs(normalized.value, "printf XEKUTE_KALI_READY"), { windowsHide: true, timeout: 20_000, maxBuffer: 64_000 }, (error, stdout, stderr) => {
      if (error) return resolve(failure("KALI_SSH_CONNECTION_FAILED", redactSecrets(clean(stderr || error.message || "Kali SSH connection failed.", 1_000))));
      if (!String(stdout || "").includes("XEKUTE_KALI_READY")) return resolve(failure("KALI_SSH_HANDSHAKE_FAILED", "Kali SSH connected but did not return the expected handshake."));
      return resolve({ ok: true, host: normalized.value.host, latencyMs: Date.now() - started });
    }));
  }
  function resolveMcpConfig(config = {}) {
    if (config?.xekute?.transport !== "kali") return { ok: true, config };
    const snapshot = read();
    if (!snapshot.ok) return snapshot;
    if (!snapshot.value.enabled) return failure("KALI_ACCESS_DISABLED", "Local Kali access is disabled in Settings > Tools & MCPs.");
    const profile = normalize(snapshot.value, { requireConnection: true });
    if (!profile.ok) return profile;
    const remoteCommand = clean(config.command, 1_000);
    const remoteCwd = clean(config.xekute.remoteCwd, 1_000);
    const remoteArgs = Array.isArray(config.args) ? config.args.map((item) => clean(item, 4_000)) : [];
    if (!REMOTE_COMMAND_RE.test(remoteCommand) || (remoteCwd && !REMOTE_COMMAND_RE.test(remoteCwd))) return failure("KALI_MCP_COMMAND_INVALID", "Kali MCP command and working directory must be simple remote paths.");
    const invocation = [posixQuote(remoteCommand), ...remoteArgs.map(posixQuote)].join(" ");
    const remote = remoteCwd ? `cd ${posixQuote(remoteCwd)} && exec ${invocation}` : `exec ${invocation}`;
    return {
      ok: true,
      config: {
        ...config,
        command: sshExecutable(),
        args: sshArgs(profile.value, remote),
        cwd: undefined,
        timeoutMs: Math.max(1_000, Math.min(120_000, Number(config.timeoutMs) || 45_000)),
      },
    };
  }
  return Object.freeze({ read, save, test, normalize, resolveMcpConfig, sshArgs, filePath });
}

module.exports = { createKaliAccessService, PROFILE_VERSION };
