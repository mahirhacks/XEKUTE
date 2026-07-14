const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

function runParser(payload) {
  const executable = process.env.POINTER_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(executable, [path.join(__dirname, "..", "src", "commands", "command_parser.py"), "--action", "parse", "--payload", JSON.stringify(payload)], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

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
