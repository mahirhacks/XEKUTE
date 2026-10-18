"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createChatReferenceResolver, prepareChatReferenceContext, unpackChatReferences, referenceIds } = require("../src/agent/runtime/chat-references.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createDelegatedChildStore } = require("../src/agent/runtime/delegated-child-store.js");
const count = value => Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 4);
const state = content => ({ summary: null, active: [{ role: "assistant", content }], workflow: null });

async function setup(t) {
  const fixture = sessionFixture(t);
  const states = new Map([["session_a", state("Original evidence A")], ["session_b", state("New finding B")]]);
  for (const sessionId of states.keys()) await fixture.store.begin(fixture.workspace, { sessionId, userPrompt: sessionId });
  const tier1Context = { state: (_, id) => states.get(id) };
  const resolver = createChatReferenceResolver({ store: fixture.store, tier1Context });
  return { fixture, states, resolver, tier1Context };
}

async function prepare(resolver, workspace, contextText, options = {}) {
  let references;
  const result = await prepareChatReferenceContext({ contextText, effectiveLimit: 262000, destinationTokens: () => 1000,
    estimateTokens: count, compactDestination: () => assert.fail("The destination already has room"),
    summarize: () => assert.fail("This small snapshot must stay exact"),
    loadSnapshot: snapshotId => resolver.loadSnapshot({ workspace, snapshotId }),
    onPrepared: value => { references = value; }, ...options });
  return { contextText: result, references };
}

test("large sources queue encrypted snapshot IDs and are summarized after cold reopen", async t => {
  const { fixture, states, resolver, tier1Context } = await setup(t);
  states.set("session_a", state("a".repeat(600000)));
  states.set("session_b", state("b".repeat(600000)));
  const runtime = createAgentSessionRuntime({ store: fixture.store, resolveChatReferences: resolver });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const text = "Compare [chat: session_a A] and [chat: session_b B]";
  const admitted = await runtime.admit({ ...location, runId: "large", userMessage: text, inputId: "large" });
  assert.equal(admitted.ok, true, admitted.error);
  const journal = fixture.store.readControl(fixture.workspace, fixture.sessionId).control.inputs[0];
  assert.ok(journal.contextText.length < 2000);
  assert.equal(unpackChatReferences(journal.contextText).length, 2);
  assert.doesNotMatch(journal.contextText, /a{100}/);
  for (const descriptor of unpackChatReferences(journal.contextText)) {
    const loaded = fixture.store.readChatReferenceSnapshot(fixture.workspace, descriptor.snapshotId);
    assert.equal(loaded.encrypted && loaded.durable, true);
    assert.doesNotMatch(fs.readFileSync(loaded.path, "utf8"), /a{100}|b{100}/);
  }
  states.set("session_a", state("Changed after admission"));
  await fixture.store.remove(fixture.workspace, "session_b");
  const opened = fixture.open();
  const coldResolver = createChatReferenceResolver({ store: opened.store, tier1Context });
  const coldRuntime = createAgentSessionRuntime({ store: opened.store, resolveChatReferences: coldResolver });
  const resumed = await coldRuntime.admit({ ...location, runId: admitted.runId, taskId: admitted.taskId, resume: true });
  let summaries = 0, observed;
  const result = await runAgentTurn({ ...location, runId: admitted.runId, model: "execution", numCtx: 262000, userMessage: text,
    initialInputId: resumed.initialInputId, chatHistory: resumed.chatHistory, liveInput: resumed.liveInput,
    runModelRound: async request => {
      if (request.messages[0].content.includes("CHAT_REFERENCE_SUMMARY")) {
        summaries++;
        assert.doesNotMatch(JSON.stringify(request.messages), /Changed after admission/);
        return { ok: true, fullText: JSON.stringify({ summarizedConversation: `Captured evidence ${summaries}` }) };
      }
      observed = request.messages.find(message => message.source_message_id === "large");
      return { ok: true, fullText: "Compared", toolCalls: [{ id: "end", type: "function", function: { name: "end_turn", arguments: { status: "stop" } } }] };
    } });
  assert.equal(result.ok, true, result.error);
  assert.equal(summaries, 2);
  assert.match(observed.content, /Captured evidence 1/);
  assert.match(observed.content, /Captured evidence 2/);
  assert.equal(observed.reference_snapshots.length, 2);
  assert.deepEqual(Object.keys(unpackChatReferences(observed.content)[0]), ["summarizedConversation", "activeConversation", "currentWorkflow"]);
  const saved = opened.store.load(fixture.workspace).sessions.find(session => session.id === fixture.sessionId).history.find(message => message.source_message_id === "large");
  assert.equal(saved.reference_context, journal.contextText);
  assert.equal(saved.reference_snapshots.length, 2);
});

