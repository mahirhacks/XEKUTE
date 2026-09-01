"use strict";

const HYPOTHESIS_STATES = Object.freeze(["proposed", "active", "supported", "rejected", "inconclusive", "closed"]);
const CHECKLIST_STATES = Object.freeze(["not_started", "in_progress", "explored", "blocked", "confirmed", "rejected", "skipped"]);
const EVIDENCE_STATES = Object.freeze(["observed", "verified", "rejected", "inconclusive"]);
const EVIDENCE_SEVERITIES = Object.freeze(["informational", "low", "medium", "high", "critical", "unrated"]);
const CHECKLIST_PHASES = Object.freeze(["preflight", "passive_recon", "active_recon", "planning", "assessment_l1", "assessment_l2", "execution", "verification", "retest"]);
const FACT_SCOPE_DECISIONS = Object.freeze(["in_scope", "out_of_scope", "unknown", "derived"]);
const FACT_CONFIDENCE = Object.freeze(["unknown", "low", "medium", "high"]);
const CHECKLIST_NON_TERMINAL_STATUSES = Object.freeze(["not_started", "in_progress", "blocked"]);

const PATHS = Object.freeze({
  root: ".xekute",
  gitignore: ".xekute/.gitignore",
  projectDirectory: ".xekute/project_info",
  projectIndex: ".xekute/project_info/index.md",
  projectEngagement: ".xekute/project_info/engagement.md",
  projectTargets: ".xekute/project_info/targets.md",
  projectIdentities: ".xekute/project_info/identities.md",
  projectSurface: ".xekute/project_info/surface.md",
  projectControls: ".xekute/project_info/controls.md",
  hypotheses: ".xekute/hypotheses.md",
  checklist: ".xekute/checklist.md",
  evidenceDirectory: ".xekute/evidence",
  evidenceIndex: ".xekute/evidence/index.md",
  transactionDirectory: ".xekute/.internal/transactions",
});

const UNREAD_LEGACY_PATHS = Object.freeze([
  ".xekute/project_info.md",
  ".xekute/investigation_checklist.md",
]);

const REVISION_KEYS = Object.freeze([
  "project_info.engagement",
  "project_info.targets",
  "project_info.identities",
  "project_info.surface",
  "project_info.controls",
  "hypotheses",
  "checklist",
  "evidence",
]);

const PROJECT_DOCUMENTS = Object.freeze([
  Object.freeze({
    id: "engagement",
    path: PATHS.projectEngagement,
    title: "Project Engagement",
    headings: Object.freeze(["Summary", "Scope", "Authority"]),
    factHeading: Object.freeze({ project: "Summary", authorization: "Authority", scope: "Scope", constraint: "Scope", unknown: "Summary" }),
  }),
  Object.freeze({
    id: "targets",
    path: PATHS.projectTargets,
    title: "Project Targets",
    headings: Object.freeze(["Assets", "Hosts", "Services", "Environments"]),
    factHeading: Object.freeze({ asset: "Assets", host: "Hosts", service: "Services", environment: "Environments" }),
  }),
  Object.freeze({
    id: "identities",
    path: PATHS.projectIdentities,
    title: "Project Identities",
    headings: Object.freeze(["Identities", "Roles", "Tenants"]),
    factHeading: Object.freeze({ identity: "Identities", role: "Roles", tenant: "Tenants" }),
  }),
  Object.freeze({
    id: "surface",
    path: PATHS.projectSurface,
    title: "Project Surface",
    headings: Object.freeze(["Routes", "Endpoints", "Parameters", "Workflows", "Stack"]),
    factHeading: Object.freeze({ route: "Routes", endpoint: "Endpoints", parameter: "Parameters", workflow: "Workflows", stack: "Stack" }),
  }),
  Object.freeze({
    id: "controls",
    path: PATHS.projectControls,
    title: "Project Controls",
    headings: Object.freeze(["Controls", "Behavior"]),
    factHeading: Object.freeze({ control: "Controls", behavior: "Behavior" }),
  }),
]);

