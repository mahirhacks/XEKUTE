"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createTier1ContextCoordinator, blocksFromActive } = require("../src/app/services/memory/tier1-context-coordinator.js");
const { createTier1SensitiveStore } = require("../src/app/storage/memory/tier1-sensitive-store.js");

const projectId = "proj_00000000-0000-4000-8000-000000005001";
const sessionId = "session_00000000-0000-4000-8000-000000005002";
const otherSessionId = "session_00000000-0000-4000-8000-000000005003";
const LIMIT = 200_000;

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-memory-v3-blocks-"));
  const protector = {
    available: () => true,
    encrypt: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(String(value), "base64").toString("utf8"),
  };
  const store = createTier1SensitiveStore({ fs, path, crypto, baseDir: root, protector });
  return { root, store, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function turn(label, { tools = [] } = {}) {
  const messages = [{ role: "user", content: `Question ${label}` }];
  tools.forEach((name, position) => {
    const id = `call-${label}-${position}`;
    messages.push({ role: "assistant", content: "", tool_calls: [{ id, function: { name, arguments: {} } }] });
    messages.push({ role: "tool", tool_call_id: id, tool_name: name, content: `result ${label} ${name}` });
  });
  messages.push({ role: "assistant", content: `Answer ${label}` });
  return messages;
}

function ledger() {
  return [
    ...turn("A", { tools: ["exec_command", "read_file"] }),
    ...turn("B"),
    ...turn("C", { tools: ["exec_command"] }),
    ...turn("D"),
  ];
}

function seed(coordinator, messages) {
  return coordinator.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "system", active_conversation: messages, effective_context_limit: LIMIT });
}

test("assemble stamps block indexes in place and re-adopts them when the ledger is re-sent unstamped", () => {
  const coordinator = createTier1ContextCoordinator();
  const callerLedger = ledger();
  seed(coordinator, callerLedger);

  assert.deepEqual(callerLedger.filter((message) => message.block_index !== undefined).map((message) => [message.content, message.block_index]), [
    ["Question A", 0], ["Question B", 1], ["Question C", 2], ["Question D", 3],
  ]);

  const resent = [...ledger(), ...turn("E")];
  seed(coordinator, resent);
  assert.deepEqual(coordinator.activeBlocks(projectId, sessionId).map((block) => block.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(resent.filter((message) => message.block_index !== undefined).map((message) => message.block_index), [0, 1, 2, 3, 4]);
});

test("a preview never stamps the caller's messages or advances the counter", () => {
  const coordinator = createTier1ContextCoordinator();
  const callerLedger = ledger();
  coordinator.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "system", active_conversation: callerLedger, effective_context_limit: LIMIT, preview: true });
  assert.equal(callerLedger.some((message) => message.block_index !== undefined), false);
  seed(coordinator, ledger());
  assert.deepEqual(coordinator.activeBlocks(projectId, sessionId).map((block) => block.index), [0, 1, 2, 3]);
});

test("releasing a block replaces it with one tombstone and keeps every other index", () => {
  const coordinator = createTier1ContextCoordinator();
  const before = seed(coordinator, ledger());
  const result = coordinator.evictBlocks(projectId, sessionId, [{ index: 0, reason: "recon finished, findings noted" }, 2]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.evicted.map((entry) => [entry.index, entry.messages]), [[0, 6], [2, 4]]);
  const blocks = coordinator.activeBlocks(projectId, sessionId);
  assert.deepEqual(blocks.map((block) => [block.index, block.state, block.messages.length]), [[0, "evicted", 1], [1, "active", 2], [2, "evicted", 1], [3, "active", 2]]);
  assert.match(blocks[0].messages[0].content, /^\[Block 0 released from context: 6 messages, started by "Question A", tools: exec_command, read_file\. Note: recon finished, findings noted\. Call recall_block with index 0 to read it again\.\]$/);
  assert.match(blocks[2].messages[0].content, /tools: exec_command\./);
  assert.equal(blocks[0].messages[0].role, "user");
  assert.equal(blocks[0].messages[0].block_tombstone, true);

  const after = coordinator.assemble({ project_id: projectId, session_id: sessionId, system_prompt: "system", effective_context_limit: LIMIT });
  assert.ok(after.rows["Active Conversation"] < before.rows["Active Conversation"], "released blocks shrink the Active Conversation row");
  assert.equal(after.rows["System Prompt"], before.rows["System Prompt"], "Block A is untouched");
});

