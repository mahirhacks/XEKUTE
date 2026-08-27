"use strict";

const { createHandoffPacket } = require("../../../contracts/memory/multi-agent-contracts.js");
const { operationFailure, clone } = require("../../storage/memory/memory-storage-utils.js");

const AGENT_MEMORY_HANDOFF_SERVICE_VERSION = 1;

function text(value, maximum = 2_000) { return String(value == null ? "" : value).replace(/[\u0000\r\n]/g, " ").trim().slice(0, maximum); }

function createAgentMemoryHandoffService({
  specialistDispatch = null,
  sensitiveWorkingMemory = null,
  featureFlags = {},
} = {}) {
  function enabled() { return featureFlags.multiAgentMemoryV2 === true; }

  async function build(input = {}) {
    if (!enabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const predecessorSessionId = text(input.predecessorSessionId || input.predecessor_session_id, 240);
    const successorSessionId = text(input.successorSessionId || input.successor_session_id, 240);
    const successorAgentId = text(input.successorAgentId || input.successor_agent_id, 240);
    if (!predecessorSessionId || !successorSessionId || !successorAgentId) return operationFailure("MEMORY_HANDOFF_ACTORS_REQUIRED", "A handoff requires predecessor and successor session/agent identities.");
    if ((input.sensitiveHandles || input.sensitive_handles || input.inheritedSensitiveHandles || input.inherited_sensitive_handles) && !(input.allowSensitiveDelegation === true || input.allow_sensitive_delegation === true)) {
      return operationFailure("MEMORY_HANDOFF_SENSITIVE_INHERIT_FORBIDDEN", "Sensitive handles cannot be inherited implicitly during handoff.");
    }
    let dispatch = null;
    if (specialistDispatch?.build) {
      dispatch = await specialistDispatch.build({
        ...input,
        parentSessionId: successorSessionId,
        parentAgentId: successorAgentId,
        childSessionId: successorSessionId,
        childInvocationId: input.successorInvocationId || input.successor_invocation_id || "handoff",
        objective: input.objective || input.task || "Continue the investigation.",
        inheritedSensitiveHandles: undefined,
        sensitiveHandles: undefined,
        sensitive_handles: undefined,
      });
      if (!dispatch?.ok) return dispatch;
    }
    if (!dispatch?.packet) return operationFailure("MEMORY_HANDOFF_PACKET_UNAVAILABLE", "A bounded handoff packet could not be assembled.");
    let packet;
    try {
      packet = createHandoffPacket({
        ...dispatch.packet,
        packet_id: dispatch.packet.packet_id,
        project_id: dispatch.packet.project_id,
        parent_session_id: successorSessionId,
        parent_agent_id: successorAgentId,
        child_session_id: successorSessionId,
        child_invocation_id: input.successorInvocationId || input.successor_invocation_id || "handoff",
        predecessor_session_id: predecessorSessionId,
        objective: input.objective || input.task || dispatch.packet.objective,
        authority_profile: input.authorityProfile || input.authority_profile || dispatch.packet.authority_profile,
        expected_output: input.expectedOutput || input.expected_output || dispatch.packet.return_schema,
        inherited_sensitive_handles: [],
      });
    } catch (error) {
      return operationFailure(error.code || "MEMORY_HANDOFF_PACKET_INVALID", error.message, error.details || {});
    }
    return { ok: true, enabled: true, packet: { ...packet, packet_hash: dispatch.packetHash || "" }, packetHash: dispatch.packetHash || "", sensitiveLease: null, warnings: clone(dispatch.warnings || []) };
  }

  async function delegateSensitiveUse(input = {}) {
    if (!enabled()) return { ok: true, enabled: false, skipped: true, changed: false };
    const handleIds = input.handleIds || input.handle_ids;
    if (!Array.isArray(handleIds) || !handleIds.length) return operationFailure("MEMORY_HANDOFF_HANDLES_REQUIRED", "Explicit sensitive delegation requires one or more handle IDs.");
    if (input.allowSensitiveDelegation !== true && input.allow_sensitive_delegation !== true) return operationFailure("MEMORY_HANDOFF_SENSITIVE_DELEGATION_REQUIRED", "Sensitive delegation must be explicitly authorized.");
    const delegation = input.delegation && typeof input.delegation === "object" ? input.delegation : {};
    const delegatedBy = text(delegation.delegatedBy || delegation.delegated_by || input.predecessorAgentId || input.predecessor_agent_id, 240);
    if (delegation.allowed !== true || !delegatedBy) return operationFailure("MEMORY_HANDOFF_SENSITIVE_DELEGATION_DENIED", "Sensitive delegation requires an allowed lease and the predecessor agent identity.");
    const authority = input.authorityDecision || input.authority_decision || {};
    if (authority.ok !== true && authority.authorized !== true) return operationFailure("MEMORY_HANDOFF_SENSITIVE_AUTHORITY_REQUIRED", "Sensitive delegation requires a successful authority decision.");
    if (!sensitiveWorkingMemory?.issueUseLease) return operationFailure("MEMORY_SENSITIVE_STORE_UNAVAILABLE", "Sensitive Working Memory is unavailable.");
    const result = await Promise.resolve(sensitiveWorkingMemory.issueUseLease({
      projectId: input.projectId || input.project_id,
      sessionId: input.successorSessionId || input.successor_session_id,
      agentId: input.successorAgentId || input.successor_agent_id,
      handleIds: [...new Set(handleIds.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20),
      purpose: text(input.purpose || "delegated_request", 500),
      adapter: text(input.adapter || "delegated-request-adapter", 240),
      authorityDecision: authority,
      delegation: { allowed: true, delegatedBy, scope: text(delegation.scope || input.purpose || "delegated_request", 240) },
      source: "runtime_event",
    }));
    if (!result?.ok) return result;
    const lease = result.lease || {};
    return {
      ok: true,
      operationId: result.operationId || lease.lease_id || "",
      changed: Boolean(result.changed),
      sensitiveLease: {
        lease_id: lease.lease_id || result.leaseId || "",
        project_id: input.projectId || input.project_id || "",
        session_id: input.successorSessionId || input.successor_session_id || "",
        agent_id: input.successorAgentId || input.successor_agent_id || "",
        handle_ids: [...new Set(handleIds.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20),
        expires_at: lease.expires_at || "",
      },
      warnings: clone(result.warnings || []),
    };
  }

  return Object.freeze({ AGENT_MEMORY_HANDOFF_SERVICE_VERSION, enabled, build, delegateSensitiveUse });
}

module.exports = Object.freeze({ AGENT_MEMORY_HANDOFF_SERVICE_VERSION, createAgentMemoryHandoffService });
