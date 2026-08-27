/* ── Memory v2 renderer views ────────────────────────────────────────────────
 * The renderer receives bounded, redacted views through the preload bridge.
 * This module deliberately has no filesystem, storage, or semantic-memory
 * imports. It renders untrusted memory text with textContent only.
 */

const SECRET_KEY = /(?:cookie|authorization|access[_-]?token|refresh[_-]?token|csrf|secret|password|private[_-]?key|passphrase|raw[_-]?value|ciphertext|credential)/i;
const MAX_DISPLAY_TEXT = 8_000;
const MAX_DISPLAY_ITEMS = 200;

const DOMAIN_LABELS = Object.freeze({
  project: "Project Memory",
  investigation: "Investigation Memory",
  evidence: "Evidence Memory",
  graph: "Knowledge Graph",
});

const DOMAIN_METHODS = Object.freeze({
  project: "memoryProjectQuery",
  investigation: "memoryInvestigationQuery",
  evidence: "memoryEvidenceQuery",
  graph: "memoryGraphQuery",
});

const DOMAIN_OPERATIONS = Object.freeze({
  project: ["overview", "search", "entity", "neighbors", "claims", "conflicts", "changes", "provenance", "coverage_inputs"],
  investigation: ["overview", "search", "investigations", "test_cases", "assignments", "attempts", "negative_results", "candidates", "blockers", "coverage", "remaining_work", "changes", "provenance"],
  evidence: ["overview", "search", "findings", "verifications", "remediations", "retests", "changes", "report", "provenance"],
  graph: ["overview", "search", "neighbors", "paths", "node", "status"],
});

function text(value, maximum = MAX_DISPLAY_TEXT) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function isObject(value) {
  return value && typeof value === "object";
}

function safeDisplay(value, key = "", depth = 0, seen = new WeakSet()) {
  if (SECRET_KEY.test(String(key || ""))) return undefined;
  if (depth > 8) return "[omitted: depth limit]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return text(value);
  if (typeof value !== "object") return text(value, 1_000);
  if (seen.has(value)) return "[omitted: circular value]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, MAX_DISPLAY_ITEMS).map((entry) => safeDisplay(entry, "", depth + 1, seen)).filter((entry) => entry !== undefined);
  const result = {};
  for (const [childKey, child] of Object.entries(value).slice(0, MAX_DISPLAY_ITEMS)) {
    const safe = safeDisplay(child, childKey, depth + 1, seen);
    if (safe !== undefined) result[text(childKey, 120)] = safe;
  }
  return result;
}

function safeJson(value, maximum = MAX_DISPLAY_TEXT) {
  try {
    const rendered = JSON.stringify(safeDisplay(value), null, 2);
    return String(rendered || "").replace(/\u0000/g, "").slice(0, maximum);
  } catch {
    return "[unavailable]";
  }
}

function unwrapResult(value) {
  if (!value || typeof value !== "object") return { ok: false, error: "Memory service returned no data." };
  if (value.ok === false) return value;
  if (value.value && typeof value.value === "object" && value.ok === true && Object.keys(value).length === 2) return value.value;
  return value;
}

function errorMessage(value) {
  const result = unwrapResult(value);
  return text(result?.error?.message || result?.error || result?.message || result?.reason || "Memory operation failed.", 1_000);
}

function recordsFrom(value) {
  const result = unwrapResult(value);
  const candidates = [result?.records, result?.items, result?.artifacts, result?.nodes, result?.findings, result?.investigations, result?.results];
  return candidates.find((entry) => Array.isArray(entry))?.slice(0, MAX_DISPLAY_ITEMS) || [];
}

function firstDefined(value, keys) {
  for (const key of keys) if (value?.[key] !== undefined && value?.[key] !== null && value?.[key] !== "") return value[key];
  return "";
}

function recordLabel(record) {
  if (!isObject(record)) return text(record, 400);
  return text(firstDefined(record, ["title", "label", "name", "finding_title", "investigation_title", "record_id", "recordId", "node_id", "nodeId", "id"]) || "Memory record", 400);
}

function recordMeta(record) {
  if (!isObject(record)) return "";
  const type = firstDefined(record, ["record_type", "recordType", "type", "domain"]);
  const lifecycle = firstDefined(record, ["lifecycle_state", "lifecycleState", "status", "state"]);
  const revision = firstDefined(record, ["revision", "source_revision", "sourceRevision"]);
  return [type, lifecycle, revision === "" ? "" : `rev ${revision}`].filter(Boolean).map((value) => text(value, 120)).join(" · ");
}

function createNode(doc, tag, className = "", value = "") {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}

function button(doc, label, className = "", title = "") {
  const node = createNode(doc, "button", className, label);
  node.type = "button";
  if (title) node.title = title;
  return node;
}

