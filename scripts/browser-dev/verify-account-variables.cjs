"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");

// Drives real tool calls through the main process: a test account variable in
// tool input reaches the tool as the stored value, and the agent-facing result
// shows the variable instead of the secret.
async function verifyAccountVariables() {
  const launch = createDevLaunch({ smoke: true });
  launch.args[0] = path.join(__dirname, "app-host.cjs");
  const workspace = path.join(launch.userData, "workspace");
  fs.mkdirSync(workspace);
  const password = "Correct-Horse-7731!";
  let app;
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  try {
    app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 45000 });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => console.error("Renderer:", error.message));
    await page.waitForFunction(() => typeof window.api?.executeTool === "function");

    const created = await page.evaluate(({ workspace, password }) => window.api.credentialCreate({
      workspace, credential: { label: "Admin", username: "admin@example.test", password, role: "admin" },
    }), { workspace, password });
    assert.equal(created?.ok, true, `account saved: ${JSON.stringify(created?.error || created)}`);
    const accountId = created.value.credential.credentialId;
    const variable = `{{account.${accountId}.password}}`;

    const execute = toolCall => page.evaluate(({ workspace, toolCall }) => window.api.executeTool({ workspace, toolCall }), { workspace, toolCall });
    const written = await execute({ function: { name: "apply_patch", arguments: { operations: [{ kind: "create", path: "login.txt", content: `password=${variable}\n` }] } } });
    assert.equal(written?.ok, true, `apply_patch ran: ${JSON.stringify(written)}`);
    assert.equal(fs.readFileSync(path.join(workspace, "login.txt"), "utf8"), `password=${password}\n`);
    assert.doesNotMatch(JSON.stringify(written), /Correct-Horse/);
    pass("a variable in tool input reaches the tool as the stored password");

    const read = await execute({ function: { name: "read_file", arguments: { path: "login.txt" } } });
    assert.equal(read?.ok, true, `read_file ran: ${JSON.stringify(read)}`);
    assert.match(JSON.stringify(read), new RegExp(`password=\\{\\{account\\.${accountId}\\.password\\}\\}`));
    assert.doesNotMatch(JSON.stringify(read), /Correct-Horse/);
    pass("a tool result shows the variable, never the stored password");

    const unknown = await execute({ function: { name: "apply_patch", arguments: { operations: [{ kind: "create", path: "other.txt", content: "{{account.nobody.password}}" }] } } });
    assert.equal(unknown?.ok, false);
    assert.match(JSON.stringify(unknown), /ACCOUNT_VARIABLE_UNRESOLVED/);
    assert.equal(fs.existsSync(path.join(workspace, "other.txt")), false);
    pass("an unknown account fails without running the tool");
    return { passed };
  } finally { try { await app?.close(); } finally { removeDevUserData(launch.userData); } }
}
module.exports = { verifyAccountVariables };
if (require.main === module) verifyAccountVariables().then(result => console.log(`Verified ${result.passed.length} account variable scenarios.`)).catch(error => { console.error(error); process.exitCode = 1; });
