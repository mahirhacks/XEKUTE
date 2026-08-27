"use strict";

const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson } = require("../../../contracts/memory/index.js");
const {
  createDispatchPacket,
  DISPATCH_PACKET_MAX_BYTES,
} = require("../../../contracts/memory/multi-agent-contracts.js");
const { operationFailure } = require("../../storage/memory/memory-storage-utils.js");

const SPECIALIST_DISPATCH_SERVICE_VERSION = 1;
const MAX_PACKET_RECORDS = 120;
const MAX_TARGET_REFS = 200;

function text(value, maximum = 2_000) {
  return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum);
}

function clone(value) {
  if (value === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function recordIdOf(value) {
  return text(value?.record_id || value?.recordId || value?.id || value?.record?.record_id || value?.record?.id, 240);
}

function safeRecord(value) {
  if (!value || typeof value !== "object") return null;
  const source = value.record && typeof value.record === "object" ? value.record : value;
  const result = {
    record_id: recordIdOf(value),
    record_type: text(value.record_type || value.recordType || source.record_type || source.recordType || "record", 120),
    sensitivity: text(value.sensitivity || source.sensitivity || "internal", 40),
    source_revision: Number(value.source_revision ?? value.sourceRevision ?? source.revision ?? 0) || 0,
    provenance: clone(value.provenance || source.provenance || source.source_refs || source.sourceRefs || []),
    record: clone(source),
  };
  if (!result.record_id) delete result.record_id;
  return result;
}

function sectionRecords(assembly, domain, maximum = MAX_PACKET_RECORDS) {
  return (Array.isArray(assembly?.sections?.[domain]?.records) ? assembly.sections[domain].records : [])
    .map(safeRecord)
    .filter(Boolean)
    .slice(0, maximum);
}

function refsFromRecords(records, prefix = "") {
  return [...new Set((Array.isArray(records) ? records : [])
    .map(recordIdOf)
    .filter((id) => !prefix || id.startsWith(`${prefix}_`)))].sort().slice(0, MAX_TARGET_REFS);
}

function sourceRevisionsFromAssembly(assembly) {
  const revisions = assembly?.source_revisions || assembly?.sourceRevisions || assembly?.source_manifest?.source_revisions || assembly?.source_manifest?.sourceRevisions || {};
  return Object.fromEntries(Object.entries(revisions || {}).map(([key, value]) => [text(key, 80), Math.max(0, Number(value) || 0)]));
}

function resolveProjectId(input, projectIdentityStore) {
  const requested = text(input.project_id || input.projectId, 240);
  if (requested) {
    try { return assertMemoryId(requested, "proj"); } catch (error) { return { error }; }
  }
  const workspace = text(input.workspace, 32_768);
  const resolved = typeof projectIdentityStore?.resolveProject === "function"
    ? projectIdentityStore.resolveProject(workspace, { persist: false })
    : null;
  if (!resolved?.ok || !resolved.projectId) return { error: Object.assign(new Error("A protected project ID is required for specialist dispatch."), { code: "MEMORY_PROJECT_ID_REQUIRED" }) };
  try { return assertMemoryId(resolved.projectId, "proj"); } catch (error) { return { error }; }
}

function hashPacket(crypto, packet) {
  return crypto.createHash("sha256").update(canonicalJson(packet), "utf8").digest("hex");
}

function createSpecialistDispatchService({
  contextAssembly = null,
  projectIdentityStore = null,
  featureFlags = {},
  crypto = nodeCrypto,
  now = () => new Date(),
} = {}) {
  if (!crypto?.createHash) throw new TypeError("Specialist dispatch service requires crypto.");

  function enabled() { return featureFlags.multiAgentMemoryV2 === true; }

  async function build(input = {}) {
    if (!enabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const resolved = resolveProjectId(input, projectIdentityStore);
    if (resolved?.error) return operationFailure(resolved.error.code || "MEMORY_PROJECT_ID_REQUIRED", resolved.error.message, resolved.error.details || {});
    const workspace = text(input.workspace, 32_768);
    if (!workspace) return operationFailure("MEMORY_DISPATCH_WORKSPACE_REQUIRED", "A workspace is required for specialist dispatch.");
    const objective = text(input.objective || input.task, 4_000);
    if (!objective) return operationFailure("MEMORY_MULTI_AGENT_OBJECTIVE_REQUIRED", "A specialist objective is required.");
    if (String(input.sensitivityCeiling || input.sensitivity_ceiling || "confidential").toLowerCase() === "restricted") {
      return operationFailure("MEMORY_MULTI_AGENT_SENSITIVE_CONTEXT_FORBIDDEN", "Specialist dispatch cannot request Restricted Sensitive Working Memory.");
    }

    let assembly = input.assembly && typeof input.assembly === "object" ? clone(input.assembly) : null;
    if (!assembly && contextAssembly?.assemble) {
      assembly = await contextAssembly.assemble({
        workspace,
        projectId: resolved,
        sessionId: input.parentSessionId || input.parent_session_id || "",
        objective,
        mode: input.mode || "agent",
        contextWindowTokens: input.contextWindowTokens || input.context_window_tokens,
        tokenBudget: Math.min(24_000, Math.max(4_000, Number(input.tokenBudget || input.token_budget) || 12_000)),
        responseReserveTokens: Math.min(4_000, Math.max(1_000, Number(input.responseReserveTokens || input.response_reserve_tokens) || 2_000)),
        sensitivityCeiling: "confidential",
        precedingBlockId: input.precedingBlockId || input.preceding_block_id || "",
        sourceRevisions: input.sourceRevisions || input.source_revisions || {},
      });
      if (assembly?.ok === false) return assembly;
    }
    assembly = assembly || { ok: true, sections: {}, source_revisions: {}, warnings: [{ code: "MEMORY_CONTEXT_ASSEMBLY_UNAVAILABLE" }] };

    const projectRecords = sectionRecords(assembly, "project");
    const investigationRecords = sectionRecords(assembly, "investigation");
    const evidenceRecords = sectionRecords(assembly, "evidence");
    const graphRecords = sectionRecords(assembly, "graph");
    const artifactRecords = sectionRecords(assembly, "artifact", 60);
    const knowledgeRecords = sectionRecords(assembly, "knowledge", 60);
    const targetRefs = [...new Set([
      ...(Array.isArray(input.targetRefs || input.target_refs) ? input.targetRefs || input.target_refs : []),
      ...refsFromRecords(projectRecords, "entity"),
    ].map((value) => text(value, 240)).filter(Boolean))].slice(0, MAX_TARGET_REFS);
    const investigationRefs = [...new Set([
      ...(Array.isArray(input.investigationRefs || input.investigation_refs) ? input.investigationRefs || input.investigation_refs : []),
      ...refsFromRecords(investigationRecords),
    ].map((value) => text(value, 240)).filter(Boolean))].slice(0, MAX_TARGET_REFS);
    const artifactRefs = [...new Set([
      ...(Array.isArray(input.artifactRefs || input.artifact_refs) ? input.artifactRefs || input.artifact_refs : []),
      ...refsFromRecords(artifactRecords, "artifact"),
    ].map((value) => text(value, 240)).filter(Boolean))].slice(0, MAX_TARGET_REFS);
    const testCaseRefs = [...new Set([
      ...(Array.isArray(input.testCaseRefs || input.test_case_refs) ? input.testCaseRefs || input.test_case_refs : []),
      ...investigationRecords.filter((entry) => entry.record_type === "test_case").map(recordIdOf),
    ].map((value) => text(value, 240)).filter(Boolean))].slice(0, MAX_TARGET_REFS);

    let packet;
    try {
      packet = createDispatchPacket({
        packet_id: input.packetId || input.packet_id,
        project_id: resolved,
        parent_session_id: input.parentSessionId || input.parent_session_id,
        parent_agent_id: input.parentAgentId || input.parent_agent_id,
        child_invocation_id: input.childInvocationId || input.child_invocation_id,
        child_session_id: input.childSessionId || input.child_session_id,
        objective,
        authority_profile: input.authorityProfile || input.authority_profile || "approve_for_me",
        target_refs: targetRefs,
        investigation_refs: investigationRefs,
        test_case_refs: testCaseRefs,
        artifact_refs: artifactRefs,
        memory_slices: {
          project: projectRecords,
          investigation: investigationRecords,
          evidence: evidenceRecords,
          checkpoint: sectionRecords(assembly, "checkpoint", 10),
          recent_tail: sectionRecords(assembly, "recent_tail", 20),
        },
        graph_slice: { records: graphRecords, omitted: clone(assembly.sections?.graph?.omitted || []) },
        knowledge: {
          release_id: text(input.knowledgeReleaseId || input.knowledge_release_id || assembly.source_manifest?.knowledge_release || "", 240),
          procedures: knowledgeRecords,
          omitted: clone(assembly.sections?.knowledge?.omitted || []),
        },
        source_revisions: sourceRevisionsFromAssembly(assembly),
        return_schema: input.returnSchema || input.return_schema || input.expectedOutput || input.expected_output || { description: "Return structured attempts, candidates, blockers, and remaining work.", format: "structured", fields: ["attempts", "finding_candidates", "blockers", "remaining_work"] },
        sensitivity_ceiling: "confidential",
        created_at: input.createdAt || input.created_at || now(),
      });
    } catch (error) {
      return operationFailure(error.code || "MEMORY_DISPATCH_PACKET_INVALID", error.message, error.details || {});
    }
    const packetHash = hashPacket(crypto, packet);
    return {
      ok: true,
      enabled: true,
      packet: { ...packet, packet_hash: packetHash },
      packetHash,
      contextState: text(assembly.state || "current", 40),
      sourceRevisions: sourceRevisionsFromAssembly(assembly),
      warnings: (Array.isArray(assembly.warnings) ? assembly.warnings : []).slice(0, 50),
      tokenAccounting: clone(assembly.token_accounting || assembly.tokenAccounting || {}),
      sizeBytes: Buffer.byteLength(JSON.stringify(packet), "utf8"),
      maximumBytes: DISPATCH_PACKET_MAX_BYTES,
    };
  }

  return Object.freeze({ SPECIALIST_DISPATCH_SERVICE_VERSION, enabled, build, create: build });
}

module.exports = Object.freeze({
  SPECIALIST_DISPATCH_SERVICE_VERSION,
  createSpecialistDispatchService,
});
