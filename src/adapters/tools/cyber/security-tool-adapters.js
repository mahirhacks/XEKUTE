const path = require("path");
const ScopeEngine = require("../../../domain/assessment/scope-engine");

const ADAPTERS = Object.freeze({
  subfinder: { executable: "subfinder", capability: "passiveRecon", risk: "passive", args: ({ host }) => ["-silent", "-d", host] },
  amass: { executable: "amass", capability: "passiveRecon", risk: "passive", args: ({ host }) => ["enum", "-passive", "-d", host] },
  theharvester: { executable: "theHarvester", capability: "passiveRecon", risk: "passive", args: ({ host }) => ["-d", host, "-b", "all"] },
  httpx: {
    executable: "httpx",
    capability: "activeRecon",
    risk: "active",
    args: ({ url, configuration }) => [
      "-silent",
      "-json",
      "-u",
      url,
      "-timeout",
      String(Math.max(1, Math.ceil(configuration.timeoutMs / 1000))),
      "-rl",
      String(configuration.rateLimit),
      "-t",
      String(configuration.concurrency),
    ],
  },
  nmap: { executable: "nmap", capability: "activeRecon", risk: "active", args: ({ host, configuration }) => ["-Pn", "-sV", "--version-light", "-T3", "--max-rate", String(configuration.rateLimit), host] },
  wafw00f: { executable: "wafw00f", capability: "activeRecon", risk: "active", args: ({ url }) => [url] },
  "nmap-firewall": { executable: "nmap", capability: "activeRecon", risk: "active", args: ({ host, configuration }) => ["-Pn", "-sA", "--reason", "-p", String(configuration.port), "--max-rate", String(configuration.rateLimit), host] },
  hping3: { executable: "hping3", capability: "automatedScanning", risk: "active", args: ({ host, configuration }) => ["-S", "-c", String(configuration.packetCount), "-p", String(configuration.port), "-i", `u${Math.max(100000, Math.ceil(1000000 / configuration.rateLimit))}`, host] },
  traceroute: {
    executable: process.platform === "win32" ? "tracert" : "traceroute",
    capability: "activeRecon",
    risk: "active",
    args: ({ host, configuration }) => process.platform === "win32"
      ? ["-d", "-h", String(configuration.maxHops), "-w", String(Math.min(configuration.timeoutMs, 10000)), host]
      : ["-n", "-q", "1", "-m", String(configuration.maxHops), "-w", String(Math.max(1, Math.ceil(configuration.timeoutMs / 1000))), host],
  },
  naabu: { executable: "naabu", capability: "activeRecon", risk: "active", args: ({ host, configuration }) => ["-host", host, "-rate", String(configuration.rateLimit), "-json"] },
  katana: { executable: "katana", capability: "activeRecon", risk: "active", args: ({ url, configuration }) => ["-u", url, "-jsonl", "-fs", "fqdn", "-d", String(configuration.depth), "-c", String(configuration.concurrency)] },
  ffuf: { executable: "ffuf", capability: "automatedScanning", risk: "active", requiresWordlist: true, args: ({ url, configuration }) => ["-u", url.includes("FUZZ") ? url : `${url.replace(/\/$/, "")}/FUZZ`, "-w", configuration.wordlist, "-rate", String(configuration.rateLimit), "-t", String(configuration.concurrency), "-of", "json"] },
  gobuster: { executable: "gobuster", capability: "automatedScanning", risk: "active", requiresWordlist: true, args: ({ url, configuration }) => ["dir", "-u", url, "-w", configuration.wordlist, "-t", String(configuration.concurrency), "--delay", `${Math.max(1, Math.ceil(1000 / configuration.rateLimit))}ms`] },
  nuclei: { executable: "nuclei", capability: "automatedScanning", risk: "active", args: ({ url, configuration }) => ["-u", url, "-jsonl", "-rl", String(configuration.rateLimit), "-c", String(configuration.concurrency), "-severity", "info,low,medium,high,critical"] },
  nikto: { executable: "nikto", capability: "automatedScanning", risk: "active", args: ({ url }) => ["-host", url, "-nointeractive"] },
  testssl: { executable: "testssl", capability: "activeRecon", risk: "active", args: ({ host }) => ["--quiet", "--warnings", "batch", host] },
  sqlmap: { executable: "sqlmap", capability: "exploitValidation", risk: "exploit", args: ({ url, configuration }) => ["-u", url, "--batch", "--level", String(configuration.level), "--risk", String(configuration.risk), "--threads", String(configuration.concurrency), "--timeout", String(Math.ceil(configuration.timeoutMs / 1000)), "--stop-failing"] },
});

