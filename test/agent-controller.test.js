const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const AgentToolSurface = require("../src/agent/tools/config/tool-surface.js");
const {
  MAX_AGENT_ROUNDS,
  buildEngagementPromptContext,
  isReasonablyLargeAgentRequest,
  runAgentTurn,
  fitMessagesToContext,
  advanceTowardPhase,
  toolCallSignature,
} = require("../src/agent/controller/agent-controller.js");
const { createTier1ContextCoordinator, CHECKPOINT_RATIO } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { classifyEvidenceRequirement } = require("../src/agent/runtime/evidence-classifier.js");
const ContextRouter = require("../src/prompts/skills/context-router");
const ModeSkills = require("../src/prompts/skills/mode-skills");
const { buildSystemContext } = require("../src/agent/runtime/prompt-context.js");
const { createAssessmentWorkspace } = require("../src/domain/assessment/assessment-workspace");
const { endTurnCall } = require("./helpers/end-turn-call.js");

function checklistCall(id = "checklist-1", args = {
  action: "create",
  main_goal: "Review supplied evidence safely",
  items: [{ id: "inspect", label: "Inspect supplied evidence", description: "Review only the supplied files and notes.", status: "in_progress" }],
}) {
  return { id, type: "function", function: { name: "manage_task_checklist", arguments: JSON.stringify(args) } };
}

function routingFixture({ skillScore = 0.1 } = {}) {
  const decisions = [];
  const loaded = [];
  const skillRouter = {
    enabled: true,
    freshRun: true,
    model: "typesafe/jev-1.14",
    candidates: [{ id: "evidence-review", title: "Evidence Review", description: "Assess supplied evidence", modes: ["agent"] }],
    runDecision: async ({ model, questions, state }) => {
      decisions.push({ model, questions: Object.keys(questions), state });
      return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: skillScore }])) };
    },
    loadSkill: async (id) => {
      loaded.push(id);
      return {
        ok: true,
        manifest: { id, title: "Evidence Review", description: "Assess supplied evidence", modes: ["agent"], requiredTools: [], requiredCapabilities: [] },
        prompt: "ROUTED_SKILL_MARKER: separate observations from assumptions.",
      };
    },
  };
  return { decisions, loaded, skillRouter };
}

test("a pending checklist holds accompanying commands until the first item starts", async () => {
  const { skillRouter } = routingFixture();
  const executed = [], events = [];
  let round = 0;
  const command = id => ({ id, type: "function", function: { name: "exec_command", arguments: JSON.stringify({ command: "fixture-only" }) } });
  const result = await runAgentTurn({
    mode: "agent", userMessage: "Inspect, verify, and report.", skillRouter, maxAgentRounds: 5,
    sendEvent: event => events.push(event),
    runModelRound: async () => {
      round++;
      if (round === 1) return { fullText: "", toolCalls: [checklistCall("pending", { action: "create", main_goal: "Inspect local evidence", items: [
        { id: "inspect", label: "Inspect evidence", description: "Read the supplied notes.", status: "pending" },
      ] }), command("held-command")] };
      if (round === 2) return { fullText: "", toolCalls: [checklistCall("start", { action: "update", items: [{ id: "inspect", status: "in_progress" }] }), command("allowed-command")] };
      return { fullText: "Reviewed.", toolCalls: [endTurnCall("end")] };
    },
    executeToolCall: async ({ toolCall }) => { executed.push(toolCall.id); return { ok: true, value: { stdout: "Reviewed", exitCode: 0 } }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(executed, ["allowed-command"], "the command prestart path must respect checklist admission");
  assert.ok(events.some(event => event.type === "tool_result" && event.result?.errorCode === "CHECKLIST_INVALID"));
});

test("resumed unordered checklists hold work until repaired and retain completed items", async () => {
  const { skillRouter } = routingFixture();
  const makeItem = (id, status) => ({ id, label: `Review ${id}`, description: `Review supplied notes for ${id}.`, status });
  const executed = [];
  let round = 0;
  const read = id => ({ id, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.md" }) } });
  const result = await runAgentTurn({
    mode: "agent", userMessage: "Resume the supplied investigation.", skillRouter, maxAgentRounds: 5,
    engineSnapshot: { checklist: { main_goal: "Review supplied notes", items: [makeItem("first", "pending"), makeItem("done", "completed"), makeItem("later", "in_progress")] } },
    runModelRound: async () => {
      round++;
      if (round === 1) return { fullText: "", toolCalls: [read("held")] };
      if (round === 2) return { fullText: "", toolCalls: [checklistCall("repair", { action: "update", items: [{ id: "later", status: "pending" }, { id: "first", status: "in_progress" }] }), read("after-repair")] };
      return { fullText: "Reviewed.", toolCalls: [endTurnCall("end")] };
    },
    executeToolCall: async ({ toolCall }) => { executed.push(toolCall.id); return { ok: true, value: { content: "Reviewed" } }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(executed, ["after-repair"]);
  assert.deepEqual(result.engineSnapshot.checklist.items.map(({ status }) => status), ["in_progress", "completed", "pending"]);
});

test("irrelevant checklist edits cannot reset a missing-active-item correction", async () => {
  const { skillRouter } = routingFixture();
  let round = 0;
  const result = await runAgentTurn({
    mode: "agent", userMessage: "Inspect, verify, and report.", skillRouter, maxAgentRounds: 5,
    runModelRound: async () => {
      round++;
      const plan = round === 1 ? { action: "create", main_goal: "Review notes", items: [{ id: "inspect", label: "Inspect notes", description: "Review the supplied notes.", status: "pending" }] }
        : { action: "update", main_goal: "Review notes carefully" };
      return { fullText: "", toolCalls: [checklistCall(`plan-${round}`, plan), { id: `read-${round}`, type: "function", function: { name: "read_file", arguments: '{"path":"notes.md"}' } }] };
    },
    executeToolCall: async () => assert.fail("task work must remain held"),
  });
  assert.equal(result.code, "CHECKLIST_INVALID");
  assert.equal(round, 2);
  assert.equal(result.engineSnapshot.checklist.items[0].status, "pending");
});

test("the agent creates its checklist directly and an empty picker permits paired task actions", async () => {
  const { decisions, skillRouter } = routingFixture();
  const roundTools = [];
  const roundPayloads = [];
  const routingLogs = [];
  const events = [];
  const executed = [];
  let round = 0;
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Review supplied code, identify evidence gaps, and report the result.",
    skillRouter,
    checkpointRun: async patch => { if (patch.checkpoint?.skillRouting) routingLogs.push(patch.checkpoint.skillRouting); },
    sendEvent: (event) => events.push(event),
    runModelRound: async (payload) => {
      const { tools } = payload;
      roundPayloads.push(payload);
      roundTools.push(tools.map((tool) => tool.function.name));
      round += 1;
      if (round === 1) return { fullText: "", toolCalls: [checklistCall(), { id: "read-1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.md" }) } }] };
      return { fullText: "Reviewed the supplied evidence.", toolCalls: [endTurnCall("end-2")] };
    },
    executeToolCall: async ({ toolCall }) => {
      executed.push(toolCall.function.name);
      return { ok: true, value: { content: "fixture result" } };
    },
  });
  assert.equal(result.ok, true);
  assert.ok(roundTools[0].includes("manage_task_checklist"));
  assert.ok(roundTools[0].includes("read_file"), "the agent starts with its normal tools");
  assert.match(JSON.stringify(roundPayloads[0].messages), /three or more meaningful steps/);
  assert.match(JSON.stringify(roundPayloads[0].messages), /one or two meaningful steps/);
  assert.ok(roundTools[1].includes("read_file"));
  assert.deepEqual(executed, ["read_file"]);
  assert.deepEqual(decisions.map(({ questions }) => questions), [["skill_evidence-review"]]);
  assert.deepEqual(routingLogs, [{ model: "typesafe/jev-1.14", source: "native", candidateCount: 1,
    outcome: "no_additions", topScores: [{ id: "evidence-review", score: 0.1 }], selected: [], loaded: [] }]);
  const postChecklistPrompt = JSON.stringify(roundPayloads[1].messages);
  assert.match(postChecklistPrompt, /Review supplied evidence safely/);
  assert.match(postChecklistPrompt, /Inspect supplied evidence/);
  assert.match(postChecklistPrompt, /Review only the supplied files and notes/);
  assert.equal(events.some((event) => event.type === "task_list" && event.tasks?.[0]?.title === "Inspect supplied evidence"), true);
  assert.equal(events.some((event) => event.type === "skills_loaded"), false);
  const widget = events.find((event) => event.type === "task_list");
  assert.equal(JSON.stringify(widget).includes("Review supplied evidence safely"), false);
  assert.equal(JSON.stringify(widget).includes("Review only the supplied files and notes."), false);
});

test("new skill instructions suppress paired calls and appear before regenerated actions", async () => {
  const { decisions, loaded, skillRouter } = routingFixture({ skillScore: 0.95 });
  const payloads = [];
  const events = [];
  const executed = [];
  let round = 0;
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Review supplied code, identify evidence gaps, and report the result.",
    skillRouter,
    sendEvent: (event) => events.push(event),
    runModelRound: async (payload) => {
      payloads.push(payload);
      round += 1;
      if (round === 1) return { fullText: "", toolCalls: [checklistCall(), { id: "read-1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.md" }) } }] };
      return { fullText: "Reviewed with the selected evidence skill.", toolCalls: [endTurnCall("end-2")] };
    },
    executeToolCall: async ({ toolCall }) => {
      executed.push(toolCall.function.name);
      return { ok: true, value: { content: "fixture result" } };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(loaded, ["evidence-review"]);
  assert.deepEqual(executed, []);
  assert.deepEqual(decisions.map(({ questions }) => questions), [["skill_evidence-review"]]);
  assert.equal(events.some((event) => event.type === "tool_result" && JSON.stringify(event.result).includes("Not executed because checklist routing loaded new instructions")), true);
  assert.equal(JSON.stringify(payloads[1].messages).includes("ROUTED_SKILL_MARKER"), true);
  assert.deepEqual(events.filter((event) => event.type === "skills_loaded"), [{ type: "skills_loaded", skills: ["Evidence Review"] }]);
  assert.equal(events.filter(event => event.type === "model_start").length, payloads.length);
  assert.ok(events.findIndex(event => event.type === "model_start") < events.findIndex(event => event.type === "model_round"));
});

test("an explicit skill announces its load once and recovery does not announce it again", async () => {
  const specialSkill = { manifest: { id: "evidence-review", title: "Evidence Review" }, prompt: "Review supplied evidence carefully." };
  const events = [];
  const options = { mode: "agent", userMessage: "Review this note", specialSkill, sendEvent: event => events.push(event),
    runModelRound: async () => ({ fullText: "Reviewed.", toolCalls: [endTurnCall("explicit-end")] }) };
  const result = await runAgentTurn(options);
  assert.equal(result.ok, true);
  assert.deepEqual(events.filter(event => event.type === "skills_loaded"), [{ type: "skills_loaded", skills: ["Evidence Review"] }]);
  events.length = 0;
  const restored = await runAgentTurn({ ...options, engineSnapshot: result.engineSnapshot });
  assert.equal(restored.ok, true);
  assert.deepEqual(events.filter(event => event.type === "skills_loaded"), []);
});

test("greetings and short tasks can finish without a checklist or a decision-model call", async () => {
  for (const mode of ["agent", "ask"]) for (const task of ["Hi", "Explain HTTP 401", "Read notes.md and summarize it."]) {
    const { decisions, skillRouter } = routingFixture();
    let modelCalls = 0;
    const result = await runAgentTurn({
      mode,
      userMessage: task,
      skillRouter,
      runModelRound: async ({ tools, messages }) => {
        modelCalls += 1;
        assert.equal(decisions.length, 0, "there is no initial planning decision");
        assert.ok(tools.some((tool) => tool.function.name === "manage_task_checklist"));
        assert.match(JSON.stringify(messages), /Checklist planning is the default for substantive work/);
        return { fullText: "Direct response.", toolCalls: [endTurnCall("small-end")] };
      },
    });
    assert.equal(result.runState.status, "completed");
    assert.equal(modelCalls, 1);
    assert.deepEqual(decisions, []);
    assert.equal(result.engineSnapshot.checklist, null);
    assert.equal(result.engineSnapshot.skillRouterState.decisionModel, "typesafe/jev-1.14");
    assert.equal(Object.hasOwn(result.engineSnapshot, "planState"), false);
  }
});

test("the agent can create a checklist after direct work without a planning decision", async () => {
  const { decisions, skillRouter } = routingFixture();
  let rounds = 0;
  let actions = 0;
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Inspect notes.md and investigate the issues you find.",
    skillRouter,
    runModelRound: async () => {
      rounds += 1;
      if (rounds === 1) return { fullText: "", toolCalls: [{ id: "initial-read", type: "function", function: { name: "read_file", arguments: '{"path":"notes.md"}' } }] };
      if (rounds === 2) {
        assert.equal(decisions.length, 0);
        return { fullText: "", toolCalls: [checklistCall("later-checklist")] };
      }
      return { fullText: "Investigation complete.", toolCalls: [endTurnCall("later-end")] };
    },
    executeToolCall: async () => { actions += 1; return { ok: true, value: { content: "Several issues need investigation." } }; },
  });
  assert.equal(result.runState.status, "completed");
  assert.equal(actions, 1);
  assert.deepEqual(decisions.map(({ questions }) => questions), [["skill_evidence-review"]]);
  assert.equal(result.engineSnapshot.checklist.items[0].id, "inspect");
});

