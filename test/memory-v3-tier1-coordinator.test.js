"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTier1ContextCoordinator, METER_ROWS } = require("../src/app/services/memory/tier1-context-coordinator.js");

const projectId = "proj_00000000-0000-4000-8000-000000004001";
const sessionId = "session_00000000-0000-4000-8000-000000004002";

test("Tier 1 exposes exactly the simplified nine sections", async () => {
  const coordinator = createTier1ContextCoordinator({ now: () => new Date("2026-08-29T00:00:00.000Z") });
  const initial = coordinator.assemble({
    project_id: projectId,
    session_id: sessionId,
    system_prompt: "system",
    tool_definitions: [{ type: "function", function: { name: "read_file" } }],
    rules: ["rule"],
    active_skills: ["skill"],
    active_subagent_instructions: ["subagent"],
    mcp_definitions: [{ type: "function", function: { name: "mcp__docs__search" } }],
    active_conversation: [{ role: "user", content: "Inspect the target." }],
    effective_context_limit: 100_000,
  });

  assert.deepEqual(Object.keys(initial.rows), METER_ROWS);
  assert.equal(initial.rows["Current Workflow"], 0);
  assert.ok(initial.rows.MCP > 0);
  assert.equal(Object.hasOwn(initial.rows, "Working References"), false);

  const checkpoint = await coordinator.checkpoint({
    project_id: projectId,
    session_id: sessionId,
    active_conversation: [{ role: "user", content: "Inspect the target." }],
    objective: "Inspect the target.",
    allow_model: false,
    effective_context_limit: 100_000,
  });
  assert.equal(checkpoint.ok, true);

  const after = coordinator.assemble({
    project_id: projectId,
    session_id: sessionId,
    effective_context_limit: 100_000,
  });
  assert.ok(after.rows["Summarized Conversation"] > 0);
  assert.ok(after.rows["Current Workflow"] > 0);
  assert.equal(after.rows["Active Conversation"], 0);
});

test("checkpoint reduction preserves the model-facing executed tool result", () => {
  const coordinator = createTier1ContextCoordinator();
  const reduction = coordinator.reduceConversation([
    { role: "user", content: "Run the check." },
    { role: "assistant", content: "", tool_calls: [{ id: "call-1", function: { name: "exec_command", arguments: { command: "check" } } }] },
    { role: "tool", tool_name: "exec_command", tool_call_id: "call-1", content: '{"ok":true,"stdout":"CHECK_RESULT"}' },
  ], [{ event_id: "event_1", tool_name: "exec_command", outcome: "success", safe_excerpt: "CHECK_RESULT" }]);

  assert.equal(reduction.messages[2].content.includes("CHECK_RESULT"), true);
  assert.equal(reduction.tool_events[0].safe_excerpt, "CHECK_RESULT");
});

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
