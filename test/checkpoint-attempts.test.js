"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { digestToolCall, attemptsFromLedger, mergeAttemptEvents, attemptFact, attemptEvent, safeUrl } = require("../src/app/services/memory/checkpoint-attempts.js");
const { createTier1ContextCoordinator } = require("../src/app/services/memory/tier1-context-coordinator.js");

const projectId = "proj_00000000-0000-4000-8000-000000009301";
const sessionId = "session_00000000-0000-4000-8000-000000009302";
const BIG = 10_000_000;

const call = (id, name, args) => ({ role: "assistant", content: "", tool_calls: [{ id, function: { name, arguments: args } }] });
const result = (id, body) => ({ role: "tool", tool_call_id: id, tool_name: "x", content: typeof body === "string" ? body : JSON.stringify(body) });
const envelope = (value, extra = {}) => ({ ok: true, status: "", error: "", errorCode: "", evidenceIds: [], payload: JSON.stringify(value), ...extra });
const checkpointOf = (coordinator, input = {}) => coordinator.checkpoint({
  project_id: projectId, session_id: sessionId, objective: "Review the lab range.", allow_model: false, effective_context_limit: BIG, ...input,
});

test("exec_command digests carry the command, redacted, and skip polling calls", () => {
  assert.equal(digestToolCall("exec_command", { command: "nmap -sV -p 22,80 10.0.0.5" }), "nmap -sV -p 22,80 10.0.0.5");
  assert.equal(digestToolCall("exec_command", JSON.stringify({ command: "curl -u admin:hunter2 http://10.0.0.5/admin" })), "curl -u admin:[REDACTED] http://10.0.0.5/admin");
  assert.equal(digestToolCall("exec_command", { executable: "hydra", args: ["-l", "admin", "-p", "hunter2", "ssh://10.0.0.5"] }), "hydra -l admin -p [REDACTED] ssh://10.0.0.5");
  assert.equal(digestToolCall("exec_command", { operation: "status", process_id: "process-1" }), "");
  assert.equal(digestToolCall("exec_command", { operation: "stop", process_id: "process-1" }), "");
  assert.equal(digestToolCall("exec_command", {}), "");
  assert.equal(digestToolCall("exec_command", { command: `echo ${"a".repeat(500)}` }).length, 200);
  assert.equal(digestToolCall("exec_command", { command: "curl -u admin:hunter2 h" }, { retainSecrets: true }), "curl -u admin:hunter2 h");
});

test("secret-bearing arguments are never read into a digest", () => {
  assert.equal(digestToolCall("exec_command", { command: "run.sh", env: { API_TOKEN: "zzzz9999" }, cwd: "/secret/place" }), "run.sh");
  const replay = digestToolCall("replay_request", { request: { url: "https://app.example.com/api/me?token=abc12345&x=1&note=short", method: "get", headers: { Authorization: "Bearer abcdefgh12345678" }, body: "password=hunter2" }, identityId: "identity_admin" });
  assert.equal(replay, "GET https://app.example.com/api/me?token=[REDACTED]&x=1&note=short identity=identity_admin");
  assert.equal(digestToolCall("browser_action", { action: "type", selector: "#login", text: "hunter2" }), "type #login [text withheld]");
  assert.equal(digestToolCall("browser_action", { action: "navigate", url: "https://admin:pw@app.example.com/login#frag" }), "navigate https://app.example.com/login");
  assert.equal(digestToolCall("manage_identity", { operation: "create", name: "admin", account: { password: "hunter2" }, metadata: { token: "abcd1234" } }), "create admin");
  assert.equal(digestToolCall("apply_patch", { operations: [{ kind: "create", path: "notes/ok.txt", content: "password=hunter2" }, { kind: "modify", path: "src/a.js", search: "x", replaceWith: "token=zzzz9999" }] }), "create notes/ok.txt, modify src/a.js");
  const generic = digestToolCall("mcp__scout__host_search", { host: "10.0.0.5", secret: "hunter2", query: "ssh" });
  assert.equal(generic, "host=10.0.0.5 query=ssh");
});

