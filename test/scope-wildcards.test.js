"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ScopeEngine = require("../src/domain/scope/scope-engine.js");
const { evaluateBrowserPolicyAsync } = require("../src/agent/authority/scope/browser-scope.js");
const { evaluateToolScope } = require("../src/agent/authority/scope/scope-policy.js");
const { createSecurityHttpWorkbench, urlMatchesTarget } = require("../src/interceptor/http-workbench.js");
const { createProxyListenerService } = require("../src/interceptor/proxy-listener.js");
const { createWebCloneService } = require("../src/app/services/research/webclone.js");
const { createAuthorityComposition } = require("../src/agent/authority/composition.js");
const { createInvocationPipeline } = require("../src/agent/authority/invocation-pipeline.js");
const { createExecutionContext } = require("../src/contracts/tool/execution-context.js");
const { createToolRegistry, registerBrowserAction, registerExecCommand } = require("../src/agent/tools/config/tool-registry.js");
const { createBrowserActionTool } = require("../src/agent/tools/assessment/browser-action.js");
const { EXEC_COMMAND_INPUT_SCHEMA } = require("../src/agent/tools/process/exec-command.js");
const { evaluateToolScopeAsync } = require("../src/agent/authority/scope/scope-policy.js");
const { extractNetworkTargetsFromCommand } = require("../src/agent/authority/scope/command-intent.js");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-wildcard-scope-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a wildcard covers nested subdomains without an exact host entry", async () => {
  const projectProfile = { scope: { inScopeTargets: ["*.nasa.gov"], wildcardRules: ["*.nasa.gov"] } };
  for (const url of ["https://astronautappearances.nasa.gov/", "https://auth.launchpad.nasa.gov/"]) {
    const decision = await evaluateBrowserPolicyAsync({ projectProfile, profileId: "full_authority",
      input: { action: "open_page", url, purpose: "assessment" },
      resolveAddresses: async () => ({ ok: true, addresses: ["8.8.8.8"] }),
    });
    assert.equal(decision.browserPolicy.decision, "allow", url);
    assert.equal(decision.browserPolicy.standing, "in_scope", url);
    assert.equal(evaluateToolScope({ projectProfile, toolName: "exec_command", args: { command: `curl ${url}` } }).ok, true);
  }
});

test("browser and terminal invocations execute through all authority gates with wildcard-only scope", async t => {
  const root = workspace(t), registry = createToolRegistry();
  const publicDns = async () => ({ ok: true, addresses: ["93.184.216.34"] });
  registerBrowserAction(registry, createBrowserActionTool({ browserProvider: { execute: async () => ({}) } }));
  registerExecCommand(registry, { inputSchema: EXEC_COMMAND_INPUT_SCHEMA });
  const composition = createAuthorityComposition({ evaluateScope: input => evaluateToolScopeAsync({ ...input, resolveAddresses: publicDns }) });
  const pipeline = createInvocationPipeline({ authorityRegistry: composition.registry, concurrency: composition.concurrency });
  let invocation = 0;
  for (const scope of [{ inScopeTargets: ["*.example.test"] }, { wildcardRules: ["*.example.test"] }, { wildcardRules: ["https://*.example.test:8443/api"] }]) {
    const projectProfile = { scope: { ...scope, outOfScopeTargets: ["blocked.example.test"] } };
    for (const [url, allowed] of [
      ["https://one.example.test:8443/api", true],
      ["https://nested.one.example.test:8443/api/items", true],
      ["https://blocked.example.test:8443/api", false],
      ["https://one.example.test.evil.test:8443/api", false],
    ]) {
      for (const toolName of ["browser_action", "exec_command"]) {
        const ran = [], asked = [];
        const args = toolName === "browser_action"
          ? { action: "open_page", url, purpose: "assessment" }
          : { command: `curl '${url}'`, context: "fetch page" };
        const browserPolicy = toolName === "browser_action" ? await evaluateBrowserPolicyAsync({ projectProfile, input: args, profileId: "full_authority", resolveAddresses: publicDns }) : null;
        const result = await pipeline.invoke({
          context: createExecutionContext({ invocationId: `wildcard-${++invocation}`, toolName, role: "agent", authority: "full_authority", workspace: { root }, sessionId: "wildcard-chat", mode: "agent" }),
          toolName, args, entry: registry.get(toolName),
          execute: async () => { ran.push(url); return { ok: true, value: { fixture: true } }; },
          runtime: { projectProfile, browserPolicy, approvalProvider: async () => { asked.push(url); return { approved: false }; } },
        });
        const label = `${toolName} ${JSON.stringify(scope)} ${url}`;
        assert.equal(result.ok, allowed, `${label}: ${result.error || result.code || ""}`);
        assert.deepEqual(ran, allowed ? [url] : [], label);
        assert.deepEqual(asked, [], label);
        if (!allowed) assert.equal(result.code, "TARGET_OUT_OF_SCOPE", label);
      }
    }
  }
});

