"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson, canonicalKeyHash } = require("../../../contracts/memory/index.js");
const { createApplicabilityEngine } = require("../../../domain/memory/knowledge/applicability-engine.js");
const { operationFailure, clone, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const INVESTIGATION_MEMORY_SERVICE_VERSION = 1;
const PROPOSAL_ORDER = Object.freeze({ create: 0, not_applicable: 1, retarget: 2, reprioritize: 3, needs_retest: 4 });

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }
function stableOperationId(crypto, value) { return `op_${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 32)}`; }
function stableRecordId(prefix, value, crypto = nodeCrypto) { return `${prefix}_${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 32)}`; }
function unique(values, maximum = 200) { return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 500)).filter(Boolean))].sort().slice(0, maximum); }
function sourceRefs(input, extra = []) { return unique([...(Array.isArray(input?.sourceRefs) ? input.sourceRefs : []), ...extra], 100); }

function createInvestigationMemoryService({
  repository,
  projectRepository = null,
  knowledgeSelectionService = null,
  applicabilityEngine = null,
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!repository?.load || !repository?.apply || !repository?.query) throw new TypeError("Investigation Memory service requires a repository.");
  const engine = applicabilityEngine || createApplicabilityEngine({ crypto });

  function actorOf(input) { return input?.actor && typeof input.actor === "object" ? clone(input.actor) : { type: "system", id: "investigation-memory-service" }; }
  function provenanceOf(input, refs = []) {
    return {
      source_type: text(input?.sourceType || input?.source_type || "canonical_derivation", 80),
      source_refs: sourceRefs(input, refs),
      captured_at: text(input?.capturedAt || input?.captured_at || timestamp(now), 80),
      ...(input?.toolName ? { tool_name: text(input.toolName, 160) } : {}),
    };
  }
  function projectIdOf(input) {
    try { return assertMemoryId(input?.projectId || input?.project_id, "proj"); } catch (error) { return null; }
  }
  function procedureFor(procedures, procedureId) { return (Array.isArray(procedures) ? procedures : []).find((procedure) => String(procedure?.procedure_id || procedure?.procedureId || "") === String(procedureId || "")) || {}; }
  function existingFor(state, procedureId, id = "") { return state.investigations.find((item) => (id && item.record_id === id) || String(item.procedure_id || "") === String(procedureId || "")) || null; }

  async function currentRevision(workspace, projectId, fallback = 0) {
    if (!projectRepository?.status) return Number(fallback) || 0;
    const status = await projectRepository.status(workspace, projectId);
    return status?.ok ? Number(status.revision) || 0 : Number(fallback) || 0;
  }

  function command(operationId, expectedBaseRevision, mutationType, payload, projectId, input, refs = []) {
    return {
      operation_id: operationId,
      idempotency_key: operationId,
      project_id: projectId,
      memory_type: "investigation",
      expected_base_revision: expectedBaseRevision,
      actor: actorOf(input),
      session_id: input?.sessionId || input?.session_id || null,
      block_id: input?.blockId || input?.block_id || null,
      mutation_type: mutationType,
      payload: clone(payload),
      provenance: provenanceOf(input, refs),
      sensitivity: "internal",
    };
  }

  function investigationPayload(proposal, procedure, existing, input, projectId) {
    const id = existing?.record_id || stableRecordId("inv", { project_id: projectId, procedure_id: proposal.procedure_id, target_bindings: input.targetBindings || input.target_bindings || [] }, crypto);
    const state = proposal.type === "not_applicable" ? "not_applicable" : existing?.state || "pending";
    return {
      record_id: id,
      investigation_id: id,
      programme_id: input.programmeId || input.programme_id || "",
      objective: text(procedure.objective || procedure.title || `Test ${proposal.procedure_id}`, 2_000),
      custom: false,
      state,
      status: state,
      verification_rule: clone(procedure.verification_rule || procedure.verificationRule || { type: "procedure", procedure_id: proposal.procedure_id }),
      safety_constraints: clone(procedure.safety_constraints || procedure.safetyConstraints || []),
      project_revision: Number(proposal.project_revision) || Number(input.projectRevision) || 0,
      knowledge_release_id: proposal.knowledge_release_id || proposal.knowledgeReleaseId || input.knowledgeReleaseId || input.knowledge_release_id,
      knowledge_content_hash: proposal.knowledge_content_hash || proposal.knowledgeContentHash || input.knowledgeContentHash || input.knowledge_content_hash,
      procedure_id: proposal.procedure_id,
      procedure_ids: [proposal.procedure_id],
      target_bindings: clone(input.targetBindings || input.target_bindings || []),
      coverage_hash: proposal.coverage_hash || proposal.coverageHash || "",
      priority: Number(proposal.priority || existing?.priority || 0),
      test_case_ids: clone(existing?.test_case_ids || []),
      remaining_work: clone(existing?.remaining_work || []),
    };
  }

  function applicabilityPayload(proposal, investigationId, input, projectId) {
    return {
      record_id: stableRecordId("inv", { project_id: projectId, investigation_id: investigationId, procedure_id: proposal.procedure_id, action: proposal.type }, crypto),
      investigation_id: investigationId,
      procedure_id: proposal.procedure_id,
      project_revision: Number(proposal.project_revision) || Number(input.projectRevision) || 0,
      knowledge_release_id: proposal.knowledge_release_id || input.knowledgeReleaseId || input.knowledge_release_id,
      knowledge_content_hash: proposal.knowledge_content_hash || input.knowledgeContentHash || input.knowledge_content_hash,
      coverage_hash: proposal.coverage_hash || "",
      action: proposal.type,
      status: proposal.type === "not_applicable" ? "not_applicable" : proposal.type === "needs_retest" ? "needs_retest" : "pending",
      reason: clone(proposal.reason || {}),
      target_binding: clone(input.targetBindings?.[0] || input.target_bindings?.[0] || null),
    };
  }

  async function applyApplicability(input = {}) {
    const projectId = projectIdOf(input);
    if (!projectId) return operationFailure("MEMORY_INVESTIGATION_PROJECT_INVALID", "A valid project ID is required for applicability updates.");
    const workspace = text(input.workspace, 4_000);
    if (!workspace) return operationFailure("MEMORY_INVESTIGATION_WORKSPACE_REQUIRED", "A workspace is required for applicability updates.");
    const loaded = await repository.load(workspace, projectId);
    if (!loaded.ok) return loaded;
    const projectRevision = Number(input.projectRevision ?? input.project_revision ?? await currentRevision(workspace, projectId, 0)) || 0;
    const procedures = Array.isArray(input.procedures) ? input.procedures : [];
    const evaluation = engine.evaluate({
      projectCoverage: input.projectCoverage || input.project_coverage || {},
      previousCoverage: input.previousCoverage || input.previous_coverage || null,
      procedures,
      existingInvestigations: loaded.state.investigations,
      projectRevision,
      knowledgeReleaseId: input.knowledgeReleaseId || input.knowledge_release_id || "",
      knowledgeContentHash: input.knowledgeContentHash || input.knowledge_content_hash || "",
      forceRefresh: Boolean(input.forceRefresh || input.force_refresh),
    });
    if (!evaluation.ok) return evaluation;
    if (!evaluation.proposals.length) return { ok: true, changed: false, operationId: text(input.operationId || input.operation_id, 240), previousRevision: loaded.revision, revision: loaded.revision, evaluation, proposals: [], warnings: [] };
    const operationId = input.operationId || input.operation_id || stableOperationId(crypto, { projectId, projectRevision, coverageHash: evaluation.coverage.hash, proposals: evaluation.proposals });
    const commands = [];
    const proposalIds = new Map();
    const ordered = evaluation.proposals.slice().sort((left, right) => (PROPOSAL_ORDER[left.type] ?? 99) - (PROPOSAL_ORDER[right.type] ?? 99) || String(left.procedure_id).localeCompare(String(right.procedure_id)) || JSON.stringify(left.reason || {}).localeCompare(JSON.stringify(right.reason || {})));
    for (const proposal of ordered) {
      const procedure = procedureFor(procedures, proposal.procedure_id);
      const existing = existingFor(loaded.state, proposal.procedure_id, proposal.existing_investigation_id);
      let investigationId = existing?.record_id || proposal.existing_investigation_id || stableRecordId("inv", { project_id: projectId, procedure_id: proposal.procedure_id, target_bindings: input.targetBindings || input.target_bindings || [] }, crypto);
      if (["create", "not_applicable", "retarget", "reprioritize"].includes(proposal.type)) {
        const payload = investigationPayload(proposal, procedure, existing, input, projectId);
        investigationId = payload.record_id;
        commands.push(command(operationId, loaded.revision, "upsert_investigation", payload, projectId, input, [proposal.procedure_id, `project-revision:${projectRevision}`]));
      } else if (proposal.type === "needs_retest") {
        if (existing) commands.push(command(operationId, loaded.revision, "mark_needs_retest", { investigation_id: existing.record_id, reason: JSON.stringify(proposal.reason || {}) }, projectId, input, [proposal.procedure_id, `project-revision:${projectRevision}`]));
        else {
          const payload = investigationPayload({ ...proposal, type: "create" }, procedure, null, input, projectId);
          investigationId = payload.record_id;
          commands.push(command(operationId, loaded.revision, "upsert_investigation", payload, projectId, input, [proposal.procedure_id, `project-revision:${projectRevision}`]));
        }
      }
      proposalIds.set(`${proposal.type}|${proposal.procedure_id}|${JSON.stringify(proposal.reason || {})}`, investigationId);
      commands.push(command(operationId, loaded.revision, "upsert_applicability", applicabilityPayload(proposal, investigationId, input, projectId), projectId, input, [proposal.procedure_id, `project-revision:${projectRevision}`]));
    }
    const applied = await repository.apply(workspace, projectId, commands, { blockId: input.blockId || input.block_id || "", sealedEventRange: input.sealedEventRange || input.sealed_event_range || {}, finalizationPosition: input.finalizationPosition ?? input.finalization_position ?? null });
    return applied.ok ? { ...applied, evaluation, proposals: evaluation.proposals, operationId, source: "applicability_channel" } : { ...applied, evaluation, proposals: evaluation.proposals, operationId };
  }

  function executionCommandPayload(candidate, input, projectId) {
    const source = candidate?.value && typeof candidate.value === "object" ? clone(candidate.value) : clone(candidate || {});
    const type = text(source.record_type || source.recordType || source.type || "", 80).toLowerCase();
    const artifactRefs = unique([...(Array.isArray(source.artifact_refs) ? source.artifact_refs : []), ...(Array.isArray(candidate?.artifact_refs) ? candidate.artifact_refs : [])], 100);
    const common = { ...source, project_id: projectId, artifact_refs: artifactRefs, record_type: type, investigation_id: source.investigation_id || source.investigationId || input.investigationId || input.investigation_id || "" };
    if (type === "attempt" || type === "execution" || type === "test_attempt") return { mutation: "record_attempt", payload: { ...common, test_case_id: source.test_case_id || source.testCaseId || input.testCaseId || input.test_case_id || "", payload_class: source.payload_class || source.payloadClass || "tool-observation", tool_refs: unique(source.tool_refs || source.toolRefs, 100), outcome: source.outcome || "inconclusive" } };
    if (type === "negative_result" || type === "negative") return { mutation: "record_negative_result", payload: { ...common, test_case_id: source.test_case_id || source.testCaseId || input.testCaseId || input.test_case_id || "", payload_class: source.payload_class || source.payloadClass || "tool-observation", outcome: source.outcome || "not_reproduced" } };
    if (type === "finding_candidate" || type === "candidate") return { mutation: "record_candidate", payload: { ...common, attempt_ids: source.attempt_ids || source.attemptIds || [], vulnerability_class: source.vulnerability_class || source.vulnerabilityClass || source.title || "candidate", summary: source.summary || "", severity: source.severity || "" } };
    if (type === "blocker") return { mutation: "upsert_blocker", payload: { ...common, description: source.description || source.reason || "Execution blocker", kind: source.kind || source.type || "execution" } };
    if (type === "coverage") return { mutation: "upsert_coverage", payload: { ...common, test_case_id: source.test_case_id || source.testCaseId || input.testCaseId || input.test_case_id || "", dimensions: source.dimensions || source.coverage_dimensions || {}, attempt_ids: source.attempt_ids || source.attemptIds || [] } };
    return { mutation: "", payload: common };
  }

  async function applyExecution(input = {}) {
    const projectId = projectIdOf(input);
    if (!projectId) return operationFailure("MEMORY_INVESTIGATION_PROJECT_INVALID", "A valid project ID is required for execution updates.");
    const workspace = text(input.workspace, 4_000);
    if (!workspace) return operationFailure("MEMORY_INVESTIGATION_WORKSPACE_REQUIRED", "A workspace is required for execution updates.");
    const loaded = await repository.load(workspace, projectId);
    if (!loaded.ok) return loaded;
    const candidates = Array.isArray(input.candidates) ? input.candidates : Array.isArray(input.investigationCandidates) ? input.investigationCandidates : [];
    const residues = [];
    const commands = [];
    for (const candidate of candidates.slice(0, 500)) {
      const mapped = executionCommandPayload(candidate, input, projectId);
      if (!mapped.mutation) { residues.push({ reason: "unsupported_investigation_candidate", candidate: text(candidate?.record_type || candidate?.value?.record_type || "", 100) }); continue; }
      if (!mapped.payload.investigation_id || !mapped.payload.test_case_id && ["record_attempt", "record_negative_result", "upsert_coverage"].includes(mapped.mutation)) {
        residues.push({ reason: "investigation_candidate_missing_scope", mutation: mapped.mutation });
        continue;
      }
      const refs = unique([candidate?.source_event_id, ...(Array.isArray(candidate?.source_ids) ? candidate.source_ids : [])], 100);
      commands.push(command(input.operationId || input.operation_id || stableOperationId(crypto, { projectId, blockId: input.blockId || input.block_id || "", candidates }), loaded.revision, mapped.mutation, mapped.payload, projectId, input, refs));
    }
    if (!commands.length) return { ok: true, changed: false, operationId: input.operationId || input.operation_id || "", previousRevision: loaded.revision, revision: loaded.revision, executionCandidates: candidates.length, appliedCandidates: 0, residues };
    const operationId = commands[0].operation_id;
    const applied = await repository.apply(workspace, projectId, commands, { blockId: input.blockId || input.block_id || "", sealedEventRange: input.sealedEventRange || input.sealed_event_range || {}, finalizationPosition: input.finalizationPosition ?? input.finalization_position ?? null });
    return applied.ok ? { ...applied, operationId, executionCandidates: candidates.length, appliedCandidates: commands.length, residues, source: "execution_channel" } : { ...applied, operationId, executionCandidates: candidates.length, appliedCandidates: commands.length, residues };
  }

  async function applySelection(input = {}) {
    if (!knowledgeSelectionService?.buildInvestigationMemory) return operationFailure("MEMORY_SELECTION_SERVICE_UNAVAILABLE", "Knowledge selection integration is unavailable.");
    const built = knowledgeSelectionService.buildInvestigationMemory({ workspace: input.workspace, projectId: input.projectId || input.project_id, selectionId: input.selectionId || input.selection_id });
    if (!built.ok) return built;
    return applyApplicability({ ...input, projectRevision: built.project_revision, knowledgeReleaseId: built.release_id, knowledgeContentHash: built.content_hash, procedures: built.procedures, operationId: input.operationId || input.operation_id });
  }

  async function finalize(input = {}) {
    const projectId = projectIdOf(input);
    if (!projectId) return operationFailure("MEMORY_INVESTIGATION_PROJECT_INVALID", "A valid project ID is required for Investigation finalization.");
    const parentOperationId = input.operationId || input.operation_id || stableOperationId(crypto, { projectId, blockId: input.blockId || input.block_id || "", eventRange: input.sealedEventRange || input.sealed_event_range || {} });
    const applicability = input.selectionId || input.selection_id ? await applySelection({ ...input, operationId: stableOperationId(crypto, { parentOperationId, channel: "applicability" }) }) : input.applicability ? await applyApplicability({ ...input, ...(input.applicability || {}), operationId: stableOperationId(crypto, { parentOperationId, channel: "applicability" }) }) : { ok: true, changed: false, skipped: true };
    if (!applicability.ok) return { ...applicability, operationId: parentOperationId, applicability };
    const execution = await applyExecution({ ...input, operationId: stableOperationId(crypto, { parentOperationId, channel: "execution" }), candidates: input.executionCandidates || input.investigationCandidates || input.candidates || [] });
    if (!execution.ok) return { ...execution, operationId: parentOperationId, applicability, execution };
    return { ok: true, operationId: parentOperationId, changed: Boolean(applicability.changed || execution.changed), applicability, execution, previousRevision: applicability.previousRevision ?? execution.previousRevision, revision: execution.revision ?? applicability.revision, warnings: [...(applicability.warnings || []), ...(execution.warnings || [])] };
  }

  function query(workspace, projectId, request = {}) { return repository.query(workspace, projectId, request); }
  function status(workspace, projectId) { return repository.status(workspace, projectId); }

  return Object.freeze({
    INVESTIGATION_MEMORY_SERVICE_VERSION,
    applyApplicability,
    applySelection,
    applyExecution,
    finalize,
    query,
    status,
  });
}

module.exports = Object.freeze({ createInvestigationMemoryService, INVESTIGATION_MEMORY_SERVICE_VERSION });
