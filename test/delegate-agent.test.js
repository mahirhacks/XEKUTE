"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDelegateAgentTool, defaultDelegationProvider } = require("../src/agent/tools/process/delegate-agent.js");
const { createToolRegistry, registerDelegateAgent } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

const VALID_INPUT = {
  task: "Analyze the login endpoint for default credentials",
  contextPackage: {
    role: "agent",
    authority: "approve_for_me",
    scope: { workspace: { root: "G:/workspace" } },
    identity: { account: "tester-1" },
    resources: { maxOutputBytes: 10000 },
  },
  expectedOutput: {
    description: "A report of discovered default credentials with evidence refs",
    format: "markdown",
  },
};

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-delegate-1",
    toolName: "delegate_agent",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: "G:/workspace" },
    ...overrides,
  }));
}

async function run(tool, input, context = execContext()) {
  return tool.execute(input, context);
}

test("delegate_agent returns structured child output with parent linkage", async () => {
  const tool = createDelegateAgentTool();
  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, true);
  assert.equal(typeof result.value.childInvocationId, "string");
  assert.notEqual(result.value.childInvocationId, "");
  assert.equal(result.value.parentInvocationId, "invocation-delegate-1");
  assert.equal(result.value.role, "agent");
  assert.equal(result.value.authority, "approve_for_me");
  assert.equal(result.value.output.format, "markdown");
  assert.equal(result.value.status, "completed");
});

test("delegate_agent passes the bounded task and context to an injected provider", async () => {
  let receivedInput;
  let receivedContext;
  const tool = createDelegateAgentTool({
    delegationProvider: async (input, executionContext) => {
      receivedInput = input;
      receivedContext = executionContext;
      return {
        ok: true,
        childInvocationId: "child-xyz",
        output: {
          text: "child report",
          format: "markdown",
          summary: "report",
        },
        status: "completed",
      };
    },
  });

  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, true);
  assert.equal(result.value.childInvocationId, "child-xyz");
  assert.equal(receivedInput.task, VALID_INPUT.task);
  assert.deepEqual(receivedInput.contextPackage, VALID_INPUT.contextPackage);
  assert.equal(receivedInput.expectedOutput.description, VALID_INPUT.expectedOutput.description);
  // The provider receives the restricted context projection, never mutable pipeline state.
  assert.equal(receivedContext.contextKind, "raw_tool_projection");
  assert.equal(receivedContext.invocationId, "invocation-delegate-1");
  assert.equal("authority_policy" in receivedContext, false);
  assert.equal("state" in receivedContext, false);
});

