"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { redactCommandLine, redactCommandArgv, redactSecrets, redactToolCallMessages } = require("../src/shared/secret-redaction.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");

const projectId = "proj_00000000-0000-4000-8000-000000009101";
const sessionId = "session_00000000-0000-4000-8000-000000009102";

const REDACTED_CASES = [
  ["curl -u admin:hunter2 http://10.0.0.5/admin", "curl -u admin:[REDACTED] http://10.0.0.5/admin"],
  ["curl -u admin:12345 http://h/", "curl -u admin:[REDACTED] http://h/"],
  ["hydra -l admin -p hunter2 ssh://10.0.0.5", "hydra -l admin -p [REDACTED] ssh://10.0.0.5"],
  ["sudo hydra -l a -p hunter2 ssh://h", "sudo hydra -l a -p [REDACTED] ssh://h"],
  ["mysql -h 10.0.0.5 -uroot -phunter2", "mysql -h 10.0.0.5 -uroot -p[REDACTED]"],
  ["smbclient //10.0.0.5/c$ -U admin%hunter2", "smbclient //10.0.0.5/c$ -U admin%[REDACTED]"],
  ["curl http://admin:hunter2@10.0.0.5/", "curl http://admin:[REDACTED]@10.0.0.5/"],
  ["psexec.py corp/admin:Passw0rd@10.0.0.5", "psexec.py corp/admin:[REDACTED]@10.0.0.5"],
  ["tool --password hunter2 host", "tool --password [REDACTED] host"],
  ["tool --password=hunter2 host", "tool --password=[REDACTED] host"],
  ["$env:DB_PASSWORD='hunter2'; ./run.ps1", "$env:DB_PASSWORD=[REDACTED]; ./run.ps1"],
  ["DB_PASSWORD=hunter2 ./run.sh", "DB_PASSWORD=[REDACTED] ./run.sh"],
  ["token=abcd1234efgh", "token=[REDACTED]"],
  ["sqlmap -u http://10.0.0.5/?id=1 --cookie='PHPSESSID=abc123def456'", "sqlmap -u http://10.0.0.5/?id=1 --cookie=[REDACTED]"],
  ['curl -H "Authorization: Bearer abcdefgh12345678" http://10.0.0.5/', 'curl -H "Authorization: [REDACTED]" http://10.0.0.5/'],
  ['curl -H "X-Api-Key: abcd1234" http://10.0.0.5/', 'curl -H "X-Api-Key: [REDACTED]" http://10.0.0.5/'],
  ["sshpass -p Passw0rd ssh root@10.0.0.5", "sshpass -p [REDACTED] ssh root@10.0.0.5"],
  ["xfreerdp /u:admin /p:Passw0rd /v:10.0.0.5", "xfreerdp /u:admin /p:[REDACTED] /v:10.0.0.5"],
  ["ldapsearch -x -D cn=admin -w Passw0rd", "ldapsearch -x -D cn=admin -w [REDACTED]"],
  ["redis-cli -h h -a Passw0rd", "redis-cli -h h -a [REDACTED]"],
  ["openssl enc -pass pass:Passw0rd", "openssl enc -pass pass:[REDACTED]"],
  ["unknowntool -p hunter2", "unknowntool -p [REDACTED]"],
  ["echo $GH && curl -H 'X-Token: ghp_abcdefghijklmnopqrstuvwxyz0123456789' h", "echo $GH && curl -H 'X-Token: [REDACTED]' h"],
];

const UNCHANGED_CASES = [
  "nmap -sS -p 1-1000 10.0.0.5",
  "nmap -p- 10.0.0.5",
  "nmap -p22,80 10.0.0.5",
  "ssh -p 2222 root@10.0.0.5",
  "mkdir -p /tmp/x",
  "sqlmap -u http://10.0.0.5/?id=1",
  "sqlmap -u 10.0.0.5:8080/x -p id",
  "curl -sk https://10.0.0.5/admin",
  "echo hi | tee out.txt",
  "gobuster dir -u http://10.0.0.5 -w /usr/share/wordlists/common.txt",
];

test("credentials in command lines are redacted and the rest of the command is kept", () => {
  for (const [input, expected] of REDACTED_CASES) assert.equal(redactCommandLine(input), expected, input);
});

test("port specs, directories and scanner flags are not mistaken for passwords", () => {
  for (const input of UNCHANGED_CASES) assert.equal(redactCommandLine(input), input, input);
});

test("redaction is idempotent and a no-op for retained secrets and empty input", () => {
  for (const [input] of REDACTED_CASES) {
    const once = redactCommandLine(input);
    assert.equal(redactCommandLine(once), once, input);
    assert.equal(redactCommandLine(input, { retainSecrets: true }), input);
  }
  assert.equal(redactCommandLine(""), "");
  assert.equal(redactCommandLine(null), "");
  assert.equal(redactCommandLine(undefined), "");
});

test("a head hint decides -p for argv input and commands joined with shell operators", () => {
  assert.equal(redactCommandArgv("hydra", ["-l", "admin", "-p", "hunter2", "ssh://10.0.0.5"]), "hydra -l admin -p [REDACTED] ssh://10.0.0.5");
  assert.equal(redactCommandArgv("nmap", ["-p", "22,80", "10.0.0.5"]), "nmap -p 22,80 10.0.0.5");
  assert.equal(redactCommandLine("cd /tmp && mysql -phunter2 db; mkdir -p out"), "cd /tmp && mysql -p[REDACTED] db; mkdir -p out");
  assert.equal(redactCommandLine("-p hunter2", { head: "hydra" }), "-p [REDACTED]");
});

