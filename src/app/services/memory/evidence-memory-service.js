"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/index.js");
const { cloneSafe } = require("../../../domain/memory/value-safety.js");
const { operationFailure, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const EVIDENCE_MEMORY_SERVICE_VERSION = 1;
const ALLOWED_PROVENANCE_TYPES = new Set(["tool_result", "runtime_event", "operator_assertion", "project_profile", "import", "canonical_derivation", "artifact"]);
const SECRET_TEXT = /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----|\bBearer\s+[A-Za-z0-9._~+/=-]+|(?:raw[_-]?cookie|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|private[_-]?key|passphrase)\s*[:=]\s*\S+/i;

function text(value, maximum = 8_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function unique(values, maximum = 200) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, maximum);
}

function stableId(prefix, value, crypto = nodeCrypto) {
  return `${prefix}_${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 32)}`;
}

function failure(code, message, details = {}, retryable = false) {
  return operationFailure(code, message, details, retryable);
}

function projectIdOf(input) {
  try { return assertMemoryId(input?.projectId || input?.project_id, "proj"); } catch { return ""; }
}

function actorOf(input) {
  return input?.actor && typeof input.actor === "object" ? clone(input.actor) : { type: "system", id: "evidence-verifier" };
}

function provenanceOf(input, refs, capturedAt) {
  const source = input?.provenance && typeof input.provenance === "object" ? input.provenance : {};
  const sourceType = ALLOWED_PROVENANCE_TYPES.has(String(source.source_type || source.sourceType || ""))
    ? String(source.source_type || source.sourceType)
    : "runtime_event";
  return {
    source_type: sourceType,
    source_refs: unique([...(Array.isArray(source.source_refs) ? source.source_refs : source.sourceRefs || []), ...refs], 200),
    captured_at: text(source.captured_at || source.capturedAt || capturedAt, 80),
    ...(source.operator_record_ref ? { operator_record_ref: text(source.operator_record_ref, 240) } : {}),
  };
}

function assertNoSecretText(value) {
  const serialized = JSON.stringify(value == null ? null : value);
  if (SECRET_TEXT.test(serialized)) {
    const error = new Error("Evidence promotion input contains raw secret material.");
    error.code = "MEMORY_SECRET_TEXT";
    throw error;
  }
}

function idList(value, prefix, field, maximum = 100) {
  const values = unique(value, maximum);
  if (!values.length) return [];
  try { return values.map((entry) => assertMemoryId(entry, prefix)); } catch (error) {
    return failure("MEMORY_EVIDENCE_REFERENCE_INVALID", `${field} contains a reference with the wrong type.`, { field, cause: error.code || "MEMORY_ID_INVALID" });
  }
}

function gateValue(value) {
  if (value === true) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.sufficient === true || value.adequate === true || value.valid === true || value.matched === true) return true;
  return ["sufficient", "adequate", "valid", "matched", "pass", "passed", "accept", "accepted"].includes(String(value.status || value.verdict || "").trim().toLowerCase());
}

function firstDefined(source, names) {
  for (const name of names) if (source?.[name] !== undefined) return source[name];
  return undefined;
}

function verifyGate(candidate, verification) {
  const missing = [];
  const scope = firstDefined(verification, ["scope_validated", "scopeValidated", "scope"]);
  const baseline = firstDefined(verification, ["baseline_comparison", "baselineComparison", "baseline"]);
  const exploit = firstDefined(verification, ["exploit_comparison", "exploitComparison", "exploit"]);
  const impact = firstDefined(verification, ["demonstrated_impact", "demonstratedImpact", "impact_demonstrated", "impactDemonstrated"]);
  if (!gateValue(scope)) missing.push("scope_validated");
  if (!gateValue(baseline)) missing.push("baseline_comparison");
  if (!gateValue(exploit)) missing.push("exploit_comparison");
  if (!gateValue(impact)) missing.push("demonstrated_impact");
  const severity = String(candidate?.severity || "").trim().toLowerCase();
  const scannerDerived = candidate?.scanner_derived === true || candidate?.scannerDerived === true || /scanner/i.test(String(candidate?.source || candidate?.origin || candidate?.source_type || candidate?.sourceType || ""));
  if ((severity === "high" || severity === "critical" || scannerDerived) && verification?.independent !== true) missing.push("independent_verification");
  return missing.length ? failure("MEMORY_EVIDENCE_VERIFICATION_GATE_FAILED", "The verification result did not satisfy the Evidence Memory promotion gate.", { missing }) : { ok: true, scannerDerived };
}

