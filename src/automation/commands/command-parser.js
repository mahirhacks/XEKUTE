"use strict";

/*
 * Node implementation of XEKUTE's deterministic slash-command boundary.
 *
 * This module intentionally has no Electron dependency so the main-process
 * runtime and future hosts can share the same command boundary.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const DEFAULT_COMMANDS = Object.freeze({
  "/passive": { role: "static", description: "Passive public reconnaissance", output: "recon/passive-recon.json", tools: ["subfinder", "amass", "theharvester"] },
  "/active": { role: "static", description: "Authorized active reconnaissance", output: "recon/active-recon.json", tools: ["httpx", "nmap", "ffuf"], wordlist: "", rate: 2, threads: 10 },
  "/endpoint": { role: "static", description: "Endpoint and page discovery", output: "enumeration/endpoints.json", tools: ["katana", "httpx"] },
  "/webclone": { role: "static", description: "Authorized WebClone inventory and screenshots", output: "enumeration/pages.json", tools: ["katana", "httpx", "gowitness"] },
  "/pentest": { role: "ai", aim: "Find and validate security weaknesses within the authorized assessment scope.", description: "AI-guided penetration testing that stays evidence-led and asks before intrusive actions.", prompt: "Run a scope-aware, hypothesis-driven penetration-test workflow using the Map and assessment evidence. Ask for confirmation before active testing." },
  "/scope": { role: "ai", description: "Review authorization and scope" },
  "/report": { role: "ai", description: "Build the assessment report" },
  "/map": { role: "ai", description: "Analyze application relationships" },
  "/settings": { role: "ai", description: "Open XEKUTE Settings" },
});

const TOOL_COMMANDS = Object.freeze({
  subfinder: (target) => ["subfinder", "-d", target, "-silent"],
  amass: (target) => ["amass", "enum", "-passive", "-d", target],
  theharvester: (target) => ["theHarvester", "-d", target, "-b", "all"],
  httpx: (target) => ["httpx", "-silent", "-json", "-u", target],
  nmap: (target) => ["nmap", "-Pn", "-T2", "--top-ports", "100", target],
  katana: (target) => ["katana", "-u", target, "-silent", "-jsonl", "-d", "3"],
  gowitness: (target) => ["gowitness", "scan", "single", "--url", target],
});

function loadOverrides(raw) {
  if (!raw) return {};
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function commandConfig(name, overrides) {
  const key = String(name || "").toLowerCase();
  const config = { ...(DEFAULT_COMMANDS[key] || {}) };
  const custom = overrides[key] || overrides[name] || {};
  if (custom && typeof custom === "object" && !Array.isArray(custom)) Object.assign(config, custom);
  return config;
}

function parseCommand(raw, overrides = null) {
  const text = String(raw || "").trim();
  if (!text.startsWith("/")) return { ok: false, error: "Command must start with '/'", code: "NOT_SLASH_COMMAND" };
  const parts = text.split(/\s+/);
  const name = parts[0].toLowerCase();
  const config = commandConfig(name, loadOverrides(overrides));
  if (!Object.keys(config).length) return { ok: false, error: `Unknown slash command: ${name}`, code: "UNKNOWN_COMMAND" };
  if (config.enabled === false) return { ok: false, error: `Slash command is disabled in XEKUTE Settings: ${name}`, code: "COMMAND_DISABLED" };
  return {
    ok: true,
    command: name,
    args: parts.slice(1),
    role: String(config.role || "ai").toLowerCase(),
    aim: config.aim || "",
    description: config.description || "",
    prompt: config.prompt || "",
    expectedOutput: config.expectedOutput || "",
    constraints: config.constraints || "",
    output: config.output || "",
    tools: Array.isArray(config.tools) ? config.tools : [],
    script: config.script || "",
    wordlist: config.wordlist || "",
    rate: config.rate ?? 2,
    threads: config.threads ?? 10,
  };
}

function readJson(file, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === typeof fallback && !Array.isArray(value) === !Array.isArray(fallback) ? value : fallback;
  } catch {
    return fallback;
  }
}

function targetUrl(target) {
  try { return new URL(String(target).includes("://") ? String(target) : `https://${target}`); } catch { return null; }
}

function normalizedHost(value) {
  return String(value || "").toLowerCase().replace(/^https?:\/\//, "").split("/")[0].split(":")[0].replace(/^\.+|\.+$/g, "");
}

function scopeValue(item, keys = ["value", "url", "host", "hostname", "pattern"]) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  return keys.map((key) => item[key]).find((value) => value != null && String(value).trim()) || "";
}

function hostMatches(host, value) {
  const candidate = normalizedHost(value);
  return host === candidate || (candidate.startsWith("*.") && host.endsWith(candidate.slice(1)));
}

function inScope(assessment, target) {
  const parsed = targetUrl(target);
  const host = (parsed?.hostname || normalizedHost(target)).toLowerCase().replace(/^\.+|\.+$/g, "");
  const scope = readJson(path.join(assessment, "scope", "in-scope.json"), {});
  const exclusions = readJson(path.join(assessment, "scope", "out-of-scope.json"), {});
  if ((exclusions.assets || []).some((item) => hostMatches(host, scopeValue(item)))) return [false, "Target matches scope/out-of-scope.json"];
  const targets = Array.isArray(scope.targets) ? scope.targets : [];
  const wildcards = Array.isArray(scope.wildcardRules) ? scope.wildcardRules : [];
  if (!targets.length && !wildcards.length) return [false, "No in-scope targets are configured"];
  const allowed = targets.some((item) => hostMatches(host, scopeValue(item))) || wildcards.some((item) => hostMatches(host, scopeValue(item)));
  return [allowed, allowed ? "Matched configured scope" : "Target is not in scope"];
}

function defaultScopeTarget(assessment) {
  const scope = readJson(path.join(assessment, "scope", "in-scope.json"), {});
  for (const item of scope.targets || []) {
    if (item && typeof item === "object" && (item.enabled === false || item.inScope === false)) continue;
    const value = String(scopeValue(item) || "").trim();
    if (!value || value.startsWith("*.") || (!value.includes("://") && /^[^/]+\/\d{1,2}$/.test(value))) continue;
    if (targetUrl(value)?.hostname) return value;
  }
  return "";
}

function targetForTool(tool, target) {
  const parsed = targetUrl(target);
  const hostname = parsed?.hostname || target;
  if (["subfinder", "amass", "theharvester", "nmap"].includes(tool)) return hostname;
  if (["httpx", "katana", "gowitness", "ffuf"].includes(tool)) {
    const scheme = parsed?.protocol === "http:" ? "http" : "https";
    const port = parsed?.port ? `:${parsed.port}` : "";
    const requestPath = parsed?.pathname || "";
    return `${scheme}://${hostname}${port}${requestPath}`;
  }
  return target;
}

function activeAuthorized(assessment) {
  const scope = readJson(path.join(assessment, "scope", "in-scope.json"), {});
  const config = readJson(path.join(assessment, "scope", "configurations.json"), {});
  const engagement = readJson(path.join(assessment, "scope", "engagement.json"), {});
  const gate = config.authorizationGate || {};
  const confirmed = Boolean(scope.authorization?.confirmed && (engagement.authorization?.confirmed ?? true) && gate.authorizationConfirmed);
  const reviewed = Boolean(gate.scopeReviewed && (engagement.scopeReview?.reviewed ?? true));
  const accepted = Boolean(gate.rulesAccepted && (engagement.scopeReview?.exclusionsConfirmed ?? true));
  const active = Boolean(gate.allowActiveRecon || scope.rulesOfEngagement?.allowActiveRecon);
  const authorized = confirmed && reviewed && accepted && active;
  return [authorized, authorized ? "Authorization, scope, and Rules of Engagement confirmed" : "Active recon requires confirmed authorization, reviewed scope, accepted Rules of Engagement, and allowActiveRecon"];
}

function buildToolCommand(tool, target, config, toolDir) {
  const effectiveTarget = targetForTool(tool, target);
  if (tool === "ffuf") {
    const wordlist = String(config.wordlist || process.env.POINTER_FFUF_WORDLIST || "").trim();
    const expanded = wordlist.replace(/^~(?=$|[\\/])/, process.env.USERPROFILE || process.env.HOME || "~");
    if (!expanded || !fs.existsSync(expanded)) return [null, "ffuf requires an explicitly configured wordlist (set command registry wordlist or POINTER_FFUF_WORDLIST)"];
    const outputFile = path.join(toolDir, `ffuf-${Date.now()}.json`);
    const rate = Math.max(1, Math.min(20, Number.parseInt(config.rate ?? 2, 10) || 2));
    const threads = Math.max(1, Math.min(20, Number.parseInt(config.threads ?? 10, 10) || 10));
    return [["ffuf", "-u", `${effectiveTarget.replace(/\/$/, "")}/FUZZ`, "-w", expanded, "-ac", "-rate", String(rate), "-t", String(threads), "-of", "json", "-o", outputFile], null];
  }
  const command = TOOL_COMMANDS[tool];
  return [command ? command(effectiveTarget) : [tool, effectiveTarget], null];
}

function parseLines(tool, text) {
  const assets = [];
  const endpoints = [];
  const pages = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    let item = null;
    try { item = JSON.parse(value); } catch { /* plain output */ }
    const url = item && typeof item === "object" ? (item.url || item.input) : null;
    if (url) {
      const parsed = targetUrl(url);
      endpoints.push({ method: item.method || "GET", host: parsed?.hostname || "", path: parsed?.pathname || "/", url, statusCode: item["status-code"] || item.status_code || null, discoveredBy: tool });
      pages.push({ url, path: parsed?.pathname || "/", title: item.title || "", statusCode: item["status-code"] || item.status_code || null, discoveredBy: tool });
    } else if (/^[A-Za-z0-9._-]+\.[A-Za-z]{2,}$/.test(value)) {
      assets.push({ type: "subdomain", value, source: tool, confidence: "observed" });
    } else if (/^https?:\/\//i.test(value)) {
      assets.push({ type: "url", value, source: tool, confidence: "observed" });
    }
  }
  return { assets, endpoints, pages };
}