const PROJECT_DOCUMENT_IDS = Object.freeze(PROJECT_DOCUMENTS.map((document) => document.id));
const PROJECT_DOCUMENT_BY_ID = Object.freeze(Object.fromEntries(PROJECT_DOCUMENTS.map((document) => [document.id, document])));

const SOURCE_ENTRY_PATHS = Object.freeze([
  PATHS.projectEngagement,
  PATHS.projectTargets,
  PATHS.projectIdentities,
  PATHS.projectSurface,
  PATHS.projectControls,
  PATHS.hypotheses,
  PATHS.checklist,
]);

const CANONICAL_EXACT_PATHS = Object.freeze([
  ...SOURCE_ENTRY_PATHS,
  PATHS.projectIndex,
  PATHS.evidenceIndex,
]);

function cleanText(value, max = 12_000) {
  return String(value == null ? "" : value).replace(/\r/g, "").replace(/\u0000/g, "").trim().slice(0, max);
}

function list(value, max = 100) {
  const input = Array.isArray(value) ? value : value == null || value === "" ? [] : String(value).split(",");
  return [...new Set(input.map((item) => cleanText(item, 500)).filter(Boolean))].slice(0, max);
}

function inline(value) {
  return cleanText(value, 4_000).replace(/\n+/g, " ").replace(/\|/g, "\\|");
}

function field(lines, label, value) {
  lines.push(`- ${label}: ${inline(value) || "not recorded"}`);
}

function arrayField(lines, label, values) {
  field(lines, label, list(values).join(", ") || "none");
}

function parseFields(text) {
  const fields = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^- ([A-Za-z][A-Za-z /_-]*):\s*(.*)$/.exec(line.trim());
    if (match) fields[match[1].toLowerCase().replace(/[ /-]+/g, "_")] = match[2].trim();
  }
  return fields;
}

function splitSections(markdown, level = 2) {
  const marker = "#".repeat(level);
  const regex = new RegExp(`^${marker} (.+)$`, "gm");
  const matches = [...String(markdown || "").matchAll(regex)];
  return matches.map((match, index) => ({
    title: match[1].trim(),
    index: match.index,
    body: String(markdown).slice(match.index + match[0].length, matches[index + 1]?.index ?? String(markdown).length).trim(),
  }));
}

function sectionBody(markdown, title) {
  const sections = splitSections(markdown, 2);
  return sections.find((section) => section.title === title)?.body || "";
}

function normalizeRelativePath(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}

function isCanonicalInvestigationPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (CANONICAL_EXACT_PATHS.includes(normalized)) return true;
  if (/^\.xekute\/evidence\/[^/]+\.md$/i.test(normalized)) return true;
  return false;
}

function gitignoreTemplate() {
  return "/evidence/\n/.internal/\n";
}

function mapCheckpointPhaseToChecklistPhase(phase) {
  const value = String(phase || "").trim();
  if (!value) return null;
  if (value === "passive") return "passive_recon";
  if (value === "active") return "active_recon";
  if (CHECKLIST_PHASES.includes(value)) return value;
  return null;
}