test("calls that say nothing about what was tried have no digest", () => {
  for (const name of ["release_blocks", "recall_block", "end_turn", "ask_questions", "delegate_agent", "view_active_terminal"]) assert.equal(digestToolCall(name, { operation: "list" }), "", name);
  assert.equal(digestToolCall("browser_action", { action: "screenshot" }), "");
  assert.equal(digestToolCall("browser_action", { action: "list_pages" }), "");
  assert.equal(digestToolCall("", {}), "");
});

test("other tools digest their allowlisted fields", () => {
  assert.equal(digestToolCall("read_file", { path: "src/server.js" }), "src/server.js");
  assert.equal(digestToolCall("read_file", { path: "src", mode: "directory" }), "src (directory)");
  assert.equal(digestToolCall("search_workspace", { mode: "text", query: "MAGIC_TOKEN" }), "text MAGIC_TOKEN");
  assert.equal(digestToolCall("web_research", { operation: "search", query: "nginx 1.18 cve" }), "search nginx 1.18 cve");
  assert.equal(digestToolCall("web_research", { operation: "fetch_page", url: "https://example.com/a?key=abcdef" }), "fetch_page https://example.com/a?key=[REDACTED]");
  assert.equal(safeUrl("not a url with token=abc12345"), "not a url with token=[REDACTED]");
});

test("a call is paired with its result by tool_call_id and the outcome is read from the result", () => {
  const ledger = [
    { role: "user", content: "scan" },
    call("c1", "exec_command", { command: "nmap -sV -p 22,80 10.0.0.5" }),
    result("c1", envelope({ stdout: "22/tcp open ssh OpenSSH 8.2" })),
    call("c2", "exec_command", { command: "curl -sk https://10.0.0.5/admin" }),
    result("c2", envelope({}, { ok: false, error: "HTTP 403 Forbidden", errorCode: "REPLAY_FAILED", payload: "{}" })),
    call("c3", "exec_command", { command: "sleep 99" }),
    result("c3", envelope({}, { ok: false, error: "took too long", errorCode: "EXEC_TIMEOUT", payload: "{}" })),
    call("c4", "exec_command", { command: "unanswered" }),
    call("c5", "exec_command", { operation: "status", process_id: "process-1" }),
    result("c5", envelope({ stdout: "still running" })),
  ];
  const { attempts, callIds } = attemptsFromLedger(ledger);
  assert.deepEqual(attempts.map(({ tool, digest, outcome, excerpt, count }) => ({ tool, digest, outcome, excerpt, count })), [
    { tool: "exec_command", digest: "nmap -sV -p 22,80 10.0.0.5", outcome: "success", excerpt: "22/tcp open ssh OpenSSH 8.2", count: 1 },
    { tool: "exec_command", digest: "curl -sk https://10.0.0.5/admin", outcome: "failure", excerpt: "HTTP 403 Forbidden", count: 1 },
    { tool: "exec_command", digest: "sleep 99", outcome: "timeout", excerpt: "took too long", count: 1 },
  ]);
  assert.deepEqual(callIds, ["c1", "c2", "c3", "c4", "c5"], "every call is listed, including the unanswered and the polling ones");
  assert.equal(attemptFact(attempts[1]), "Attempt: exec_command curl -sk https://10.0.0.5/admin -> failure: HTTP 403 Forbidden");
  assert.equal(attemptEvent(attempts[0]), "exec_command nmap -sV -p 22,80 10.0.0.5 -> success");
});

test("a per-run event for the same call overrides the outcome and excerpt", () => {
  const ledger = [call("c1", "exec_command", { command: "ffuf -u http://10.0.0.5/FUZZ" }), result("c1", envelope({}))];
  const { attempts } = attemptsFromLedger(ledger, [{ call_id: "c1", outcome: "cancelled", safe_excerpt: "stopped by the operator" }]);
  assert.equal(attempts[0].outcome, "cancelled");
  assert.equal(attempts[0].excerpt, "stopped by the operator");
});