function safeString(value, max = 2000) {
  const text = String(value == null ? "" : value).trim();
  if (!text || /[\u0000\r\n]/.test(text) || text.length > max) return "";
  return text;
}

function quote(value) {
  const text = safeString(value);
  if (!text) throw new Error("Invalid empty or multiline process argument");
  return `"${text.replace(/"/g, '\\"')}"`;
}

function normalizeConfiguration(input = {}, policy = {}) {
  return {
    rateLimit: Math.max(1, Math.min(Number(input.rateLimit || input.rate_limit) || Number(policy.maxRequestsPerSecond) || 2, Number(policy.maxRequestsPerSecond) || 100)),
    concurrency: Math.max(1, Math.min(Number(input.concurrency) || Number(policy.maxConcurrency) || 1, Number(policy.maxConcurrency) || 20)),
    timeoutMs: Math.max(1000, Math.min(Number(input.timeoutMs || input.timeout_ms) || Number(policy.requestTimeoutSeconds) * 1000 || 15000, 120000)),
    depth: Math.max(1, Math.min(Number(input.depth) || 2, 5)),
    risk: Math.max(1, Math.min(Number(input.risk) || 1, 3)),
    level: Math.max(1, Math.min(Number(input.level) || 1, 5)),
    wordlist: safeString(input.wordlist, 1000),
    port: Math.max(1, Math.min(Math.round(Number(input.port) || 443), 65535)),
    packetCount: Math.max(1, Math.min(Math.round(Number(input.packetCount || input.packet_count) || 5), 20)),
    maxHops: Math.max(1, Math.min(Math.round(Number(input.maxHops || input.max_hops) || 20), 30)),
  };
}

function buildAction(args = {}, policy = {}) {
  const adapterId = String(args.adapter_id || args.adapterId || "").toLowerCase();
  const adapter = ADAPTERS[adapterId];
  if (!adapter) return { ok: false, code: "ADAPTER_UNKNOWN", error: `Unsupported security adapter: ${adapterId}` };
  const target = ScopeEngine.canonicalTarget(args.target);
  if (!target) return { ok: false, code: "TARGET_INVALID", error: "A canonical HTTP/HTTPS target is required." };
  const configuration = normalizeConfiguration(args.configuration, policy);
  if (adapter.requiresWordlist && !configuration.wordlist) return { ok: false, code: "WORDLIST_REQUIRED", error: `${adapterId} requires an explicitly configured wordlist.` };
    const context = { target, url: `${target.scheme}://${target.hostname}${target.port === 443 && target.scheme === "https" || target.port === 80 && target.scheme === "http" ? "" : `:${target.port}`}${target.path}`, host: target.hostname, configuration };
  const kind = adapter.capability === "passiveRecon" ? "passive" : "active";
  const defaultOutputPath = `recon/${kind}/${adapterId}/result-${Date.now()}.txt`;
  let processArgs;
  try { processArgs = adapter.args(context).map((value) => safeString(value)); } catch (error) { return { ok: false, code: "ADAPTER_BUILD_FAILED", error: error.message }; }
  if (processArgs.some((value) => !value)) return { ok: false, code: "ADAPTER_ARGUMENT_INVALID", error: "Adapter produced an invalid argument." };
  const outputPath = safeString(args.output_path || defaultOutputPath, 1000).replace(/\\/g, "/");
  if (!outputPath || path.posix.isAbsolute(outputPath) || outputPath.split("/").includes("..")) return { ok: false, code: "OUTPUT_PATH_INVALID", error: "Output path must remain inside the assessment." };
  return {
    ok: true,
    action: {
      adapterId,
      executable: adapter.executable,
      processArgs,
      capability: adapter.capability,
      risk: adapter.risk,
      target,
      techniqueIds: Array.isArray(args.technique_ids) ? args.technique_ids.map(String).slice(0, 30) : [],
      hypothesisId: safeString(args.hypothesis_id, 160),
      expectedSignal: safeString(args.expected_signal, 1200),
      evidencePlan: Array.isArray(args.evidence_plan) ? args.evidence_plan.map((value) => safeString(value, 500)).filter(Boolean).slice(0, 20) : [],
      configuration,
      outputPath,
      command: [adapter.executable, ...processArgs.map(quote)].join(" "),
    },
  };
}

