"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { ARCHETYPES, archetypeFor, narrowToolsForArchetype } = require("../src/agent/runtime/child-archetypes.js");
const { createRuntimeDelegationProvider, buildChildContextText } = require("../src/agent/runtime/delegation-provider.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const tool = (name) => ({ type: "function", function: { name, description: name, parameters: {} } });
const ALL = ["apply_patch", "read_file", "search_workspace", "exec_command", "manage_identity", "browser_action", "web_research", "replay_request", "view_active_terminal", "ask_questions", "end_turn", "release_blocks", "recall_block", "mcp__scout__host_search"].map(tool);
const names = (tools) => tools.map((entry) => entry.function.name);

test("archetype lookup is case-insensitive and unknown roles keep the full surface", () => {
  assert.equal(archetypeFor(" Recon ").name, "recon");
  assert.equal(archetypeFor("ANALYST").name, "analyst");
  for (const role of ["agent", "ask", "", undefined, "toString", "__proto__", "constructor"]) assert.equal(archetypeFor(role), null, String(role));
  assert.deepEqual(narrowToolsForArchetype(ALL, null), ALL);
  assert.deepEqual(narrowToolsForArchetype(undefined, ARCHETYPES.recon), []);
});

test("recon cannot edit files or touch identities but keeps scanning tools and MCP", () => {
  const recon = names(narrowToolsForArchetype(ALL, ARCHETYPES.recon));
  assert.equal(recon.includes("apply_patch"), false);
  assert.equal(recon.includes("manage_identity"), false);
  for (const name of ["exec_command", "read_file", "browser_action", "replay_request", "web_research", "mcp__scout__host_search", "end_turn", "ask_questions"]) assert.equal(recon.includes(name), true, name);
});

test("analyst is read-only: no commands, no network, no MCP, but it can always finish", () => {
  const analyst = names(narrowToolsForArchetype(ALL, ARCHETYPES.analyst));
  assert.deepEqual(analyst.sort(), ["ask_questions", "end_turn", "read_file", "recall_block", "release_blocks", "search_workspace", "view_active_terminal", "web_research"].sort());
  for (const archetype of Object.values(ARCHETYPES)) assert.equal(archetype.tools.includes("end_turn"), true, `${archetype.name} must be able to end its turn`);
});

test("child context carries the role guidance only for named archetypes", () => {
  const input = (role) => ({ task: "map the host", contextPackage: { role, authority: "approve_for_me", scope: {}, identity: {}, resources: {} }, expectedOutput: { description: "map", format: "json" } });
  const recon = buildChildContextText(input("recon"), { workspace: { root: "G:/ws" }, invocationId: "p1" });
  assert.match(recon, /## Objective\nmap the host\n\n## Role\nYou are a recon child\./);
  assert.equal(buildChildContextText(input("agent"), { workspace: { root: "G:/ws" }, invocationId: "p1" }).includes("## Role"), false);
});

test("a recon child is started with the narrowed tool set and the plain role keeps every tool", async () => {
  const seen = {};
  const make = () => createRuntimeDelegationProvider({
    senderId: "s", runKey: "s::parent", parentModel: "m", subagentModel: "c", workspace: "G:/ws", sessionId: "parent-session-1",
    tools: [...ALL, tool("delegate_agent")],
    runAgentTurn: async (payload) => { seen.tools = names(payload.tools); seen.skill = payload.specialSkill?.prompt || ""; return { ok: true, finalText: "{\"status\":\"done\",\"summary\":\"ok\",\"evidenceRefs\":[],\"unverified\":[]}", executedTools: true, evidenceIds: [], aborted: false }; },
    runModelRound: async () => ({ fullText: "", toolCalls: [endTurnCall()], error: null }),
    executeToolCall: async () => ({ ok: true }),
    beginChildSession: async (deps) => ({ ok: true, sessionId: deps.childSessionId }),
    sendToRenderer: () => {}, registerChildRun: () => {}, unregisterChildRun: () => {},
  });
  const run = (role) => make()({ task: "look around", contextPackage: { role, authority: "approve_for_me", scope: {}, identity: {}, resources: {} }, expectedOutput: { description: "notes", format: "json" } },
    projectExecutionContext(createExecutionContext({ invocationId: "parent-invocation-1", toolName: "delegate_agent", role: "agent", authority: "approve_for_me", workspace: { root: "G:/ws" }, sessionId: "parent-session-1", mode: "agent" })), {});

  await run("recon");
  assert.equal(seen.tools.includes("apply_patch"), false);
  assert.equal(seen.tools.includes("exec_command"), true);
  assert.equal(seen.tools.includes("delegate_agent"), false);
  assert.match(seen.skill, /You are a recon child/);

  await run("agent");
  assert.equal(seen.tools.includes("apply_patch"), true);
  assert.equal(seen.skill.includes("## Role"), false);
});
