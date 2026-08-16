const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseCommand, runCommand } = require("../src/app/commands/command-parser.js");

async function runCommandAction(action, payload) {
  if (action === "parse") return parseCommand(payload.command, payload.overrides);
  return runCommand(payload.command, payload.assessment, payload.overrides);
}

function runParser(payload) { return parseCommand(payload.command, payload.overrides); }

test("slash command parser separates static and AI roles", () => {
  const passive = runParser({ command: "/passive example.com" });
  assert.equal(passive.ok, true);
  assert.equal(passive.role, "static");
  assert.equal(passive.output, "recon/passive-recon.json");

  const removedActive = runParser({ command: "/active example.com" });
  assert.equal(removedActive.ok, false);
  assert.equal(removedActive.code, "UNKNOWN_COMMAND");
  assert.equal(runParser({ command: "/active example.com", overrides: { "/active": { role: "ai", prompt: "old override" } } }).code, "UNKNOWN_COMMAND");

  const ai = runParser({ command: "/pentest example.com" });
  assert.equal(ai.ok, true);
  assert.equal(ai.role, "ai");

  const overridden = runParser({ command: "/passive example.com", overrides: { "/passive": { role: "ai", prompt: "Analyze passively." } } });
  assert.equal(overridden.role, "ai");
  assert.equal(overridden.prompt, "Analyze passively.");

  const customScript = runParser({ command: "/my-script example.com", overrides: { "/my-script": { role: "static", script: "collect.py", tools: [] } } });
  assert.equal(customScript.role, "static");
  assert.equal(customScript.script, "collect.py");
});

test("targetless passive command derives the reviewed in-scope target", async () => {
  const assessment = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-slash-target-"));
  try {
    for (const folder of ["scope", "recon", ".xekute/logs", "enumeration", "tools"]) fs.mkdirSync(path.join(assessment, folder), { recursive: true });
    fs.writeFileSync(path.join(assessment, "scope", "in-scope.json"), JSON.stringify({
      authorization: { confirmed: true },
      rulesOfEngagement: { allowActiveRecon: true },
      targets: ["https://example.com/app"],
      wildcardRules: [],
    }));
    fs.writeFileSync(path.join(assessment, "scope", "out-of-scope.json"), JSON.stringify({ assets: [] }));
    fs.writeFileSync(path.join(assessment, "scope", "configurations.json"), JSON.stringify({ authorizationGate: { authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true, allowActiveRecon: true } }));
    fs.writeFileSync(path.join(assessment, "scope", "engagement.json"), JSON.stringify({ authorization: { confirmed: true }, scopeReview: { reviewed: true, exclusionsConfirmed: true } }));

    const overrides = { "/passive": { tools: [] } };
    const passive = await runCommandAction("run", { command: "/passive", assessment, overrides });
    assert.equal(passive.ok, true);
    assert.equal(passive.target, "https://example.com/app");
  } finally {
    fs.rmSync(assessment, { recursive: true, force: true });
  }
});
