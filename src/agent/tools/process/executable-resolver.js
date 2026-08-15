const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TOOL_BIN_ENV_KEYS = Object.freeze([
  "XEKUTE_TOOLS_BIN",
  "POINTER_TOOLS_BIN",
  "SECURITY_TOOLS_BIN",
]);

function uniquePaths(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const clean = String(value || "").trim();
    if (!clean) continue;
    const key = process.platform === "win32" ? clean.toLowerCase() : clean;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function candidateToolDirectories({
  env = process.env,
  homeDir = os.homedir(),
  resourcesPath = process.resourcesPath,
  cwd = process.cwd(),
  platform = process.platform,
} = {}) {
  const configured = TOOL_BIN_ENV_KEYS.flatMap((key) => String(env?.[key] || "").split(path.delimiter));
  const bundled = [
    resourcesPath ? path.join(resourcesPath, "tools", "bin") : "",
    resourcesPath ? path.join(resourcesPath, "resources", "tools", "bin") : "",
    cwd ? path.join(cwd, "tools", "bin") : "",
  ];
  const legacyWindows = platform === "win32" && homeDir
    ? [path.join(homeDir, "AppData", "Local", "Pointer", "tools", "bin")]
    : [];
  return uniquePaths([...configured, ...bundled, ...legacyWindows]);
}

function executableCandidates(name, platform = process.platform) {
  if (platform !== "win32") return [name];
  return [name, `${name}.exe`, `${name}.cmd`, `${name}.bat`];
}

function isFile(candidate, fsImpl = fs) {
  try {
    return fsImpl.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveSecurityExecutable(executable, options = {}) {
  const raw = String(executable || "").trim();
  if (!raw || /[\u0000\r\n]/.test(raw)) return "";
  const platform = options.platform || process.platform;
  const fsImpl = options.fsImpl || fs;
  if (path.isAbsolute(raw) || raw.includes("/") || raw.includes("\\")) return raw;

  for (const directory of candidateToolDirectories({ ...options, platform })) {
    for (const candidateName of executableCandidates(raw, platform)) {
      const candidate = path.join(directory, candidateName);
      if (isFile(candidate, fsImpl)) return candidate;
    }
  }
  return raw;
}

module.exports = {
  TOOL_BIN_ENV_KEYS,
  candidateToolDirectories,
  resolveSecurityExecutable,
};