test("the newest block, unknown, already released and invalid indexes are rejected without touching the ledger", () => {
  const coordinator = createTier1ContextCoordinator();
  seed(coordinator, ledger());
  assert.equal(coordinator.evictBlocks(projectId, sessionId, [1]).evicted.length, 1);
  const snapshot = JSON.stringify(coordinator.state(projectId, sessionId).active);

  const result = coordinator.evictBlocks(projectId, sessionId, [3, 99, 1, -1, "x", 1.5, 3]);
  assert.deepEqual(result.evicted, []);
  assert.deepEqual(result.rejected.map((entry) => entry.code), ["BLOCK_IN_FLIGHT", "BLOCK_NOT_FOUND", "BLOCK_ALREADY_RELEASED", "BLOCK_INDEX_INVALID", "BLOCK_INDEX_INVALID", "BLOCK_INDEX_INVALID"]);
  assert.equal(JSON.stringify(coordinator.state(projectId, sessionId).active), snapshot);
});

test("tombstones redact secrets from the prompt and the note", () => {
  const coordinator = createTier1ContextCoordinator();
  const messages = [
    { role: "user", content: "Log in with password=hunter2 and Authorization: Bearer abc.def.ghi to the host" },
    { role: "assistant", content: "Logged in." },
    ...turn("Z"),
  ];
  seed(coordinator, messages);
  const result = coordinator.evictBlocks(projectId, sessionId, [{ index: 0, reason: "token=sekret-value was used" }]);
  assert.equal(result.evicted.length, 1);
  assert.equal(/hunter2|abc\.def\.ghi|sekret-value/.test(result.evicted[0].tombstone), false);
  assert.match(result.evicted[0].tombstone, /\[REDACTED\]/);
});

test("recall returns the original messages, rejects live blocks, and leaves the ledger unchanged", () => {
  const coordinator = createTier1ContextCoordinator();
  seed(coordinator, ledger());
  const original = ledger().slice(0, 6).map((message) => message.content);
  coordinator.evictBlocks(projectId, sessionId, [0]);
  const ledgerBefore = JSON.stringify(coordinator.state(projectId, sessionId).active);

  const recalled = coordinator.recallBlock(projectId, sessionId, 0);
  assert.equal(recalled.ok, true);
  assert.deepEqual(recalled.messages.map((message) => message.content), original);
  assert.equal(recalled.messages[1].tool_calls[0].id, "call-A-0");
  assert.equal(JSON.stringify(coordinator.state(projectId, sessionId).active), ledgerBefore);

  assert.equal(coordinator.recallBlock(projectId, sessionId, 1).code, "MEMORY_BLOCK_ACTIVE");
  assert.equal(coordinator.recallBlock(projectId, sessionId, 42).code, "MEMORY_BLOCK_NOT_RELEASED");
  assert.equal(coordinator.recallBlock(projectId, sessionId, "nope").code, "MEMORY_BLOCK_INDEX_INVALID");
});

test("released blocks, tombstones and the index counter survive a restart", () => {
  const { store, cleanup } = makeStore();
  try {
    const first = createTier1ContextCoordinator({ sensitiveStore: store });
    seed(first, ledger());
    first.evictBlocks(projectId, sessionId, [0, 2]);

    const second = createTier1ContextCoordinator({ sensitiveStore: store });
    const blocks = second.activeBlocks(projectId, sessionId);
    assert.deepEqual(blocks.map((block) => [block.index, block.state]), [[0, "evicted"], [1, "active"], [2, "evicted"], [3, "active"]]);
    assert.equal(second.recallBlock(projectId, sessionId, 2).messages[3].content, "Answer C");

    second.appendConversation(projectId, sessionId, turn("E"));
    assert.deepEqual(second.activeBlocks(projectId, sessionId).map((block) => block.index), [0, 1, 2, 3, 4]);
  } finally { cleanup(); }
});