test("tool messages in other shapes are read as best they can be", () => {
  const ledger = [
    call("a", "exec_command", { command: "check" }), result("a", '{"ok":true,"stdout":"CHECK_RESULT"}'),
    call("b", "exec_command", { command: "weird" }), result("b", "plain text output"),
    call("c", "exec_command", { command: "odd" }), result("c", '{"something":"else"}'),
  ];
  const outcomes = attemptsFromLedger(ledger).attempts.map(({ outcome, excerpt }) => [outcome, excerpt]);
  assert.deepEqual(outcomes, [["success", "CHECK_RESULT"], ["unknown", "plain text output"], ["unknown", ""]]);
});

test("identical attempts collapse, keep the newest position and the newest excerpt, and count", () => {
  const ledger = [
    call("1", "exec_command", { command: "nmap -p 22 10.0.0.5" }), result("1", envelope({ stdout: "first" }, { ok: false, error: "no route", payload: "{}" })),
    call("2", "exec_command", { command: "gobuster dir -u http://10.0.0.5" }), result("2", envelope({ stdout: "found /admin" })),
    call("3", "exec_command", { command: "nmap -p 22 10.0.0.5" }), result("3", envelope({ stdout: "second" }, { ok: false, error: "no route", payload: "{}" })),
    call("4", "exec_command", { command: "nmap -p 22 10.0.0.5" }), result("4", envelope({ stdout: "third" }, { ok: false, error: "no route", payload: "{}" })),
  ];
  const { attempts } = attemptsFromLedger(ledger);
  assert.deepEqual(attempts.map((attempt) => [attempt.digest, attempt.outcome, attempt.count]), [["gobuster dir -u http://10.0.0.5", "success", 1], ["nmap -p 22 10.0.0.5", "failure", 3]]);
});

test("event strings merge across checkpoints: counts add, repeats move to the newest position, old formats are kept", () => {
  const attempt = (digest, outcome, count) => ({ tool: "exec_command", digest, outcome, count });
  assert.deepEqual(mergeAttemptEvents(
    ["nmap_scan: success", "exec_command nmap -p 22 10.0.0.5 -> failure x3", "exec_command ls -> success"],
    [attempt("nmap -p 22 10.0.0.5", "failure", 2), attempt("whoami", "success", 1)],
    ["ffuf_scan: failure"],
  ), ["nmap_scan: success", "exec_command ls -> success", "exec_command nmap -p 22 10.0.0.5 -> failure x5", "exec_command whoami -> success", "ffuf_scan: failure"]);
});

test("a checkpoint records what was run, with the result, and the secret stays out", async () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = [
    { role: "user", content: "Check the admin panel" },
    call("c1", "exec_command", { command: "curl -u admin:hunter2 http://10.0.0.5/admin" }),
    result("c1", envelope({}, { ok: false, error: "HTTP 403 Forbidden", errorCode: "REPLAY_FAILED", payload: "{}" })),
  ];
  const checkpoint = (await checkpointOf(coordinator, { active_conversation: ledger })).checkpoint;
  assert.equal(checkpoint.grounded_facts.includes("Attempt: exec_command curl -u admin:[REDACTED] http://10.0.0.5/admin -> failure: HTTP 403 Forbidden"), true);
  assert.deepEqual(checkpoint.significant_events, ["exec_command curl -u admin:[REDACTED] http://10.0.0.5/admin -> failure"]);
  assert.equal(JSON.stringify(checkpoint).includes("hunter2"), false);
});

test("repeating a failed attempt across checkpoints is visible as a count", async () => {
  const coordinator = createTier1ContextCoordinator();
  const turn = (id, times) => [{ role: "user", content: `try ${id}` }, ...Array.from({ length: times }, (_, index) => [
    call(`${id}-${index}`, "exec_command", { command: "nmap -p 22 10.0.0.5" }),
    result(`${id}-${index}`, envelope({}, { ok: false, error: "host down", payload: "{}" })),
  ]).flat()];
  await checkpointOf(coordinator, { active_conversation: turn("a", 3) });
  const second = await checkpointOf(coordinator, { active_conversation: turn("b", 2) });
  assert.deepEqual(second.checkpoint.significant_events, ["exec_command nmap -p 22 10.0.0.5 -> failure x5"]);
});