function yamlScalar(value) {
  const text = String(value == null ? "" : value);
  const needsQuote = /[:#\[\]{}&*!|>'"%@`]|^\s|\s$|^\d+$|^[-\s]|:\s/.test(text) || text === "" || /^[yn]es$|^[yt]rue$|^[no]false$/i.test(text);
  if (!needsQuote) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildTraffsuckerConfig(plan) {
  const lines = [];
  lines.push("# Autogenerated by XEKUTE for the traffsucker subagent. Do not store secrets here.");
  const context = String(plan.context || "").trim();
  const goal = String(plan.goal || "").trim();
  if (context) {
    lines.push("context: |");
    for (const row of context.split(/\r?\n/)) lines.push(`  ${row}`);
  }
  if (goal) {
    lines.push("goal: |");
    for (const row of goal.split(/\r?\n/)) lines.push(`  ${row}`);
  }
  lines.push("scope:");
  lines.push(`  hosts: [${yamlScalar(plan.host)}]`);
  lines.push("  exclude_hosts: []");
  lines.push(`  analysis: ${yamlScalar(plan.scopeAnalysis || "same_site")}`);
  lines.push("map:");
  lines.push("  browser:");
  lines.push(`    engine: ${yamlScalar(plan.browserEngine || "chromium")}`);
  if (plan.browserEngine === "lightpanda" && plan.cdpUrl) {
    lines.push(`    cdp_url: ${yamlScalar(plan.cdpUrl)}`);
  }
  lines.push(`  max_pages: ${Math.max(1, Math.min(Math.round(Number(plan.maxPages) || 100), 1000000))}`);
  lines.push(`  max_actions: ${Math.max(1, Math.min(Math.round(Number(plan.maxActions) || 50), 50000))}`);
  lines.push(`  max_depth: ${Math.max(0, Math.min(Math.round(Number(plan.maxDepth) || 3), 100000))}`);
  lines.push(`  max_runtime: ${Math.max(30, Math.min(Number(plan.maxRuntime) || 600, 86400))}`);
  lines.push("ollama:");
  lines.push("  enabled: false");
  if (plan.model) lines.push(`  model: ${yamlScalar(plan.model)}`);
  return `${lines.join("\n")}\n`;
}

function buildTraffsuckerPlan(args = {}) {
  const target = ScopeEngine.canonicalTarget(args.target);
  if (!target) return { ok: false, code: "TARGET_INVALID", error: "A canonical HTTP/HTTPS target is required for the traffsucker subagent." };
  const configuration = normalizeConfiguration(args.configuration);
  const model = safeString(args.model, 160);
  const runDir = safeString(args.run_dir || "runtime/traffsucker", 1000).replace(/\\/g, "/");
  if (!runDir || path.posix.isAbsolute(runDir) || runDir.split("/").includes("..") || /^(?:src|node_modules)(?:\/|$)/.test(runDir)) {
    return { ok: false, code: "OUTPUT_PATH_INVALID", error: "Subagent run path must remain inside the project and outside the source tree." };
  }
  const host = `${target.scheme}://${target.hostname}`;
  const plan = {
    target,
    host,
    model,
    context: safeString(args.context, 8000),
    goal: safeString(args.goal, 8000),
    scopeAnalysis: safeString(args.scope_analysis, 80) || "same_site",
    browserEngine: safeString(args.browser_engine, 40) || "chromium",
    cdpUrl: safeString(args.cdp_url, 200),
    maxPages: Number(args.max_pages) || 100,
    maxActions: Number(args.max_actions) || 50,
    maxDepth: Number(args.max_depth) || 3,
    maxRuntime: Number(args.max_runtime) || configuration.timeoutMs / 1000,
    configPath: `${runDir}/config.yaml`,
    outputDir: `${runDir}/map`,
  };
  const processArgs = [
    "map",
    "--url", host,
    "--config", plan.configPath,
    "--output", plan.outputDir,
    "--max-pages", String(plan.maxPages),
    "--max-actions", String(plan.maxActions),
    "--max-depth", String(plan.maxDepth),
    "--max-runtime", String(Math.max(30, Math.min(Math.round(Number(plan.maxRuntime) || 600), 86400))),
    ...(model ? ["--model", model] : []),
  ];
  return {
    ok: true,
    plan,
    configYaml: buildTraffsuckerConfig(plan),
    executable: "traffsucker",
    processArgs,
    command: ["traffsucker", ...processArgs.map((value) => quoteValue(value))].join(" "),
    capability: "activeRecon",
    risk: "active",
    techniqueIds: Array.isArray(args.technique_ids) ? args.technique_ids.map(String).slice(0, 30) : [],
    hypothesisId: safeString(args.hypothesis_id, 160),
  };
}

function quoteValue(value) {
  const text = safeString(value);
  if (/^[a-z0-9_./:,-]+$/i.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

module.exports = { ADAPTERS, normalizeConfiguration, buildAction, buildTraffsuckerPlan };
