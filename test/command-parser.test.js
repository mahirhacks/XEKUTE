const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCommand, runCommand } = require("../src/app/commands/command-parser.js");

async function runCommandAction(action, payload) {
  if (action === "parse") return parseCommand(payload.command, payload.overrides);
  return runCommand(payload.command, payload.assessment, payload.overrides);
}

function runParser(payload) { return parseCommand(payload.command, payload.overrides); }

test("slash command parser exposes parameterless shipped special skills", () => {
  const pentest = runParser({ command: "/pentest example.com" });
  assert.equal(pentest.ok, true);
  assert.equal(pentest.role, "special");
  assert.deepEqual(pentest.args, []);
  assert.equal(pentest.userContext, "example.com");
  assert.equal(pentest.parameterPolicy, "context-only");

  for (const removed of ["/passive example.com", "/active example.com", "/map", "/settings"]) {
    const parsed = runParser({ command: removed });
    assert.equal(parsed.ok, false, `${removed} should no longer be shipped`);
    assert.equal(parsed.code, "UNKNOWN_COMMAND");
  }

  const reservedOverride = runParser({ command: "/pentest example.com", overrides: { "/pentest": { role: "static", prompt: "old override" } } });
  assert.equal(reservedOverride.role, "special");
  assert.equal(reservedOverride.prompt, "");

  const customScript = runParser({ command: "/my-script example.com", overrides: { "/my-script": { role: "static", script: "collect.py", tools: [] } } });
  assert.equal(customScript.ok, false);
  assert.equal(customScript.code, "STATIC_COMMAND_UNSUPPORTED");
});

test("special skills never launch the legacy static runner", async () => {
  const pentest = await runCommandAction("run", { command: "/pentest example.com" });
  assert.equal(pentest.ok, true);
  assert.equal(pentest.role, "special");
  assert.equal(pentest.mode, "special");
});
