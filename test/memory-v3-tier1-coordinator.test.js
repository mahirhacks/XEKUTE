"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");

const projectId = "proj_00000000-0000-4000-8000-000000004001";
const sessionId = "session_00000000-0000-4000-8000-000000004002";

test("checkpoint uses the session's protected current prompt when the caller omits it", async () => {
  const writes = [];
  const coordinator = createTier1ContextCoordinator({
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    sensitiveStore: {
      writeCheckpoint: (_project, _session, value) => {
        writes.push(value);
        return { ok: true, encrypted: false, durable: false, ephemeral: true };
      },
    },
  });

  coordinator.assemble({
    project_id: projectId,
    session_id: sessionId,
    current_user_prompt: "Continue the approved target review.",
    effective_context_limit: 100_000,
  });
  coordinator.appendConversation(projectId, sessionId, [{ role: "assistant", content: "The next step is ready." }]);

  const result = await coordinator.checkpoint({
    project_id: projectId,
    session_id: sessionId,
    allow_model: false,
    effective_context_limit: 100_000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.active.length, 0);
  assert.equal(writes.length, 1);
  assert.ok(result.reduction.messages.some((message) => message.content === "Continue the approved target review."));
});

test("checkpoint repair receives only safe reference handles", async () => {
  const calls = [];
  const coordinator = createTier1ContextCoordinator({
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    sensitiveStore: {
      writeCheckpoint: () => ({ ok: true, encrypted: false, durable: false, ephemeral: true }),
    },
  });

  coordinator.appendConversation(projectId, sessionId, [{ role: "assistant", content: "The workflow is ready." }]);
  await coordinator.checkpoint({
    project_id: projectId,
    session_id: sessionId,
    current_user_prompt: "Continue the review.",
    protected_refs: ["Bearer supersecret-checkpoint-token"],
    source_block_refs: ["raw-secret-block-reference"],
    effective_context_limit: 100_000,
    model: async (payload) => {
      calls.push(payload);
      return calls.length === 1 ? { grounded_facts: ["ungrounded-checkpoint-repair-probe"] } : {};
    },
  });

  assert.ok(calls.length >= 1);
  const serializedCalls = JSON.stringify(calls);
  assert.equal(serializedCalls.includes("supersecret-checkpoint-token"), false);
  assert.equal(serializedCalls.includes("raw-secret-block-reference"), false);
  const repairPayload = calls.find((payload) => payload?.repair) || calls[calls.length - 1];
  const refs = Array.isArray(repairPayload?.authoritative_refs) ? repairPayload.authoritative_refs : [];
  assert.ok(refs.every((value) => /^\w+_[a-f0-9]+$/i.test(String(value))));
});
