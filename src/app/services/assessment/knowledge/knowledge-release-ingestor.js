"use strict";

const nodeCrypto = require("node:crypto");
const { createKnowledgeRelease } = require("../../../../domain/memory/knowledge/knowledge-release.js");

const DEFAULT_WSTG_CATALOGUE = Object.freeze([
  { id: "wstg-information-gathering", title: "Information gathering", category: "information-gathering", objective: "Identify the application surface and its trust boundaries from authorized sources.", features: ["domain", "hostname", "technology", "endpoint"], steps: ["Enumerate the in-scope application surface from supplied and permitted discovery evidence.", "Record source, scope, timestamp, and confidence for each discovered component."] },
  { id: "wstg-configuration-deployment", title: "Configuration and deployment management", category: "configuration", objective: "Review exposed configuration, deployment, and infrastructure controls.", features: ["service", "listener", "platform", "waf", "cdn"], steps: ["Compare observable deployment behavior with the authorized configuration baseline.", "Capture only bounded proof references for confirmed configuration weaknesses."] },
  { id: "wstg-identity-management", title: "Identity management testing", category: "identity", objective: "Assess identity lifecycle and account-management controls.", features: ["identity", "role", "authentication"], steps: ["Test declared identity-management flows with permitted identities and controlled variants.", "Record expected and observed behavior for each identity variant."] },
  { id: "wstg-authentication", title: "Authentication testing", category: "authentication", objective: "Assess authentication mechanisms and session establishment controls.", features: ["authentication", "session", "cookie", "token"], steps: ["Establish a permitted baseline authentication flow.", "Change one security-relevant authentication variable at a time and compare the response."] },
  { id: "wstg-authorization", title: "Authorization testing", category: "authorization", objective: "Assess access-control decisions across identities, roles, and objects.", features: ["authorization", "role", "permission", "data-object", "endpoint"], steps: ["Build an identity and role matrix from authorized test accounts.", "Repeat object and function requests across permitted identity variants and record differentials."] },
  { id: "wstg-session-management", title: "Session management testing", category: "session-management", objective: "Assess session creation, rotation, expiry, invalidation, and binding.", features: ["session", "cookie", "token"], steps: ["Capture session state transitions without retaining raw values in semantic memory.", "Verify rotation, logout, expiry, and reuse behavior with bounded artifact references."] },
  { id: "wstg-input-validation", title: "Input validation testing", category: "input-validation", objective: "Assess server-side handling of structured and unstructured input surfaces.", features: ["input-surface", "endpoint", "graphql-operation", "websocket-channel"], steps: ["Catalogue accepted input surfaces and response schemas.", "Use approved, bounded test classes and compare baseline and variant behavior."] },
  { id: "wstg-error-handling", title: "Error handling", category: "error-handling", objective: "Assess whether error behavior leaks sensitive implementation or security state.", features: ["endpoint", "application", "component"], steps: ["Trigger bounded invalid and boundary cases within scope.", "Classify observable differences and preserve proof references without copying secrets."] },
  { id: "wstg-weak-cryptography", title: "Weak cryptography", category: "cryptography", objective: "Assess cryptographic transport and application controls using observable behavior.", features: ["tls", "authentication", "session", "certificate"], steps: ["Review permitted transport and certificate observations.", "Verify material weaknesses with reproducible, scope-bound evidence."] },
  { id: "wstg-business-logic", title: "Business logic testing", category: "business-logic", objective: "Assess workflow and state-transition invariants under permitted variations.", features: ["workflow", "state", "role", "permission"], steps: ["Model the normal workflow and its state transitions.", "Change one workflow invariant at a time and verify the resulting authorization and state behavior."] },
  { id: "wstg-client-side", title: "Client-side testing", category: "client-side", objective: "Assess browser-visible client behavior and security-relevant sinks.", features: ["page", "component", "technology", "input-surface"], steps: ["Inventory client assets and security-relevant data flows.", "Validate candidate behavior with controlled browser observations and proof references."] },
  { id: "wstg-api", title: "API testing", category: "api", objective: "Assess API routes, schemas, authorization, and error behavior.", features: ["endpoint", "graphql-operation", "data-object", "role"], steps: ["Normalize API routes, methods, schemas, and identity variants.", "Execute the applicable API checks and retain bounded request/response artifact references."] },
]);

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function section(body, heading) {
  const lines = String(body || "").split(/\r?\n/);
  const wanted = String(heading || "").toLowerCase();
  const start = lines.findIndex((line) => /^##\s+/.test(line) && line.replace(/^##\s+/, "").trim().toLowerCase() === wanted);
  if (start < 0) return "";
  const output = [];
  for (let index = start + 1; index < lines.length && !/^##\s+/.test(lines[index]); index += 1) output.push(lines[index]);
  return output.join("\n").trim().slice(0, 4_000);
}

function createKnowledgeReleaseIngestor({ graph, releaseStore, crypto = nodeCrypto, now = () => new Date() } = {}) {
  if (!graph?.load || !releaseStore?.install) throw new TypeError("Knowledge release ingestion requires a graph and immutable release store.");

  function procedureFromSkill(entry) {
    const body = String(entry.body || "");
    const workflow = section(body, "workflow") || body.slice(0, 3_500);
    const verification = section(body, "verification rules");
    const evidence = section(body, "evidence to collect");
    const stopping = section(body, "stop conditions");
    return {
      title: entry.title,
      objective: entry.summary || entry.title,
      prerequisites: ["The target and requested operation are in scope.", ...(entry.mcp?.length ? ["Any mapped tool is separately authorized by the runtime authority pipeline."] : [])],
      target_features: [entry.category, entry.phase, ...(entry.signals || [])].filter(Boolean),
      applicable_technologies: entry.technologies || [],
      steps: [{ step_id: "procedure", instruction: workflow || `Apply the ${entry.title} methodology to the bounded target slice.`, expected: verification || "Record the expected and observed behavior.", rejecting: stopping || "Stop when scope, safety, or proof requirements cannot be satisfied.", evidence: evidence ? [evidence] : [], stop_conditions: stopping ? [stopping] : [] }],
      verification_rule: { required: verification || "A result requires reproducible, source-linked observations.", source_skill_id: entry.id },
      safety_constraints: ["Respect project scope and authority decisions.", "Do not retain raw credentials or secret values in methodology records."],
      classifications: [entry.category, entry.phase, entry.level].filter(Boolean),
      remediation: "Apply the control guidance in the source procedure and retest the affected behavior.",
      source_refs: [entry.source, entry.stableId, entry.sourceHash].filter(Boolean),
      aliases: [entry.id, ...(entry.aliases || [])],
      source: { type: "markdown-skill", uri: entry.source, content_hash: entry.sourceHash, publisher: "xekute" },
    };
  }

  function buildSkillRelease({ name = "Xekute Markdown skills", version = "current", aliases = ["current-skills"] } = {}) {
    const entries = graph.load().map(procedureFromSkill);
    return createKnowledgeRelease({
      source: { type: "markdown-skill-library", name, version, uri: "src/prompts/skills/libraries", publisher: "xekute" },
      aliases,
      procedures: entries,
    }, { crypto, now });
  }

  function buildWstgRelease({ version = "1.0", catalogue = DEFAULT_WSTG_CATALOGUE } = {}) {
    const procedures = (Array.isArray(catalogue) ? catalogue : []).map((entry) => ({
      title: text(entry.title || entry.id, 300),
      objective: text(entry.objective || entry.title || entry.id, 2_000),
      target_features: Array.isArray(entry.features) ? entry.features : [],
      classifications: ["wstg", text(entry.category || "general", 120)],
      steps: (Array.isArray(entry.steps) ? entry.steps : [entry.objective || entry.title || entry.id]).map((instruction, index) => ({ step_id: `${entry.id || "wstg"}-${index + 1}`, instruction })),
      verification_rule: { source_catalogue_id: text(entry.id, 160), required: "Preserve scope, source, expected behavior, and observed behavior." },
      safety_constraints: ["Use only authorized targets and identities.", "Do not place raw secrets in memory records."],
      source_refs: [`wstg:${text(entry.id, 160)}`],
      aliases: [text(entry.id, 160)],
      source: { type: "wstg-catalogue", uri: `wstg://${text(entry.id, 160)}`, publisher: "OWASP WSTG catalogue" },
    }));
    return createKnowledgeRelease({
      source: { type: "wstg", name: "Web Security Testing Guide procedure catalogue", version, uri: "packaged://wstg", publisher: "OWASP WSTG catalogue" },
      aliases: [`wstg-${version}`, "wstg"],
      procedures,
    }, { crypto, now });
  }

  function installSkillRelease(options = {}) {
    const release = buildSkillRelease(options);
    return releaseStore.install(release);
  }
  function installWstgRelease(options = {}) {
    const release = buildWstgRelease(options);
    return releaseStore.install(release);
  }
  function installAll(options = {}) {
    const skill = installSkillRelease(options.skill || {});
    if (!skill.ok) return { ok: false, stage: "skills", skill };
    const wstg = installWstgRelease(options.wstg || {});
    if (!wstg.ok) return { ok: false, stage: "wstg", skill, wstg };
    return { ok: true, skill, wstg };
  }

  return Object.freeze({
    buildSkillRelease,
    buildWstgRelease,
    installSkillRelease,
    installWstgRelease,
    installAll,
    DEFAULT_WSTG_CATALOGUE,
  });
}

module.exports = Object.freeze({ createKnowledgeReleaseIngestor, DEFAULT_WSTG_CATALOGUE });
