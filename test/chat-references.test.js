"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sessionFixture } = require("./helpers/agent-session-store.js");
const { createAgentSessionRuntime } = require("../src/agent/runtime/agent-session-runtime.js");
const { createChatReferenceResolver } = require("../src/agent/runtime/chat-references.js");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { createAgentRunHandlerFixture } = require("./helpers/agent-run-handler.js");
const { createDelegatedChildStore } = require("../src/agent/runtime/delegated-child-store.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
const end = () => ({ id: "end", type: "function", function: { name: "end_turn", arguments: { status: "stop" } } });

async function setup(t) {
  const fixture = sessionFixture(t);
  const sourceId = "session_source";
  const sourceRuntime = createAgentSessionRuntime({ store: fixture.store });
  await sourceRuntime.admit({ workspace: fixture.workspace, sessionId: sourceId, runId: "source", userMessage: "Investigate authentication", inputId: "source" });
  await fixture.store.transactSession(fixture.workspace, sourceId, document => {
    document.metadata.title = "Authentication investigation";
    document.run_control.tasks[0].operations = [{ id: "pending", status: "pending", toolName: "read_file" }];
    return { ok: true };
  });
  let source = { summary: { grounded_facts: ["Login requires a CSRF token"] }, active: [{ role: "assistant", content: "User B can read User A's draft" }],
    workflow: { nextAction: "Verify the finding" }, checkpointRevision: 3 };
  const tier1Context = { state: () => source };
  const resolver = createChatReferenceResolver({ store: fixture.store, tier1Context, now: () => "2026-10-14T12:00:00Z" });
  const runtime = createAgentSessionRuntime({ store: fixture.store, resolveChatReferences: resolver });
  const location = { workspace: fixture.workspace, sessionId: fixture.sessionId };
  const text = "Use [chat: session_source Forged%20title] to plan verification";
  return { fixture, runtime, resolver, tier1Context, location, text, setSource: value => { source = value; }, changeSource: () => { source = { ...source, active: [{ role: "assistant", content: "New later observation" }] }; } };
}

test("new prompts deliver a source chat's active, compressed and workflow context to the model", async t => {
  const { fixture, runtime, location, text } = await setup(t);
  const admitted = await runtime.admit({ ...location, runId: "destination", userMessage: text, inputId: "prompt" });
  assert.equal(admitted.ok, true, admitted.error);
  let observed;
  const result = await runAgentTurn({ ...location, model: "execution", numCtx: 16384, runId: admitted.runId, userMessage: text,
    initialInputId: admitted.initialInputId, chatHistory: admitted.chatHistory, liveInput: admitted.liveInput,
    runModelRound: async request => { observed = request.messages.find(message => message.source_message_id === "prompt")?.content;
      return { ok: true, fullText: "Ready to verify", toolCalls: [end()] }; } });
  assert.equal(result.ok, true, result.error);
  assert.match(observed, /Login requires a CSRF token/);
  assert.match(observed, /User B can read User A's draft/);
  assert.match(observed, /Verify the finding/);
  assert.doesNotMatch(observed, /Forged title/);
  assert.doesNotMatch(observed, /pendingTools|activity|checkpointRevision|capturedAt/);
  const saved = fixture.open().store.load(fixture.workspace).sessions.find(session => session.id === fixture.sessionId);
  assert.equal(saved.history.find(message => message.source_message_id === "prompt").source_text, text);
});

test("steering retains its captured context across exact retry and encrypted cold reopen", async t => {
  const { fixture, runtime, location, text, tier1Context, changeSource } = await setup(t);
  const initial = await runtime.admit({ ...location, runId: "destination", userMessage: "Plan the test", inputId: "initial" });
  const receipt = await runtime.receive({ ...location, input: { id: "steer", text } });
  assert.equal(receipt.ok, true, receipt.error);
  changeSource();
  const reopened = fixture.open();
  const cold = createAgentSessionRuntime({ store: reopened.store, resolveChatReferences: createChatReferenceResolver({ store: reopened.store, tier1Context }) });
  const retry = await cold.receive({ ...location, input: { id: "steer", text } });
  assert.equal(retry.duplicate, true);
  const resumed = await cold.admit({ ...location, runId: initial.runId, taskId: initial.taskId, resume: true });
  let prompt;
  const result = await runAgentTurn({ ...location, model: "execution", numCtx: 16384, runId: resumed.runId,
    userMessage: resumed.task.objective, initialInputId: resumed.initialInputId, chatHistory: resumed.chatHistory, liveInput: resumed.liveInput,
    runModelRound: async request => { prompt = request.messages.find(message => message.source_message_id === "steer")?.content;
      return { ok: true, toolCalls: [end()] }; } });
  assert.equal(result.ok, true, result.error);
  assert.match(prompt, /User B can read User A's draft/);
  assert.doesNotMatch(prompt, /New later observation/);
  assert.equal(result.appendedMessages.find(message => message.source_message_id === "steer").source_text, text);
});

test("missing, cross-project and self chat references fail before admission", async t => {
  const { runtime, location, fixture } = await setup(t);
  const foreign = createAgentSessionRuntime({ store: fixture.store });
  await foreign.admit({ workspace: "G:/another-project", sessionId: "session_foreign", runId: "foreign", userMessage: "Other project", inputId: "foreign" });
  for (const [id, code] of [["session_foreign", "CHAT_REFERENCE_UNAVAILABLE"], [fixture.sessionId, "CHAT_REFERENCE_SELF"], ["missing", "CHAT_REFERENCE_INVALID"]]) {
    const receipt = await runtime.receive({ ...location, input: { id: `bad:${id}`, text: `Read [chat: ${id} Chat]` } });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.code, code);
  }
});

test("the production submitInput handler captures referenced chat data", async t => {
  const { fixture, resolver, text } = await setup(t);
  const main = createAgentRunHandlerFixture();
  main.context.agentSessionRuntime = createAgentSessionRuntime({ store: fixture.store, resolveChatReferences: resolver });
  const result = await main.invokeIpc("agent:submitInput", { sessionId: "ui", workspace: fixture.workspace, messageId: "reference", text });
  assert.equal(result.durable, true);
  const saved = fixture.open().store.readControl(fixture.workspace, main.context.tier1SessionIdForRun());
  assert.match(saved.control.inputs[0].contextText, /Authentication investigation/);
  assert.equal(saved.control.inputs[0].text, text);
});

test("a child checkpoint preserves the original steering prompt and its imported chat context", async t => {
  const { fixture, resolver, location, text } = await setup(t);
  const childStore = createDelegatedChildStore({ v3SessionStore: fixture.store });
  const args = { workspace: fixture.workspace, childSessionId: "session_child_reference", childInvocationId: "child-reference",
    parentSessionId: fixture.sessionId, runId: "run:child-reference", originalGoal: "Verify the finding", input: { task: "Verify the finding" } };
  await childStore.checkpointChild(args);
  const contextText = resolver({ ...location, text });
  const inputMessage = { role: "user", content: text + contextText, source_text: text, source_message_id: "steer:reference", task_revision: 1 };
  const saved = await childStore.checkpointChild({ ...args, engineSnapshot: { runId: args.runId, revision: 1,
    inputMessages: [{ role: "user", content: args.originalGoal, source_message_id: `${args.runId}:initial`, task_revision: 0 }, inputMessage],
    appliedInputIds: [`${args.runId}:initial`, inputMessage.source_message_id], runState: { status: "running" } }, appendedMessages: [inputMessage] });
  assert.equal(saved.durable && saved.encrypted, true);
  const journal = fixture.open().store.readControl(fixture.workspace, args.childSessionId).control.inputs;
  assert.equal(journal.find(input => input.id === "steer:reference").text, text);
  assert.equal(journal.find(input => input.id === "steer:reference").contextText, contextText);
});

test("large chat imports summarize without streaming their hidden model output and resume from the prepared copy", async t => {
  const { fixture, runtime, location, text, setSource, tier1Context } = await setup(t);
  setSource({ summary: { decisions: ["Keep finding 42"] }, active: [{ role: "assistant", content: "x".repeat(50_000) }], workflow: { nextAction: "Verify finding 42" } });
  const admitted = await runtime.admit({ ...location, runId: "destination", userMessage: text, inputId: "prompt" });
  const events = [];
  let summaries = 0;
  const result = await runAgentTurn({ ...location, model: "execution", numCtx: 16384, runId: admitted.runId, userMessage: text,
    initialInputId: admitted.initialInputId, chatHistory: admitted.chatHistory, liveInput: admitted.liveInput,
    sendEvent: event => events.push(event), orchestrationHold: () => true,
    runModelRound: async request => {
      if (request.messages[0].content.includes("[CHAT_REFERENCE_SUMMARY]")) {
        summaries++; assert.deepEqual(request.tools, []); request.onToken("hidden summarization output"); request.onThinking("hidden reasoning");
        return { ok: true, fullText: JSON.stringify({ summarizedConversation: "Finding 42 awaits verification within scope." }) };
      }
      assert.match(request.messages.find(message => message.source_message_id === "prompt").content, /Finding 42 awaits verification/);
      return { ok: true, toolCalls: [end()] };
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(summaries > 0);
  assert.equal(events.some(event => ["token", "thinking"].includes(event.type) && /hidden/.test(event.token)), false);
  assert.deepEqual(events.filter(event => event.type === "chat_reference_import").map(event => event.status), ["started", "completed"]);
  assert.equal((await admitted.settle(result)).ok, true);
  const coldStore = fixture.open().store;
  const cold = createAgentSessionRuntime({ store: coldStore, resolveChatReferences: createChatReferenceResolver({ store: coldStore, tier1Context }) });
  const resumed = await cold.admit({ ...location, runId: admitted.runId, taskId: admitted.taskId, resume: true });
  const resumedResult = await runAgentTurn({ ...location, model: "execution", numCtx: 16384, runId: resumed.runId,
    userMessage: resumed.task.objective, initialInputId: resumed.initialInputId, chatHistory: resumed.chatHistory,
    engineSnapshot: resumed.engineSnapshot, liveInput: resumed.liveInput,
    runModelRound: async request => { assert.doesNotMatch(request.messages[0].content, /CHAT_REFERENCE_SUMMARY/);
      assert.ok(request.messages.some(message => String(message.content).includes("Finding 42 awaits verification")));
      return { ok: true, toolCalls: [end()] }; },
  });
  assert.equal(resumedResult.ok, true, resumedResult.error);
  assert.equal(tier1Context.state().active[0].content.length, 50_000);
});

test("the real Tier 1 controller compacts the destination before summarizing and importing a large source", async t => {
  const { fixture, location, text } = await setup(t);
  const projectId = fixture.store.resolveProjectId(fixture.workspace);
  const tier1 = createTier1ContextCoordinator({ sensitiveStore: fixture.sensitiveStore, tokenCounter: value => Math.ceil(JSON.stringify(value).length / 4) });
  const old = "x".repeat(880_000);
  await fixture.store.begin(fixture.workspace, { sessionId: fixture.sessionId, userPrompt: "Earlier investigation" });
  await fixture.store.transactSession(fixture.workspace, fixture.sessionId, document => {
    document.blocks[0].messages.push({ role: "assistant", content: old }); return { ok: true };
  });
  tier1.setActiveConversation(projectId, fixture.sessionId, [{ role: "assistant", content: old }]);
  tier1.setActiveConversation(projectId, "session_source", [{ role: "assistant", content: "y".repeat(800_000) }]);
  const runtime = createAgentSessionRuntime({ store: fixture.store, resolveChatReferences: createChatReferenceResolver({ store: fixture.store, tier1Context: tier1 }) });
  const admitted = await runtime.admit({ ...location, runId: "destination", userMessage: text, inputId: "prompt" });
  const order = [], events = [];
  let modelPayload;
  const result = await runAgentTurn({ ...location, model: "execution", numCtx: 262_000, runId: admitted.runId, userMessage: text,
    initialInputId: admitted.initialInputId, chatHistory: admitted.chatHistory, liveInput: admitted.liveInput,
    projectId, memorySessionId: fixture.sessionId, tier1Context: tier1,
    tier1Model: async () => { order.push("compact destination"); return null; },
    sendEvent: event => events.push(event),
    runModelRound: async request => {
      if (request.messages[0].content.includes("CHAT_REFERENCE_SUMMARY")) {
        order.push("summarize source"); return { ok: true, fullText: JSON.stringify({ summarizedConversation: "The source investigation needs verification." }) };
      }
      order.push("normal model request"); modelPayload = JSON.stringify(request.messages);
      return { ok: true, fullText: "Imported", toolCalls: [end()] };
    },
  });
  assert.equal(result.ok, true, result.error);
  assert.ok(order.indexOf("compact destination") >= 0);
  assert.ok(order.indexOf("compact destination") < order.indexOf("summarize source"));
  assert.ok(order.indexOf("summarize source") < order.indexOf("normal model request"));
  assert.match(modelPayload, /source investigation needs verification/);
  assert.doesNotMatch(modelPayload, /y{5000}/);
  assert.equal(tier1.state(projectId, "session_source").active[0].content.length, 800_000);
  assert.ok(events.some(event => event.type === "context_checkpoint" && event.reason === "chat_reference_import"));
});