test("a call whose event is already explained by the ledger does not add a second, vaguer record", async () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = [
    { role: "user", content: "scan" },
    call("c1", "exec_command", { command: "nmap 10.0.0.5" }), result("c1", envelope({ stdout: "ok" })),
    call("c2", "exec_command", { operation: "status", process_id: "p1" }), result("c2", envelope({ stdout: "running" })),
  ];
  const events = [
    { call_id: "c1", tool_name: "exec_command", outcome: "success", safe_excerpt: "ok" },
    { call_id: "c2", tool_name: "exec_command", outcome: "success", safe_excerpt: "running" },
    { call_id: "orphan", tool_name: "read_file", outcome: "failure", safe_excerpt: "missing" },
  ];
  const checkpoint = (await checkpointOf(coordinator, { active_conversation: ledger, tool_events: events })).checkpoint;
  assert.deepEqual(checkpoint.significant_events, ["exec_command nmap 10.0.0.5 -> success", "read_file: failure"]);
  assert.equal(checkpoint.grounded_facts.some((fact) => fact.startsWith("Tool exec_command completed")), false);
  assert.equal(checkpoint.grounded_facts.some((fact) => fact.startsWith("Tool read_file completed")), true, "an event with no ledger call keeps the old record");
});

test("a released block keeps what was run in its tombstone, redacted, before the arguments leave the ledger", () => {
  const coordinator = createTier1ContextCoordinator();
  const ledger = [
    { role: "user", content: "Check the admin panel" },
    call("c1", "exec_command", { command: "curl -u admin:hunter2 http://10.0.0.5/admin" }),
    result("c1", envelope({}, { ok: false, error: "HTTP 403", payload: "{}" })),
    call("c2", "exec_command", { command: "nmap -p 22 10.0.0.5" }), result("c2", envelope({ stdout: "ok" })),
    call("c3", "exec_command", { command: "nmap -p 22 10.0.0.5" }), result("c3", envelope({ stdout: "ok" })),
    { role: "assistant", content: "Done." },
    { role: "user", content: "Now the next thing" },
    { role: "assistant", content: "Working." },
  ];
  coordinator.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "s", active_conversation: ledger, effective_context_limit: BIG });
  const released = coordinator.evictBlocks(projectId, sessionId, [0]);
  assert.equal(released.evicted.length, 1);
  const tombstone = released.evicted[0].tombstone;
  assert.match(tombstone, /\. Ran: exec_command curl -u admin:\[REDACTED\] http:\/\/10\.0\.0\.5\/admin -> failure; exec_command nmap -p 22 10\.0\.0\.5 -> success x2\./);
  assert.equal(tombstone.includes("hunter2"), false);
});

test("with Redact secrets turned off, digests, facts and tombstones keep the raw command", async () => {
  const ledger = [
    { role: "user", content: "Check the admin panel" },
    call("c1", "exec_command", { command: "curl -u admin:hunter2 http://10.0.0.5/admin" }),
    result("c1", envelope({ stdout: "ok" })),
    { role: "assistant", content: "Done." },
    { role: "user", content: "Next" },
    { role: "assistant", content: "Working." },
  ];
  const coordinator = createTier1ContextCoordinator();
  const checkpoint = (await checkpointOf(coordinator, { active_conversation: ledger, retain_secrets: true })).checkpoint;
  assert.equal(checkpoint.grounded_facts.includes("Attempt: exec_command curl -u admin:hunter2 http://10.0.0.5/admin -> success: ok"), true);
  assert.deepEqual(checkpoint.significant_events, ["exec_command curl -u admin:hunter2 http://10.0.0.5/admin -> success"]);

  const other = createTier1ContextCoordinator();
  other.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "s", active_conversation: ledger, effective_context_limit: BIG });
  const released = other.evictBlocks(projectId, sessionId, [0], { retainSecrets: true });
  assert.match(released.evicted[0].tombstone, /Ran: exec_command curl -u admin:hunter2 http:\/\/10\.0\.0\.5\/admin -> success/);
});