function appendToolOutputLog(assessment, runId, command, target, results) {
  const logPath = path.join(assessment, "logs", "tool-output.jsonl");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const stamp = new Date().toISOString();
  const lines = results.map((result) => {
    const outputFile = result.outputFile || "";
    const absolute = outputFile ? path.join(assessment, outputFile) : "";
    let digest = "";
    if (absolute && fs.existsSync(absolute)) digest = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    return JSON.stringify({ runId, timestamp: stamp, tool: result.tool || command, command, target, exitCode: result.exitCode, outputPath: outputFile, sha256: digest, redacted: true, truncated: false });
  });
  if (lines.length) fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf8");
}

function mergeJson(file, command, target, results, assets, endpoints, pages) {
  const data = readJson(file, {});
  const document = Object.keys(data).length ? data : { schemaVersion: 3, runs: [], sources: [], discoveredAssets: [], findings: [], evidence: [], endpoints: [], pages: [], statistics: {} };
  const stamp = new Date().toISOString();
  const runId = `slash-${Date.now()}`;
  document.runs = [...(document.runs || []), { id: runId, startedAt: stamp, completedAt: stamp, operator: "XEKUTE slash command", tool: command, status: results.some((item) => item.exitCode === 0) ? "completed" : "partial", targetIds: [target], outputFiles: results.map((item) => item.outputFile).filter(Boolean), notes: "Generated by the local Node slash-command runner." }].slice(-100);
  const existingAssets = new Map((document.discoveredAssets || []).filter((item) => item && typeof item === "object").map((item) => [String(item.value), item]));
  for (const item of assets) if (!existingAssets.has(String(item.value))) existingAssets.set(String(item.value), item);
  document.discoveredAssets = [...existingAssets.values()].slice(-2000);
  if (endpoints.length) {
    const keys = new Set((document.endpoints || []).map((item) => `${item.method}\u0000${item.url}`));
    document.endpoints = [...(document.endpoints || []), ...endpoints.filter((item) => !keys.has(`${item.method}\u0000${item.url}`))].slice(-5000);
  }
  if (pages.length) {
    const keys = new Set((document.pages || []).map((item) => item.url));
    document.pages = [...(document.pages || []), ...pages.filter((item) => !keys.has(item.url))].slice(-5000);
  }
  document.statistics = { ...(document.statistics || {}), total: (document.endpoints || document.pages || document.discoveredAssets || []).length, lastRunAt: stamp };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  try { fs.renameSync(temporary, file); } catch { fs.copyFileSync(temporary, file); fs.rmSync(temporary, { force: true }); }
  appendToolOutputLog(path.dirname(path.dirname(file)), runId, command, target, results);
  return document;
}