test("terminal target extraction preserves URL boundaries and separate destinations", () => {
  assert.deepEqual(extractNetworkTargetsFromCommand("curl 'https://one.example.test:8443/api' https://8.8.8.8:8443/api extra.example.test 1.1.1.1"), [
    "https://one.example.test:8443/api", "https://8.8.8.8:8443/api", "1.1.1.1", "extra.example.test",
  ]);
  const projectProfile = { scope: { wildcardRules: ["https://*.example.test:8443/api"] } };
  for (const command of [
    "curl 'https://one.example.test:8443/api' extra.example.test",
    "curl 'https://one.example.test:8443/api' https://outside.test/",
    "curl 'https://one.example.test:8443/api' 1.1.1.1",
    "curl 'http://one.example.test:8443/api'",
    "curl 'https://one.example.test:8443/application'",
    "curl 'https://one.example.test/api'",
  ]) assert.equal(evaluateToolScope({ toolName: "exec_command", args: { command }, projectProfile }).code, "TARGET_OUT_OF_SCOPE", command);
});

test("URL wildcard rules keep their scheme, port and path boundaries", () => {
  const policy = { wildcardRules: ["https://*.example.test:8443/api"], excludedTargets: ["blocked.example.test"] };
  for (const [url, allowed] of [
    ["https://one.example.test:8443/api/items", true],
    ["https://two.one.example.test:8443/api", true],
    ["http://one.example.test:8443/api", false],
    ["https://one.example.test/api", false],
    ["https://one.example.test:8443/application", false],
    ["https://example.test:8443/api", false],
    ["https://one.example.test.evil.test:8443/api", false],
    ["https://blocked.example.test:8443/api", false],
  ]) assert.equal(ScopeEngine.evaluateTarget(url, policy).allowed, allowed, url);
});

test("legacy URL matching honors disabled rules and wildcard restrictions", () => {
  assert.equal(urlMatchesTarget(new URL("https://one.example.test/api"), { value: "*.example.test", enabled: false }), false);
  assert.equal(urlMatchesTarget(new URL("https://one.example.test/application"), "https://*.example.test/api"), false);
  assert.equal(urlMatchesTarget(new URL("http://one.example.test/api"), "https://*.example.test/api"), false);
  assert.equal(urlMatchesTarget(new URL("http://one.example.test:8080/api/item"), "*.example.test:8080/api"), true);
  assert.equal(urlMatchesTarget(new URL("http://one.example.test/api/item"), "*.example.test:8080/api"), false);
  assert.equal(urlMatchesTarget(new URL("http://one.example.test:8080/application"), "*.example.test:8080/api"), false);
  assert.equal(urlMatchesTarget(new URL("https://one.example.test/anywhere"), "one.example.test/*"), true);
});

