"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createTier1ContextCoordinator, CHECKPOINT_RATIO, METER_ROWS } = require("../src/app/services/memory/tier1-context-coordinator.js");

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

test("Tier 1 OnChange recalculates Active Conversation tokens after append", () => {
  const changes = [];
  const coordinator = createTier1ContextCoordinator({
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    onChange: (event) => changes.push(event),
  });
  coordinator.assemble({
    project_id: projectId,
    session_id: sessionId,
    system_prompt: "system",
    active_conversation: [{ role: "user", content: "Inspect the target." }],
    effective_context_limit: 100_000,
  });
  const before = Number(changes.at(-1)?.rows?.["Active Conversation"]) || 0;
  coordinator.appendConversation(projectId, sessionId, [{ role: "assistant", content: "The authorized review is ready to continue with the next scoped check." }]);
  const after = changes.at(-1);
  assert.ok(changes.length >= 2);
  assert.deepEqual(after.changed, ["Active Conversation"]);
  assert.ok(Number(after.rows["Active Conversation"]) > before);
  assert.equal(after.rows["Active Conversation"], coordinator.state(projectId, sessionId).lastAssembly.rows["Active Conversation"]);
});

test("a Tier 1 preview reports rows without advancing or persisting the ledger", () => {
  const changes = [];
  const writes = [];
  const coordinator = createTier1ContextCoordinator({
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    onChange: (event) => changes.push(event),
    sensitiveStore: {
      writeActive: (_project, _session, messages) => { writes.push(messages); return { ok: true }; },
    },
  });

  const preview = coordinator.assemble({
    project_id: projectId,
    session_id: sessionId,
    system_prompt: "system",
    rules: ["rule"],
    active_conversation: [{ role: "user", content: "Inspect the target." }],
    effective_context_limit: 100_000,
    preview: true,
  });

  assert.deepEqual(Object.keys(preview.rows), METER_ROWS);
  assert.ok(preview.rows["System Prompt"] > 0);
  assert.ok(preview.rows["Active Conversation"] > 0);
  assert.equal(changes.length, 0, "a preview is not an OnChange event");
  assert.equal(writes.length, 0, "a preview never writes the durable ledger");
  assert.deepEqual(coordinator.state(projectId, sessionId).active, [], "a preview leaves the ledger untouched");
});

test("Tier 1 restores the active ledger across coordinator instances", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const crypto = require("node:crypto");
  const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-active-coord-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const messages = [
    { role: "user", content: "Inspect the target." },
    { role: "assistant", content: "Starting the authorized review." },
  ];
  try {
    const first = createTier1ContextCoordinator({ sensitiveStore: store, now: () => new Date("2026-08-29T00:00:00.000Z") });
    first.assemble({
      project_id: projectId,
      session_id: sessionId,
      system_prompt: "system",
      active_conversation: messages,
      effective_context_limit: 100_000,
    });
    const second = createTier1ContextCoordinator({ sensitiveStore: store, now: () => new Date("2026-08-29T00:00:00.000Z") });
    const restored = second.state(projectId, sessionId);
    assert.deepEqual(restored.active.map((message) => message.content), messages.map((message) => message.content));
    const assembled = second.assemble({
      project_id: projectId,
      session_id: sessionId,
      system_prompt: "system",
      effective_context_limit: 100_000,
    });
    assert.ok(assembled.rows["Active Conversation"] > 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("checkpoint pressure flips at 90% of the effective context limit", () => {
  assert.equal(CHECKPOINT_RATIO, 0.90);
  const limit = 10_000;
  const threshold = Math.floor(limit * 0.90);
  assert.equal(threshold, Math.floor(limit * CHECKPOINT_RATIO));

  function coordinatorForTokens(tokens) {
    return createTier1ContextCoordinator({ tokenCounter: () => tokens });
  }

  const below = coordinatorForTokens(threshold - 1).assemble({
    project_id: projectId,
    session_id: sessionId,
    active_conversation: [{ role: "user", content: "below-threshold prompt" }],
    effective_context_limit: limit,
    preview: true,
  });
  assert.equal(below.checkpoint_threshold, threshold);
  assert.equal(below.conservative_prompt_upper_bound, threshold - 1);
  assert.equal(below.total_tokens, threshold - 1);
  assert.equal(below.should_checkpoint, false);

  const atLine = coordinatorForTokens(threshold).assemble({
    project_id: projectId,
    session_id: sessionId,
    active_conversation: [{ role: "user", content: "at-threshold prompt" }],
    effective_context_limit: limit,
    preview: true,
  });
  assert.equal(atLine.checkpoint_threshold, threshold);
  assert.equal(atLine.conservative_prompt_upper_bound, threshold);
  assert.equal(atLine.total_tokens, threshold);
  assert.equal(atLine.should_checkpoint, true);

  const belowPressure = coordinatorForTokens(threshold - 1).pressure({
    project_id: projectId,
    session_id: sessionId,
    active_conversation: [{ role: "user", content: "below-threshold prompt" }],
    effective_context_limit: limit,
    preview: true,
  });
  assert.equal(belowPressure.threshold, threshold);
  assert.equal(belowPressure.shouldCheckpoint, false);

  const atPressure = coordinatorForTokens(threshold).pressure({
    project_id: projectId,
    session_id: sessionId,
    active_conversation: [{ role: "user", content: "at-threshold prompt" }],
    effective_context_limit: limit,
    preview: true,
  });
  assert.equal(atPressure.threshold, threshold);
  assert.equal(atPressure.shouldCheckpoint, true);
});
