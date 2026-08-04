/* VAPT phase skill libraries — detailed instructions loaded for Hypothesis and cyber workflows. */

const Preflight = require("./libraries/preflight");
const ReconPassive = require("./libraries/recon-passive");
const ReconActive = require("./libraries/recon-active");
const AutomatedSecurityScan = require("./libraries/automated-security-scan");
const HeaderCheck = require("./libraries/header-check");
const SoftVulnProbing = require("./libraries/soft-vuln-probing");
const NormalVulnProbing = require("./libraries/normal-vuln-probing");
const DeepVulnProbing = require("./libraries/deep-vuln-probing");
const PostVulnProbing = require("./libraries/post-vuln-probing");

const LIBRARY_ORDER = Object.freeze([
  "preflight",
  "recon-passive",
  "recon-active",
  "automated-security-scan",
  "header-check",
  "soft-vuln-probing",
  "normal-vuln-probing",
  "deep-vuln-probing",
  "post-vuln-probing",
]);

const LIBRARIES = Object.freeze({
  preflight: {
    id: "preflight",
    label: "Preflight & engagement readiness",
    phases: ["preflight"],
    wstg: ["engagement-setup"],
    content: Preflight,
  },
  "recon-passive": {
    id: "recon-passive",
    label: "Passive recon (WSTG-INFO)",
    phases: ["preflight", "inventory"],
    wstg: ["WSTG-INFO"],
    content: ReconPassive,
  },
  "recon-active": {
    id: "recon-active",
    label: "Active recon & enumeration",
    phases: ["inventory", "hypothesis"],
    wstg: ["WSTG-INFO", "WSTG-CONF"],
    content: ReconActive,
  },
  "automated-security-scan": {
    id: "automated-security-scan",
    label: "Automated security scanning",
    phases: ["test-design", "execution"],
    wstg: ["WSTG-CONF", "WSTG-INPV", "WSTG-CRYP"],
    content: AutomatedSecurityScan,
  },
  "header-check": {
    id: "header-check",
    label: "Header, token & CSRF analysis",
    phases: ["execution", "observation"],
    wstg: ["WSTG-CONF", "WSTG-SESS", "WSTG-INPV", "WSTG-CLNT"],
    content: HeaderCheck,
  },
  "soft-vuln-probing": {
    id: "soft-vuln-probing",
    label: "Soft vulnerability probing",
    phases: ["test-design", "execution", "observation"],
    wstg: ["WSTG-ATHZ", "WSTG-ATHN", "WSTG-SESS", "WSTG-INPV", "WSTG-BUSL", "WSTG-APIT"],
    content: SoftVulnProbing,
  },
  "normal-vuln-probing": {
    id: "normal-vuln-probing",
    label: "Normal vulnerability probing",
    phases: ["execution", "observation"],
    wstg: ["WSTG-ATHZ", "WSTG-ATHN", "WSTG-SESS", "WSTG-INPV", "WSTG-BUSL", "WSTG-APIT"],
    content: NormalVulnProbing,
  },
  "deep-vuln-probing": {
    id: "deep-vuln-probing",
    label: "Deep vulnerability probing & impact",
    phases: ["execution", "observation", "verification"],
    wstg: ["WSTG-ATHZ", "WSTG-ATHN", "WSTG-SESS", "WSTG-INPV", "WSTG-BUSL", "WSTG-APIT"],
    content: DeepVulnProbing,
  },
  "post-vuln-probing": {
    id: "post-vuln-probing",
    label: "Post-signal depth, verification & reporting",
    phases: ["observation", "verification", "finding", "report", "retest", "complete"],
    wstg: ["verification", "reporting"],
    content: PostVulnProbing,
  },
});