test("block indexes are never reused after a checkpoint empties the ledger", async () => {
  const { store, cleanup } = makeStore();
  try {
    const coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
    seed(coordinator, ledger());
    coordinator.evictBlocks(projectId, sessionId, [0]);
    const checkpoint = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Review the host.", allow_model: false, effective_context_limit: LIMIT });
    assert.equal(checkpoint.ok, true);
    assert.equal(coordinator.activeBlocks(projectId, sessionId).length, 0);

    const restarted = createTier1ContextCoordinator({ sensitiveStore: store });
    restarted.appendConversation(projectId, sessionId, turn("F"));
    assert.deepEqual(restarted.activeBlocks(projectId, sessionId).map((block) => block.index), [4]);
    assert.equal(restarted.recallBlock(projectId, sessionId, 0).ok, true, "a released block stays recallable after a checkpoint");
  } finally { cleanup(); }
});

test("a checkpoint does not report a tombstone as a user request", async () => {
  const coordinator = createTier1ContextCoordinator();
  seed(coordinator, ledger());
  coordinator.evictBlocks(projectId, sessionId, [0]);
  const checkpoint = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Review the host.", allow_model: false, effective_context_limit: LIMIT });
  const facts = checkpoint.checkpoint.grounded_facts.map((fact) => (typeof fact === "string" ? fact : fact.text || JSON.stringify(fact)));
  assert.equal(facts.some((fact) => fact.includes("User request: Question B")), true);
  assert.equal(facts.some((fact) => /User request: \[Block 0/.test(fact)), false);
});

test("a failed durable write leaves the block in context", () => {
  const { store, cleanup } = makeStore();
  try {
    const failing = Object.freeze({ ...store, writeReleasedBlock: () => ({ ok: false, code: "MEMORY_SENSITIVE_WRITE_FAILED" }) });
    const coordinator = createTier1ContextCoordinator({ sensitiveStore: failing });
    seed(coordinator, ledger());
    const before = JSON.stringify(coordinator.state(projectId, sessionId).active);
    const result = coordinator.evictBlocks(projectId, sessionId, [0]);
    assert.deepEqual(result.evicted, []);
    assert.deepEqual(result.rejected, [{ index: 0, code: "MEMORY_SENSITIVE_WRITE_FAILED" }]);
    assert.equal(JSON.stringify(coordinator.state(projectId, sessionId).active), before);
    assert.equal(coordinator.recallBlock(projectId, sessionId, 0).code, "MEMORY_BLOCK_ACTIVE");
  } finally { cleanup(); }
});

test("cloning a session carries released blocks so recall works in the copy", () => {
  const { store, cleanup } = makeStore();
  try {
    const coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
    seed(coordinator, ledger());
    coordinator.evictBlocks(projectId, sessionId, [0]);
    assert.equal(coordinator.cloneSession(projectId, sessionId, otherSessionId).copied, true);

    const fresh = createTier1ContextCoordinator({ sensitiveStore: store });
    assert.equal(fresh.recallBlock(projectId, otherSessionId, 0).messages[0].content, "Question A");
    fresh.appendConversation(projectId, otherSessionId, turn("G"));
    assert.deepEqual(fresh.activeBlocks(projectId, otherSessionId).map((block) => block.index), [0, 1, 2, 3, 4]);
  } finally { cleanup(); }
});

test("blocksFromActive reports tombstoned openers as evicted and unstamped ledgers by position", () => {
  const blocks = blocksFromActive([
    { role: "user", content: "[Block 5 released]", block_index: 5, block_tombstone: true },
    { role: "user", content: "next", block_index: 6 },
    { role: "assistant", content: "ok" },
  ], () => 1);
  assert.deepEqual(blocks.map((block) => [block.index, block.state, block.blockId, block.tokenEstimate]), [[5, "evicted", "block_5", 1], [6, "active", "block_6", 2]]);
  assert.deepEqual(blocksFromActive([{ role: "user", content: "a" }, { role: "user", content: "b" }]).map((block) => block.index), [0, 1]);
});

test("extractBlockFindings keeps hosts, ports, urls, cves and touched files and only counts credentials", () => {
  const { extractBlockFindings } = require("../src/app/services/memory/tier1-context-coordinator.js");
  const findings = extractBlockFindings([
    { role: "user", content: "Scan 10.0.0.5 and 10.0.0.7, then look at https://app.example.com/login?next=/admin&token=abc123 for CVE-2021-44228" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "read_file", arguments: JSON.stringify({ path: "src/server.js" }) } }, { id: "c2", function: { name: "apply_patch", arguments: { operations: [{ kind: "create", path: "notes/ok.txt", content: "x" }] } } }] },
    { role: "tool", tool_call_id: "c1", content: "22/tcp open ssh\n443/tcp open https\nNot an ip 999.1.1.1\npassword=hunter2" },
    { role: "tool", tool_call_id: "c2", content: '{"ok":false,"error":"denied"}' },
  ]);
  assert.match(findings, /hosts: 10\.0\.0\.5, 10\.0\.0\.7/);
  assert.equal(findings.includes("999.1.1.1"), false);
  assert.match(findings, /ports: 22\/tcp, 443\/tcp/);
  assert.match(findings, /urls: https:\/\/app\.example\.com\/login/);
  assert.equal(/token=abc123|next=/.test(findings), false, "query strings are dropped");
  assert.match(findings, /cves: CVE-2021-44228/);
  assert.match(findings, /files: src\/server\.js, notes\/ok\.txt/);
  assert.match(findings, /1 failed tool result/);
  assert.match(findings, /2 credential-like values not shown/, "password=hunter2 and the token in the URL query");
  assert.equal(findings.includes("hunter2"), false);
  assert.ok(findings.length <= 700);
  assert.equal(extractBlockFindings([{ role: "user", content: "hello" }]), "");
});

