const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCommand, runCommand } = require("../src/app/commands/command-parser.js");

async function runCommandAction(action, payload) {
  if (action === "parse") return parseCommand(payload.command, payload.overrides);
  return runCommand(payload.command, payload.assessment, payload.overrides);
}

function runParser(payload) { return parseCommand(payload.command, payload.overrides); }

test("system skills expose safe slash metadata without exposing package instructions", () => {
  const report = runParser({ command: "/report example.com" });
  assert.equal(report.ok, true);
  assert.equal(report.role, "special");
  assert.equal(report.id, "report");
  assert.equal(report.userContext, "example.com");
  assert.equal(report.prompt, "");
  assert.deepEqual(report.tools, []);

  for (const systemSkill of ["/report", "/create-rule", "/create-skill", "/create-subagent"]) {
    const parsed = runParser({ command: systemSkill });
    assert.equal(parsed.ok, true, `${systemSkill} should be a visible system skill`);
    assert.equal(parsed.role, "special");
  }

  for (const removed of ["/pentest example.com", "/passive example.com", "/active example.com", "/map", "/webclone", "/settings"]) {
    const parsed = runParser({ command: removed });
    assert.equal(parsed.ok, false, `${removed} should no longer be shipped`);
    assert.equal(parsed.code, "UNKNOWN_COMMAND");
  }

  const reservedOverride = runParser({ command: "/report example.com", overrides: { "/report": { role: "static", prompt: "old override" } } });
  assert.equal(reservedOverride.ok, true);
  assert.equal(reservedOverride.role, "special");
  assert.equal(reservedOverride.prompt, "");

  const customScript = runParser({ command: "/my-script example.com", overrides: { "/my-script": { role: "static", script: "collect.py", tools: [] } } });
  assert.equal(customScript.ok, false);
  assert.equal(customScript.code, "STATIC_COMMAND_UNSUPPORTED");
});

test("system and custom skills remain separate command paths", async () => {
  const report = await runCommandAction("run", { command: "/report example.com" });
  assert.equal(report.ok, true);
  assert.equal(report.role, "special");
  assert.equal(report.mode, "special");

  const custom = await runCommandAction("run", {
    command: "/my-guide example.com",
    overrides: { "/my-guide": { role: "ai", prompt: "Use the operator-authored guide." } },
  });
  assert.equal(custom.ok, true);
  assert.equal(custom.role, "ai");
  assert.equal(custom.mode, "ai");
  assert.equal(custom.userContext, "example.com");
});