test("invalid checklist calls preserve state and do not invoke the skill picker", async () => {
  const { decisions, skillRouter } = routingFixture();
  const tooLong = checklistCall("bad", {
    action: "create",
    main_goal: "Review safely",
    items: [{ id: "too-long", label: Array.from({ length: 13 }, (_, index) => `word${index}`).join(" "), description: "Review evidence.", status: "pending" }],
  });
  let round = 0;
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Review this evidence.",
    skillRouter: { ...skillRouter, runDecision: async ({ questions }) => {
      decisions.push({ questions: Object.keys(questions) });
      return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.9 }])) };
    } },
    runModelRound: async () => {
      round += 1;
      return round === 1
        ? { fullText: "", toolCalls: [tooLong] }
        : { fullText: "No checklist was accepted.", toolCalls: [endTurnCall("end-2")] };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(decisions.map(({ questions }) => questions), []);
  assert.equal(result.engineSnapshot.checklist, null);
});

test("overlapping checklist activity is rejected before routing or accompanying task execution", async () => {
  const { decisions, skillRouter } = routingFixture();
  const events = [];
  const executed = [];
  let round = 0;
  const read = { id: "read-after-handoff", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.md" }) } };
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Inspect evidence, verify the result, and report the gaps.",
    skillRouter,
    sendEvent: event => events.push(event),
    runModelRound: async () => {
      round += 1;
      if (round === 1) return { fullText: "", toolCalls: [checklistCall("initial", {
        action: "create", main_goal: "Review supplied evidence",
        items: [
          { id: "inspect", label: "Inspect evidence", description: "Inspect the supplied files.", status: "in_progress" },
          { id: "verify", label: "Verify results", description: "Verify the evidence before reporting.", status: "pending" },
        ],
      })] };
      if (round === 2) return { fullText: "", toolCalls: [checklistCall("overlap", { action: "update", items: [{ id: "verify", status: "in_progress" }] }), { ...read, id: "read-before-repair" }] };
      if (round === 3) return { fullText: "", toolCalls: [checklistCall("handoff", { action: "update", items: [{ id: "inspect", status: "completed" }, { id: "verify", status: "in_progress" }] }), read] };
      return { fullText: "Verification complete.", toolCalls: [endTurnCall("finish")] };
    },
    executeToolCall: async ({ toolCall }) => { executed.push(toolCall.id); return { ok: true, value: { content: "Verified fixture." } }; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(executed, ["read-after-handoff"]);
  assert.equal(decisions.length, 2, "only the initial checklist and repaired handoff invoke selection");
  assert.deepEqual(events.filter(event => event.type === "task_list").map(event => event.tasks.map(({ status }) => status)), [
    ["in_progress", "pending"], ["completed", "in_progress"],
  ]);
  assert.deepEqual(result.engineSnapshot.checklist.items.map(({ status }) => status), ["completed", "in_progress"]);
});

test("one checklist repair is allowed and repeated invalid calls fail before task actions", async () => {
  const { decisions, skillRouter } = routingFixture();
  const invalid = checklistCall("too-long", {
    action: "create",
    main_goal: "Review safely",
    items: [{ id: "too-long", label: Array.from({ length: 13 }, (_, index) => `word${index}`).join(" "), description: "Review evidence.", status: "pending" }],
  });
  let rounds = 0;
  const executed = [];
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Review the supplied evidence across several files.",
    skillRouter: { ...skillRouter, runDecision: async ({ questions }) => {
      decisions.push({ questions: Object.keys(questions) });
      return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.1 }])) };
    } },
    runModelRound: async () => {
      rounds += 1;
      return { fullText: "", toolCalls: [invalid, { id: `read-${rounds}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.md" }) } }] };
    },
    executeToolCall: async ({ toolCall }) => { executed.push(toolCall.function.name); return { ok: true }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CHECKLIST_INVALID");
  assert.equal(rounds, 2, "the model received one corrective turn");
  assert.deepEqual(executed, [], "an invalid chosen checklist holds its accompanying task actions");
  assert.deepEqual(decisions.map(({ questions }) => questions), []);
  assert.equal(result.engineSnapshot.checklist, null);
});

test("a valid checklist correction resets the error and routes exactly once", async () => {
  const { decisions, skillRouter } = routingFixture();
  const invalid = checklistCall("bad-first", {
    action: "create",
    main_goal: "Review safely",
    items: [{ id: "too-long", label: Array.from({ length: 13 }, (_, index) => `word${index}`).join(" "), description: "Review evidence.", status: "pending" }],
  });
  let rounds = 0;
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Review the supplied evidence across several files.",
    skillRouter: { ...skillRouter, runDecision: async ({ questions }) => {
      decisions.push({ questions: Object.keys(questions) });
      return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.1 }])) };
    } },
    runModelRound: async () => {
      rounds += 1;
      if (rounds === 1) return { fullText: "", toolCalls: [invalid] };
      if (rounds === 2) return { fullText: "", toolCalls: [checklistCall("repaired")] };
      return { fullText: "The review is complete.", toolCalls: [endTurnCall("end-repaired")] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.engineSnapshot.checklist.items[0].id, "inspect");
  assert.deepEqual(decisions.map(({ questions }) => questions), [["skill_evidence-review"]]);
});

test("snapshot recovery restores exact checklist and active instructions without routing again", async () => {
  const { skillRouter } = routingFixture({ skillScore: 0.95 });
  let firstRounds = 0;
  const first = await runAgentTurn({
    mode: "agent",
    userMessage: "Review the supplied evidence and report the gaps.",
    skillRouter,
    maxAgentRounds: 4,
    runModelRound: async () => {
      firstRounds += 1;
      return firstRounds === 1
        ? { fullText: "", toolCalls: [checklistCall("recovery-checklist")] }
        : { fullText: "Continuing the review.", toolCalls: [endTurnCall("recovery-end")] };
    },
  });
  assert.equal(first.ok, true);
  const storedInstructions = first.engineSnapshot.activeSkillRecords[0].instructions;
  let decisionCalls = 0;
  let skillLoads = 0;
  const events = [];
  const resumed = await runAgentTurn({
    mode: "agent",
    userMessage: "Review the supplied evidence and report the gaps.",
    chatHistory: first.appendedMessages,
    engineSnapshot: first.engineSnapshot,
    skillRouter: {
      ...skillRouter,
      freshRun: false,
      runDecision: async () => { decisionCalls += 1; throw new Error("recovery must not reroute"); },
      loadSkill: async () => { skillLoads += 1; throw new Error("recovery must not recompile"); },
    },
    sendEvent: (event) => events.push(event),
    runModelRound: async ({ messages }) => {
      assert.ok(messages.some((message) => String(message.content || "").includes("ROUTED_SKILL_MARKER")));
      return { fullText: "The recovery is complete.", toolCalls: [endTurnCall("recovery-resumed-end")] };
    },
  });
  assert.equal(resumed.ok, true);
  assert.equal(decisionCalls, 0);
  assert.equal(skillLoads, 0);
  assert.equal(resumed.engineSnapshot.activeSkillRecords[0].instructions, storedInstructions);
  assert.equal(resumed.engineSnapshot.checklist.items[0].id, "inspect");
  assert.equal(events.some((event) => event.type === "task_list" && event.tasks?.[0]?.id === "inspect"), true);
});

test("checklist replay with a provider call ID uses its durable receipt", async () => {
  const operation = {
    action: "create",
    main_goal: "Review supplied evidence safely",
    items: [{ id: "inspect", label: "Inspect supplied evidence", description: "Review only supplied files.", status: "in_progress" }],
  };
  const replay = checklistCall("replay", operation);
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Continue the evidence review.",
    engineSnapshot: {
      skillRouterState: { decisionModel: "typesafe/jev-1.14" },
      checklist: { main_goal: operation.main_goal, items: operation.items },
      successfulToolRefs: ["replay"],
    },
    skillRouter: { enabled: true, freshRun: false, model: "typesafe/jev-1.14", candidates: [], runDecision: async () => { throw new Error("replay must not route"); } },
    runModelRound: async () => ({ fullText: "The review continues.", toolCalls: [replay, endTurnCall("replay-end")] }),
  });
  assert.equal(result.ok, true, `${result.code || ""}: ${result.error || ""}`);
  assert.equal(result.engineSnapshot.actionResults[0].ok, true, JSON.stringify(result.engineSnapshot.actionResults));
  assert.equal(result.engineSnapshot.actionResults[0].error, undefined);
});

test("skill selection falls back through the agent LLM once after a technical decision failure", async () => {
  const { skillRouter } = routingFixture();
  const calls = [];
  let rounds = 0;
  const result = await runAgentTurn({
    mode: "agent",
    model: "worker-model",
    userMessage: "Review the supplied evidence and prepare a report.",
    skillRouter: {
      ...skillRouter,
      runDecision: async () => { throw new Error("decision service unavailable"); },
      runFallback: async (request) => { calls.push(request); return '{"skill_ids":["evidence-review"]}'; },
    },
    runModelRound: async () => {
      rounds += 1;
      if (rounds === 1) {
        assert.equal(calls.length, 0);
        return { fullText: "", toolCalls: [checklistCall("fallback-checklist")] };
      }
      return { fullText: "Reviewed.", toolCalls: [endTurnCall("fallback-end")] };
    },
  });
  assert.equal(result.runState.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "worker-model");
  assert.match(calls[0].messages[0].content, /skill_ids/);
  assert.deepEqual(result.engineSnapshot.activeSkillRecords.map(({ id }) => id), ["evidence-review"]);
});

test("skill selection still applies its 0.70 threshold after the agent creates a checklist", async () => {
  for (const score of [0.699, 0.70]) {
    const { decisions, skillRouter } = routingFixture({ skillScore: score });
    let rounds = 0;
    const result = await runAgentTurn({
      mode: "agent",
      userMessage: "Review evidence, compare findings, and prepare the report.",
      skillRouter,
      runModelRound: async () => {
        rounds += 1;
        return rounds === 1
          ? { fullText: "", toolCalls: [checklistCall(`threshold-${score}`)] }
          : { fullText: "Report ready.", toolCalls: [endTurnCall(`threshold-end-${score}`)] };
      },
    });
    assert.equal(result.runState.status, "completed");
    assert.equal(decisions.length, 1);
    assert.equal(result.engineSnapshot.activeSkillRecords.length, score >= 0.7 ? 1 : 0);
  }
});

test("older router snapshots keep the frozen model without forcing their old planning decision", async () => {
  const { skillRouter } = routingFixture();
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Hi",
    engineSnapshot: { planState: { evaluated: true, requiresPlan: true, decisionModel: "frozen-model" } },
    skillRouter: { ...skillRouter, freshRun: false, model: "new-settings-model", runDecision: async () => { throw new Error("no checklist means no picker call"); } },
    runModelRound: async ({ tools }) => {
      assert.ok(tools.length > 1);
      return { fullText: "Hello.", toolCalls: [endTurnCall("migration-end")] };
    },
  });
  assert.equal(result.runState.status, "completed");
  assert.equal(result.engineSnapshot.skillRouterState.decisionModel, "frozen-model");
  assert.equal(Object.hasOwn(result.engineSnapshot, "planState"), false);
});

test("unfinished pre-router runs keep their existing tool behavior", async () => {
  const { skillRouter } = routingFixture();
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Continue the work.",
    engineSnapshot: { version: 1 },
    skillRouter: { ...skillRouter, freshRun: false, runDecision: async () => { throw new Error("legacy runs must not route"); } },
    runModelRound: async ({ tools }) => {
      assert.equal(tools.some((tool) => tool.function.name === "manage_task_checklist"), false);
      return { fullText: "Done.", toolCalls: [endTurnCall("legacy-end")] };
    },
  });
  assert.equal(result.runState.status, "completed");
  assert.equal(result.engineSnapshot.skillRouterState, null);
});

test("cancellation during skill selection never invokes fallback or another agent turn", async () => {
  const { skillRouter } = routingFixture();
  const controller = new AbortController();
  let fallbacks = 0;
  let modelCalls = 0;
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Review the supplied evidence.",
    signal: controller.signal,
    skillRouter: {
      ...skillRouter,
      runDecision: async () => {
        controller.abort();
        throw Object.assign(new Error("cancelled"), { code: "SKILL_ROUTER_CANCELLED", aborted: true });
      },
      runFallback: async () => { fallbacks += 1; return '{"skill_ids":[]}'; },
    },
    runModelRound: async () => {
      modelCalls += 1;
      return { fullText: "", toolCalls: [checklistCall("cancel-checklist")] };
    },
  });
  assert.equal(result.aborted, true);
  assert.equal(fallbacks, 0);
  assert.equal(modelCalls, 1);
  assert.equal(result.engineSnapshot.checklist.items[0].id, "inspect");
});

test("context preview does not invoke the skill picker", async () => {
  let decisionCalls = 0;
  const preview = await runAgentTurn({
    mode: "agent",
    userMessage: "Review the supplied evidence.",
    previewOnly: true,
    skillRouter: {
      enabled: true,
      freshRun: true,
      model: "typesafe/jev-1.14",
      candidates: [],
      runDecision: async () => { decisionCalls += 1; throw new Error("preview must not route"); },
    },
    runModelRound: async () => { throw new Error("preview must not run the model"); },
    executeToolCall: async () => { throw new Error("preview must not execute tools"); },
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.preview, true);
  assert.equal(decisionCalls, 0);
});

test("a stale skill decision retries with updated task context without using fallback", async () => {
  const { skillRouter } = routingFixture();
  let nativeCalls = 0;
  let fallbackCalls = 0;
  let rounds = 0;
  let delivered = false;
  let boundaryRevision = 0;
  const seenTasks = [];
  const result = await runAgentTurn({
    mode: "agent",
    userMessage: "Review the supplied evidence.",
    initialInputId: "initial-task",
    skillRouter: {
      ...skillRouter,
      runDecision: async ({ state, questions }) => {
        nativeCalls += 1;
        seenTasks.push(state.task);
        if (nativeCalls === 1) throw new Error("superseded request failed");
        return { answers: Object.fromEntries(Object.keys(questions).map((id) => [id, { type: "noul", noul: 0.1 }])) };
      },
      runFallback: async () => { fallbackCalls += 1; return '{"skill_ids":[]}'; },
    },
    liveInput: {
      boundary: async ({ kind }) => {
        if (!delivered && kind === "before_decision_fallback") {
          delivered = true;
          boundaryRevision = 1;
          return { ok: true, revision: boundaryRevision, deliveries: [{ id: "steering-1", text: "Only summarize the supplied files.", revision: 1 }] };
        }
        return { ok: true, revision: boundaryRevision, deliveries: [] };
      },
      checkpoint: async () => ({ ok: true }),
      prepareRound: async ({ revision, result: roundResult }) => ({ ok: true, plan: { id: `prepared-round-${rounds}`, revision, result: roundResult } }),
      finalize: async () => ({ ok: true, completed: true }),
    },
    runModelRound: async () => {
      rounds += 1;
      return rounds === 1 ? { fullText: "", toolCalls: [checklistCall("stale-checklist")] }
        : { fullText: "Summary ready.", toolCalls: [endTurnCall("stale-skill-end")] };
    },
  });
  assert.equal(result.runState.status, "completed");
  assert.equal(nativeCalls, 2);
  assert.equal(fallbackCalls, 0);
  assert.match(seenTasks[1], /Only summarize the supplied files/);
});

test("agent tool surface is enabled by default in controller turns", () => {
  assert.equal(AgentToolSurface.toolsEnabled(), true);
});

test("Agent catalog never includes the retired task-list tool", async () => {
  assert.equal(isReasonablyLargeAgentRequest("Fix the typo in README.md"), false);
  assert.equal(isReasonablyLargeAgentRequest("Implement the following:\n- inspect the updater\n- fix notification state\n- verify packaging"), false);
  assert.equal(isReasonablyLargeAgentRequest("Implement the following:\n- inspect the updater\n- fix notification state\n- update the tests\n- verify packaging"), true);
  assert.equal(isReasonablyLargeAgentRequest("Inspect the code. Update the parser. Run the tests."), false);
  assert.equal(isReasonablyLargeAgentRequest("Inspect the code. Update the parser. Add regression coverage. Run the tests."), true);
  const seen = [];
  const run = (userMessage) => runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage,
    runModelRound: async ({ tools }) => {
      seen.push(tools.map((tool) => tool.function.name));
      return { fullText: "done", toolCalls: [endTurnCall()] };
    },
  });
  await run("Fix the typo in README.md");
  await run("Implement the following:\n- inspect the updater\n- fix notification state\n- update the tests\n- verify packaging");
  assert.equal(seen[0].includes("update_task_list"), false);
  assert.equal(seen[1].includes("update_task_list"), false);
  assert.equal(seen[0].includes("update_project_artifacts"), false);
  assert.equal(seen[1].includes("update_project_artifacts"), false);
});

test("Agent turns do not publish a task-list surface", async () => {
  const events = [];
  await runAgentTurn({
    workspace: path.resolve("."),
    mode: "agent",
    userMessage: "Implement the following:\n- inspect current behavior\n- make the required change\n- add regression coverage\n- verify the result",
    sendEvent: (event) => events.push(event),
    runModelRound: async () => ({ fullText: "Done", toolCalls: [endTurnCall()] }),
    executeToolCall: async () => ({ ok: true }),
  });
  assert.equal(events.some((event) => event.type === "task_brief"), false);
  assert.equal(events.some((event) => event.type === "task_list"), false);
});

test("scope-only dispatch returns raw tool results to the model", async (t) => {

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-gates-off-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  let rounds = 0;
  const allRoundPayloads = [];
  const toolResultsSeen = [];
  const result = await runAgentTurn({
    workspace,
    model: "local:small",
    numCtx: 8192,
    thinking: false,
    tools: [{ type: "function", function: { name: "exec_command", description: "run a command", parameters: {} } }],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "run pwd" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    userMessage: "run pwd",
    sendEvent(event) {
      if (event.type === "tool_result") toolResultsSeen.push(event.result);
    },
    async runModelRound(payload) {
      rounds += 1;
      allRoundPayloads.push(payload);
      if (rounds > 1) return { error: null, fullText: "Done.", toolCalls: [endTurnCall()], usage: { promptTokens: 10, completionTokens: 5 } };
      return {
        error: null,
        fullText: "Running pwd.",
        toolCalls: [{ id: "call-1", type: "function", function: { name: "exec_command", arguments: JSON.stringify({ executable: process.execPath, args: ["-e", "console.log(process.cwd())"] }) } }],
        usage: { promptTokens: 100, completionTokens: 10 },
      };
    },
    // Simulates the main.js dispatcher: registry adapter + restricted context.
    async executeToolCall({ toolCall }) {
      const name = toolCall?.function?.name;
      if (name === "exec_command") {
        return { ok: true, value: { stdout: "REAL_STDOUT_MARKER", stderr: "", exitCode: 0, executable: process.execPath, args: [] } };
      }
      return { ok: false, error: `Unknown tool '${name}'`, code: "UNKNOWN_TOOL", retryable: false };
    },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(result.runState?.status, "completed", "gates-off run should complete");
  // The tool executed (no gate blocked it).
  assert.ok(toolResultsSeen.length >= 1, "tool_result event must fire");
  assert.equal(toolResultsSeen[0].ok, true, "exec result must be ok");
  // The model-facing content must include the real stdout, not {}.
  const lastPayload = allRoundPayloads[allRoundPayloads.length - 1];
  const toolMessages = (lastPayload?.messages || []).filter((m) => m.role === "tool");
  assert.ok(toolMessages.length >= 1, "a tool message must be pushed to the model");
  const content = toolMessages[toolMessages.length - 1].content;
  assert.ok(!content.includes('"payload":"{}"'), "model must not see empty {} payload");
  assert.ok(content.includes("REAL_STDOUT_MARKER"), "model must see the real stdout");
});

test("Tier 1 keeps the current prompt before assistant/tool turns and preserves the exact turn transcript", async () => {
  const rounds = [];
  let round = 0;
  const projectId = "proj_00000000-0000-4000-8000-000000004101";
  const sessionId = "session_00000000-0000-4000-8000-000000004102";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const result = await runAgentTurn({
    workspace: "",
    model: "local:small",
    numCtx: 32768,
    contextBudget: 32768,
    tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    mode: "agent",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "run the check",
    chatHistory: [],
    sendEvent() {},
    async runModelRound(payload) {
      rounds.push(payload.messages.map((message) => ({
        role: message.role,
        content: message.content,
        tool_calls: message.tool_calls,
        tool_call_id: message.tool_call_id,
      })));
      round += 1;
      if (round === 1) {
        return {
          ok: true,
          fullText: "",
          toolCalls: [{ id: "call-check", type: "function", function: { name: "exec_command", arguments: {} } }],
          finishReason: "tool_calls",
        };
      }
      return { ok: true, fullText: "done", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() {
      return { ok: true, value: { summary: "check completed" } };
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result.error || ""));
  assert.equal(rounds.length, 2);
  const currentPrompt = (message) => message.role === "user" && message.content === "run the check";
  const firstPromptIndex = rounds[0].findIndex(currentPrompt);
  const secondPromptIndex = rounds[1].findIndex(currentPrompt);
  const assistantToolIndex = rounds[1].findIndex((message) => message.role === "assistant" && Array.isArray(message.tool_calls));
  const toolResultIndex = rounds[1].findIndex((message) => message.role === "tool");
  assert.equal(rounds[0].filter(currentPrompt).length, 1);
  assert.equal(firstPromptIndex, rounds[0].length - 1, "the initial provider request ends with the current user prompt");
  assert.equal(rounds[1].filter(currentPrompt).length, 1);
  assert.ok(secondPromptIndex >= 0 && secondPromptIndex < assistantToolIndex, "the current prompt precedes the assistant tool call");
  assert.ok(assistantToolIndex < toolResultIndex, "the tool result follows the assistant tool call");
  assert.equal(rounds[1].at(-1).role, "tool");
  assert.deepEqual(result.appendedMessages.map((message) => message.role), ["assistant", "tool", "assistant", "tool"]);
  assert.equal(result.appendedMessages.some(currentPrompt), false, "the protected prompt is not duplicated in appended transcript messages");
  const active = tier1.state(projectId, sessionId).active;
  assert.deepEqual(active.map((message) => message.role), ["user", "assistant", "tool", "assistant", "tool"]);
  assert.equal(active[0].content, "run the check");
  assert.equal(active[1].tool_calls[0].function.name, "exec_command");
  assert.equal(active[2].content.includes("check completed"), true);
  assert.equal(active[3].content, "done");
  assert.equal(active[3].tool_calls[0].function.name, "end_turn");
  assert.deepEqual(result.contextUsage.sections.map((section) => section.label), ["System Prompt", "Tool Definitions", "Rules", "Skills", "Subagents", "MCP", "Summarized Conversation", "Active Conversation", "Current Workflow"]);
});

test("Tier 1 excludes tool attempts that never crossed the execution boundary", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004111";
  const sessionId = "session_00000000-0000-4000-8000-000000004112";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  let round = 0;
  const result = await runAgentTurn({
    model: "local:small",
    numCtx: 32768,
    contextBudget: 32768,
    tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    mode: "agent",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "try the unavailable reader",
    chatHistory: [],
    sendEvent() {},
    async runModelRound() {
      round += 1;
      if (round === 1) return { ok: true, fullText: "Trying.", toolCalls: [{ id: "call-missing", type: "function", function: { name: "read_file", arguments: { path: "missing.txt" } } }], finishReason: "tool_calls" };
      return { ok: true, fullText: "The reader was unavailable.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() { throw new Error("an unavailable tool must not execute"); },
  });

  assert.equal(result.ok, true);
  const active = tier1.state(projectId, sessionId).active;
  assert.equal(active[0].role, "user");
  assert.equal(JSON.stringify(active).includes("call-missing"), false);
  assert.equal(JSON.stringify(active).includes("TOOL_UNAVAILABLE"), false);
});

test("Tier 1 usage snapshots keep local section tokens instead of OpenRouter prompt totals", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004121";
  const sessionId = "session_00000000-0000-4000-8000-000000004122";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const events = [];
  const result = await runAgentTurn({
    model: "provider/reconciled-model",
    numCtx: 32_768,
    contextBudget: 32_768,
    contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
    mode: "ask",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "Explain the result.",
    chatHistory: [],
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      return {
        ok: true,
        provider: "openrouter",
        fullText: "Done.",
        toolCalls: [endTurnCall()],
        finishReason: "stop",
        usage: { promptTokens: 777, completionTokens: 9, source: "openrouter" },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.contextUsage.source, "estimate");
  assert.equal(result.contextUsage.tokenCalculation.method, "tier1-approximate");
  assert.notEqual(result.contextUsage.promptTokens, 777);
  assert.equal(result.contextUsage.sections.length, 9);
  assert.equal(
    result.contextUsage.sections.reduce((sum, section) => sum + section.tokens, 0),
    result.contextUsage.promptTokens,
  );
  const active = result.contextUsage.sections.find((section) => section.key === "active_conversation");
  assert.ok(active.tokens > 0, "Active Conversation must come from the T1 ledger");
  const expectedActive = Number(result.contextUsage.tier1?.rows?.["Active Conversation"]) || 0;
  assert.equal(active.tokens, expectedActive);

  const snapshots = events.filter((event) => event.type === "context_usage" && event.usage?.sections?.length === 9);
  assert.ok(snapshots.length >= 2);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.usage.source, "estimate");
    assert.notEqual(snapshot.usage.promptTokens, 777);
    assert.equal(snapshot.usage.tokenCalculation.method, "tier1-approximate");
    assert.equal(
      snapshot.usage.sections.reduce((sum, section) => sum + section.tokens, 0),
      snapshot.usage.promptTokens,
      "section rows must match the T1 approximate total",
    );
  }
  assert.equal(events.some((event) => event.type === "context_usage" && event.usage?.source === "openrouter"), false);
});

test("a Tier 1 preview fills the meter before the first send without running the model", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004141";
  const sessionId = "session_00000000-0000-4000-8000-000000004142";
  const { previewTier1Usage } = require("../src/agent/controller/agent-controller.js");
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const events = [];
  const preview = await previewTier1Usage({
    model: "provider/meter-model",
    numCtx: 32_768,
    contextBudget: 32_768,
    contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
    tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    mode: "agent",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    chatHistory: [],
    sendEvent(event) { events.push(event); },
    async runModelRound() { throw new Error("a context preview must not call the model"); },
    async executeToolCall() { throw new Error("a context preview must not execute tools"); },
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.preview, true);
  assert.equal(preview.contextUsage.source, "estimate");
  assert.equal(preview.contextUsage.tokenCalculation.method, "tier1-approximate");
  assert.equal(preview.contextUsage.sections.length, 9);
  const rows = Object.fromEntries(preview.contextUsage.sections.map((section) => [section.key, section.tokens]));
  assert.ok(rows.system_prompt > 0, "Block A rows are available before the first send");
  assert.ok(rows.tool_definitions > 0);
  assert.equal(rows.active_conversation, 0, "an unsent chat has no active conversation");
  assert.deepEqual(tier1.state(projectId, sessionId).active, [], "a preview does not seed the ledger");
  assert.equal(events.length, 0, "a preview publishes no run events");
});

test("Tier 1 meter updates when the active ledger changes and survives a coordinator restart", async () => {
  const crypto = require("node:crypto");
  const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");
  const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-t1-meter-restart-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  const projectId = "proj_00000000-0000-4000-8000-000000004131";
  const sessionId = "session_00000000-0000-4000-8000-000000004132";
  const first = createTier1ContextCoordinator({ sensitiveStore: store });
  const events = [];
  let round = 0;
  try {
    const firstTurn = await runAgentTurn({
      model: "provider/meter-model",
      numCtx: 32_768,
      contextBudget: 32_768,
      contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
      tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
      mode: "agent",
      modeFamily: "assist",
      projectId,
      memorySessionId: sessionId,
      tier1Context: first,
      userMessage: "run the check",
      chatHistory: [],
      sendEvent(event) { events.push(event); },
      async runModelRound() {
        round += 1;
        if (round === 1) {
          return {
            ok: true,
            provider: "openrouter",
            fullText: "",
            toolCalls: [{ id: "call-check", type: "function", function: { name: "exec_command", arguments: {} } }],
            finishReason: "tool_calls",
            usage: { promptTokens: 777, completionTokens: 2, source: "openrouter" },
          };
        }
        return {
          ok: true,
          provider: "openrouter",
          fullText: "done",
          toolCalls: [endTurnCall()],
          finishReason: "stop",
          usage: { promptTokens: 777, completionTokens: 4, source: "openrouter" },
        };
      },
      async executeToolCall() {
        return { ok: true, value: { summary: "check completed" } };
      },
    });
    assert.equal(firstTurn.ok, true, JSON.stringify(firstTurn.error || ""));
    const usageEvents = events.filter((event) => event.type === "context_usage" && event.usage?.source === "estimate");
    assert.ok(usageEvents.length >= 3);
    const activeTokens = usageEvents.map((event) => (
      event.usage.sections.find((section) => section.key === "active_conversation")?.tokens || 0
    ));
    assert.ok(activeTokens.some((tokens, index) => index > 0 && tokens > activeTokens[0]), "Active Conversation tokens must rise when T1 appends");
    assert.equal(usageEvents.every((event) => event.usage.promptTokens !== 777), true);

    const restarted = createTier1ContextCoordinator({ sensitiveStore: store });
    const secondTurn = await runAgentTurn({
      model: "provider/meter-model",
      numCtx: 32_768,
      contextBudget: 32_768,
      contextPlan: { provider: "openrouter", effectiveLimitTokens: 32_768 },
      mode: "ask",
      modeFamily: "assist",
      projectId,
      memorySessionId: sessionId,
      tier1Context: restarted,
      userMessage: "continue the review",
      chatHistory: [],
      sendEvent() {},
      async runModelRound() {
        return { ok: true, fullText: "Continuing.", toolCalls: [endTurnCall()], finishReason: "stop" };
      },
    });
    assert.equal(secondTurn.ok, true, JSON.stringify(secondTurn.error || ""));
    const restored = restarted.state(projectId, sessionId).active;
    assert.ok(restored.some((message) => message.role === "user" && message.content === "run the check"));
    assert.ok(restored.some((message) => message.role === "tool" || String(message.content || "").includes("check completed")));
    assert.ok(restored.some((message) => message.role === "user" && message.content === "continue the review"));
    const secondActive = secondTurn.contextUsage.sections.find((section) => section.key === "active_conversation");
    assert.ok(secondActive.tokens > activeTokens[0], "restarted T1 Active Conversation must include the persisted ledger");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("simple conversation uses compact context with no tool execution and no workspace writes", async (t) => {
  let roundPayload = null;
  let discoveryCalls = 0;
  const events = [];
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-greeting-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const result = await runAgentTurn({
    workspace,
    model: "local:small",
    numCtx: 32768,
    thinking: false,
    tools: [],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "hi" }],
    contextSummary: "A very large previous assessment summary that must not enter a greeting.",
    dirMap: "ROOT/\n  app.js",
    activeFile: { path: "app.js", content: "console.log('hello')" },
    extraFiles: [],
    userMessage: "hi",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      roundPayload = payload;
      return { error: null, fullText: "Hey! How can I help?", toolCalls: [endTurnCall()], usage: { promptTokens: 321, completionTokens: 7 } };
    },
    async executeToolCall() { throw new Error("A greeting must not execute tools."); },
    findWorkspaceFiles() { discoveryCalls += 1; return { results: [] }; },
    searchWorkspaceIndex() { discoveryCalls += 1; return { results: [] }; },
  });

  assert.equal(discoveryCalls, 0);
  assert.equal(Array.isArray(roundPayload.tools), true);
  assert.ok(roundPayload.tools.length > 0, "agent mode now exposes the registry tool catalog");
  assert.ok(roundPayload.tools.some((tool) => tool.function?.name === "apply_patch"), "catalog includes apply_patch");
  assert.match(roundPayload.messages.map((message) => message.content).join("\n"), /XEKUTE VAPT SYSTEM PROMPT/i);
  assert.doesNotMatch(roundPayload.messages.map((message) => message.content).join("\n"), /run_traffsucker|run_security_tool|load_tool_schemas/i);
  assert.equal(roundPayload.messages.filter((message) => message.role === "user" && message.content === "hi").length, 1);
  assert.doesNotMatch(roundPayload.messages.map((message) => message.content).join("\n"), /OPERATING LOOP|XEKUTE AUTHORITY|UNTRUSTED CONTEXT DATA|previous assessment summary/);
  assert.match(roundPayload.messages[0].content, /Casual conversation does not start an assessment/i);
  assert.equal(result.contextRoute.kind, "conversation");
  assert.equal(result.finalText, "Hey! How can I help?");
  assert.equal(result.contextUsage.source, "ollama");
  assert.equal(result.contextUsage.promptTokens, 321);
  assert.ok(Array.isArray(result.contextUsage.toolNames));
  assert.equal(result.contextUsage.route.promptDepth, "compact");
  assert.deepEqual(fs.readdirSync(workspace), []);
});

test("length-limited model output continues automatically without persisting synthetic prompts", async () => {
  const events = [];
  const rounds = [];
  const result = await runAgentTurn({
    workspace: "",
    model: "provider/limited-output",
    numCtx: 32768,
    contextBudget: 32768,
    thinking: false,
    tools: [],
    mode: "ask",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Explain the complete vulnerability." }],
    userMessage: "Explain the complete vulnerability.",
    sendEvent(event) { events.push(event); },
    async runModelRound(payload) {
      rounds.push(payload);
      if (rounds.length === 1) {
        payload.onToken("The vulnerabili");
        return {
          ok: true,
          fullText: "The vulnerabili",
          toolCalls: [],
          finishReason: "length",
          usage: { promptTokens: 100, completionTokens: 20 },
        };
      }
      payload.onToken("ty is confirmed and fully explained.");
      return {
        ok: true,
        fullText: "ty is confirmed and fully explained.",
        toolCalls: [endTurnCall()],
        finishReason: "stop",
        usage: { promptTokens: 120, completionTokens: 12 },
      };
    },
    async executeToolCall() { throw new Error("Output continuation should not need a tool."); },
  });

  assert.equal(rounds.length, 2);
  assert.equal(result.finalText, "The vulnerability is confirmed and fully explained.");
  assert.ok(rounds[1].messages.some((message) => message.role === "user" && /Continue the same assistant response exactly where it stopped/.test(message.content)));
  assert.ok(rounds[1].messages.some((message) => message.role === "assistant" && message.content === "The vulnerabili"));
  assert.equal(events.filter((event) => event.type === "output_continuation").length, 1);
  assert.equal(result.finalText, "The vulnerability is confirmed and fully explained.");
});

test("output continuations do not consume the operational agent-round budget", async () => {
  let calls = 0;
  const continuationSegments = 5;
  const result = await runAgentTurn({
    workspace: "",
    model: "provider/limited-output",
    numCtx: 32768,
    contextBudget: 32768,
    thinking: false,
    tools: [],
    mode: "ask",
    modeFamily: "assist",
    chatHistory: [{ role: "user", content: "Produce a long report." }],
    userMessage: "Produce a long report.",
    sendEvent() {},
    maxAgentRounds: 3,
    async runModelRound() {
      calls += 1;
      if (calls <= continuationSegments) {
        return { ok: true, fullText: "x", toolCalls: [], finishReason: "length" };
      }
      return { ok: true, fullText: "done", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() { throw new Error("Output continuation should not execute tools."); },
  });

  assert.equal(calls, continuationSegments + 1);
  assert.equal(result.runState.status, "completed");
  assert.equal(result.finalText, `${"x".repeat(continuationSegments)}done`);
});

test("tool-access questions receive the registry tool surface", async () => {
  let roundPayload = null;
  const result = await runAgentTurn({
    workspace: "",
    model: "local:small",
    numCtx: 8192,
    contextBudget: 8192,
    thinking: false,
    tools: [],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [],
    userMessage: "can you see if you have any access to any tools?",
    sendEvent: () => {},
    async runModelRound(payload) {
      roundPayload = payload;
      return {
        error: null,
        fullText: "I have access to the 17 registry tools (exec_command, read_file, apply_patch, ...).",
        toolCalls: [endTurnCall()],
        usage: { promptTokens: 100, completionTokens: 18 },
      };
    },
    async executeToolCall() {
      throw new Error("Tool-access questions must not execute tools.");
    },
  });

  assert.ok(Array.isArray(roundPayload.tools) && roundPayload.tools.length > 0, "agent mode exposes the registry tool catalog");
  assert.ok(roundPayload.tools.some((tool) => tool.function?.name === "apply_patch"), "catalog includes apply_patch");
  assert.match(result.finalText, /17 registry tools/i);
});

test("request classification selects workflow, hypothesis, or ordinary conversation", () => {
  const workflow = ContextRouter.routeRequest({
    text: "fix this",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
    activeFile: { path: "src/app.js" },
  });
  assert.equal(workflow.interactionType, "workflow");
  assert.equal(workflow.classification.taskBrief, true);
  assert.equal(workflow.osMode, "write");

  const calculatorUpgrade = ContextRouter.routeRequest({
    text: "can you make the calculator better?",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
  });
  assert.equal(calculatorUpgrade.interactionType, "workflow");
  assert.deepEqual(calculatorUpgrade.toolCategories, ["os"]);
  assert.equal(calculatorUpgrade.osMode, "write");

  const delegatedUpgrade = ContextRouter.routeRequest({
    text: "idk just make it better",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
    history: [
      { role: "user", content: "can you make the calculator better?" },
      { role: "assistant", content: "Which improvements would you like, or should I apply a sensible general upgrade to the calculator?" },
    ],
  });
  assert.equal(delegatedUpgrade.interactionType, "workflow");
  assert.equal(delegatedUpgrade.inheritedIntent, true);
  assert.equal(delegatedUpgrade.osMode, "write");

  const retryUpgrade = ContextRouter.routeRequest({
    text: "try again",
    hasWorkspace: true,
    family: "assist",
    mode: "agent",
    history: [
      { role: "user", content: "can you make the calculator better?" },
      { role: "assistant", content: "I can improve the calculator without changing unrelated files." },
    ],
  });
  assert.equal(retryUpgrade.inheritedIntent, true);
  assert.equal(retryUpgrade.osMode, "write");
  assert.equal(retryUpgrade.osMutates, true);

  const hypothesis = ContextRouter.routeRequest({
    text: "run a passive scan and report findings",
    hasWorkspace: true,
    family: "testing",
    mode: "agent",
  });
  assert.equal(hypothesis.interactionType, "hypothesis");
  assert.equal(hypothesis.classification.evidence, true);
  assert.equal(hypothesis.responseRequirements.evidence, true);

  const conversation = ContextRouter.routeRequest({ text: "what is XSS?", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(conversation.interactionType, "conversation");
  assert.equal(conversation.classification.taskBrief, false);
});

test("open project includes project and workspace context when requested", () => {
  const route = ContextRouter.routeRequest({ text: "What targets are in scope?", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(route.includeProjectContext, true);
  assert.equal(route.includeWorkspaceContext, true);
  assert.equal(route.includeWorkspaceDiscovery, false);

  const greeting = ContextRouter.routeRequest({ text: "hi", hasWorkspace: true, family: "testing", mode: "ask" });
  assert.equal(greeting.includeProjectContext, false);
  assert.equal(greeting.includeWorkspaceContext, false);
});

test("passive scan requests route cyber tools in testing mode", () => {
  const route = ContextRouter.routeRequest({
    text: "can you run a basic passive scan?",
    hasWorkspace: true,
    family: "testing",
    mode: "agent",
  });
  assert.deepEqual(route.toolCategories, ["cyber"]);
  assert.ok(route.cyberCapabilities.includes("active"));
});

test("passive scan routing is not reduced by the selected mode", () => {
  const route = ContextRouter.routeRequest({
    text: "can you run a basic passive scan?",
    hasWorkspace: true,
    mode: "ask",
  });
  assert.deepEqual(route.toolCategories, ["cyber"]);
  assert.ok(route.cyberCapabilities.includes("active"));
});

test("project prompt context uses app-managed profile scope", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-scope-context-"));
  const root = path.join(parent, "assessment");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const context = buildEngagementPromptContext({
    workspace: root,
    projectProfile: {
      project: { name: "Example App" },
      scope: {
        inScopeTargets: [{ id: "target-1", assetType: "domain", value: "app.example.com", notes: "primary app" }],
        notes: "profile note",
      },
      context: { applicationOverview: "Customer portal" },
    },
  });

  assert.equal(context.project.name, "Example App");
  assert.equal(context.application.applicationOverview, "Customer portal");
  assert.equal(context.scope.inScopeTargets[0].value, "app.example.com");
  assert.equal(context.scope.notes, "profile note");
  fs.rmSync(parent, { recursive: true, force: true });
});

test("scope questions in an open project inject project settings and scope guidance", async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-scope-prompt-"));
  const root = path.join(parent, "assessment");
  const workspaceApi = createAssessmentWorkspace({ fs, path });
  workspaceApi.repair(root, { createRoot: true });
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  let roundPayload = null;
  const result = await runAgentTurn({
    workspace: root,
    projectProfile: {
      project: { name: "Example App" },
      scope: { inScopeTargets: [{ id: "target-1", assetType: "domain", value: "app.example.com" }] },
    },
    model: "local:small",
    numCtx: 8192,
    thinking: false,
    tools: [],
    mode: "ask",
    modeFamily: "testing",
    chatHistory: [],
    contextSummary: "",
    dirMap: "ROOT/\n  scope/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "What targets are in scope?",
    sendEvent() {},
    async runModelRound(payload) {
      roundPayload = payload;
      return { error: null, fullText: "app.example.com is in scope.", toolCalls: [endTurnCall()], usage: { promptTokens: 900, completionTokens: 12 } };
    },
    async executeToolCall() { throw new Error("Scope questions should not execute tools."); },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  const prompt = roundPayload.messages.map((message) => message.content).join("\n");
  assert.match(prompt, /XEKUTE PROJECT SETTINGS/);
  assert.match(prompt, /app\.example\.com/);
  assert.match(prompt, /filesystem and network scope separately/i);
  assert.match(prompt, /UNTRUSTED CONTEXT DATA/);
  assert.ok(Array.isArray(roundPayload.tools) && roundPayload.tools.length > 0, "ask mode exposes the canonical tool set");
  assert.ok(roundPayload.tools.some((tool) => tool.function?.name === "search_workspace"), "ask mode can inspect workspace evidence");
  assert.equal(roundPayload.tools.some((tool) => tool.function?.name === "exec_command"), false, "ask mode does not include exec_command");
  assert.equal(result.contextRoute.includeProjectContext, true);
});

test("inherited confirmations can complete with a normal text answer when no tool is selected", async () => {
  const result = await runAgentTurn({
    workspace: "G:/Xekute/tmp",
    model: "local:small",
    numCtx: 16384,
    thinking: false,
    tools: [],
    mode: "agent",
    modeFamily: "assist",
    chatHistory: [{ role: "assistant", content: "Would you like me to inspect the workspace and update the file?" }],
    contextSummary: "",
    dirMap: "ROOT/\n",
    activeFile: null,
    extraFiles: [],
    userMessage: "yes",
    sendEvent() {},
    async runModelRound() {
      return { error: null, fullText: "Yes — I can help with that.", toolCalls: [endTurnCall()], usage: { promptTokens: 120, completionTokens: 8 } };
    },
    async executeToolCall() { throw new Error("No tool should be required for a plain answer."); },
    findWorkspaceFiles() { return { results: [] }; },
    searchWorkspaceIndex() { return { results: [] }; },
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalText, "Yes — I can help with that.");
});

test("mode prompts stay distinct while the tool surface is registry-backed", () => {
  const agentPrompt = buildSystemContext({ mode: "agent", numCtx: 4096, userMessage: "Fix it" });
  const leftoverPlan = buildSystemContext({ mode: "plan", numCtx: 4096, userMessage: "Plan it" });
  const askPrompt = buildSystemContext({ mode: "ask", numCtx: 4096, userMessage: "Explain it" });
  const leftoverHypothesis = buildSystemContext({ mode: "hypothesis", numCtx: 4096, userMessage: "Hypothesize" });
  assert.match(agentPrompt, /PROFILE — Agent/);
  assert.match(leftoverPlan, /PROFILE — Ask/);
  assert.match(leftoverHypothesis, /PROFILE — Ask/);
  assert.match(askPrompt, /PROFILE — Ask/);
  assert.match(ModeSkills.render("agent"), /tools/i);
  assert.doesNotMatch(leftoverPlan, /PROFILE — Plan/);
  assert.doesNotMatch(leftoverHypothesis, /PROFILE — Hypothesis/);
  assert.match(askPrompt, /read-only questions and analysis/i);
  assert.match(askPrompt, /inconclusive/i);
  assert.match(askPrompt, /Runtime scope checks are enforced/i);
});

test("response evidence classification stays quiet for workspace work and escalates for evidence runs", () => {
  const workspaceRoute = ContextRouter.routeRequest({ text: "Create .xekute/skills/basic-test.md", hasWorkspace: true, family: "assist", mode: "agent" });
  const workspaceRequirement = classifyEvidenceRequirement({
    profile: { key: "agent" },
    contextRoute: workspaceRoute,
    userMessage: "Create .xekute/skills/basic-test.md",
  });
  assert.equal(workspaceRequirement.required, false);
  assert.equal(workspaceRequirement.mode, "evidence_not_required");

  const testingRoute = ContextRouter.routeRequest({ text: "Run a passive scan and report findings", hasWorkspace: true, family: "testing", mode: "agent" });
  const testingRequirement = classifyEvidenceRequirement({
    profile: { key: "agent" },
    contextRoute: testingRoute,
    userMessage: "Run a passive scan and report findings",
    assessmentRequested: true,
  });
  assert.equal(testingRequirement.required, true);
  assert.equal(testingRequirement.mode, "evidence_required");

  const producedRequirement = classifyEvidenceRequirement({
    profile: { key: "agent" },
    contextRoute: workspaceRoute,
    userMessage: "Inspect this file",
    evidenceIds: ["ev-1"],
  });
  assert.equal(producedRequirement.reason, "evidence-produced");
});

test("fitMessagesToContext fails closed when mandatory anchors exceed the budget", () => {
  const objective = Array.from({ length: 3000 }, (_, index) => `word${index}`).join(" ");
  const fitted = fitMessagesToContext({
    baseMessages: [{ role: "system", content: "fixed prompt" }],
    history: [{ role: "user", content: objective }],
    promptBudget: 512,
  });
  assert.equal(fitted.ok, false);
  assert.equal(fitted.overflow, true);
});

test("fitMessagesToContext rejects fixed-only overflow", () => {
  const fixed = Array.from({ length: 3000 }, (_, index) => `fixed${index}`).join(" ");
  const fitted = fitMessagesToContext({
    baseMessages: [{ role: "system", content: fixed }],
    history: [],
    promptBudget: 512,
  });
  assert.equal(fitted.ok, false);
  assert.equal(fitted.overflow, true);
});

test("agent lifecycle permits justified or skipped phase transitions without approval gates", () => {
  const AgentRuntime = require("../src/agent/runtime/agent-runtime.js");
  const runState = AgentRuntime.createRunState({ runId: "run-phase", profile: "agent" });
  const step = advanceTowardPhase(runState, "execution", {
    reason: "Skip inventory",
    profile: { key: "agent" },
    cyberAction: true,
  });
  assert.equal(step.ok, true);
  assert.equal(runState.phase, "execution");
});

test("tool signatures canonicalize argument key order", () => {
  const first = toolCallSignature({
    toolName: "search_workspace",
    args: { query: "xekute", limit: 4, options: { language: "en", safe: true } },
  });
  const second = toolCallSignature({
    toolName: "search_workspace",
    args: { options: { safe: true, language: "en" }, limit: 4, query: "xekute" },
  });
  assert.equal(first, second);
});

test("a Tier 1 checkpoint fills summarized conversation and current workflow usage", async () => {
  const projectId = "proj_00000000-0000-4000-8000-000000004301";
  const sessionId = "session_00000000-0000-4000-8000-000000004302";
  const tier1 = require("../src/app/services/memory/tier1-context-coordinator.js").createTier1ContextCoordinator();
  const events = [];
  let modelCalls = 0;
  const chatHistory = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `Turn ${index}: ${"finding ".repeat(80)}`,
  }));
  const result = await runAgentTurn({
    model: "local:small",
    numCtx: 4_096,
    contextBudget: 4_096,
    contextPlan: { provider: "ollama", effectiveLimitTokens: 4_096, promptBudgetTokens: 4_096 },
    mode: "ask",
    modeFamily: "assist",
    projectId,
    memorySessionId: sessionId,
    tier1Context: tier1,
    userMessage: "Continue the investigation from the last finding.",
    chatHistory,
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls > 2) {
        throw new Error("wrap-up resume must not call runModelRound more than twice");
      }
      return { ok: true, fullText: "Continuing from the checkpoint.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  });

  assert.equal(result.ok, true, result.error || "");
  const completed = events.filter((event) => event.type === "context_checkpoint" && event.status === "completed");
  assert.ok(completed.length, "the controller must complete at least one conversation checkpoint");
  const latestCheckpoint = completed.at(-1);
  assert.ok(latestCheckpoint.summarizedConversationTokens > 0, "summarized conversation must receive checkpoint tokens");
  assert.ok(latestCheckpoint.currentWorkflowTokens > 0, "current workflow must be populated by the checkpoint");
  assert.equal(Boolean(latestCheckpoint.currentWorkflow), true);

  const usageAfter = [...events].reverse().find((event) => event.type === "context_usage" && Array.isArray(event.usage?.sections));
  assert.ok(usageAfter, "a context usage snapshot must follow the checkpoint");
  const summarized = usageAfter.usage.sections.find((section) => section.key === "summarized_conversation");
  const workflow = usageAfter.usage.sections.find((section) => section.key === "current_workflow");
  assert.ok(summarized?.tokens > 0);
  assert.ok(workflow?.tokens > 0);
});

function memoryIds(n) {
  return {
    projectId: `proj_00000000-0000-4000-8000-00000000${n}`,
    sessionId: `session_00000000-0000-4000-8000-00000000${n}`,
  };
}

function activeConversationHasRole(assembled, role) {
  const components = assembled?.blocks?.B?.components || [];
  const active = components.find((entry) => entry.label === "Active Conversation");
  return Array.isArray(active?.value) && active.value.some((message) => message?.role === role);
}

function delegateTier1(inner, extras = {}) {
  return {
    assemble: (...args) => inner.assemble(...args),
    pressure: extras.pressure || ((...args) => inner.pressure(...args)),
    appendConversation: (...args) => inner.appendConversation(...args),
    checkpoint: extras.checkpoint || ((...args) => inner.checkpoint(...args)),
    setActiveConversation: (...args) => inner.setActiveConversation?.(...args),
    setWorkflow: (...args) => inner.setWorkflow?.(...args),
    state: (...args) => inner.state?.(...args),
  };
}

function createWrapUpCrossingCoordinator({
  failCheckpoint = false,
  stayOverAfterRotate = false,
  onAfterCheckpoint = null,
} = {}) {
  const inner = createTier1ContextCoordinator();
  let rotated = false;
  return delegateTier1(inner, {
    pressure(input) {
      const base = inner.pressure(input);
      const assembled = input.assembled;
      const crossed = activeConversationHasRole(assembled, "assistant")
        || activeConversationHasRole(assembled, "tool");
      if (!rotated) {
        return { ...base, threshold: crossed ? 0 : Number.MAX_SAFE_INTEGER };
      }
      return { ...base, threshold: stayOverAfterRotate ? 0 : Number.MAX_SAFE_INTEGER };
    },
    async checkpoint(...args) {
      if (failCheckpoint) {
        return { ok: false, code: "MEMORY_CHECKPOINT_FAILED", error: "forced checkpoint failure" };
      }
      const result = await inner.checkpoint(...args);
      if (result?.ok && result?.checkpointed) rotated = true;
      if (typeof onAfterCheckpoint === "function") onAfterCheckpoint(result);
      return result;
    },
  });
}

function wrapUpTurnOptions({ ids, events, tier1, runModelRound, extra = {} }) {
  return {
    model: "local:small",
    numCtx: 32_768,
    contextBudget: 32_768,
    contextPlan: { provider: "ollama", effectiveLimitTokens: 32_768, promptBudgetTokens: 32_768 },
    mode: "ask",
    modeFamily: "assist",
    projectId: ids.projectId,
    memorySessionId: ids.sessionId,
    tier1Context: tier1,
    userMessage: "Continue the investigation from the last finding.",
    chatHistory: [],
    sendEvent(event) { events.push(event); },
    runModelRound,
    async executeToolCall() {
      return { ok: true, value: { summary: "check completed" } };
    },
    ...extra,
    projectId: ids.projectId,
    memorySessionId: ids.sessionId,
    tier1Context: extra.tier1Context || tier1,
  };
}

test("wrap-up block_complete rotates then resumes the same turn", async () => {
  assert.equal(CHECKPOINT_RATIO, 0.90);
  const ids = memoryIds(4401);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Continuing after the summarized conversation.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
  const started = events.filter((event) => event.type === "context_checkpoint" && event.status === "started");
  const completed = events.filter((event) => event.type === "context_checkpoint" && event.status === "completed");
  assert.ok(started.some((event) => event.reason === "block_complete"));
  assert.ok(completed.some((event) => event.reason === "block_complete"));
});

test("a tool-free turn under 90% completes without a wrap-up checkpoint", async () => {
  const ids = memoryIds(4402);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createTier1ContextCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      return { ok: true, fullText: "XSS is cross-site scripting.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    extra: { userMessage: "What is XSS?" },
  }));

  assert.equal(modelCalls, 1);
  assert.equal(result.ok, true, result.error || "");
  assert.equal(result.runState.status, "completed");
  assert.equal(events.some((event) => event.type === "context_checkpoint"), false);
});

test("wrap-up resume latches after one continue when pressure stays at 90%", async () => {
  const ids = memoryIds(4403);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({ stayOverAfterRotate: true }),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls > 2) {
        throw new Error("latch must not allow a third runModelRound");
      }
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
});

test("in-loop block_complete checkpoint failure continues the turn", async () => {
  const ids = memoryIds(4404);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({ failCheckpoint: true }),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Continuing after a checkpoint limitation.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(result.runState.status, "completed");
  assert.ok(result.runState.limitations.some((text) => /checkpoint/i.test(String(text))));
  assert.ok(modelCalls >= 1);
  assert.ok(Array.isArray(result.failureRecords));
  assert.equal(typeof result.executedTools, "boolean");
  assert.ok(Array.isArray(result.evidenceIds));
  assert.equal("lastUsage" in result, true);
  assert.equal("contextUsage" in result, true);
});

test("abort after wrap-up checkpoint does not resume the model", async () => {
  const ids = memoryIds(4405);
  const events = [];
  let modelCalls = 0;
  const abort = new AbortController();
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({
      onAfterCheckpoint() { abort.abort(); },
    }),
    async runModelRound() {
      modelCalls += 1;
      return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
    },
    extra: { signal: abort.signal },
  }));

  assert.equal(result.ok, false);
  assert.equal(result.aborted, true);
  assert.equal(result.runState.status, "stopped");
  assert.equal(modelCalls, 1);
});

test("tool-call batches are not checkpointed until the batch seals", async () => {
  const ids = memoryIds(4406);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          ok: true,
          fullText: "",
          toolCalls: [{ id: "call-pair", type: "function", function: { name: "exec_command", arguments: {} } }],
          finishReason: "tool_calls",
        };
      }
      return { ok: true, fullText: "The check finished.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    extra: {
      mode: "agent",
      tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  const firstToolOpen = events.findIndex((event) => event.type === "tool_call" || event.type === "tool_start");
  const lastToolResult = events.findLastIndex((event) => event.type === "tool_result" && event.tool?.toolName !== "end_turn");
  assert.ok(firstToolOpen >= 0, "a tool_call or tool_start must be emitted");
  assert.ok(lastToolResult >= 0, "tool_result must be emitted");
  const between = events.slice(firstToolOpen, lastToolResult + 1);
  assert.equal(between.some((event) => event.type === "context_checkpoint"), false);
  const toolResultsCheckpoint = events.findIndex((event) => event.type === "context_checkpoint" && event.reason === "tool_results");
  assert.ok(toolResultsCheckpoint > lastToolResult, "reason tool_results must fire only after the batch seals");
  assert.equal(events.some((event) => event.type === "context_checkpoint" && event.reason === "tool_results" && events.indexOf(event) < lastToolResult), false);
});

test("a throwing checkpoint reports failure and keeps the task recoverable", async () => {
  const events = [];
  const tier1 = createWrapUpCrossingCoordinator();
  tier1.checkpoint = async () => { throw new Error("checkpoint storage temporarily unavailable"); };
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids: memoryIds(4418), events, tier1,
    runModelRound: async () => ({ ok: true, fullText: "The check finished.", toolCalls: [endTurnCall()], finishReason: "stop" }),
  }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.runState.status, "completed");
  assert.ok(events.some(event => event.type === "context_checkpoint" && event.status === "failed" && event.code === "MEMORY_CHECKPOINT_FAILED"));
  assert.ok(result.runState.limitations.some(text => /checkpoint storage temporarily unavailable/.test(text)));
});

test("before_model_call does not force a checkpoint when the ledger holds only the task", async () => {
  const ids = memoryIds(4407);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator({ stayOverAfterRotate: true }),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls > 2) {
        throw new Error("empty-active resume must not loop");
      }
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Continuing after rotation.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(events.some((event) => event.type === "context_checkpoint" && event.reason === "before_model_call"), false);
});

test("unlimited MAX_AGENT_ROUNDS still resumes wrap-up in the same for-loop", async () => {
  assert.equal(MAX_AGENT_ROUNDS, 0);
  const ids = memoryIds(4408);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Resumed in the same turn.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
});

test("finite maxAgentRounds refunds the wrap-up round so resume is not post-loop", async () => {
  const ids = memoryIds(4409);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createWrapUpCrossingCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return { ok: true, fullText: "The objective is complete. What would you like to do next?", toolCalls: [], finishReason: "stop" };
      }
      return { ok: true, fullText: "Resumed after the wrap-up checkpoint.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    extra: { maxAgentRounds: 2 },
  }));

  assert.equal(result.ok, true, result.error || "");
  assert.equal(modelCalls, 2);
  assert.equal(result.runState.status, "completed");
  assert.notEqual(result.runState.status, "inconclusive");
});

test("post-loop round-limit block_complete stays terminal", async () => {
  const ids = memoryIds(4410);
  const events = [];
  let modelCalls = 0;
  const result = await runAgentTurn(wrapUpTurnOptions({
    ids,
    events,
    tier1: createTier1ContextCoordinator(),
    async runModelRound() {
      modelCalls += 1;
      return {
        ok: true,
        fullText: "",
        toolCalls: [{ id: `call-limit-${modelCalls}`, type: "function", function: { name: "exec_command", arguments: { n: modelCalls } } }],
        finishReason: "tool_calls",
      };
    },
    extra: {
      mode: "agent",
      maxAgentRounds: 1,
      tools: [{ type: "function", function: { name: "exec_command", description: "run a check", parameters: { type: "object" } } }],
    },
  }));

  assert.equal(modelCalls, 1);
  assert.equal(result.runState.status, "inconclusive");
  assert.equal(result.ok, true);
  const blockComplete = events.filter((event) => event.type === "context_checkpoint" && event.reason === "block_complete");
  assert.equal(blockComplete.some((event) => event.status === "started" || event.status === "completed"), false);
});

test("model rounds emit stop only when finishReason is stop and there are no tool calls", async () => {
  const events = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "Check package.json",
    tools: [{ type: "function", function: { name: "exec_command", description: "run a command", parameters: {} } }],
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) {
        return {
          ok: true,
          fullText: "Reading the file.",
          toolCalls: [{ id: "call-1", type: "function", function: { name: "exec_command", arguments: { executable: process.execPath, args: ["-e", "console.log(1)"] } } }],
          finishReason: "tool_calls",
        };
      }
      return { ok: true, fullText: "The start script is electron .", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() {
      return { ok: true, value: { stdout: "1", stderr: "", exitCode: 0 } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  const roundsEmitted = events.filter((event) => event.type === "model_round");
  assert.equal(roundsEmitted.length, 2);
  assert.equal(roundsEmitted[0].finishReason, "tool_calls");
  assert.equal(roundsEmitted[0].stop, false);
  assert.equal(roundsEmitted[1].finishReason, "stop");
  assert.equal(roundsEmitted[1].stop, false);
  assert.equal(result.finalText, "The start script is electron .");
});

function execToolCall(id, args = {}) {
  return {
    id,
    type: "function",
    function: { name: "exec_command", arguments: { command: `echo ${id}`, context: "echo command", ...args } },
  };
}

test("an outstanding command parks the model turn without marking it pending end-turn", async () => {
  const pendingEndTurnWrites = [];
  const events = [];
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "Run the command and continue when I steer.",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    async runModelRound() {
      return { fullText: "The command is still running.", toolCalls: [execToolCall("call-sleep"), endTurnCall()] };
    },
    async executeToolCall({ toolCall }) {
      if (toolCall.function.name === "end_turn") return { ok: true, endTurn: true, value: { status: "stop" } };
      return { ok: true, value: { processId: "process-sleep", mode: "process_start", status: "running", startedAt: Date.now() } };
    },
    async listRunningCommands() { return [{ processId: "process-sleep" }]; },
    setPendingEndTurn(value) { pendingEndTurnWrites.push(value); },
    sendEvent(event) { events.push(event); },
  });

  assert.equal(result.ok, true, result.error || "");
  assert.equal(result.commandWait, true);
  assert.equal(result.deferredEndTurn, true);
  assert.equal(result.runState.status, "running");
  assert.deepEqual(pendingEndTurnWrites, [], "command lifetime must not own the model's pending-end-turn flag");
  assert.equal(events.some((event) => event.type === "model_run_command_wait"), true);
});

test("a single exec_command run seals its result as soon as it finishes", async () => {
  const log = [];
  const waits = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "run one",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    sendEvent(event) {
      if (event.type === "tool_result") log.push(`result:${event.tool.callId}`);
    },
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) return { fullText: "", toolCalls: [execToolCall("call-one")] };
      return { fullText: "done", toolCalls: [endTurnCall()] };
    },
    async executeToolCall({ toolCall }) {
      waits.push(toolCall.function.arguments.wait_ms);
      log.push(`start:${toolCall.id}`);
      log.push(`end:${toolCall.id}`);
      return { ok: true, value: { stdout: toolCall.id, exitCode: 0 } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.deepEqual(waits, [1_000], "an omitted command wait should yield quickly to the next agent checkpoint");
  assert.deepEqual(log, ["start:call-one", "end:call-one", "result:call-one", "result:end-turn-1"]);
});

test("multiple exec_command runs seal agent-facing results in call order", async () => {
  const log = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "run three",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    sendEvent(event) {
      if (event.type === "tool_start") log.push(`start-event:${event.tool.callId}`);
      if (event.type === "tool_result") log.push(`result:${event.tool.callId}:${event.result?.error || event.result?.value?.stdout || ""}`);
    },
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) {
        return {
          fullText: "",
          toolCalls: [execToolCall("call-1"), execToolCall("call-2"), execToolCall("call-3")],
        };
      }
      return { fullText: "done", toolCalls: [endTurnCall()] };
    },
    async executeToolCall({ toolCall }) {
      log.push(`exec:${toolCall.id}`);
      if (toolCall.id === "call-2") return { ok: false, error: "boom", value: { stdout: "call-2", exitCode: 1 } };
      return { ok: true, value: { stdout: toolCall.id, exitCode: 0 } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.deepEqual(log, [
    "start-event:call-1",
    "exec:call-1",
    "start-event:call-2",
    "exec:call-2",
    "start-event:call-3",
    "exec:call-3",
    "result:call-1:call-1",
    "result:call-2:boom",
    "result:call-3:call-3",
    "start-event:end-turn-1",
    "result:end-turn-1:",
  ]);
});

test("mixed run and non-run tools seal in call order", async () => {
  const log = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "run mixed",
    tools: [
      { type: "function", function: { name: "exec_command", description: "run", parameters: {} } },
      { type: "function", function: { name: "read_file", description: "read", parameters: {} } },
    ],
    sendEvent(event) {
      if (event.type === "tool_result") log.push(`result:${event.tool.toolName}:${event.tool.callId}`);
    },
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) {
        return {
          fullText: "",
          toolCalls: [
            execToolCall("call-run-1"),
            {
              id: "call-read",
              type: "function",
              function: { name: "read_file", arguments: { path: "README.md" } },
            },
            execToolCall("call-run-2"),
          ],
        };
      }
      return { fullText: "done", toolCalls: [endTurnCall()] };
    },
    async executeToolCall({ toolCall }) {
      log.push(`exec:${toolCall.id}`);
      return { ok: true, value: { stdout: toolCall.id } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.deepEqual(log, [
    "exec:call-run-1",
    "exec:call-run-2",
    "result:exec_command:call-run-1",
    "exec:call-read",
    "result:read_file:call-read",
    "result:exec_command:call-run-2",
    "result:end_turn:end-turn-1",
  ]);
  const toolMessages = result.appendedMessages.filter((message) => message.role === "tool");
  assert.deepEqual(toolMessages.map((message) => message.tool_name), ["exec_command", "read_file", "exec_command", "end_turn"]);
});

test("a request for more commands than free slots reaches the process manager", async () => {
  const log = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "run four",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    listRunningCommands: async () => [],
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) {
        return {
          fullText: "",
          toolCalls: [execToolCall("c1"), execToolCall("c2"), execToolCall("c3"), execToolCall("c4")],
        };
      }
      return { fullText: "blocked", toolCalls: [endTurnCall()] };
    },
    async executeToolCall() {
      log.push("exec");
      return { ok: true, value: { stdout: "should-not-run", exitCode: 0 } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.deepEqual(log, ["exec", "exec", "exec", "exec"]);
  const toolMessages = result.appendedMessages.filter((message) => message.role === "tool" && message.tool_name === "exec_command");
  assert.equal(toolMessages.length, 4);
  for (const message of toolMessages) {
    assert.doesNotMatch(message.content, /COMMAND_QUEUE_REJECTED|none were started/);
  }
});

test("commands beyond the remaining slots reach the process manager", async () => {
  const log = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    sessionId: "chat-a",
    userMessage: "run two more",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    listRunningCommands: async () => [
      { processId: "process-a", command: "cmd 1" },
      { processId: "process-b", command: "cmd 2" },
    ],
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) return { fullText: "", toolCalls: [execToolCall("extra-1"), execToolCall("extra-2")] };
      return { fullText: "blocked", toolCalls: [endTurnCall()] };
    },
    async executeToolCall() {
      log.push("exec");
      return { ok: true, value: { stdout: "should-not-run", exitCode: 0 } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.deepEqual(log, ["exec", "exec"]);
  const toolMessages = result.appendedMessages.filter((message) => message.role === "tool" && message.tool_name === "exec_command");
  assert.equal(toolMessages.length, 2);
  for (const message of toolMessages) {
    assert.doesNotMatch(message.content, /COMMAND_QUEUE_REJECTED|none were started/);
  }
});

test("one command starts when one slot is free and status does not take a slot", async () => {
  const log = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    sessionId: "chat-a",
    userMessage: "status then one command",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    listRunningCommands: async () => [
      { processId: "process-a", command: "cmd 1" },
      { processId: "process-b", command: "cmd 2" },
    ],
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) {
        return {
          fullText: "",
          toolCalls: [
            {
              id: "call-status",
              type: "function",
              function: { name: "exec_command", arguments: { operation: "status", process_id: "process-a" } },
            },
            execToolCall("only-one"),
          ],
        };
      }
      return { fullText: "done", toolCalls: [endTurnCall()] };
    },
    async executeToolCall({ toolCall }) {
      log.push(toolCall.id);
      return { ok: true, value: { stdout: toolCall.id, exitCode: 0 } };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.deepEqual(log, ["only-one", "call-status"]);
});

test("aborting an agent run does not execute remaining queued commands", async () => {
  const log = [];
  const abort = new AbortController();
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "run two",
    signal: abort.signal,
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    sendEvent(event) {
      if (event.type === "tool_result") log.push(`result:${event.tool.callId}`);
    },
    async runModelRound() {
      rounds += 1;
      if (rounds === 1) return { fullText: "", toolCalls: [execToolCall("call-a"), execToolCall("call-b")] };
      return { fullText: "should not happen", toolCalls: [endTurnCall()] };
    },
    async executeToolCall({ toolCall }) {
      log.push(`exec:${toolCall.id}`);
      if (toolCall.id === "call-a") abort.abort();
      return { ok: true, aborted: toolCall.id === "call-a", value: { stdout: toolCall.id } };
    },
  });
  assert.equal(result.aborted, true);
  assert.deepEqual(log, ["exec:call-a", "result:call-a", "result:call-b"]);
  assert.equal(log.includes("exec:call-b"), false);
  assert.match(result.appendedMessages.find((message) => message.tool_call_id === "call-b").content, /TOOL_CALL_CANCELLED/);
});

test("a silent model round continues until end_turn status stop", async () => {
  const rounds = [];
  const modelRounds = [];
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "Keep going until the work is done.",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    sendEvent(event) { if (event.type === "model_round") modelRounds.push(event); },
    async runModelRound(payload) {
      rounds.push(payload.messages.at(-1));
      if (rounds.length === 1) return { ok: true, fullText: "Working.", toolCalls: [], finishReason: "stop" };
      assert.match(String(payload.messages.at(-1)?.content || ""), /No end_turn/);
      return { ok: true, fullText: "Finished.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.equal(result.runState.status, "completed");
  assert.equal(rounds.length, 2);
  assert.equal(result.finalText, "Finished.");
  // The no-tool answer round is completion-grade; the round that closed with
  // end_turn is not, so the UI prefers the earlier answer over any recap.
  assert.equal(modelRounds[0].answerOnly, true);
  assert.equal(modelRounds[1].answerOnly, false);
});

test("end_turn status stop keeps the assistant conclusion as finalText", async () => {
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "Wrap up.",
    async runModelRound() {
      return {
        ok: true,
        fullText: "Here is what I found.",
        toolCalls: [{
          id: "end-turn-1",
          type: "function",
          function: { name: "end_turn", arguments: { status: "stop", summary: "should not replace" } },
        }],
        finishReason: "stop",
      };
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.equal(result.runState.status, "completed");
  assert.equal(result.finalText, "Here is what I found.");
});

test("identical failed tool calls honor REPEAT_CLASS_LIMIT before suppression", async () => {
  const Tunables = require("../src/agent/runtime/tunables.js");
  const results = [];
  let rounds = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "agent",
    userMessage: "retry the same command",
    tools: [{ type: "function", function: { name: "exec_command", description: "run", parameters: {} } }],
    async runModelRound() {
      rounds += 1;
      if (rounds <= Number(Tunables.REPEAT_CLASS_LIMIT) + 1) {
        return { ok: true, fullText: "", toolCalls: [execToolCall("call-repeat")], finishReason: "tool_calls" };
      }
      return { ok: true, fullText: "stopped repeating", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() {
      return { ok: false, error: "boom", errorCode: "EXEC_FAILED" };
    },
    sendEvent(event) {
      if (event.type === "tool_result") results.push(event.result?.errorCode || event.result?.code);
    },
  });
  assert.equal(result.ok, true, result.error || "");
  assert.equal(results.filter((code) => code === "EXEC_FAILED").length, Number(Tunables.REPEAT_CLASS_LIMIT));
  assert.equal(results.includes("REPEATED_FAILED_CALL"), true);
});

test("mandatory context overflow returns an explicit limit without sending a truncated prompt", async () => {
  const events = [];
  let providerCalls = 0;
  const result = await runAgentTurn({
    workspace: "",
    mode: "ask",
    userMessage: "Summarize this.",
    contextBudget: 256,
    contextPlan: { provider: "ollama", effectiveLimitTokens: 256, promptBudgetTokens: 256 },
    chatHistory: Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `History ${index}: ${"token ".repeat(80)}`,
    })),
    sendEvent(event) { events.push(event); },
    async runModelRound() {
      providerCalls += 1;
      return { ok: true, fullText: "Summary ready.", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.code, "MANDATORY_CONTEXT_LIMIT");
  assert.equal(result.runState.status, "inconclusive");
  assert.equal(result.ok, true, result.error || "");
  assert.match(result.runState.stopReason, /MANDATORY_CONTEXT_LIMIT/);
});

test("deferred end_turn while orchestration hold avoids finalize", async () => {
  const { endTurnCall } = require("./helpers/end-turn-call.js");
  const result = await runAgentTurn({
    workspace: "G:/ws",
    userMessage: "orchestrate",
    tools: [{ type: "function", function: { name: "end_turn", description: "end", parameters: { type: "object", properties: { status: { type: "string" } }, required: ["status"] } } }],
    orchestrationHold: () => true,
    setPendingEndTurn: () => {},
    async runModelRound() {
      return { ok: true, fullText: "done", toolCalls: [endTurnCall()], finishReason: "stop" };
    },
    async executeToolCall() {
      return { ok: true, endTurn: true, value: { status: "stop" } };
    },
    sendEvent() {},
  });
  assert.equal(result.deferredEndTurn, true);
  assert.equal(result.reason, "ORCHESTRATION_HOLD");
  assert.notEqual(result.runState?.status, "completed");
});
