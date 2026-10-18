"use strict";

const assert = require("node:assert/strict");
const { runAgentTurn } = require("../../src/agent/controller/agent-controller.js");
const { createAgentSessionRuntime } = require("../../src/agent/runtime/agent-session-runtime.js");
const { createBrowserActionTool } = require("../../src/agent/tools/assessment/browser-action.js");
const { createEndTurnTool } = require("../../src/agent/tools/process/end-turn.js");
const { createToolRegistry, registerBrowserAction, registerEndTurn, toOpenAITools } = require("../../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../../src/contracts/tool/execution-context.js");
const { sessionFixture } = require("../../test/helpers/agent-session-store.js");

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const call = (id, action, args = {}) => ({ id, type: "function", function: { name: "browser_action", arguments: { action, ...args } } });
const finish = () => ({ id: "loop-finish", type: "function", function: { name: "end_turn", arguments: { status: "stop" } } });

function latestObservation(messages) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool") continue;
    const result = JSON.parse(message.content);
    const payload = typeof result.payload === "string" ? JSON.parse(result.payload) : result.payload;
    if (payload?.evidence?.observation) return payload.evidence.observation;
  }
  throw new Error("The normal model request did not contain a browser observation.");
}

async function runBrowserLoopFixture({ service, provider, fixtures, workspace, tabId }) {
  const cleanup = [];
  const fixture = sessionFixture({ after: action => cleanup.push(action) });
  const events = [], actions = [], modelRequests = [];
  const chatId = "browser-loop-chat";
  const location = { workspace, sessionId: "browser-loop-durable-session" };
  const runtime = createAgentSessionRuntime({ store: fixture.store, emit: event => events.push(event) });
  const browserTool = createBrowserActionTool({ browserProvider: provider });
  const registry = createToolRegistry();
  registerBrowserAction(registry, browserTool);
  registerEndTurn(registry, createEndTurnTool());
  const current = () => service.list().find(tab => tab.id === tabId);
  const steeringText = "Use the Admin role for this fixture sign-in.";
  let steeringReceipt = null;
  let stopResult = null;
  const controller = new AbortController();
  const originalOwner = current()?.owner;
  try {
    const existing = current();
    assert.ok(existing, "The browser loop needs a real native tab.");
    await service.handoff(tabId, chatId, existing.controlGeneration);
    const admission = await runtime.admit({ ...location, runId: "browser-loop-run", userMessage: "Use the shared browser to sign in with the synthetic fixture credentials.",
      inputId: "browser-loop-initial", binding: { provider: "ollama", model: "deterministic-browser-fixture" } });
    assert.equal(admission.ok, true, JSON.stringify(admission));

    const execute = async ({ toolCall, signal }) => {
      assert.equal(toolCall.function.name, "browser_action");
      const input = { ...toolCall.function.arguments, tabId };
      const context = projectExecutionContext(createExecutionContext({ invocationId: `fixture-${toolCall.id}`, toolName: "browser_action", role: "agent", authority: "scope_only",
        workspace: { root: workspace }, sessionId: "different-runtime-run-id", browserSessionId: chatId }));
      const operation = browserTool.execute(input, context, { signal });
      let stopWatch;
      if (input.action === "wait" && input.waitMs === 10000) {
        stopWatch = (async () => {
          for (let attempt = 0; attempt < 200; attempt++) {
            if (current().operation.status === "running") { controller.abort("OPERATOR_STOPPED"); return; }
            await pause(5);
          }
          throw new Error("The native browser wait never became active.");
        })();
      }
      const result = await operation;
      assert.doesNotMatch(JSON.stringify(result), /loop-fixture-password/, "Native observations must not echo the password value.");
      if (stopWatch) { await stopWatch; stopResult = result; }
      actions.push({ action: input.action, ok: result.ok, code: result.error?.code || "" });
      if (toolCall.id === "loop-user") {
        steeringReceipt = await runtime.receive({ ...location, input: { id: "browser-loop-steering", text: steeringText } });
        assert.equal(steeringReceipt.ok, true, JSON.stringify(steeringReceipt));
      }
      return result;
    };

    let round = 0;
    const run = await runAgentTurn({ workspace, sessionId: location.sessionId, model: "deterministic-browser-fixture", mode: "agent", modeFamily: "assist",
      numCtx: 65536, contextBudget: 65536, tools: toOpenAITools(registry), runId: admission.runId, initialInputId: admission.initialInputId,
      userMessage: admission.task.objective, chatHistory: admission.chatHistory, liveInput: admission.liveInput, engineSnapshot: admission.engineSnapshot,
      sendEvent: event => events.push(event), executeToolCall: execute, maxAgentRounds: 12,
      runModelRound: async request => {
        modelRequests.push(request.messages.map(message => ({ ...message })));
        round++;
        const target = name => {
          const observation = latestObservation(request.messages);
          const element = observation.elements.find(item => item.name === name);
          assert.ok(element, `The normal model request must expose ${name}.`);
          return { kind: "element", observationId: observation.id, ref: element.ref };
        };
        let tool;
        if (round === 1) tool = call("loop-navigate", "navigate", { url: fixtures.origins.primary + "/form" });
        else if (round === 2) tool = call("loop-user", "type", { target: target("User"), text: "LoopUser" });
        else if (round === 3) {
          assert.ok(request.messages.some(message => message.role === "user" && String(message.content).includes(steeringText)), "Steering must enter the next normal browser model round.");
          tool = call("loop-password", "type", { target: target("Password"), text: "loop-fixture-password" });
        } else if (round === 4) tool = call("loop-role", "select", { target: target("Role"), text: "admin" });
        else if (round === 5) tool = call("loop-submit", "click", { target: target("Sign in") });
        else if (round === 6) tool = call("loop-wait", "wait", { waitMs: 100 });
        else if (round === 7) tool = call("loop-observe", "observe");
        else if (round === 8) {
          assert.match(latestObservation(request.messages).text, /Signed in as LoopUser \(admin\)/);
          tool = finish();
        } else throw new Error("The deterministic browser model exceeded its expected rounds.");
        return { ok: true, fullText: round === 8 ? "The fixture sign-in completed with the requested Admin role." : "", toolCalls: [tool], finishReason: "tool_calls" };
      } });
    assert.equal(run.ok, true, run.error || run.runState?.stopReason || "Browser loop failed.");
    assert.equal(run.runState.status, "completed");
    assert.equal(actions.length, 7);
    assert.ok(actions.every(action => action.ok), JSON.stringify(actions));
    assert.equal(steeringReceipt.durable, true);
    assert.ok(events.some(event => event.type === "input_applied" && event.messageId === "browser-loop-steering"));
    const status = await service.getContents(tabId).executeJavaScript("document.querySelector('#status').textContent");
    assert.equal(status, "Signed in as LoopUser (admin)");

    let stopRounds = 0;
    const startedAt = Date.now();
    const stopped = await runAgentTurn({ workspace, sessionId: location.sessionId, model: "deterministic-browser-fixture", mode: "agent", tools: toOpenAITools(registry),
      userMessage: "Wait on this browser tab until I stop the turn.", numCtx: 32768, contextBudget: 32768, signal: controller.signal,
      sendEvent: event => events.push(event), executeToolCall: execute, maxAgentRounds: 3,
      runModelRound: async () => { stopRounds++; return { ok: true, fullText: "", toolCalls: [call("loop-stop-wait", "wait", { waitMs: 10000 })] }; } });
    const stopElapsedMs = Date.now() - startedAt;
    assert.equal(controller.signal.aborted, true);
    assert.equal(stopResult?.ok, false);
    assert.equal(stopped.runState.status, "stopped", JSON.stringify(stopped));
    assert.equal(stopRounds, 1);
    assert.ok(stopElapsedMs < 5000, `Browser stop took ${stopElapsedMs} ms.`);
    assert.equal(current().operation.status, "idle");
    return { completed: { ok: run.ok, status: run.runState.status, modelCalls: round, toolCalls: actions.slice(0, 7), pageStatus: status },
      steering: { durable: steeringReceipt.durable, applied: true, role: "admin" },
      stopped: { status: stopped.runState.status, modelCalls: stopRounds, toolResult: stopResult, elapsedMs: stopElapsedMs, operation: current().operation.status } };
  } finally {
    controller.abort("FIXTURE_FINISHED");
    const tab = current();
    if (tab && originalOwner) {
      if (originalOwner.kind === "chat") await service.handoff(tabId, originalOwner.sessionId, tab.controlGeneration);
      else await service.takeover(tabId, tab.controlGeneration);
    }
    await fixture.sensitiveStore.flush?.();
    for (const action of cleanup.reverse()) await action();
  }
}