function mergeAssetInventory(assessment, assets, source) {
  if (!assets.length) return;
  const file = path.join(assessment, "enumeration", "assets.json");
  const document = readJson(file, { schemaVersion: 3, assetTemplate: {}, assets: [], relationships: [], statistics: {} });
  const existing = new Map((document.assets || []).filter((item) => item && item.value).map((item) => [String(item.value), item]));
  const stamp = new Date().toISOString();
  for (const item of assets) {
    const value = String(item.value || "").trim();
    if (!value) continue;
    const current = existing.get(value) || {};
    existing.set(value, { ...current, ...item, source: item.source || source, lastSeen: stamp, firstSeen: current.firstSeen || stamp, inScope: current.inScope, scopeReason: current.scopeReason || "" });
  }
  document.assets = [...existing.values()].slice(-5000);
  document.statistics = { ...(document.statistics || {}), total: document.assets.length, unknownScope: document.assets.filter((item) => item.inScope == null).length, inScope: document.assets.filter((item) => item.inScope === true).length, outOfScope: document.assets.filter((item) => item.inScope === false).length, lastReconciledAt: stamp };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

function runProcess(args, cwd, timeoutMs = 90_000) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ timedOut: true, stdout, stderr }); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-500_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-100_000); });
    child.on("error", (error) => finish({ error }));
    child.on("close", (code) => finish({ code, stdout, stderr }));
  });
}