function headingForFact(document, key) {
  const spec = PROJECT_DOCUMENT_BY_ID[document];
  if (!spec) return "Summary";
  const mapped = spec.factHeading[String(key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").split("_")[0]];
  return mapped || spec.headings[0];
}

function parseFactAnnotations(value) {
  let text = String(value || "").trim();
  const pull = (pattern) => {
    const match = pattern.exec(text);
    if (!match) return "";
    text = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim();
    return cleanText(match[1], 400);
  };
  const corrects = pull(/\s+_\(corrects:\s*(.+?)\)_$/);
  const scope = pull(/\s+_\(scope:\s*(.+?)\)_$/);
  const confidence = pull(/\s+_\(confidence:\s*(.+?)\)_$/);
  const observed = pull(/\s+_\(observed:\s*(.+?)\)_$/);
  const sources = pull(/\s+_\(sources:\s*(.+?)\)_$/);
  return {
    value: cleanText(text),
    source_refs: list(sources),
    observed_at: observed,
    confidence: FACT_CONFIDENCE.includes(confidence.toLowerCase()) ? confidence.toLowerCase() : (confidence || "unknown"),
    scope_decision: FACT_SCOPE_DECISIONS.includes(scope.toLowerCase()) ? scope.toLowerCase() : (scope || "unknown"),
    corrects,
  };
}

function renderFactLine(fact) {
  const refs = list(fact.source_refs);
  const observed = inline(fact.observed_at);
  const confidence = FACT_CONFIDENCE.includes(fact.confidence) ? fact.confidence : "unknown";
  const scope = FACT_SCOPE_DECISIONS.includes(fact.scope_decision) ? fact.scope_decision : "unknown";
  const corrects = inline(fact.corrects);
  return `- **${inline(fact.key) || "fact"}** — ${inline(fact.value) || "Not recorded."}${refs.length ? ` _(sources: ${refs.join(", ")})_` : ""}${observed ? ` _(observed: ${observed})_` : ""}${` _(confidence: ${confidence})_`}${` _(scope: ${scope})_`}${corrects ? ` _(corrects: ${corrects})_` : ""}`;
}

function parseProjectDocument(documentId, markdown) {
  const spec = PROJECT_DOCUMENT_BY_ID[documentId];
  if (!spec) return { ok: false, code: "ARTIFACT_PROJECT_DOCUMENT_REQUIRED", error: `Unknown project document: ${documentId}.` };
  const title = String(markdown || "").match(/^# (.+)\s*$/m)?.[1]?.trim();
  if (title !== spec.title) return { ok: false, code: "ARTIFACT_PROJECT_TITLE_INVALID", error: `${spec.path} must start with '# ${spec.title}'.` };
  const found = new Map(splitSections(markdown, 2).map((section) => [section.title, section.body]));
  const missing = spec.headings.filter((name) => !found.has(name));
  if (missing.length) return { ok: false, code: "ARTIFACT_PROJECT_SECTIONS_INVALID", error: `${spec.path} is missing required sections: ${missing.join(", ")}.` };
  const facts = [];
  for (const heading of spec.headings) {
    let pendingId = "";
    for (const raw of found.get(heading).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || !line.startsWith("-")) continue;
      if (/^-\s*Not recorded\.?$/i.test(line)) continue;
      const factId = /^- \*\*fact_id:\*\*\s+(\S+)\s*$/i.exec(line);
      if (factId) {
        pendingId = factId[1];
        continue;
      }
      const match = /^- \*\*(.+?)\*\*\s+[—–-]\s+(.+)$/.exec(line)
        || /^- \*\*(.+?)\*\*\s*:\s*(.+)$/.exec(line)
        || /^- ([A-Za-z][A-Za-z0-9 /_-]*):\s*(.*)$/.exec(line);
      if (!match) return { ok: false, code: "ARTIFACT_PROJECT_ENTRY_INVALID", error: `Invalid project entry in ${spec.id}/${heading}: ${line}` };
      if (!pendingId) return { ok: false, code: "ARTIFACT_PROJECT_ENTRY_INVALID", error: `Missing fact_id for entry in ${spec.id}/${heading}.` };
      const parsed = parseFactAnnotations(match[2]);
      facts.push({
        fact_id: cleanText(pendingId, 80),
        key: cleanText(match[1], 300),
        value: parsed.value,
        source_refs: parsed.source_refs,
        observed_at: parsed.observed_at,
        confidence: parsed.confidence,
        scope_decision: parsed.scope_decision,
        ...(parsed.corrects ? { corrects: parsed.corrects } : {}),
        heading,
      });
      pendingId = "";
    }
    if (pendingId) return { ok: false, code: "ARTIFACT_PROJECT_ENTRY_INVALID", error: `Dangling fact_id ${pendingId} in ${spec.id}/${heading}.` };
  }
  return { ok: true, value: facts };
}

function renderProjectDocument(documentId, facts = []) {
  const spec = PROJECT_DOCUMENT_BY_ID[documentId];
  if (!spec) return "";
  const grouped = Object.fromEntries(spec.headings.map((heading) => [heading, []]));
  for (const fact of facts) {
    const heading = spec.headings.includes(fact.heading) ? fact.heading : headingForFact(documentId, fact.key);
    if (!grouped[heading]) grouped[heading] = [];
    grouped[heading].push(fact);
  }
  const lines = [`# ${spec.title}`, ""];
  for (const heading of spec.headings) {
    lines.push(`## ${heading}`, "");
    const entries = grouped[heading] || [];
    if (!entries.length) lines.push("- Not recorded.");
    else for (const fact of entries) {
      lines.push(`- **fact_id:** ${inline(fact.fact_id)}`);
      lines.push(renderFactLine(fact));
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function projectDocumentTemplate(documentId) {
  return renderProjectDocument(documentId, []);
}

function parseProjectFolder(texts = {}) {
  const documents = {};
  for (const spec of PROJECT_DOCUMENTS) {
    const parsed = parseProjectDocument(spec.id, texts[spec.id] ?? texts[spec.path]);
    if (!parsed.ok) return { ...parsed, document: spec.id, path: spec.path };
    documents[spec.id] = parsed.value;
  }
  return { ok: true, value: { documents } };
}

function factObservedSortKey(fact) {
  const raw = String(fact?.observed_at || "").trim();
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : Date.parse("0000-01-01T00:00:00.000Z");
}

function renderProjectIndex(documents = {}) {
  const lines = [
    "# Project Information Index",
    "",
    "Bounded projection of engagement.md, targets.md, identities.md, surface.md, and controls.md. Those documents are authoritative.",
    "",
  ];
  for (const spec of PROJECT_DOCUMENTS) {
    lines.push(`## ${spec.title.replace(/^Project /, "")}`, "| Fact ID | Key | Value | Confidence | Scope | Updated |", "|---|---|---|---|---|---|");
    const facts = [...(documents[spec.id] || [])]
      .sort((left, right) => factObservedSortKey(right) - factObservedSortKey(left) || String(left.fact_id).localeCompare(String(right.fact_id), undefined, { numeric: true }))
      .slice(0, 40);
    for (const fact of facts) {
      lines.push(`| ${inline(fact.fact_id)} | ${inline(fact.key)} | ${inline(fact.value)} | ${inline(fact.confidence)} | ${inline(fact.scope_decision)} | ${inline(fact.observed_at)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function hypothesesTemplate() {
  return "# Investigation Hypotheses\n\nNo hypotheses have been recorded.\n";
}

function checklistTemplate() {
  return "# Investigation Checklist\n\nNo investigation techniques have been planned.\n";
}

function evidenceIndexTemplate() {
  return "# Evidence Index\n\n| ID | Title | Status | Severity | Confidence | Targets | Hypotheses | Checklist | Updated |\n|---|---|---|---|---|---|---|---|---|\n";
}

function renderHypotheses(records = []) {
  const lines = ["# Investigation Hypotheses", ""];
  const ordered = [...records].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  if (!ordered.length) lines.push("No hypotheses have been recorded.", "");
  for (const record of ordered) {
    lines.push(`## ${record.id}: ${inline(record.title) || "Untitled hypothesis"}`, "");
    field(lines, "Status", HYPOTHESIS_STATES.includes(record.status) ? record.status : "proposed");
    field(lines, "Confidence", record.confidence || "unknown");
    field(lines, "Objective", record.objective);
    arrayField(lines, "Known facts", record.known_facts);
    arrayField(lines, "Unknowns", record.unknowns);
    field(lines, "Rationale", record.rationale);
    arrayField(lines, "Supporting signals", record.supporting_signals);
    arrayField(lines, "Rejecting signals", record.rejecting_signals);
    field(lines, "Smallest test", record.smallest_test);
    arrayField(lines, "Stop conditions", record.stop_conditions);
    arrayField(lines, "Evidence refs", record.evidence_refs);
    field(lines, "Created", record.created_at);
    field(lines, "Updated", record.updated_at);
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

function parseHypotheses(markdown) {
  if (!/^# Investigation Hypotheses\s*$/m.test(String(markdown || ""))) return { ok: false, code: "ARTIFACT_HYPOTHESES_TITLE_INVALID", error: "hypotheses.md must start with '# Investigation Hypotheses'." };
  const records = [];
  for (const section of splitSections(markdown, 2)) {
    const heading = /^(H-\d{4,}):\s+(.+)$/.exec(section.title);
    if (!heading) return { ok: false, code: "ARTIFACT_HYPOTHESIS_HEADING_INVALID", error: `Invalid hypothesis heading: ${section.title}` };
    const fields = parseFields(section.body);
    const status = cleanText(fields.status).toLowerCase();
    if (!HYPOTHESIS_STATES.includes(status)) return { ok: false, code: "ARTIFACT_HYPOTHESIS_STATUS_INVALID", error: `Invalid status for ${heading[1]}.` };
    records.push({
      id: heading[1],
      title: heading[2],
      status,
      confidence: fields.confidence,
      objective: fields.objective,
      known_facts: list(fields.known_facts),
      unknowns: list(fields.unknowns),
      rationale: fields.rationale,
      supporting_signals: list(fields.supporting_signals),
      rejecting_signals: list(fields.rejecting_signals),
      smallest_test: fields.smallest_test,
      stop_conditions: list(fields.stop_conditions),
      evidence_refs: list(fields.evidence_refs),
      created_at: fields.created,
      updated_at: fields.updated,
    });
  }
  return { ok: true, value: records };
}

function renderChecklist(records = [], hypotheses = []) {
  const titleFor = new Map(hypotheses.map((item) => [item.id, item.title]));
  const grouped = new Map();
  for (const record of records) {
    const key = record.hypothesis_id || "H-UNLINKED";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }
  const lines = ["# Investigation Checklist", ""];
  if (!records.length) lines.push("No investigation techniques have been planned.", "");
  for (const [hypothesisId, items] of [...grouped.entries()].sort()) {
    lines.push(`## ${hypothesisId}: ${inline(titleFor.get(hypothesisId) || "Unlinked investigation")}`, "");
    for (const record of items.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)))) {
      lines.push(`### ${record.id}: ${inline(record.title) || "Untitled technique"}`, "");
      field(lines, "Status", CHECKLIST_STATES.includes(record.status) ? record.status : "not_started");
      field(lines, "Phase", CHECKLIST_PHASES.includes(record.phase) ? record.phase : "preflight");
      field(lines, "Priority", record.priority || "medium");
      field(lines, "Order", Number.isFinite(Number(record.order)) ? Number(record.order) : 0);
      arrayField(lines, "Dependencies", record.dependencies);
      field(lines, "Technique", record.technique);
      field(lines, "Target", record.target);
      field(lines, "Required identity", record.required_identity);
      field(lines, "Required role", record.required_role);
      field(lines, "Required tenant", record.required_tenant);
      field(lines, "Baseline", record.baseline);
      field(lines, "Negative control", record.negative_control);
      arrayField(lines, "Expected signals", record.expected_signals);
      arrayField(lines, "Rejecting signals", record.rejecting_signals);
      arrayField(lines, "Stop conditions", record.stop_conditions);
      field(lines, "Execution result", record.execution_result);
      arrayField(lines, "Tool refs", record.tool_refs);
      arrayField(lines, "Evidence refs", record.evidence_refs);
      field(lines, "Knowledge release id", record.knowledge_release_id);
      field(lines, "Procedure id", record.procedure_id);
      field(lines, "Source hash", record.source_hash);
      field(lines, "Created", record.created_at);
      field(lines, "Updated", record.updated_at);
      lines.push("");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

function parseChecklist(markdown) {
  if (!/^# Investigation Checklist\s*$/m.test(String(markdown || ""))) return { ok: false, code: "ARTIFACT_CHECKLIST_TITLE_INVALID", error: "checklist.md must start with '# Investigation Checklist'." };
  const records = [];
  let currentHypothesis = "";
  const sections = splitSections(markdown, 3);
  for (const section of sections) {
    const heading = /^(C-\d{4,}):\s+(.+)$/.exec(section.title);
    if (!heading) return { ok: false, code: "ARTIFACT_CHECKLIST_HEADING_INVALID", error: `Invalid checklist heading: ${section.title}` };
    const before = String(markdown).slice(0, section.index);
    const parentMatches = [...before.matchAll(/^## (H-\d{4,}):/gm)];
    currentHypothesis = parentMatches.at(-1)?.[1] || currentHypothesis;
    const fields = parseFields(section.body);
    const status = cleanText(fields.status).toLowerCase();
    if (!CHECKLIST_STATES.includes(status)) return { ok: false, code: "ARTIFACT_CHECKLIST_STATUS_INVALID", error: `Invalid status for ${heading[1]}.` };
    const phase = cleanText(fields.phase).toLowerCase();
    if (!CHECKLIST_PHASES.includes(phase)) return { ok: false, code: "ARTIFACT_CHECKLIST_PHASE_INVALID", error: `Invalid phase for ${heading[1]}.` };
    records.push({
      id: heading[1],
      hypothesis_id: currentHypothesis,
      title: heading[2],
      status,
      phase,
      priority: fields.priority,
      order: Number(fields.order) || 0,
      dependencies: list(fields.dependencies),
      technique: fields.technique,
      target: fields.target,
      required_identity: fields.required_identity,
      required_role: fields.required_role,
      required_tenant: fields.required_tenant,
      baseline: fields.baseline,
      negative_control: fields.negative_control,
      expected_signals: list(fields.expected_signals),
      rejecting_signals: list(fields.rejecting_signals),
      stop_conditions: list(fields.stop_conditions),
      execution_result: fields.execution_result,
      tool_refs: list(fields.tool_refs),
      evidence_refs: list(fields.evidence_refs),
      knowledge_release_id: fields.knowledge_release_id === "not recorded" ? "" : (fields.knowledge_release_id || ""),
      procedure_id: fields.procedure_id === "not recorded" ? "" : (fields.procedure_id || ""),
      source_hash: fields.source_hash === "not recorded" ? "" : (fields.source_hash || ""),
      created_at: fields.created,
      updated_at: fields.updated,
    });
  }
  return { ok: true, value: records };
}

function renderEvidence(record = {}) {
  const lines = [`# ${record.id}: ${inline(record.title) || "Untitled evidence"}`, ""];
  field(lines, "Status", EVIDENCE_STATES.includes(record.status) ? record.status : "observed");
  field(lines, "Confidence", record.confidence || "unknown");
  arrayField(lines, "Hypotheses", record.hypothesis_refs);
  arrayField(lines, "Checklist", record.checklist_refs);
  arrayField(lines, "Targets", record.target_refs);
  field(lines, "Severity", record.severity || "unrated");
  field(lines, "Created", record.created_at);
  field(lines, "Updated", record.updated_at);
  lines.push("", "## Summary", "", cleanText(record.summary) || "Not recorded.", "", "## Reproduction", "", cleanText(record.reproduction) || "Not recorded.", "", "## Expected Behavior", "", cleanText(record.expected_behavior) || "Not recorded.", "", "## Observed Behavior", "", cleanText(record.observed_behavior) || "Not recorded.", "", "## Impact", "", cleanText(record.impact) || "Not recorded.", "", "## Remediation", "", cleanText(record.remediation) || "Not recorded.", "", "## Retest Criteria", "", cleanText(record.retest_criteria) || "Not recorded.", "", "## Verifier", "", cleanText(record.verifier) || "Not run.", "", "## Sanitized Excerpts", "", cleanText(record.sanitized_excerpts) || "No excerpts recorded.", "", "## Source References", "");
  const refs = list(record.source_refs);
  lines.push(...(refs.length ? refs.map((ref) => `- ${ref}`) : ["- None recorded."]));
  lines.push("", "## Hashes", "");
  const hashes = list(record.hashes);
  lines.push(...(hashes.length ? hashes.map((hash) => `- ${hash}`) : ["- None recorded."]));
  return `${lines.join("\n").trim()}\n`;
}

function parseEvidence(markdown) {
  const heading = /^# (E-\d{4,}):\s+(.+)$/m.exec(String(markdown || ""));
  if (!heading) return { ok: false, code: "ARTIFACT_EVIDENCE_TITLE_INVALID", error: "Evidence must start with '# E-####: <title>'." };
  const fields = parseFields(String(markdown).slice(0, String(markdown).search(/^## /m) < 0 ? undefined : String(markdown).search(/^## /m)));
  const status = cleanText(fields.status).toLowerCase();
  if (!EVIDENCE_STATES.includes(status)) return { ok: false, code: "ARTIFACT_EVIDENCE_STATUS_INVALID", error: `Invalid evidence status for ${heading[1]}.` };
  const bulletSection = (title) => sectionBody(markdown, title).split(/\r?\n/).map((line) => /^- (.+)$/.exec(line.trim())?.[1]).filter((value) => value && !/^none recorded\.?$/i.test(value));
  return {
    ok: true,
    value: {
      id: heading[1],
      title: heading[2],
      status,
      confidence: fields.confidence,
      hypothesis_refs: list(fields.hypotheses),
      checklist_refs: list(fields.checklist),
      target_refs: list(fields.targets),
      severity: fields.severity,
      created_at: fields.created,
      updated_at: fields.updated,
      summary: sectionBody(markdown, "Summary"),
      reproduction: sectionBody(markdown, "Reproduction"),
      expected_behavior: sectionBody(markdown, "Expected Behavior"),
      observed_behavior: sectionBody(markdown, "Observed Behavior"),
      impact: sectionBody(markdown, "Impact"),
      remediation: sectionBody(markdown, "Remediation"),
      retest_criteria: sectionBody(markdown, "Retest Criteria"),
      verifier: sectionBody(markdown, "Verifier"),
      sanitized_excerpts: sectionBody(markdown, "Sanitized Excerpts"),
      source_refs: bulletSection("Source References"),
      hashes: bulletSection("Hashes"),
    },
  };
}

function renderEvidenceIndex(records = []) {
  const lines = ["# Evidence Index", "", "| ID | Title | Status | Severity | Confidence | Targets | Hypotheses | Checklist | Updated |", "|---|---|---|---|---|---|---|---|---|"];
  for (const record of [...records].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))) {
    lines.push(`| ${inline(record.id)} | ${inline(record.title)} | ${inline(record.status)} | ${inline(record.severity)} | ${inline(record.confidence)} | ${inline(list(record.target_refs).join(", "))} | ${inline(list(record.hypothesis_refs).join(", "))} | ${inline(list(record.checklist_refs).join(", "))} | ${inline(record.updated_at)} |`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = Object.freeze({
  PATHS,
  PROJECT_DOCUMENTS,
  PROJECT_DOCUMENT_IDS,
  PROJECT_DOCUMENT_BY_ID,
  SOURCE_ENTRY_PATHS,
  CHECKLIST_PHASES,
  CHECKLIST_NON_TERMINAL_STATUSES,
  FACT_SCOPE_DECISIONS,
  FACT_CONFIDENCE,
  REVISION_KEYS,
  UNREAD_LEGACY_PATHS,
  HYPOTHESIS_STATES,
  CHECKLIST_STATES,
  EVIDENCE_STATES,
  EVIDENCE_SEVERITIES,
  cleanText,
  list,
  gitignoreTemplate,
  mapCheckpointPhaseToChecklistPhase,
  isCanonicalInvestigationPath,
  headingForFact,
  projectDocumentTemplate,
  parseProjectDocument,
  renderProjectDocument,
  parseProjectFolder,
  renderProjectIndex,
  hypothesesTemplate,
  checklistTemplate,
  evidenceIndexTemplate,
  renderHypotheses,
  parseHypotheses,
  renderChecklist,
  parseChecklist,
  renderEvidence,
  parseEvidence,
  renderEvidenceIndex,
});