function verificationRecordId(findingId, verification, crypto) {
  return stableId("finding", { finding_id: findingId, procedure_reference: verification.procedure_reference, verified_at: verification.verified_at, proof_refs: verification.proof_refs, reason: verification.reason }, crypto);
}

function createEvidenceMemoryService({
  repository,
  investigationRepository = null,
  artifactRegistry = null,
  outboxStore = null,
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!repository?.load || !repository?.apply || !repository?.query) throw new TypeError("Evidence Memory service requires a repository.");

  async function candidateExists(workspace, projectId, candidateId) {
    if (!candidateId || !investigationRepository?.query) return { ok: true, checked: false };
    const result = await investigationRepository.query(workspace, projectId, { operation: "candidates", limit: 200 });
    if (!result.ok) return result;
    const found = (result.items || []).some((candidate) => candidate.record_id === candidateId || candidate.candidate_id === candidateId);
    return found ? { ok: true, checked: true } : failure("MEMORY_REFERENCE_NOT_FOUND", "The Evidence promotion references an unknown Investigation candidate.", { candidateId });
  }

  async function verifyProofs(workspace, projectId, proofRefs, verification) {
    if (!proofRefs.length) return failure("MEMORY_EVIDENCE_PROOF_REQUIRED", "A verified finding requires at least one artifact proof reference.");
    if (artifactRegistry?.verify) {
      const results = [];
      for (const artifactId of proofRefs) {
        const result = await artifactRegistry.verify(workspace, projectId, artifactId);
        if (!result?.ok || result.integrityState !== "verified") return failure("MEMORY_EVIDENCE_PROOF_INTEGRITY_FAILED", "One or more finding proof artifacts failed integrity verification.", { artifactId, integrityState: result?.integrityState || "unavailable", cause: result?.code || "MEMORY_ARTIFACT_UNAVAILABLE" });
        results.push({ artifact_id: artifactId, integrity_state: result.integrityState });
      }
      return { ok: true, results };
    }
    if (!gateValue(firstDefined(verification, ["proof_integrity", "proofIntegrity"]))) return failure("MEMORY_EVIDENCE_PROOF_INTEGRITY_REQUIRED", "Evidence promotion requires artifact verification or an explicit proof-integrity verdict.");
    return { ok: true, results: proofRefs.map((artifactId) => ({ artifact_id: artifactId, integrity_state: "verified" })) };
  }

  function buildPromotion(input, projectId, verifiedAt, proofRefs, attemptRefs, investigationIds, affectedEntityIds, gate) {
    const candidate = input.candidate && typeof input.candidate === "object" ? input.candidate : input;
    const verificationInput = input.verification && typeof input.verification === "object" ? input.verification : input;
    const candidateId = text(candidate.candidate_id || candidate.candidateId || input.candidateId || input.candidate_id, 240);
    const procedureReference = text(verificationInput.procedure_reference || verificationInput.procedureReference || verificationInput.procedure_id || verificationInput.procedureId || candidate.procedure_id || candidate.procedureId || input.procedureReference || input.procedure_reference, 500);
    const findingId = candidate.finding_id || candidate.findingId || input.findingId;
    const stableFindingId = findingId ? assertMemoryId(findingId, "finding") : stableId("finding", { project_id: projectId, candidate_id: candidateId, affected_entity_ids: affectedEntityIds, vulnerability_class: candidate.vulnerability_class || candidate.vulnerabilityClass || candidate.classification || "", proof_refs: proofRefs }, crypto);
    const suppliedOperationId = input.operationId || input.operation_id || "";
    const operationId = suppliedOperationId
      ? assertMemoryId(suppliedOperationId, "op")
      : stableId("op", { project_id: projectId, candidate_id: candidateId, finding_id: stableFindingId, verification: { procedureReference, verifiedAt, proofRefs, reason: text(verificationInput.reason, 4_000) } }, crypto);
    const verificationId = verificationRecordId(stableFindingId, { procedure_reference: procedureReference, verified_at: verifiedAt, proof_refs: proofRefs, reason: text(verificationInput.reason, 4_000) }, crypto);
    const provenanceRefs = unique([candidateId, ...proofRefs, ...attemptRefs, ...investigationIds, ...((input.provenance?.source_refs || input.provenance?.sourceRefs) || [])], 200);
    const provenance = provenanceOf(input, provenanceRefs, verifiedAt);
    const actor = actorOf(input);
    const verification = {
      verdict: "accept",
      reason: text(verificationInput.reason || verificationInput.summary || "Verified by the Evidence promotion gate.", 4_000),
      procedure_reference: procedureReference,
      verified_at: verifiedAt,
      independent: verificationInput.independent === true,
      scope_validated: true,
      baseline_comparison: true,
      exploit_comparison: true,
      demonstrated_impact: true,
      proof_integrity: true,
      gate: {
        scanner_derived: Boolean(gate.scannerDerived),
        proof_artifacts: proofRefs.length,
      },
    };
    const finding = {
      record_id: stableFindingId,
      finding_id: stableFindingId,
      project_id: projectId,
      title: text(candidate.title || candidate.name || candidate.vulnerability_class || candidate.vulnerabilityClass || "Confirmed vulnerability", 500),
      vulnerability_class: text(candidate.vulnerability_class || candidate.vulnerabilityClass || candidate.classification || "confirmed-vulnerability", 300),
      severity: text(candidate.severity || input.severity, 40).toLowerCase(),
      confidence: Number.isFinite(Number(candidate.confidence ?? input.confidence)) ? Number(candidate.confidence ?? input.confidence) : 0.9,
      description: text(candidate.description || candidate.summary || input.description || "", 8_000),
      affected_entity_ids: affectedEntityIds,
      affected_resources: Array.isArray(candidate.affected_resources || candidate.affectedResources) ? clone(candidate.affected_resources || candidate.affectedResources).slice(0, 100) : [],
      proof_refs: proofRefs,
      reproduction_refs: attemptRefs,
      investigation_ids: investigationIds,
      impact: clone(candidate.impact || input.impact || "Demonstrated security impact."),
      reproduction: clone(candidate.reproduction || candidate.reproduction_requirements || candidate.reproductionRequirements || input.reproduction || { proof_refs: proofRefs }),
      remediation: clone(candidate.remediation || input.remediation || "Remediate the affected behavior and verify the fix."),
      verification,
      actor,
      provenance,
      sensitivity: "confidential",
      verification_gate: true,
      promoted_from_verification: true,
      candidate_id: candidateId,
      verifier: {
        actor: clone(actor),
        procedure_reference: procedureReference,
        gate: clone(verification.gate),
      },
    };
    const verificationRecord = {
      record_id: verificationId,
      finding_id: stableFindingId,
      project_id: projectId,
      verdict: "accept",
      reason: verification.reason,
      procedure_reference: procedureReference,
      proof_refs: proofRefs,
      verified_at: verifiedAt,
      independent: verification.independent,
      actor,
      provenance,
      sensitivity: "confidential",
    };
    return { candidateId, operationId, finding, verificationRecord, actor, provenance };
  }

  function evidenceCommands(promotion, projectId, expectedBaseRevision) {
    return [
      {
        operation_id: promotion.operationId,
        idempotency_key: promotion.operationId,
        project_id: projectId,
        memory_type: "evidence",
        expected_base_revision: expectedBaseRevision,
        actor: promotion.actor,
        mutation_type: "create_finding",
        payload: promotion.finding,
        provenance: promotion.provenance,
        sensitivity: "confidential",
      },
      {
        operation_id: promotion.operationId,
        idempotency_key: promotion.operationId,
        project_id: projectId,
        memory_type: "evidence",
        expected_base_revision: expectedBaseRevision,
        actor: promotion.actor,
        mutation_type: "record_verification",
        payload: promotion.verificationRecord,
        provenance: promotion.provenance,
        sensitivity: "confidential",
      },
    ];
  }

  function investigationVerificationCommand(promotion, projectId, expectedBaseRevision) {
    return {
      operation_id: promotion.operationId,
      idempotency_key: promotion.operationId,
      project_id: projectId,
      memory_type: "investigation",
      expected_base_revision: expectedBaseRevision,
      actor: promotion.actor,
      target_record_id: promotion.candidateId,
      mutation_type: "set_candidate_verification",
      payload: {
        candidate_id: promotion.candidateId,
        verification_status: "verified",
        verification_record_id: promotion.verificationRecord.record_id,
        reason: promotion.verificationRecord.reason,
        verification_refs: promotion.verificationRecord.proof_refs,
      },
      provenance: promotion.provenance,
      sensitivity: "internal",
    };
  }

  async function promoteWithOutbox(input, projectId, promotion, initialEvidenceRevision, gate, proof) {
    if (!outboxStore?.enqueue || !outboxStore?.list || !outboxStore?.transition || !investigationRepository?.load || !investigationRepository?.apply) return null;
    if (!promotion.candidateId) return null;
    const workspace = text(input.workspace, 4_000);
    const loadedInvestigation = await investigationRepository.load(workspace, projectId);
    if (!loadedInvestigation.ok) return loadedInvestigation;
    const investigationCommand = investigationVerificationCommand(promotion, projectId, loadedInvestigation.revision);
    const commands = evidenceCommands(promotion, projectId, initialEvidenceRevision);
    const destinationMutation = {
      kind: "verified_finding_promotion",
      operation_id: promotion.operationId,
      candidate_id: promotion.candidateId,
      finding_id: promotion.finding.finding_id,
      investigation_command: investigationCommand,
      evidence_commands: commands,
    };
    let listed = await outboxStore.list(workspace, projectId, { destinationMemory: "evidence", limit: 200 });
    if (!listed?.ok) return listed;
    let entry = (listed.entries || []).find((value) => value.operation_id === promotion.operationId);
    if (!entry) {
      const enqueued = await outboxStore.enqueue(workspace, projectId, {
        entry_id: stableId("event", { project_id: projectId, operation_id: promotion.operationId, destination: "evidence" }, crypto),
        operation_id: promotion.operationId,
        project_id: projectId,
        source_memory: "investigation",
        source_revision: loadedInvestigation.revision,
        destination_memory: "evidence",
        destination_mutation: destinationMutation,
        state: "pending",
      });
      if (!enqueued?.ok) return enqueued;
      entry = enqueued.entry;
    }
    if (entry.state === "completed") return { ...(entry.result || {}), ok: true, crossMemory: true, replayed: true, candidateId: promotion.candidateId, findingId: promotion.finding.finding_id, verificationId: promotion.verificationRecord.record_id, gate: { ...gate, proof: proof.results }, outbox: entry };
    if (["failed", "interrupted"].includes(entry.state)) {
      const reset = await outboxStore.transition(workspace, projectId, entry.entry_id, "pending", { error: null });
      if (!reset?.ok) return reset;
      entry = reset.entry;
    }
    if (entry.state === "processing") return failure("MEMORY_EVIDENCE_PROMOTION_PENDING", "Evidence promotion is already being processed and will be recovered or completed by the outbox worker.", { operationId: promotion.operationId, entryId: entry.entry_id }, true);
    const processing = await outboxStore.transition(workspace, projectId, entry.entry_id, "processing", { claimed_by: "evidence-memory-service", lease_expires_at: new Date(Date.now() + 60_000).toISOString() });
    if (!processing?.ok) return processing;
    entry = processing.entry;
    const currentInvestigation = await investigationRepository.load(workspace, projectId);
    if (!currentInvestigation.ok) return failure("MEMORY_EVIDENCE_PROMOTION_SOURCE_LOAD_FAILED", currentInvestigation.error || "Investigation Memory could not be loaded for promotion.", { operationId: promotion.operationId }, true);
    const storedInvestigationCommand = entry.destination_mutation?.investigation_command || investigationCommand;
    const investigationResult = await investigationRepository.apply(workspace, projectId, [{ ...storedInvestigationCommand, expected_base_revision: currentInvestigation.revision }], { blockId: input.blockId || input.block_id || "", sealedEventRange: input.sealedEventRange || input.sealed_event_range || {}, finalizationPosition: input.finalizationPosition ?? input.finalization_position ?? null });
    if (!investigationResult.ok) {
      const failed = await outboxStore.transition(workspace, projectId, entry.entry_id, "failed", { error: { code: investigationResult.code, message: text(investigationResult.error, 2_000), retryable: Boolean(investigationResult.retryable) } });
      return { ...investigationResult, crossMemory: true, outbox: failed?.entry || entry };
    }
    const currentEvidence = await repository.load(workspace, projectId);
    if (!currentEvidence.ok) return failure("MEMORY_EVIDENCE_PROMOTION_DESTINATION_LOAD_FAILED", currentEvidence.error || "Evidence Memory could not be loaded for promotion.", { operationId: promotion.operationId }, true);
    const storedEvidenceCommands = Array.isArray(entry.destination_mutation?.evidence_commands) ? entry.destination_mutation.evidence_commands : commands;
    const evidenceResult = await repository.apply(workspace, projectId, storedEvidenceCommands.map((command) => ({ ...command, expected_base_revision: currentEvidence.revision })), { blockId: input.blockId || input.block_id || "", sealedEventRange: input.sealedEventRange || input.sealed_event_range || {}, finalizationPosition: input.finalizationPosition ?? input.finalization_position ?? null });
    if (!evidenceResult.ok) {
      const failed = await outboxStore.transition(workspace, projectId, entry.entry_id, "failed", { error: { code: evidenceResult.code, message: text(evidenceResult.error, 2_000), retryable: Boolean(evidenceResult.retryable) } });
      return { ...evidenceResult, crossMemory: true, investigation: investigationResult, outbox: failed?.entry || entry };
    }
    const finalResult = { ...evidenceResult, ok: true, crossMemory: true, candidateId: promotion.candidateId, findingId: promotion.finding.finding_id, verificationId: promotion.verificationRecord.record_id, investigation: investigationResult, gate: { ...gate, proof: proof.results } };
    const completed = await outboxStore.transition(workspace, projectId, entry.entry_id, "completed", { result: finalResult, error: null });
    if (!completed?.ok) return { ...finalResult, outboxPending: true, outbox: entry, warning: completed?.error || "The promotion completed but its outbox status is pending." };
    return { ...finalResult, outbox: completed.entry };
  }

  async function promoteVerifiedFinding(input = {}) {
    const projectId = projectIdOf(input);
    if (!projectId) return failure("MEMORY_EVIDENCE_PROJECT_INVALID", "A valid project ID is required for Evidence promotion.");
    const workspace = text(input.workspace, 4_000);
    if (!workspace) return failure("MEMORY_EVIDENCE_WORKSPACE_REQUIRED", "A workspace is required for Evidence promotion.");
    const candidate = input.candidate && typeof input.candidate === "object" ? input.candidate : input;
    const verification = input.verification && typeof input.verification === "object" ? input.verification : input;
    try {
      cloneSafe(candidate);
      cloneSafe(verification);
      assertNoSecretText(candidate);
      assertNoSecretText(verification);
    } catch (error) { return failure(error.code || "MEMORY_EVIDENCE_INPUT_INVALID", error.message, error.details || {}); }
    const verdict = String(verification.verdict || verification.status || input.verdict || "").trim().toLowerCase();
    if (!["accept", "verified"].includes(verdict)) return failure("MEMORY_EVIDENCE_VERDICT_NOT_ACCEPTED", "Only an accepting verification verdict can promote a finding.", { verdict });
    const gate = verifyGate(candidate, verification);
    if (!gate.ok) return gate;
    const proofRefs = idList(candidate.proof_refs || candidate.proofRefs || candidate.artifact_refs || candidate.artifactRefs || verification.proof_refs || verification.proofRefs || verification.evidence_refs || verification.evidenceRefs, "artifact", "proof_refs");
    if (!Array.isArray(proofRefs)) return proofRefs;
    const attemptRefs = idList(candidate.reproduction_refs || candidate.reproductionRefs || candidate.attempt_ids || candidate.attemptIds || verification.attempt_refs || verification.attemptRefs, "attempt", "reproduction_refs");
    if (!Array.isArray(attemptRefs)) return attemptRefs;
    const investigationIds = idList(candidate.investigation_ids || candidate.investigationIds || (candidate.investigation_id ? [candidate.investigation_id] : input.investigationId ? [input.investigationId] : []), "inv", "investigation_ids");
    if (!Array.isArray(investigationIds)) return investigationIds;
    const affectedEntityIds = idList(candidate.affected_entity_ids || candidate.affectedEntityIds || candidate.affected_refs || candidate.affectedRefs || input.affectedEntityIds || input.affected_entity_ids, "entity", "affected_entity_ids");
    if (!Array.isArray(affectedEntityIds)) return affectedEntityIds;
    if (!investigationIds.length) return failure("MEMORY_EVIDENCE_INVESTIGATION_REQUIRED", "A verified finding must reference its originating Investigation.");
    if (!affectedEntityIds.length) return failure("MEMORY_EVIDENCE_TARGET_REQUIRED", "A verified finding must reference at least one affected Project entity.");
    const candidateId = text(candidate.candidate_id || candidate.candidateId || input.candidateId || input.candidate_id, 240);
    if (candidateId) {
      try { assertMemoryId(candidateId, "inv"); } catch (error) { return failure(error.code || "MEMORY_EVIDENCE_CANDIDATE_INVALID", error.message, error.details || {}); }
    }
    const candidateCheck = await candidateExists(workspace, projectId, candidateId);
    if (!candidateCheck.ok) return candidateCheck;
    const proof = await verifyProofs(workspace, projectId, proofRefs, verification);
    if (!proof.ok) return proof;
    const verifiedAt = text(verification.verified_at || verification.verifiedAt || input.verifiedAt || input.verified_at || timestamp(now), 80);
    const promotion = buildPromotion({ ...input, candidate, verification }, projectId, verifiedAt, proofRefs, attemptRefs, investigationIds, affectedEntityIds, gate);
    const loaded = await repository.load(workspace, projectId);
    if (!loaded.ok) return loaded;
    const crossMemory = await promoteWithOutbox(input, projectId, promotion, loaded.revision, gate, proof);
    if (crossMemory) return crossMemory;
    const applied = await repository.apply(workspace, projectId, evidenceCommands(promotion, projectId, loaded.revision), { blockId: input.blockId || input.block_id || "", sealedEventRange: input.sealedEventRange || input.sealed_event_range || {}, finalizationPosition: input.finalizationPosition ?? input.finalization_position ?? null });
    if (!applied.ok) return applied;
    return { ...applied, candidateId: promotion.candidateId, findingId: promotion.finding.finding_id, verificationId: promotion.verificationRecord.record_id, gate: { ...gate, proof: proof.results } };
  }

  return Object.freeze({ EVIDENCE_MEMORY_SERVICE_VERSION, promoteVerifiedFinding, verifyAndPromote: promoteVerifiedFinding });
}

module.exports = Object.freeze({ createEvidenceMemoryService, EVIDENCE_MEMORY_SERVICE_VERSION });
