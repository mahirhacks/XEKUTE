/* Small specialist overlays loaded only when the current cyber intent needs them. */

const LIBRARIES = Object.freeze({
  scope: "SCOPE: Confirm the canonical target, authorization, exclusions, testing window, rate limits, and stop conditions before active work.",
  recon: "RECON: Begin passive, form a specific inventory question, then use the narrowest approved probe that can resolve it. Preserve raw output as evidence.",
  web: "WEB/API: Map trust boundaries, identity and session state, input sources, server-side decisions, and expected control behavior before testing a hypothesis.",
  authorization: "AUTHORIZATION: Compare the same operation across controlled identities and object ownership. A status code alone does not prove or disprove access control.",
  injection: "INJECTION: Identify the input source, parser or sink, expected safe behavior, benign test signal, and false-positive control before proposing a payload.",
  evidence: "EVIDENCE: Scanner output is a lead. Promotion requires reproducible admissible evidence, false-positive checks, affected scope, limitations, and confidence.",
  reporting: "REPORTING: Separate observation, hypothesis, verified behavior, impact, remediation, coverage, and retest criteria. Never turn missing coverage into a security claim.",
});

function selectLibraries(text = "", { active = false } = {}) {
  const value = String(text || "");
  const selected = [];
  if (active) selected.push("scope");
  if (/\b(?:recon|enumerat|subdomain|port|service|nmap|httpx|subfinder|amass|katana|gobuster|ffuf)\b/i.test(value)) selected.push("recon");
  if (/\b(?:web|api|http|route|endpoint|request|response|cookie|session|csrf|ssrf|file\s*upload)\b/i.test(value)) selected.push("web");
  if (/\b(?:idor|authorization|access\s+control|privilege|role|tenant|ownership)\b/i.test(value)) selected.push("authorization");
  if (/\b(?:injection|xss|sql|command\s+injection|template|payload)\b/i.test(value)) selected.push("injection");
  if (/\b(?:evidence|finding|verify|validate|false\s+positive|scanner|nuclei)\b/i.test(value)) selected.push("evidence");
  if (/\b(?:report|remediation|retest|coverage)\b/i.test(value)) selected.push("reporting");
  if (!selected.length) selected.push("web");
  return [...new Set(selected)].slice(0, 3);
}

function renderLibraries(ids = []) {
  const selected = (Array.isArray(ids) ? ids : []).filter((id) => LIBRARIES[id]);
  if (!selected.length) return "";
  return ["SPECIALIZED CYBER INSTRUCTION LIBRARY", ...selected.map((id) => LIBRARIES[id])].join("\n");
}

module.exports = { LIBRARIES, selectLibraries, renderLibraries };