const KEYWORD_SCORES = Object.freeze({
  preflight: /\b(?:preflight|authorization|scope|roe|rules?\s+of\s+engagement|engagement\s+ready|stop\s+condition)\b/i,
  "recon-passive": /\b(?:passive\s*recon|osint|info\s*gather|information\s+gather|wstg-info|attack\s+surface|entry\s+point|fingerprint|metafile|robots\.txt|sitemap)\b/i,
  "recon-active": /\b(?:recon|enumerat|subdomain|dns|port\s+scan|directory\s+brute|gobuster|ffuf|httpx|katana|subfinder|amass|nmap|discover\s+route)\b/i,
  "automated-security-scan": /\b(?:automated?\s+scan|scanner|nuclei|nikto|mass\s+scan|scan\s+wave|template\s+scan|vuln\s+scan)\b/i,
  "header-check": /\b(?:header|csrf|xsrf|token|jwt|csp|hsts|x-frame-options|x-content-type-options|samesite|cookie\s+flag|hpp|parameter\s+pollution|clickjack|security\s+header)\b/i,
  "soft-vuln-probing": /\b(?:soft\s*prob|benign|differential|low-impact|reversible|config\s+check|header|cors|probe)\b/i,
  "normal-vuln-probing": /\b(?:vuln\s*prob|probe|exploit\s+test|manual\s+test|idor|xss|sqli|ssrf|csrf|injection|auth(?:en|or)z|access\s+control|payload)\b/i,
  "deep-vuln-probing": /\b(?:deep\s*prob|impact\s+analysis|blast\s+radius|chain|depth|reproduce|escalat|demonstrate\s+impact|exploit\s+validat)\b/i,
  "post-vuln-probing": /\b(?:post[-\s]?vuln|verify|verification|false\s+positive|report|retest|finding\s+promot|coverage\s+matrix|remediation)\b/i,
});

const HYPOTHESIS_DEFAULTS = Object.freeze([
  "preflight",
  "recon-passive",
  "recon-active",
  "automated-security-scan",
  "header-check",
  "soft-vuln-probing",
  "normal-vuln-probing",
]);

const MAX_HYPOTHESIS_LIBRARIES = 8;
const MAX_AGENT_LIBRARIES = 3;

function scoreLibrary(id, text = "") {
  const value = String(text || "");
  const pattern = KEYWORD_SCORES[id];
  if (!pattern) return 0;
  const matches = value.match(new RegExp(pattern.source, "gi"));
  return matches ? matches.length : 0;
}

function selectByScore(text = "", { limit = 3, defaults = [] } = {}) {
  const scored = LIBRARY_ORDER.map((id) => ({ id, score: scoreLibrary(id, text) }));
  scored.sort((a, b) => b.score - a.score);
  const matched = scored.filter((entry) => entry.score > 0).slice(0, limit).map((entry) => entry.id);
  if (matched.length) return matched;
  return defaults.slice(0, limit);
}

function selectForHypothesis(text = "", { fullPlan = false } = {}) {
  const value = String(text || "");
  const broadPlan = fullPlan || /\b(?:full|complete|entire|whole|comprehensive|pentest\s+plan|vapt\s+plan|assessment\s+plan|hypothesis\s+plan|test\s+plan)\b/i.test(value);
  const limit = broadPlan ? MAX_HYPOTHESIS_LIBRARIES : 4;
  const selected = selectByScore(value, { limit, defaults: HYPOTHESIS_DEFAULTS });
  if (broadPlan) return [...LIBRARY_ORDER];
  return selected;
}

function selectForAgent(text = "", { active = false } = {}) {
  const value = String(text || "");
  const selected = selectByScore(value, {
    limit: MAX_AGENT_LIBRARIES,
    defaults: active ? ["recon-active", "normal-vuln-probing", "deep-vuln-probing"] : ["recon-passive", "recon-active"],
  });
  if (active && !selected.includes("automated-security-scan") && /\bscan|nuclei|nikto\b/i.test(value)) {
    selected.unshift("automated-security-scan");
  }
  return [...new Set(selected)].slice(0, MAX_AGENT_LIBRARIES);
}

function libraryIndex() {
  return [
    "VAPT SKILL LIBRARY INDEX",
    "Detailed phase instructions follow for selected libraries. Apply them when planning or executing the matching engagement phase.",
    ...LIBRARY_ORDER.map((id) => {
      const lib = LIBRARIES[id];
      return `- **${id}** — ${lib.label} (phases: ${lib.phases.join(", ")})`;
    }),
  ].join("\n");
}

function renderLibraries(ids = [], { includeIndex = false } = {}) {
  const selected = (Array.isArray(ids) ? ids : []).filter((id) => LIBRARIES[id]);
  if (!selected.length) return "";
  const sections = [];
  if (includeIndex) sections.push(libraryIndex());
  for (const id of selected) {
    sections.push(LIBRARIES[id].content.trim());
  }
  return sections.join("\n\n");
}

function ids() {
  return [...LIBRARY_ORDER];
}

module.exports = {
  LIBRARY_ORDER,
  LIBRARIES,
  selectForHypothesis,
  selectForAgent,
  selectByScore,
  libraryIndex,
  renderLibraries,
  ids,
};
