const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function runPython(action, payload) {
  const executable = process.env.POINTER_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(executable, [path.join(__dirname, "..", "src", "commands", "command_parser.py"), "--action", action, "--payload", JSON.stringify(payload)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

function runParser(payload) { return runPython("parse", payload); }

test("slash command parser separates static and AI roles", () => {
  const passive = runParser({ command: "/passive example.com" });
  assert.equal(passive.ok, true);
  assert.equal(passive.role, "static");
  assert.equal(passive.output, "recon/passive-recon.json");

  const active = runParser({ command: "/active example.com" });
  assert.deepEqual(active.tools, ["httpx", "nmap", "ffuf"]);
  assert.equal(active.role, "static");

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

test("targetless passive and active commands derive the reviewed in-scope target", () => {
  const assessment = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-slash-target-"));
  try {
    for (const folder of ["scope", "recon", "logs", "enumeration", "tools"]) fs.mkdirSync(path.join(assessment, folder), { recursive: true });
    fs.writeFileSync(path.join(assessment, "scope", "in-scope.json"), JSON.stringify({
      authorization: { confirmed: true },
      rulesOfEngagement: { allowActiveRecon: true },
      targets: ["https://example.com/app"],
      wildcardRules: [],
    }));
    fs.writeFileSync(path.join(assessment, "scope", "out-of-scope.json"), JSON.stringify({ assets: [] }));
    fs.writeFileSync(path.join(assessment, "scope", "configurations.json"), JSON.stringify({ authorizationGate: { authorizationConfirmed: true, scopeReviewed: true, rulesAccepted: true, allowActiveRecon: true } }));
    fs.writeFileSync(path.join(assessment, "scope", "engagement.json"), JSON.stringify({ authorization: { confirmed: true }, scopeReview: { reviewed: true, exclusionsConfirmed: true } }));

    const overrides = { "/passive": { tools: [] }, "/active": { tools: [] } };
    const passive = runPython("run", { command: "/passive", assessment, overrides });
    assert.equal(passive.ok, true);
    assert.equal(passive.target, "https://example.com/app");

    const active = runPython("run", { command: "/active", assessment, overrides });
    assert.equal(active.ok, true);
    assert.equal(active.target, "https://example.com/app");
  } finally {
    fs.rmSync(assessment, { recursive: true, force: true });
  }
});