function latestScreenshot(messages) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool") continue;
    const result = JSON.parse(message.content);
    const payload = typeof result.payload === "string" ? JSON.parse(result.payload) : result.payload;
    if (payload?.evidence?.screenshot) return payload.evidence.screenshot;
  }
  throw new Error("The normal model request did not contain a screenshot result.");
}

// One agent run that needs structure, then vision, then structure again. The
// deterministic model stands in for visual understanding: it is told where the
// canvas control is and must still act through the captured screenshot.
async function runHybridBrowserLoopFixture({ service, provider, fixtures, workspace, tabId }) {
  const cleanup = [];
  const fixture = sessionFixture({ after: action => cleanup.push(action) });
  const events = [], actions = [];
  const chatId = "browser-hybrid-chat";
  const location = { workspace, sessionId: "browser-hybrid-durable-session" };
  const runtime = createAgentSessionRuntime({ store: fixture.store, emit: event => events.push(event) });
  const browserTool = createBrowserActionTool({ browserProvider: provider });
  const registry = createToolRegistry();
  registerBrowserAction(registry, browserTool);
  registerEndTurn(registry, createEndTurnTool());
  const current = () => service.list().find(tab => tab.id === tabId);
  const steeringText = "Use the delivery note: leave at the side door.";
  let steeringReceipt = null;
  const originalOwner = current()?.owner;
  try {
    await service.handoff(tabId, chatId, current().controlGeneration);
    const admission = await runtime.admit({ ...location, runId: "browser-hybrid-run", userMessage: "Place the fixture order named Hybrid-42 and confirm it.",
      inputId: "browser-hybrid-initial", binding: { provider: "openrouter", model: "deterministic-vision-fixture" } });
    assert.equal(admission.ok, true, JSON.stringify(admission));
    const execute = async ({ toolCall, signal }) => {
      const input = { ...toolCall.function.arguments, tabId };
      const context = projectExecutionContext(createExecutionContext({ invocationId: `hybrid-${toolCall.id}`, toolName: "browser_action", role: "agent", authority: "scope_only",
        workspace: { root: workspace }, sessionId: "hybrid-runtime-run", browserSessionId: chatId }));
      const operation = browserTool.execute(input, context, { signal, assertVision: async () => true });
      if (toolCall.id === "hybrid-confirm") {
        for (let attempt = 0; attempt < 200 && current().operation.status !== "running"; attempt++) await pause(5);
        steeringReceipt = await runtime.receive({ ...location, input: { id: "browser-hybrid-steering", text: steeringText } });
      }
      const result = await operation;
      actions.push({ action: input.action, target: input.target?.kind || "", ok: result.ok, code: result.error?.code || "" });
      return result;
    };
    // The model acts on what each request shows. A visual click interrupted by
    // steering continues in the background, so the model looks again before
    // relying on the page.
    let step = 0, rounds = 0, done = false;
    const run = await runAgentTurn({ workspace, sessionId: location.sessionId, model: "deterministic-vision-fixture", mode: "agent", modeFamily: "assist",
      numCtx: 65536, contextBudget: 65536, tools: toOpenAITools(registry), runId: admission.runId, initialInputId: admission.initialInputId,
      userMessage: admission.task.objective, chatHistory: admission.chatHistory, liveInput: admission.liveInput, engineSnapshot: admission.engineSnapshot,
      sendEvent: event => events.push(event), executeToolCall: execute, maxAgentRounds: 16,
      runModelRound: async request => {
        if (++rounds > 14) throw new Error("The deterministic hybrid model exceeded its expected rounds.");
        if (done) return { ok: true, fullText: "Order Hybrid-42 is confirmed.", toolCalls: [finish()], finishReason: "tool_calls" };
        const observation = () => latestObservation(request.messages);
        const has = name => observation().elements.some(item => item.name === name);
        const target = name => {
          const element = observation().elements.find(item => item.name === name);
          assert.ok(element, `The normal model request must expose ${name}.`);
          return { kind: "element", observationId: observation().id, ref: element.ref };
        };
        const look = () => ({ ok: true, fullText: "", toolCalls: [call(`hybrid-observe-${rounds}`, "observe")], finishReason: "tool_calls" });
        let tool;
        if (step === 0) tool = call("hybrid-navigate", "navigate", { url: fixtures.origins.primary + "/hybrid" });
        else if (step === 1) tool = call("hybrid-order", "type", { target: target("Order name"), text: "Hybrid-42" });
        else if (step === 2) tool = call("hybrid-next", "click", { target: target("Continue to confirmation") });
        else if (step === 3) {
          assert.ok(observation().elements.some(item => item.role === "canvas"), "The confirmation is a canvas.");
          assert.ok(!has("Confirm"), "Structure offers no Confirm control.");
          tool = call("hybrid-look", "screenshot");
        } else if (step === 4) {
          const shot = latestScreenshot(request.messages);
          const box = await service.getContents(tabId).executeJavaScript("(()=>{const b=document.querySelector('#confirm').getBoundingClientRect();return {x:b.x+b.width*230/320,y:b.y+b.height*60/120}})()");
          tool = call("hybrid-confirm", "click", { target: { kind: "point", screenshotId: shot.id, x: Math.floor(box.x * shot.pixelWidth / shot.viewportWidth), y: Math.floor(box.y * shot.pixelHeight / shot.viewportHeight) } });
        } else if (step === 5) {
          assert.ok(request.messages.some(message => message.role === "user" && String(message.content).includes(steeringText)), "Steering sent during the visual click reaches the next round.");
          if (!has("Delivery note")) return look();
          tool = call("hybrid-note", "type", { target: target("Delivery note"), text: "leave at the side door" });
        } else if (step === 6) tool = call("hybrid-submit", "click", { target: target("Submit order") });
        else {
          if (!/Order Hybrid-42 confirmed with note leave at the side door/.test(observation().text)) return look();
          done = true;
          return { ok: true, fullText: "Order Hybrid-42 is confirmed.", toolCalls: [finish()], finishReason: "tool_calls" };
        }
        step++;
        return { ok: true, fullText: "", toolCalls: [tool], finishReason: "tool_calls" };
      } });
    assert.equal(run.ok, true, run.error || run.runState?.stopReason || "Hybrid loop failed.");
    assert.equal(run.runState.status, "completed");
    assert.ok(actions.every(action => action.ok), JSON.stringify(actions));
    assert.equal(steeringReceipt?.durable, true);
    return { sequence: actions.map(action => `${action.action}:${action.target}`), status: await service.getContents(tabId).executeJavaScript("document.querySelector('#status').textContent") };
  } finally {
    const tab = current();
    if (tab && originalOwner) {
      if (originalOwner.kind === "chat") await service.handoff(tabId, originalOwner.sessionId, tab.controlGeneration);
      else await service.takeover(tabId, tab.controlGeneration);
    }
    await fixture.sensitiveStore.flush?.();
    for (const action of cleanup.reverse()) await action();
  }
}

module.exports = { runBrowserLoopFixture, runHybridBrowserLoopFixture };