test("something secret-shaped that no rule caught withholds the whole argument list", () => {
  const out = redactCommandLine("odd-tool --config x --password-file p --api_key=abcdefghij --password hunter2");
  assert.equal(out.includes("hunter2"), false);
  assert.equal(out.includes("abcdefghij"), false);
  assert.equal(redactCommandLine("curl --data 'password: abc12345' http://h"), "curl [arguments withheld]");
  assert.equal(redactCommandLine("FOO=1 BAR_TOKEN_X=zzzzzzzz run.sh; echo ok"), "FOO=1 BAR_TOKEN_X=[REDACTED] run.sh; echo ok");
});

test("redactSecrets now catches token= and underscore-prefixed names without changing its other output", () => {
  assert.equal(redactSecrets("DB_PASSWORD=hunter2 run"), "DB_PASSWORD=[REDACTED] run");
  assert.equal(redactSecrets("token=abcd1234efgh"), "token=[REDACTED]");
  assert.equal(redactSecrets("session_token: zzzz9999"), "session_token=[REDACTED]");
  assert.equal(redactSecrets("Authorization: Bearer abcdefgh12345678"), "Authorization: [REDACTED]");
  assert.equal(redactSecrets("nothing secret here"), "nothing secret here");
  assert.equal(redactSecrets("tokenize the input"), "tokenize the input");
});

test("tool-call arguments are redacted in every form a model provider may send them", () => {
  const command = "curl -u admin:hunter2 http://10.0.0.5/admin";
  const messages = [
    { role: "user", content: "keep me" },
    { role: "assistant", content: "", tool_calls: [
      { id: "a", function: { name: "exec_command", arguments: { command } } },
      { id: "b", function: { name: "exec_command", arguments: JSON.stringify({ command }) } },
      { id: "c", function: { name: "exec_command", arguments: command } },
      { id: "d", function: { name: "exec_command", arguments: { executable: "hydra", args: ["-l", "admin", "-p", "hunter2", "ssh://10.0.0.5"] } } },
      { id: "e", function: { name: "read_file", arguments: { path: "notes/ok.txt" } } },
    ] },
  ];
  const out = redactToolCallMessages(messages);
  assert.equal(out[0], messages[0], "messages without tool calls are returned as they are");
  assert.equal(JSON.stringify(out).includes("hunter2"), false);
  assert.deepEqual(out[1].tool_calls[0].function.arguments, { command: "curl -u admin:[REDACTED] http://10.0.0.5/admin" });
  assert.equal(JSON.parse(out[1].tool_calls[1].function.arguments).command, "curl -u admin:[REDACTED] http://10.0.0.5/admin");
  assert.equal(out[1].tool_calls[2].function.arguments, "curl -u admin:[REDACTED] http://10.0.0.5/admin");
  assert.deepEqual(out[1].tool_calls[3].function.arguments.args, ["-l admin -p [REDACTED] ssh://10.0.0.5"]);
  assert.deepEqual(out[1].tool_calls[4].function.arguments, { path: "notes/ok.txt" });
  assert.equal(messages[1].tool_calls[0].function.arguments.command, command, "the input is not mutated");
  assert.equal(redactToolCallMessages(messages, { retainSecrets: true }), messages);
});

test("a command password in the ledger never reaches the summarizer payload", async () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = [
    { role: "user", content: "Check the admin panel" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "exec_command", arguments: { command: "curl -u admin:hunter2 http://10.0.0.5/admin" } } }] },
    { role: "tool", tool_call_id: "c1", tool_name: "exec_command", content: "{\"ok\":true}" },
  ];
  let payload = null;
  const result = await coordinator.checkpoint({
    project_id: projectId, session_id: sessionId, active_conversation: ledger, objective: "Check the admin panel", effective_context_limit: 200_000,
    model: async (request) => { payload = request; return {}; },
  });
  assert.equal(result.ok, true);
  assert.ok(payload, "the model was called");
  assert.equal(JSON.stringify(payload).includes("hunter2"), false);
  assert.equal(JSON.stringify(payload).includes("admin:[REDACTED]"), true, "the command itself stays visible");
  assert.equal(JSON.stringify(ledger).includes("hunter2"), true, "the local ledger is untouched");
});

test("retained secrets still reach the payload when the project keeps them", async () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = [
    { role: "user", content: "Check" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "exec_command", arguments: { command: "curl -u admin:hunter2 http://10.0.0.5/admin" } } }] },
  ];
  let payload = null;
  await coordinator.checkpoint({
    project_id: projectId, session_id: sessionId, active_conversation: ledger, objective: "Check", effective_context_limit: 200_000, retain_secrets: true,
    model: async (request) => { payload = request; return {}; },
  });
  assert.equal(JSON.stringify(payload).includes("hunter2"), true);
});

test("the main-process summarizer request honors the project's Redact secrets setting", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  assert.match(main, /async function runTier1CheckpointModel\(\{ context = \{\}, model = "", provider = "", reasoningEffort = null, retainSecrets = false, signal = null \} = \{\}\)/);
  assert.match(main, /redactToolCallMessages\(context\.active\.slice\(0, 500\), \{ retainSecrets \}\)/);
  assert.match(main, /const retainSecrets = readProjectProfile\(payload\.workspace\)\?\.profile\?\.dataHandling\?\.redactSecrets === false;/);
  assert.match(main, /return runTier1CheckpointModel\(\{ context, \.\.\.common, retainSecrets \}\);/);
  const users = main.match(/tier1Model: tier1ProjectId \? createTier1ModelCallback\(payload\) : null,/g) || [];
  assert.equal(users.length, 2, "both agent run handlers use the one callback that reads the setting");
});