test("A to B to A drops the old A copy while preserving B's new conversation", async t => {
  const { fixture, states, resolver } = await setup(t);
  const outgoing = resolver({ workspace: fixture.workspace, sessionId: "session_b", text: "[chat: session_a A]" });
  const first = await prepare(resolver, fixture.workspace, outgoing);
  states.get("session_b").active.push({ role: "user", content: "Use A" + first.contextText, source_text: "Use A", reference_snapshots: first.references });
  const incoming = resolver({ workspace: fixture.workspace, sessionId: "session_a", text: "[chat: session_b B]" });
  const back = await prepare(resolver, fixture.workspace, incoming, { destinationSessionId: "session_a" });
  assert.match(back.contextText, /New finding B/);
  assert.doesNotMatch(back.contextText, /Original evidence A/);
  assert.match(back.contextText, /Use A/);
  assert.equal(unpackChatReferences(back.contextText)[0].activeConversation.length, 2);
});

test("snapshot provenance deduplicates transitive and repeated imports, including after encrypted reopen", async t => {
  const { fixture, states, resolver, tier1Context } = await setup(t);
  const first = await prepare(resolver, fixture.workspace, resolver({ workspace: fixture.workspace, sessionId: "session_b", text: "[chat: session_a A]" }));
  states.get("session_b").active.push({ role: "user", content: "Use A" + first.contextText, source_text: "Use A", reference_snapshots: first.references });
  const packet = resolver({ workspace: fixture.workspace, sessionId: fixture.sessionId, text: "[chat: session_b B] [chat: session_a A]" });
  const combined = await prepare(resolver, fixture.workspace, packet);
  assert.equal((combined.contextText.match(/Original evidence A/g) || []).length, 1);
  const coldResolver = createChatReferenceResolver({ store: fixture.open().store, tier1Context });
  const repeated = await prepare(coldResolver, fixture.workspace, packet, { knownSnapshotIds: referenceIds(combined.references) });
  assert.deepEqual(unpackChatReferences(repeated.contextText), []);
  states.get("session_a").active.push({ role: "assistant", content: "New evidence A2" });
  const newer = await prepare(coldResolver, fixture.workspace, coldResolver({ workspace: fixture.workspace, sessionId: fixture.sessionId, text: "[chat: session_a A]" }),
    { knownSnapshotIds: referenceIds(combined.references) });
  assert.match(newer.contextText, /New evidence A2/);
});

test("a missing snapshot fails preparation and never substitutes live source state", async t => {
  const { fixture, resolver } = await setup(t);
  const packet = resolver({ workspace: fixture.workspace, sessionId: fixture.sessionId, text: "[chat: session_a A]" });
  const descriptor = unpackChatReferences(packet)[0];
  const loaded = fixture.store.readChatReferenceSnapshot(fixture.workspace, descriptor.snapshotId);
  fs.unlinkSync(loaded.path);
  await assert.rejects(prepare(resolver, fixture.workspace, packet), { code: "CHAT_REFERENCE_UNAVAILABLE" });
});

test("Current Workflow is restored from the encrypted checkpoint before capturing a source", async t => {
  const { fixture } = await setup(t);
  const projectId = fixture.store.resolveProjectId(fixture.workspace);
  const warm = createTier1ContextCoordinator({ sensitiveStore: fixture.sensitiveStore });
  const checkpoint = await warm.checkpoint({ project_id: projectId, session_id: "session_a", objective: "Verify finding 42",
    active_conversation: [{ role: "user", content: "Verify finding 42" }], effective_context_limit: 100000, allow_model: false });
  assert.equal(checkpoint.ok, true, checkpoint.error);
  const opened = fixture.open();
  const cold = createTier1ContextCoordinator({ sensitiveStore: opened.sensitiveStore });
  const resolver = createChatReferenceResolver({ store: opened.store, tier1Context: cold });
  const packet = resolver({ workspace: fixture.workspace, sessionId: fixture.sessionId, text: "[chat: session_a A]" });
  const imported = unpackChatReferences((await prepare(resolver, fixture.workspace, packet)).contextText)[0];
  assert.deepEqual(imported.currentWorkflow, warm.state(projectId, "session_a").workflow);
  assert.match(JSON.stringify(imported.currentWorkflow), /Verify finding 42/);
});