function renderKeyValue(doc, parent, label, value, { status = "" } = {}) {
  const row = createNode(doc, "div", "memory-kv-row");
  const key = createNode(doc, "span", "memory-kv-label", label);
  const result = createNode(doc, "span", `memory-kv-value${status ? ` memory-state-${status}` : ""}`, value);
  row.append(key, result);
  parent.append(row);
  return row;
}

function stateLabel(value) {
  const raw = text(value || "unknown", 80).toLowerCase().replace(/[_-]+/g, " ");
  return raw ? raw[0].toUpperCase() + raw.slice(1) : "Unknown";
}

function createMemoryUi({ documentRef = globalThis.document, api = globalThis.api } = {}) {
  const state = {
    workspace: "",
    projectId: "",
    sessionId: "",
    activeDomain: "project",
    operation: "overview",
    query: "",
    status: null,
    result: null,
    selected: null,
    contextUsage: null,
    loading: false,
    error: "",
  };
  let mounted = false;
  let getSessionContext = () => null;
  let elements = {};

  function resolveElements() {
    if (!documentRef?.getElementById) return false;
    const ids = [
      "memory-sidebar-view", "memory-refresh", "memory-context-refresh", "memory-migration-preview",
      "memory-status", "memory-context-summary", "memory-context-allocations", "memory-context-revisions",
      "memory-query-form", "memory-query-operation", "memory-query-input", "memory-results", "memory-detail",
      "memory-detail-title", "memory-detail-meta", "memory-detail-body", "memory-detail-close", "memory-query-status",
    ];
    elements = Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
    elements.domainButtons = [...documentRef.querySelectorAll("[data-memory-domain]")];
    return Boolean(elements["memory-sidebar-view"]);
  }

  function workspacePayload() {
    const session = typeof getSessionContext === "function" ? getSessionContext() : null;
    const workspace = state.workspace || session?.workspace || "";
    const sessionId = state.sessionId || session?.sessionId || "";
    const projectId = state.projectId || session?.projectId || "";
    return {
      workspace,
      ...(projectId ? { project_id: projectId } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
    };
  }

  function renderDomainButtons() {
    for (const item of elements.domainButtons || []) {
      const active = item.dataset.memoryDomain === state.activeDomain;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    }
  }

  function renderStatusLine() {
    const node = elements["memory-query-status"];
    if (!node) return;
    node.className = `memory-query-status${state.error ? " is-error" : ""}`;
    if (state.loading) node.textContent = "Loading bounded memory view…";
    else if (state.error) node.textContent = state.error;
    else if (!state.workspace) node.textContent = "Open a project to inspect memory.";
    else if (state.result && state.result.ok === false) node.textContent = errorMessage(state.result);
    else {
      const sourceRevision = firstDefined(state.result, ["sourceRevision", "source_revision", "revision"]);
      const omitted = Number(firstDefined(state.result, ["omitted", "omitted_count"])) || 0;
      node.textContent = `${recordsFrom(state.result).length} bounded item${recordsFrom(state.result).length === 1 ? "" : "s"}${sourceRevision === "" ? "" : ` · source revision ${sourceRevision}`}${omitted ? ` · ${omitted} omitted` : ""}`;
    }
  }

  function renderContext() {
    const summary = elements["memory-context-summary"];
    const allocations = elements["memory-context-allocations"];
    const revisions = elements["memory-context-revisions"];
    if (!summary || !allocations || !revisions) return;
    summary.replaceChildren();
    allocations.replaceChildren();
    revisions.replaceChildren();

    const usage = state.contextUsage || {};
    const total = Number(usage.total || usage.contextWindow || usage.modelMaxTokens || 0) || 0;
    const used = Number(usage.used || usage.promptTokens || 0) || 0;
    const free = Number(usage.free || Math.max(total - used, 0)) || 0;
    renderKeyValue(documentRef, summary, "Prompt allocation", total ? `${Math.round(used).toLocaleString()} / ${Math.round(total).toLocaleString()} tokens` : "Unavailable");
    renderKeyValue(documentRef, summary, "Response reserve", usage.responseReserveTokens ? `${Math.round(Number(usage.responseReserveTokens)).toLocaleString()} tokens` : "Protected");
    renderKeyValue(documentRef, summary, "Free budget", total ? `${Math.round(free).toLocaleString()} tokens` : "Unavailable");
    renderKeyValue(documentRef, summary, "Context source", stateLabel(usage.source || "estimate"));

    const sections = Array.isArray(usage.breakdown?.sections) ? usage.breakdown.sections : [];
    if (sections.length) {
      for (const section of sections.slice(0, 12)) {
        const tokens = Math.max(0, Number(section?.tokens) || 0);
        renderKeyValue(documentRef, allocations, text(section?.label || section?.key || "Context", 120), `${Math.round(tokens).toLocaleString()} tokens`);
      }
    } else {
      allocations.append(createNode(documentRef, "div", "memory-empty", "Live allocation details will appear when a chat context is measured."));
    }

    const status = state.status || {};
    const finalization = status.finalization || {};
    const dimensions = status.dimensions || {};
    const checkpoint = status.projections?.checkpoint || {};
    const knowledgeLease = usage.knowledgeLease || checkpoint.knowledgeLease || checkpoint.knowledge_lease || null;
    renderKeyValue(documentRef, revisions, "Project", status.domains?.project?.revision ?? "0");
    renderKeyValue(documentRef, revisions, "Investigation", status.domains?.investigation?.revision ?? "0");
    renderKeyValue(documentRef, revisions, "Evidence", status.domains?.evidence?.revision ?? "0");
    renderKeyValue(documentRef, revisions, "Finalization", finalization.pending_finalization_count > 0 || finalization.pending ? "Pending" : stateLabel(dimensions.semantic_finalization?.state || "unknown"), { status: finalization.pending_finalization_count > 0 || finalization.pending ? "pending" : dimensions.semantic_finalization?.state || "unknown" });
    renderKeyValue(documentRef, revisions, "Checkpoint", stateLabel(checkpoint.status || dimensions.summarization?.state || "unknown"), { status: checkpoint.status || dimensions.summarization?.state || "unknown" });
    renderKeyValue(documentRef, revisions, "Knowledge lease", knowledgeLease ? "Active (body is temporary)" : "Reference-only / none");
    renderKeyValue(documentRef, revisions, "Sensitive store", stateLabel(dimensions.sensitive_store?.state || "protected"), { status: dimensions.sensitive_store?.state || "protected" });
    renderKeyValue(documentRef, revisions, "Projection", stateLabel(dimensions.projection?.state || "unknown"), { status: dimensions.projection?.state || "unknown" });
    const warningCount = Array.isArray(status.warnings) ? status.warnings.length : 0;
    renderKeyValue(documentRef, revisions, "Omitted / warnings", warningCount ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "None reported");
  }

  function renderResults() {
    const parent = elements["memory-results"];
    if (!parent) return;
    parent.replaceChildren();
    const records = recordsFrom(state.result);
    if (!state.workspace) {
      parent.append(createNode(documentRef, "div", "memory-empty", "Open a project before querying memory."));
      return;
    }
    if (state.result?.ok === false) {
      parent.append(createNode(documentRef, "div", "memory-empty memory-error", errorMessage(state.result)));
      return;
    }
    if (!records.length) {
      parent.append(createNode(documentRef, "div", "memory-empty", state.result?.initialized === false ? "This memory domain is not initialized yet." : "No records match the bounded query."));
      return;
    }
    for (const record of records) {
      const item = createNode(documentRef, "button", "memory-result-item");
      item.type = "button";
      item.dataset.memoryRecord = "true";
      item._memoryRecord = record;
      const title = createNode(documentRef, "span", "memory-result-title", recordLabel(record));
      const meta = createNode(documentRef, "span", "memory-result-meta", recordMeta(record) || "Bounded memory record");
      item.append(title, meta);
      item.addEventListener("click", () => showDetail(record));
      parent.append(item);
    }
  }

  function showDetail(record) {
    state.selected = record;
    const panel = elements["memory-detail"];
    if (!panel) return;
    panel.hidden = false;
    if (elements["memory-detail-title"]) elements["memory-detail-title"].textContent = recordLabel(record);
    if (elements["memory-detail-meta"]) elements["memory-detail-meta"].textContent = recordMeta(record) || DOMAIN_LABELS[state.activeDomain];
    if (elements["memory-detail-body"]) {
      elements["memory-detail-body"].textContent = safeJson(record);
    }
  }

  function closeDetail() {
    state.selected = null;
    if (elements["memory-detail"]) elements["memory-detail"].hidden = true;
  }

  function render() {
    renderDomainButtons();
    renderStatusLine();
    renderContext();
    renderResults();
    if (elements["memory-query-operation"]) {
      elements["memory-query-operation"].replaceChildren();
      for (const operation of DOMAIN_OPERATIONS[state.activeDomain] || []) {
        const option = createNode(documentRef, "option", "", operation.replace(/_/g, " "));
        option.value = operation;
        option.selected = operation === state.operation;
        elements["memory-query-operation"].append(option);
      }
    }
    if (elements["memory-query-input"] && elements["memory-query-input"].value !== state.query) elements["memory-query-input"].value = state.query;
    const unavailable = !state.workspace || state.loading;
    if (elements["memory-refresh"]) elements["memory-refresh"].disabled = unavailable;
    if (elements["memory-context-refresh"]) elements["memory-context-refresh"].disabled = unavailable;
    if (elements["memory-migration-preview"]) elements["memory-migration-preview"].disabled = unavailable;
  }

  async function query() {
    if (!state.workspace || !api) return null;
    state.loading = true;
    state.error = "";
    renderStatusLine();
    const payload = {
      ...workspacePayload(),
      operation: state.operation,
      ...(state.query ? { query: state.query } : {}),
      limit: 50,
      token_budget: 12_000,
      ...(state.activeDomain === "graph" ? { depth: 1 } : {}),
    };
    try {
      const method = DOMAIN_METHODS[state.activeDomain];
      state.result = unwrapResult(await api[method]?.(payload));
      if (state.result?.project_id && !state.projectId) state.projectId = text(state.result.project_id, 240);
      if (state.result?.ok === false) state.error = errorMessage(state.result);
    } catch (error) {
      state.result = { ok: false, error: error?.message || "Memory query failed." };
      state.error = errorMessage(state.result);
    } finally {
      state.loading = false;
      render();
    }
    return state.result;
  }

  async function refresh() {
    if (!state.workspace || !api?.memoryStatus) {
      state.status = null;
      state.result = null;
      render();
      return null;
    }
    state.loading = true;
    state.error = "";
    renderStatusLine();
    try {
      const status = unwrapResult(await api.memoryStatus(workspacePayload()));
      state.status = status;
      if (status?.project_id) state.projectId = text(status.project_id, 240);
      if (status?.ok === false) state.error = errorMessage(status);
      await query();
    } catch (error) {
      state.status = { ok: false, error: error?.message || "Memory status failed." };
      state.error = errorMessage(state.status);
      state.loading = false;
      render();
    }
    return state.status;
  }

  async function showMigrationPreview() {
    if (!state.workspace || !api?.memoryMigrationPreview) return null;
    const result = unwrapResult(await api.memoryMigrationPreview({ ...workspacePayload(), refresh: true }));
    state.result = result;
    state.error = result?.ok === false ? errorMessage(result) : "";
    render();
    if (result?.ok !== false) showDetail({ title: "Migration preview", ...result });
    return result;
  }

  function bindWorkspace(workspace = "", { projectId = "", sessionId = "" } = {}) {
    state.workspace = text(workspace, 32_768);
    state.projectId = text(projectId, 240);
    state.sessionId = text(sessionId, 240);
    state.status = null;
    state.result = null;
    state.error = "";
    closeDetail();
    render();
    return state.workspace ? refresh() : Promise.resolve(null);
  }

  function setContextUsage(usage) {
    state.contextUsage = safeDisplay(usage) || null;
    renderContext();
  }

  function openContextInspector() {
    const panel = elements["memory-context-summary"];
    if (panel) panel.scrollIntoView?.({ block: "nearest" });
    return true;
  }

  function selectDomain(domain) {
    const next = DOMAIN_METHODS[domain] ? domain : "project";
    state.activeDomain = next;
    state.operation = DOMAIN_OPERATIONS[next]?.includes(state.operation) ? state.operation : "overview";
    closeDetail();
    render();
    return query();
  }

  function mount({ getSessionContext: sessionContextGetter } = {}) {
    if (sessionContextGetter) getSessionContext = sessionContextGetter;
    if (mounted) return true;
    if (!resolveElements()) return false;
    mounted = true;
    for (const item of elements.domainButtons) item.addEventListener("click", () => selectDomain(item.dataset.memoryDomain));
    elements["memory-query-form"]?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.query = text(elements["memory-query-input"]?.value || "", 4_000);
      state.operation = text(elements["memory-query-operation"]?.value || "overview", 80).toLowerCase();
      query();
    });
    elements["memory-refresh"]?.addEventListener("click", () => refresh());
    elements["memory-context-refresh"]?.addEventListener("click", () => refresh());
    elements["memory-migration-preview"]?.addEventListener("click", () => showMigrationPreview());
    elements["memory-detail-close"]?.addEventListener("click", () => closeDetail());
    render();
    return true;
  }

  function snapshot() {
    return safeDisplay({ ...state, selected: undefined });
  }

  return Object.freeze({ bindWorkspace, closeDetail, mount, openContextInspector, query, refresh, selectDomain, setContextUsage, showMigrationPreview, snapshot });
}

const XekuteMemoryUi = Object.freeze({
  DOMAIN_LABELS,
  DOMAIN_OPERATIONS,
  createMemoryUi,
  safeDisplay,
  safeJson,
});

globalThis.XekuteMemoryUi = XekuteMemoryUi;

export { DOMAIN_LABELS, DOMAIN_OPERATIONS, createMemoryUi, safeDisplay, safeJson };
