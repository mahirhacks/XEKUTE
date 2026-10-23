"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const projectId = "proj_00000000-0000-4000-8000-000000008701";
const sessionId = "session_00000000-0000-4000-8000-000000008702";

test("repeated context measurements do not encrypt and save an unchanged ledger", () => {
  const writes = [];
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: { writeActive: (...args) => { writes.push(structuredClone(args)); return { ok: true, durable: true }; } } });
  const input = { project_id: projectId, session_id: sessionId, active_conversation: [{ role: "user", content: "Inspect this workspace" }], effective_context_limit: 262144 };
  coordinator.assemble(input);
  for (let index = 0; index < 20; index++) coordinator.assemble({ ...input, active_conversation: structuredClone(input.active_conversation) });
  assert.equal(writes.length, 1);
  coordinator.appendConversation(projectId, sessionId, { role: "assistant", content: "New observation" });
  assert.equal(writes.length, 2, "new messages are saved before returning");
  coordinator.pinBlock(projectId, sessionId, 0);
  assert.equal(writes.length, 3, "pin changes are durable");
  assert.deepEqual(writes.at(-1)[3].pinnedBlocks, [0]);
});

test("unchanged measurements retry a failed save and retain agent isolation", () => {
  let fail = true;
  const writes = [];
  const coordinator = createTier1ContextCoordinator({ sensitiveStore: { writeActive: (...args) => { writes.push(args[1]); return fail ? { ok: false, code: "MEMORY_SAVE_FAILED" } : { ok: true, durable: true }; } } });
  const input = { project_id: projectId, session_id: sessionId, active_conversation: [{ role: "user", content: "Task" }], effective_context_limit: 262144 };
  coordinator.assemble(input);
  fail = false;
  coordinator.assemble(input);
  coordinator.assemble(input);
  assert.deepEqual(writes, [sessionId, sessionId]);
  const childId = "session_00000000-0000-4000-8000-000000008703";
  coordinator.assemble({ ...input, session_id: childId });
  assert.deepEqual(writes, [sessionId, sessionId, childId]);
});