test("a released block's tombstone carries its findings and a checkpoint keeps them as released work", async () => {
  const coordinator = createTier1ContextCoordinator();
  seed(coordinator, [
    { role: "user", content: "Scan the host" },
    { role: "assistant", content: "Found 10.0.0.5 with 22/tcp open." },
    ...turn("B"),
  ]);
  const released = coordinator.evictBlocks(projectId, sessionId, [0]);
  assert.match(released.evicted[0].tombstone, /Findings: hosts: 10\.0\.0\.5; ports: 22\/tcp\./);

  const checkpoint = await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Review the host.", allow_model: false, effective_context_limit: LIMIT });
  const facts = checkpoint.checkpoint.grounded_facts.map((fact) => (typeof fact === "string" ? fact : fact.text || JSON.stringify(fact)));
  assert.equal(facts.some((fact) => /Released work: \[Block 0 released[^\]]*hosts: 10\.0\.0\.5/.test(fact)), true);
});

test("a pinned block is refused for release, listed as pinned, and survives a restart", () => {
  const { store, cleanup } = makeStore();
  try {
    const first = createTier1ContextCoordinator({ sensitiveStore: store });
    seed(first, ledger());
    assert.deepEqual(first.pinBlock(projectId, sessionId, 1), { ok: true, index: 1, pinned: true, pinnedBlocks: [1] });
    const result = first.evictBlocks(projectId, sessionId, [0, 1]);
    assert.deepEqual(result.evicted.map((entry) => entry.index), [0]);
    assert.deepEqual(result.rejected, [{ index: 1, code: "BLOCK_PINNED" }]);

    const second = createTier1ContextCoordinator({ sensitiveStore: store });
    assert.deepEqual(second.activeBlocks(projectId, sessionId).map((block) => [block.index, block.pinned]), [[0, false], [1, true], [2, false], [3, false]]);
    assert.deepEqual(second.pinBlock(projectId, sessionId, 1, false), { ok: true, index: 1, pinned: false, pinnedBlocks: [] });
    assert.equal(second.evictBlocks(projectId, sessionId, [1]).evicted.length, 1);
  } finally { cleanup(); }
});

