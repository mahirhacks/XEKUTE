/* Small specialist overlays loaded only when the current cyber intent needs them. */

const LIBRARIES = Object.freeze({
  scope: "SCOPE: Confirm canonical targets, written authorization, exclusions, testing window, rate limits, and stop conditions before active work. Cross-check scope-engine rules and ROE fields.",
  recon: "RECON (WSTG-INFO): Passive first — search metadata, DNS, certificates, technology fingerprint. Then the narrowest approved probe that resolves a specific inventory question. Preserve raw output as evidence with source URLs.",
  web: "WEB/API (WSTG-INFO, ATHN, SESS, ATHZ, INPV, APIT): Map trust boundaries, session model, input sources, server-side decisions, and object ownership before testing injection or IDOR.",
  authorization: "AUTHORIZATION (WSTG-ATHZ, WSTG-APIT, A01:2025): Compare the same operation across identities and object ownership. Status code alone does not prove access control. Test horizontal and vertical cases.",
  injection: "INJECTION (WSTG-INPV, A05:2025): Identify input source, parser/sink, expected safe behavior, benign differential signal, and false-positive control before payloads.",
  evidence: "EVIDENCE: Scanner output is a lead. Promotion requires reproducible admissible evidence, false-positive checks, affected scope, WSTG check ID, Top 10 mapping, limitations, and confidence.",
  reporting: "REPORTING: Separate observation, hypothesis, verified behavior, impact, remediation, WSTG/Top 10 coverage matrix, and retest criteria. Missing coverage is a limitation, not a security claim.",
  wstg: "WSTG: Tag hypotheses and findings with check IDs (INFO, CONF, IDNT, ATHN, ATHZ, SESS, INPV, ERRH, CRYP, BUSL, CLNT, APIT). Skipped categories must appear in coverage limitations.",
  top10: "OWASP Top 10:2025: Classify when evidence supports A01–A10 themes. Do not assign Top 10 labels from scanner titles alone.",
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
  if (/\b(?:wstg|checklist|methodology)\b/i.test(value)) selected.push("wstg");
  if (/\b(?:top\s*10|owasp\s*a\d{2}|a01|a02|a03|a04|a05|a06|a07|a08|a09|a10)\b/i.test(value)) selected.push("top10");
  if (!selected.length) selected.push("web");
  return [...new Set(selected)].slice(0, 3);
}

function renderLibraries(ids = []) {
  const selected = (Array.isArray(ids) ? ids : []).filter((id) => LIBRARIES[id]);
  if (!selected.length) return "";
  return ["SPECIALIZED CYBER INSTRUCTION LIBRARY", ...selected.map((id) => LIBRARIES[id])].join("\n");
}

module.exports = { LIBRARIES, selectLibraries, renderLibraries };