test("HTTP tools honor the Wildcard Rules field and exclusions before sending", async t => {
  const root = workspace(t), requests = [];
  const workbench = createSecurityHttpWorkbench({ assessmentWorkspace: {
    verify: () => ({ root }), appendTrafficRecord: () => ({ ok: true }),
  }, fetchImpl: async url => { requests.push(String(url)); return new Response("fixture"); } });
  const projectProfile = { scope: { inScopeTargets: [], wildcardRules: ["*.example.test"], outOfScopeTargets: ["blocked.example.test"] } };
  const run = host => workbench.run({ assessmentPath: root, rawRequest: `GET / HTTP/1.1\nHost: ${host}`,
    projectProfile, runtimeSettings: { logging: { logRawTraffic: false } } });
  assert.equal((await run("one.example.test")).ok, true);
  assert.equal((await run("nested.one.example.test")).ok, true);
  assert.equal((await run("blocked.example.test")).code, "OUT_OF_SCOPE");
  assert.equal((await run("one.example.test.evil.test")).code, "OUT_OF_SCOPE");
  assert.deepEqual(requests, ["https://one.example.test/", "https://nested.one.example.test/"]);
});

test("WebClone accepts wildcard scope and rejects exclusions without fetching", async t => {
  for (const scope of [{ inScopeTargets: ["*.example.test"] }, { wildcardRules: ["*.example.test"] }]) {
    const root = workspace(t), requests = [];
    const service = createWebCloneService({ fs, path,
      projectProfileProvider: () => ({ scope: { ...scope, outOfScopeTargets: ["blocked.example.test"] } }),
      webResearch: { fetchRawUrl: async url => { requests.push(url); return { text: "<h1>Fixture</h1>", finalUrl: url }; } },
    });
    assert.equal((await service.build({ root, target: "https://one.example.test/" })).ok, true);
    assert.ok((await service.build({ root, target: "https://blocked.example.test/" })).error);
    assert.deepEqual(requests, ["https://one.example.test/"]);
  }
});

test("proxy capture uses wildcard-only scope and gives exclusions precedence", async t => {
  const root = workspace(t), handlers = {}, captures = [];
  const instance = { httpPort: 43123 };
  for (const name of ["onError", "onRequest", "onRequestData", "onRequestEnd", "onResponse", "onResponseData", "onResponseEnd"])
    instance[name] = handler => { handlers[name] = handler; };
  const service = createProxyListenerService({ fs, path, assessmentWorkspace: {},
    sendEvent: (channel, payload) => { if (channel === "proxy:capture") captures.push(payload); },
    proxyAdapter: { create: () => instance, listen: async () => ({ error: "" }), close() {} },
  });
  t.after(() => service.stop());
  const started = await service.configure(root, { targets: [], wildcardRules: ["*.example.test"], excludedTargets: ["blocked.example.test"],
    settings: { listener: { enabled: true, bindAddress: "127.0.0.1", port: 43123 }, interception: { onlyInScope: true, interceptRequests: false } },
  });
  assert.equal(started.targetCount, 1);
  assert.equal(started.warning, "");
  for (const host of ["one.example.test", "nested.one.example.test", "blocked.example.test", "one.example.test.evil.test"]) {
    const ctx = { uuid: host, isSSL: true, clientToProxyRequest: { url: "/", method: "GET", httpVersion: "1.1", headers: { host } } };
    await new Promise(resolve => handlers.onRequest(ctx, resolve));
  }
  assert.deepEqual(captures.filter(item => item.phase === "request").map(item => item.url), ["https://one.example.test/", "https://nested.one.example.test/"]);
  const updated = await service.configure(root, { targets: [], wildcardRules: [],
    settings: { listener: { enabled: true, bindAddress: "127.0.0.1", port: 43123 }, interception: { onlyInScope: true } },
  });
  assert.equal(updated.targetCount, 0);
  assert.match(updated.warning, /no targets/);
});