test("steering checkpoints keep a compact capture handle even when the prepared conversation is large", async t => {
  const { fixture, resolver } = await setup(t);
  const contextText = resolver({ workspace: fixture.workspace, sessionId: fixture.sessionId, text: "[chat: session_a A]" });
  const children = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const args = { workspace: fixture.workspace, childSessionId: "session_child_snapshot", childInvocationId: "snapshot-child",
    parentSessionId: fixture.sessionId, runId: "run:snapshot-child", originalGoal: "Inspect the evidence" };
  await children.checkpointChild(args);
  const message = { role: "user", content: "Use A" + "x".repeat(1200000), source_text: "Use A", reference_context: contextText,
    reference_prepared: true, source_message_id: "snapshot-steer", task_revision: 1 };
  const receipt = await children.checkpointChild({ ...args, appendedMessages: [message], engineSnapshot: { runId: args.runId,
    revision: 1, inputMessages: [message], appliedInputIds: ["snapshot-steer"], runState: { status: "running" } } });
  assert.equal(receipt.ok, true);
  const control = fixture.open().store.readControl(fixture.workspace, args.childSessionId).control;
  assert.equal(control.inputs.find(input => input.id === "snapshot-steer").contextText, contextText);
  assert.ok(contextText.length < 2000);
});

test("snapshots cannot be loaded through another project and project reset removes them", async t => {
  const { fixture, resolver } = await setup(t);
  const contextText = resolver({ workspace: fixture.workspace, sessionId: fixture.sessionId, text: "[chat: session_a A]" });
  const { snapshotId } = unpackChatReferences(contextText)[0];
  assert.throws(() => resolver.loadSnapshot({ workspace: "G:/another-project", snapshotId }), { code: "CHAT_REFERENCE_UNAVAILABLE" });
  assert.equal(fixture.sensitiveStore.readChatReferenceSnapshot(fixture.store.resolveProjectId(fixture.workspace), "../escape").ok, false);
  const deleted = fixture.sensitiveStore.resetProject(fixture.store.resolveProjectId(fixture.workspace));
  assert.equal(deleted.ok, true);
  assert.throws(() => resolver.loadSnapshot({ workspace: fixture.workspace, snapshotId }), { code: "CHAT_REFERENCE_UNAVAILABLE" });
});

test("nested provenance survives another hop without restoring duplicate imported evidence", async t => {
  const { fixture, states, resolver } = await setup(t);
  await fixture.store.begin(fixture.workspace, { sessionId: "session_c", userPrompt: "C" });
  const a = await prepare(resolver, fixture.workspace, resolver({ workspace: fixture.workspace, sessionId: "session_b", text: "[chat: session_a A]" }));
  states.get("session_b").active.push({ role: "user", content: "Use A" + a.contextText, source_text: "Use A", reference_snapshots: a.references });
  const b = await prepare(resolver, fixture.workspace, resolver({ workspace: fixture.workspace, sessionId: "session_c", text: "[chat: session_b B]" }));
  states.set("session_c", { summary: null, workflow: null, active: [{ role: "assistant", content: "New finding C" },
    { role: "user", content: "Use B" + b.contextText, source_text: "Use B", reference_snapshots: b.references }] });
  const c = await prepare(resolver, fixture.workspace, resolver({ workspace: fixture.workspace, sessionId: "session_a", text: "[chat: session_c C]" }),
    { destinationSessionId: "session_a" });
  assert.match(c.contextText, /New finding B/);
  assert.match(c.contextText, /New finding C/);
  assert.doesNotMatch(c.contextText, /Original evidence A/);
});

test("the controller deduplicates a repeated import using provenance from the encrypted transcript", async t => {
  const { fixture, resolver, tier1Context } = await setup(t);
  let store = fixture.store, activeResolver = resolver;
  const observed = [];
  for (const inputId of ["first", "second"]) {
    const runtime = createAgentSessionRuntime({ store, resolveChatReferences: activeResolver });
    const text = `Use [chat: session_a A] for ${inputId}`;
    const admitted = await runtime.admit({ workspace: fixture.workspace, sessionId: fixture.sessionId, runId: inputId, userMessage: text, inputId });
    assert.equal(admitted.ok, true, admitted.error);
    const result = await runAgentTurn({ workspace: fixture.workspace, sessionId: fixture.sessionId, memorySessionId: fixture.sessionId,
      runId: inputId, model: "execution", numCtx: 262000, userMessage: text, initialInputId: inputId,
      chatHistory: admitted.chatHistory, liveInput: admitted.liveInput,
      runModelRound: async request => {
        observed.push(request.messages.find(message => message.source_message_id === inputId).content);
        return { ok: true, fullText: "Used", toolCalls: [{ id: "end", type: "function", function: { name: "end_turn", arguments: { status: "stop" } } }] };
      } });
    assert.equal(result.ok, true, result.error);
    store = fixture.open().store;
    activeResolver = createChatReferenceResolver({ store, tier1Context });
  }
  assert.match(observed[0], /Original evidence A/);
  assert.doesNotMatch(observed[1], /Original evidence A/);
});