test("delegate_agent uses a runtime child-model provider when the parent supplies one", async () => {
  let calls = 0;
  const tool = createDelegateAgentTool();
  const result = await tool.execute(VALID_INPUT, execContext(), {
    delegationProvider: async (input, executionContext, runtime) => {
      calls += 1;
      assert.equal(input.task, VALID_INPUT.task);
      assert.equal(executionContext.parentInvocationId, undefined);
      assert.equal(typeof runtime.delegationProvider, "function");
      return {
        childInvocationId: "runtime-child-1",
        output: { text: "runtime child report", format: "markdown", summary: "report" },
        status: "completed",
        metadata: { model: "selected/subagent-model" },
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.value.provider, "injected");
  assert.equal(result.value.childInvocationId, "runtime-child-1");
  assert.equal(result.value.output.text, "runtime child report");
  assert.equal(result.value.metadata.model, "selected/subagent-model");
});

test("delegate_agent forwards the caller's bounded V3 context without hidden projection", async () => {
  let receivedInput;
  const tool = createDelegateAgentTool({
    delegationProvider: async (input) => {
      receivedInput = input;
      return { childInvocationId: "child-memory", output: { text: "ok", format: "text", summary: "ok" }, status: "completed" };
    },
  });
  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, true);
  assert.deepEqual(receivedInput.contextPackage, VALID_INPUT.contextPackage);
  assert.equal("memoryPacket" in receivedInput.contextPackage, false);
});

test("delegate_agent cannot expand the parent role/authority/scope/identity/resources", async () => {
  const tool = createDelegateAgentTool();
  // The raw adapter accepts a bounded context package but MUST NOT report a
  // wider role/authority than the declared package. The authority system owns
  // the actual derived child-context bounds (deriveDelegatedExecutionContext);
  // a raw tool cannot silently report an expanded package.
  const result = await run(tool, { ...VALID_INPUT, contextPackage: { ...VALID_INPUT.contextPackage, role: "root", authority: "full_authority" } });
  assert.equal(result.ok, true);
  assert.equal(result.value.role, "root");
  assert.equal(result.value.authority, "full_authority");
  // The restricted context projection never exposes policy fields to the provider.
  assert.equal("authority_policy" in result.value, false);
});

test("delegate_agent rejects invalid input without invoking the provider", async () => {
  let providerCalls = 0;
  const tool = createDelegateAgentTool({
    delegationProvider: async () => { providerCalls += 1; return { ok: true, childInvocationId: "x", output: { text: "x" } }; },
  });
  assert.equal((await run(tool, {})).error.code, "INVALID_DELEGATE_AGENT_INPUT");
  assert.equal((await run(tool, { task: "", contextPackage: {}, expectedOutput: {} })).error.code, "INVALID_DELEGATE_AGENT_INPUT");
  assert.equal((await run(tool, { task: "t", contextPackage: { role: "agent", authority: "ask" }, expectedOutput: { description: "d", format: "text" } })).error.code, "INVALID_DELEGATE_AGENT_INPUT");
  assert.equal((await run(tool, { task: "t", contextPackage: { role: "agent", authority: "ask", scope: {}, identity: {}, resources: {} }, expectedOutput: { description: "d" } })).error.code, "INVALID_DELEGATE_AGENT_INPUT");
  assert.equal(providerCalls, 0);
});

test("delegate_agent surfaces provider errors as structured failures", async () => {
  const tool = createDelegateAgentTool({
    delegationProvider: async () => { throw new Error("child agent crashed"); },
  });
  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "DELEGATE_AGENT_DELEGATION_FAILED");
  assert.equal(result.error.retryable, false);
});

test("delegate_agent rejects an invalid provider outcome shape", async () => {
  const tool = createDelegateAgentTool({
    delegationProvider: async () => ({ ok: true, output: { text: "no child id" } }),
  });
  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "DELEGATE_AGENT_DELEGATION_FAILED");
});

test("delegate_agent returns a structured failure when the child outcome failed", async () => {
  const tool = createDelegateAgentTool({
    delegationProvider: async () => ({
      childInvocationId: "child-failed",
      output: { text: "I only printed a patch", format: "text", summary: "failed write" },
      status: "failed",
      metadata: { error: "No successful apply_patch call was recorded." },
    }),
  });
  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "DELEGATE_AGENT_DELEGATION_FAILED");
  assert.equal(result.error.childInvocationId, "child-failed");
  assert.equal(result.error.status, "failed");
  assert.match(result.error.message, /No successful apply_patch/);
});

test("delegate_agent reports the provider kind (injected vs default)", async () => {
  const tool = createDelegateAgentTool();
  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, true);
  assert.equal(result.value.provider, "default");

  const injected = createDelegateAgentTool({ delegationProvider: defaultDelegationProvider });
  const injectedResult = await run(injected, VALID_INPUT);
  assert.equal(injectedResult.ok, true);
  assert.equal(injectedResult.value.provider, "injected");
});

test("delegate_agent rejects an unrestricted execution context projection", async () => {
  const tool = createDelegateAgentTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-delegate-2",
    toolName: "delegate_agent",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute(VALID_INPUT, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("delegate_agent registration adds exactly one raw tool entry", () => {
  const tool = createDelegateAgentTool();
  const registry = createToolRegistry();
  const entry = registerDelegateAgent(registry, tool);
  assert.equal(entry.name, "delegate_agent");
  assert.deepEqual(registry.names(), ["delegate_agent"]);
  assert.throws(() => registerDelegateAgent(registry, tool), /DUPLICATE_TOOL_NAME/);
});

test("delegate_agent makes no authority or permission-expansion decision", async () => {
  const tool = createDelegateAgentTool();
  const result = await run(tool, VALID_INPUT);
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("permissionExpansion" in result.value, false);
  assert.equal("role" in result.value, true); // reports the bounded parent role, never widens it
});
