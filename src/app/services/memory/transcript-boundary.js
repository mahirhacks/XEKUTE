"use strict";

const nodeCrypto = require("node:crypto");
const { canonicalJson, isMemoryId } = require("../../../contracts/memory/memory-identity.js");
const { createTranscriptBoundary } = require("../../../contracts/memory/operational-context-contracts.js");

const TRANSCRIPT_BOUNDARY_SERVICE_VERSION = 1;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function text(value, maximum = 240) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maximum);
}

function numericBlockId(id) {
  return Number(String(id || "").match(/^(?:block[_-])?(\d+)$/i)?.[1] || Number.MAX_SAFE_INTEGER);
}

function orderedBlocks(session) {
  return Object.entries(session && typeof session === "object" ? session : {})
    .filter(([id, block]) => id !== "__meta" && block && typeof block === "object")
    .sort(([left], [right]) => numericBlockId(left) - numericBlockId(right) || String(left).localeCompare(String(right)));
}

function transcriptFor(block) {
  const transcript = block?.__meta?.transcript;
  return Array.isArray(transcript) ? transcript.map(clone) : [];
}

function hashSnapshot(crypto, blocks) {
  return crypto.createHash("sha256").update(canonicalJson(blocks), "utf8").digest("hex");
}

function createTranscriptBoundaryService({ sessionMemoryStore, projectIdentityStore = null, crypto = nodeCrypto, now = () => new Date() } = {}) {
  if (!sessionMemoryStore?.load) throw new TypeError("Transcript boundary service requires a session memory store.");
  if (!crypto?.createHash) throw new TypeError("Transcript boundary service requires crypto.");

  function read(input = {}) {
    const workspace = text(input.workspace, 32_768);
    const sessionId = text(input.sessionId || input.session_id);
    if (!workspace || !sessionId) return { ok: false, code: "MEMORY_CONTEXT_SCOPE_REQUIRED", error: "Workspace and session are required." };
    const loaded = sessionMemoryStore.load(workspace);
    if (!loaded?.ok || !loaded.projectId) return { ok: false, code: "MEMORY_CONTEXT_SESSION_UNAVAILABLE", error: "The session project is not initialized." };
    const project = loaded.data?.[loaded.projectId];
    const session = project?.[sessionId];
    if (!session) return { ok: false, code: "MEMORY_CONTEXT_SESSION_NOT_FOUND", error: "The session memory session was not found." };
    const identity = projectIdentityStore?.resolveProject?.(workspace, { persist: false }) || null;
    const projectId = identity?.projectId || loaded.projectId;
    if (!isMemoryId(projectId, "proj")) return { ok: false, code: "MEMORY_PROJECT_ID_INVALID", error: "A protected proj_ project ID is required for Operational Context." };

    const entries = orderedBlocks(session);
    let selectedEnd = entries.length - 1;
    const throughBlockId = text(input.throughBlockId || input.through_block_id);
    const throughMessageId = text(input.throughMessageId || input.through_message_id);
    if (throughBlockId) {
      const index = entries.findIndex(([id]) => id === throughBlockId);
      selectedEnd = index >= 0 ? index : -1;
    } else if (throughMessageId) {
      const index = entries.findIndex(([, block]) => transcriptFor(block).some((message) => text(message?.id) === throughMessageId));
      selectedEnd = index >= 0 ? index : -1;
      if (selectedEnd >= 0) {
        const transcript = transcriptFor(entries[selectedEnd][1]);
        const lastMessageId = text(transcript.at(-1)?.id || "");
        // A block is the atomic transcript unit. If the caller points at a
        // message before that block's durable tail, leave the whole block out.
        if (lastMessageId !== throughMessageId) selectedEnd -= 1;
      }
    }
    const selected = selectedEnd >= 0 ? entries.slice(0, selectedEnd + 1) : [];
    const blockRows = selected.map(([blockId, block]) => ({
      blockId: text(blockId),
      transcript: transcriptFor(block),
      outcome: text(block.outcome || "pending", 80),
      timeStamp: text(block.time_stamp || block.timestamp || "", 80),
      completedAt: text(block.completed_at || "", 80),
    }));
    const messages = blockRows.flatMap((row) => row.transcript);
    const messageIds = messages.map((message) => text(message?.id)).filter(Boolean);
    const blockIds = blockRows.map((row) => row.blockId).filter(Boolean);
    const sourceRefs = [`session:${sessionId}`, ...blockIds.map((blockId) => `block:${blockId}`)];
    const transcriptHash = hashSnapshot(crypto, blockRows.map((row) => ({ blockId: row.blockId, transcript: row.transcript })));
    const boundary = createTranscriptBoundary({
      record_id: input.recordId || input.record_id || `event_${transcriptHash.slice(0, 32)}`,
      project_id: projectId,
      session_id: sessionId,
      first_block_id: blockIds[0] || "",
      last_block_id: blockIds.at(-1) || "",
      first_message_id: messageIds[0] || "",
      last_message_id: messageIds.at(-1) || "",
      block_count: blockRows.length,
      message_count: messages.length,
      transcript_hash: transcriptHash,
      source_revision: Number(input.sourceRevision ?? input.source_revision ?? 0) || 0,
      status: input.status || "sealed",
      block_ids: blockIds,
      message_ids: messageIds,
      created_at: blockRows[0]?.timeStamp || "1970-01-01T00:00:00.000Z",
      updated_at: blockRows.at(-1)?.completedAt || blockRows.at(-1)?.timeStamp || blockRows[0]?.timeStamp || "1970-01-01T00:00:00.000Z",
      actor: input.actor || { type: "system", id: "transcript-boundary" },
      provenance: input.provenance || { source_type: "runtime_event", source_refs: sourceRefs, captured_at: blockRows.at(-1)?.completedAt || blockRows.at(-1)?.timeStamp || "1970-01-01T00:00:00.000Z" },
      sensitivity: "internal",
    });
    return {
      ok: true,
      version: TRANSCRIPT_BOUNDARY_SERVICE_VERSION,
      projectId,
      sessionId,
      boundary,
      blocks: blockRows,
      messages: clone(messages),
      sessionMeta: clone(session.__meta || {}),
      source: { projectId, sessionId, blockIds, messageIds },
    };
  }

  return Object.freeze({
    TRANSCRIPT_BOUNDARY_SERVICE_VERSION,
    read,
    orderedBlocks,
  });
}

module.exports = Object.freeze({ createTranscriptBoundaryService, TRANSCRIPT_BOUNDARY_SERVICE_VERSION });