test("pinning rejects unknown and already released blocks, and a pin follows its block when the controller re-sends the ledger", () => {
  const coordinator = createTier1ContextCoordinator();
  seed(coordinator, ledger());
  coordinator.evictBlocks(projectId, sessionId, [0]);
  assert.equal(coordinator.pinBlock(projectId, sessionId, 0).code, "MEMORY_BLOCK_RELEASED");
  assert.equal(coordinator.pinBlock(projectId, sessionId, 99).code, "MEMORY_BLOCK_NOT_FOUND");
  assert.equal(coordinator.pinBlock(projectId, sessionId, "x").code, "MEMORY_BLOCK_INDEX_INVALID");

  coordinator.pinBlock(projectId, sessionId, 2);
  seed(coordinator, [...coordinator.state(projectId, sessionId).active.map((message) => ({ ...message })), ...turn("E")]);
  assert.deepEqual(coordinator.activeBlocks(projectId, sessionId).filter((block) => block.pinned).map((block) => block.index), [2]);
});

test("pins are dropped when their block leaves the ledger and are copied with a cloned session", async () => {
  const { store, cleanup } = makeStore();
  try {
    const coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
    seed(coordinator, ledger());
    coordinator.pinBlock(projectId, sessionId, 3);
    coordinator.cloneSession(projectId, sessionId, otherSessionId);
    assert.deepEqual(createTier1ContextCoordinator({ sensitiveStore: store }).activeBlocks(projectId, otherSessionId).filter((block) => block.pinned).map((block) => block.index), [3]);

    await coordinator.checkpoint({ project_id: projectId, session_id: sessionId, objective: "Review the host.", allow_model: false, effective_context_limit: LIMIT });
    const restarted = createTier1ContextCoordinator({ sensitiveStore: store });
    restarted.appendConversation(projectId, sessionId, turn("F"));
    assert.deepEqual(restarted.activeBlocks(projectId, sessionId).map((block) => [block.index, block.pinned]), [[4, false]]);
  } finally { cleanup(); }
});

test("with a store, released blocks are read back from it and not held in memory", () => {
  const { store, cleanup } = makeStore();
  try {
    let reads = 0;
    const counting = Object.freeze({ ...store, readReleasedBlock: (...args) => { reads += 1; return store.readReleasedBlock(...args); } });
    const coordinator = createTier1ContextCoordinator({ sensitiveStore: counting });
    seed(coordinator, ledger());
    coordinator.evictBlocks(projectId, sessionId, [0]);
    assert.equal(coordinator.recallBlock(projectId, sessionId, 0).ok, true);
    assert.equal(coordinator.recallBlock(projectId, sessionId, 0).ok, true);
    assert.equal(reads, 2, "every recall reads the encrypted copy");
  } finally { cleanup(); }
});

test("an active ledger saved before block indexes existed is stamped in order on first load", () => {
  const { store, cleanup } = makeStore();
  try {
    store.writeActive(projectId, sessionId, ledger());
    const coordinator = createTier1ContextCoordinator({ sensitiveStore: store });
    assert.deepEqual(coordinator.activeBlocks(projectId, sessionId).map((block) => [block.index, block.pinned]), [[0, false], [1, false], [2, false], [3, false]]);
    coordinator.appendConversation(projectId, sessionId, turn("E"));
    assert.deepEqual(coordinator.activeBlocks(projectId, sessionId).map((block) => block.index), [0, 1, 2, 3, 4]);
    assert.equal(coordinator.evictBlocks(projectId, sessionId, [0]).evicted.length, 1);
  } finally { cleanup(); }
});