async function runCommand(raw, assessment, overrides = null) {
  const parsed = parseCommand(raw, overrides);
  if (!parsed.ok) return parsed;
  if (parsed.role !== "static") return { ...parsed, ok: true, mode: "ai" };
  if (!assessment || !fs.existsSync(assessment) || !fs.statSync(assessment).isDirectory()) return { ok: false, error: "Open an assessment before running static recon commands", code: "ASSESSMENT_REQUIRED" };
  const target = parsed.args[0] || defaultScopeTarget(assessment);
  if (!target) return { ok: false, error: `No target was supplied and ${parsed.command} could not derive one from scope/in-scope.json`, code: "TARGET_REQUIRED" };
  const [allowed, scopeReason] = inScope(assessment, target);
  if (!allowed) return { ok: false, error: scopeReason, code: "OUT_OF_SCOPE" };
  if (["/active", "/endpoint", "/webclone"].includes(parsed.command)) {
    const [authorized, authReason] = activeAuthorized(assessment);
    if (!authorized) return { ok: false, error: authReason, code: "AUTHORIZATION_REQUIRED" };
  }
  const results = [];
  const assets = [];
  const endpoints = [];
  const pages = [];
  const toolDir = path.join(assessment, "tools", parsed.command.slice(1));
  fs.mkdirSync(toolDir, { recursive: true });
  const reconMode = parsed.command === "/passive" ? "passive" : parsed.command === "/active" ? "active" : null;
  const reconRoot = reconMode ? path.join(assessment, "recon", reconMode) : null;
  for (const tool of parsed.tools || []) {
    if (tool === "custom_script") continue;
    const [args, configurationError] = buildToolCommand(tool, target, parsed, toolDir);
    if (configurationError) { results.push({ tool, status: "configuration_required", error: configurationError }); continue; }
    if (!args || !args[0]) continue;
    const started = Date.now();
    const executableResult = await runProcess(args, assessment);
    if (executableResult.error) { results.push({ tool, status: executableResult.error.code === "ENOENT" ? "unavailable" : "error", error: executableResult.error.message }); continue; }
    if (executableResult.timedOut) { results.push({ tool, status: "timeout", error: "Tool exceeded the 90 second safety limit" }); continue; }
    const output = `${executableResult.stdout || ""}${executableResult.stderr ? `\n${executableResult.stderr}` : ""}`.slice(0, 500_000);
    const toolOutDir = reconRoot ? path.join(reconRoot, tool) : toolDir;
    fs.mkdirSync(toolOutDir, { recursive: true });
    const outputFile = path.join(toolOutDir, `${tool}-${Date.now()}.txt`);
    fs.writeFileSync(outputFile, output, "utf8");
    const found = parseLines(tool, output, target);
    assets.push(...found.assets); endpoints.push(...found.endpoints); pages.push(...found.pages);
    results.push({ tool, command: args, exitCode: executableResult.code, durationSeconds: Math.round((Date.now() - started) / 10) / 100, outputFile: path.relative(assessment, outputFile).replace(/\\/g, "/") });
  }
  const outputRelative = parsed.output || "";
  if (outputRelative) {
    mergeJson(path.join(assessment, outputRelative), parsed.command, target, results, assets, endpoints, pages);
    mergeAssetInventory(assessment, assets, parsed.command);
  }
  return { ok: true, mode: "static", command: parsed.command, target, results, output: outputRelative, normalized: { assets: assets.length, endpoints: endpoints.length, pages: pages.length } };
}

module.exports = { DEFAULT_COMMANDS, parseCommand, runCommand, inScope, defaultScopeTarget, targetForTool, buildToolCommand };
