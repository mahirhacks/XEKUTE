"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runAgentTurn } = require("../src/agent/controller/agent-controller.js");
const { defaultRegistry } = require("../src/prompts/skills/internal/registry.js");
const { resolveInternalSkill } = require("../src/prompts/skills/internal/runner.js");
const fixtures = require("./fixtures/skill-router/cases.json");
const { endTurnCall } = require("./helpers/end-turn-call.js");

function checklistCall(id = "acceptance-checklist") {
  return {
    id,
    type: "function",
    function: {
      name: "manage_task_checklist",
      arguments: JSON.stringify({
        action: "create",
        main_goal: "Complete the assigned review safely",
        items: [{ id: "review", label: "Review supplied evidence", description: "Use only the materials supplied in the assigned task.", status: "in_progress" }],
      }),
    },
  };
}

test("all twenty frozen scenarios traverse production checklist and skill-routing paths with controlled decisions", async () => {
  assert.equal(fixtures.cases.length, 20);
  for (const scenario of fixtures.cases) {
    const explicit = String(scenario.request).trim().startsWith("/");
    const mode = /In Ask mode/i.test(scenario.request) ? "ask" : "agent";
    const expectedSkills = scenario.expectedSkills || [];
    const decisionCalls = [];
    const loaded = [];
    const skillRouter = {
      enabled: true,
      freshRun: true,
      model: "typesafe/jev-1.14",
      candidates: defaultRegistry.listInternal(),
      runDecision: async ({ questions, state }) => {
        const questionIds = Object.keys(questions);
        decisionCalls.push({ questionIds, state });
        return { answers: Object.fromEntries(questionIds.map((key) => {
          const skillId = key.slice("skill_".length);
          return [key, { type: "noul", noul: expectedSkills.includes(skillId) ? 0.95 : 0.02 }];
        })) };
      },
      loadSkill: async (id) => {
        loaded.push(id);
        return resolveInternalSkill(defaultRegistry, id, { mode, compact: true });
      },
    };
    const specialSkill = explicit
      ? defaultRegistry.select(scenario.request, { mode })
      : null;
    const selectedSpecialSkill = specialSkill?.ok
      ? { ...specialSkill, prompt: resolveInternalSkill(defaultRegistry, specialSkill.id, { mode }).ok
        ? resolveInternalSkill(defaultRegistry, specialSkill.id, { mode }).prompt
        : "" }
      : null;
    const history = (scenario.recentTurns || []).map((message) => ({ ...message }));
    let round = 0;
    const result = await runAgentTurn({
      mode,
      modeFamily: "xekute",
      userMessage: scenario.request,
      chatHistory: history,
      specialSkill: selectedSpecialSkill,
      skillRouter: { ...skillRouter, bypassAutomaticSkills: explicit },
      maxAgentRounds: 4,
      runModelRound: async () => {
        round += 1;
        if (scenario.expectedPlan && round === 1) return { fullText: "", toolCalls: [checklistCall(`${scenario.id}-checklist`), endTurnCall(`${scenario.id}-end-1`)] };
        return { fullText: `Fixture response for ${scenario.id}.`, toolCalls: [endTurnCall(`${scenario.id}-end-${round}`)] };
      },
    });

    assert.equal(result.ok, true, `${scenario.id}: ${result.error || result.code || "run failed"}`);
    assert.equal(result.runState.status, "completed", `${scenario.id}: task completes`);
    assert.equal(result.code, undefined, `${scenario.id}: no context or execution error`);
    assert.equal(decisionCalls.some((call) => call.questionIds.includes("needs_plan")), false, `${scenario.id}: planning belongs to the agent`);
    assert.equal(Boolean(result.engineSnapshot.checklist), Boolean(scenario.expectedPlan), `${scenario.id}: checklist state`);
    assert.ok(decisionCalls.length <= 1, `${scenario.id}: at most one skill-picker pass`);
    if (scenario.expectedPlan && !explicit) {
      assert.equal(decisionCalls.length, 1, `${scenario.id}: accepted checklist invokes the picker`);
      assert.ok(decisionCalls[0].state.checklist?.items?.length);
      assert.ok(loaded.length <= 2, `${scenario.id}: no more than two automatic skills`);
      assert.ok(loaded.every((id) => expectedSkills.includes(id)), `${scenario.id}: unexpected skill ${loaded.join(", ")}`);
    }
    if (!scenario.expectedPlan || explicit) assert.equal(decisionCalls.length, 0, `${scenario.id}: no automatic selection without an applicable checklist`);
    if (explicit) {
      const expectedExplicitId = scenario.request.trim().split(/\s+/)[0].slice(1).toLowerCase();
      assert.ok(result.engineSnapshot.activeSkillRecords.some((record) => record.id === expectedExplicitId), `${scenario.id}: explicit skill retained`);
      assert.equal(loaded.length, 0, `${scenario.id}: explicit selection bypasses automatic additions`);
    }
  }
});
