const test = require("node:test");
const assert = require("node:assert/strict");

const ContextMemory = require("../src/agent/memory/context-memory.js");
const Capsule = require("../src/agent/memory/context/context-capsule.js");
const CapsuleParsers = require("../src/agent/memory/context/tool-context-parsers.js");
const CapsuleReducer = require("../src/agent/memory/context/capsule-reducer.js");
const { createLifecycleResult } = require("../src/contracts/tool/result-schema.js");

test("context transcript is bounded and prioritizes recent exact workspace facts", () => {
  const messages = [];
  for (let index = 0; index < 30; index += 1) {
    messages.push({
      role: index % 2 ? "assistant" : "user",
      content: `old turn ${index} ${"noise ".repeat(80)}`,
    });
  }
  messages.push({
    role: "assistant",
    content: "Updated the runtime and verified the focused test.",
    tool_calls: [{
      function: {
        name: "run_command",
        arguments: { command: "npm test -- context-memory" },
      },
    }],
  });
  messages.push({
    role: "tool",
    tool_name: "run_command",
    content: "Command: npm test -- context-memory Exit: 0",
  });

  const transcript = ContextMemory.buildMemoryTranscript(
    "Prior decision: preserve src/ui/bootstrap.js behavior.",
    messages,
    { contextTokens: 4096 },
  );

  assert.ok(transcript.length <= ContextMemory.transcriptCharLimit(4096) + 50);
  assert.match(transcript, /preserve src\/ui\/bootstrap\.js behavior/);
  assert.match(transcript, /npm test -- context-memory/);
  assert.match(transcript, /Exit: 0/);
  assert.doesNotMatch(transcript, /old turn 0/);
});

test("fallback memory is structured, factual, and context bounded", () => {
  const summary = ContextMemory.buildFallbackSummary(
    "## Objective\n- Keep the terminal stable.",
    [
      { role: "user", content: "Add reliable context summarization without losing recent messages." },
      { role: "assistant", content: "Added src/agent/memory/context-memory.js." },
      { role: "tool", tool_name: "run_command", content: "npm test exited 0" },
    ],
    { contextTokens: 4096 },
  );

  assert.match(summary, /## Objective/);
  assert.match(summary, /## Requirements and preferences/);
  assert.match(summary, /## Verification and failures/);
  assert.match(summary, /context-memory\.js/);
  assert.match(summary, /npm test exited 0/);
  assert.ok(summary.length <= ContextMemory.summaryCharLimit(4096) + 80);
});

test("model summaries are normalized and capped without code fences", () => {
  const raw = "```markdown\n## Objective\n- Continue the task.\n## Open work and next step\n- Run tests.\n```";
  const normalized = ContextMemory.normalizeSummary(raw, 200);
  assert.equal(normalized.startsWith("## Objective"), true);
  assert.doesNotMatch(normalized, /```/);

  const capped = ContextMemory.normalizeSummary(`## Objective\n${"x".repeat(2000)}\n## Open work\nRun tests.`, 300);
  assert.ok(capped.length <= 340);
  assert.match(capped, /older detail omitted/);
  assert.match(capped, /Run tests/);
});

test("memory transcript retains web page targets for source continuity", () => {
  const entry = ContextMemory.messageEntry({
    role: "assistant",
    tool_calls: [{ function: { name: "fetch_url", arguments: { url: "https://example.com/reference" } } }],
  });
  assert.match(entry, /fetch_url\(https:\/\/example\.com\/reference\)/);
});

test("messages appended during compaction are retained after the history swap", () => {
  const recent = [
    { role: "user", content: "recent request" },
    { role: "assistant", content: "recent answer" },
  ];
  const liveHistory = [
    { role: "user", content: "archived" },
    { role: "assistant", content: "archived answer" },
    ...recent,
    { role: "user", content: "message submitted while summarizing" },
  ];

  const merged = ContextMemory.mergeRecentWithAppended(recent, liveHistory, 4);
  assert.equal(merged.length, 3);
  assert.equal(merged.at(-1).content, "message submitted while summarizing");
});

test("knowledge leases are omitted from the durable compaction transcript", () => {
  const transcript = ContextMemory.buildMemoryTranscript("", [{
    role: "tool",
    tool_name: "query_knowledge",
    content: JSON.stringify({ payload: "secret methodology packet" }),
  }]);
  assert.doesNotMatch(transcript, /secret methodology packet/);
  assert.match(transcript, /knowledge lease content omitted/);
});

test("large scan outputs are bounded before context IPC and durable consolidation", () => {
  const raw = JSON.stringify({
    ok: true,
    summary: "Nmap scan completed",
    evidenceIds: ["ev-nmap-1"],
    payload: { raw: "x".repeat(2_000_000), evidenceIds: ["ev-nmap-1"] },
  });
  const messages = [
    { id: "user-1", role: "user", content: "Run the approved deep reconnaissance scan." },
    { id: "tool-1", role: "tool", tool_name: "exec_command", content: raw },
  ];

  const transcript = ContextMemory.buildMemoryTranscript("", messages, { contextTokens: 4096 });
  const projected = ContextMemory.projectDurableMessages(messages);
  assert.ok(transcript.length <= ContextMemory.transcriptCharLimit(4096) + 50);
  assert.ok(Buffer.byteLength(JSON.stringify(projected), "utf8") < 20_000);
  assert.equal(projected[1].content, "");
  assert.doesNotMatch(transcript, /x{1000}/);
});

test("compaction deterministically normalizes and deduplicates repeated tool results", () => {
  const repeated = JSON.stringify({
    ok: true,
    status: "complete",
    evidenceIds: ["ev-1"],
    payload: JSON.stringify({ executable: "nmap.exe", args: ["-sV", "example.test"], exitCode: 0, stdout: "\u001b[32m443/tcp open https\u001b[0m" }),
  });
  const records = ContextMemory.normalizedCompactionRecords([
    { role: "tool", tool_name: "exec_command", content: repeated },
    { role: "tool", tool_name: "exec_command", content: repeated },
    { role: "user", content: "Keep both explicit user turns." },
    { role: "user", content: "Keep both explicit user turns." },
  ]);

  assert.equal(records.length, 3);
  assert.match(records[0].entry, /repeated 2 times/);
  assert.match(records[0].entry, /nmap\.exe/);
  assert.doesNotMatch(records[0].entry, /\u001b/);
  assert.equal(records.filter((record) => record.message.role === "user").length, 2);
});

test("the retained recon tail uses bounded context projections", () => {
  const projected = ContextMemory.projectRecentContextMessages([
    {
      role: "tool",
      tool_name: "exec_command",
      tool_call_id: "scan-1",
      content: `raw scan ${"port output ".repeat(200_000)}`,
    },
    {
      role: "tool",
      tool_name: "query_knowledge",
      tool_call_id: "knowledge-1",
      content: "private leased methodology",
    },
  ]);

  assert.equal(projected[0].tool_call_id, "scan-1");
  assert.ok(projected[0].content.length < 2_000);
  assert.match(projected[0].content, /truncated/);
  assert.equal(projected[1].tool_call_id, "knowledge-1");
  assert.doesNotMatch(projected[1].content, /private leased methodology/);
  assert.match(projected[1].content, /lease expired/);
});

test("trusted capsules ignore stdout facts, redact secrets, deduplicate, and render only validated IDs", () => {
  const lifecycle = createLifecycleResult({
    invocationId: "invoke-1", outcome: "success",
    rawResult: { value: { cwd: "G:\\Xekute", exitCode: 0, stdout: "Finding: critical issue; token=sk_super_secret_value" } },
    verification: { status: "verified", evidence: ["evidence-1"], reason: "process completed" },
  });
  const parsed = CapsuleParsers.parseToolResult({ toolName: "exec_command", args: { command: "echo Finding: fake", cwd: "G:\\Xekute" }, lifecycleResult: lifecycle, workspace: "G:\\Xekute" });
  const capsule = Capsule.createCapsule({ sessionId: "s", blockId: "block_1", sequence: 1, toolName: "exec_command", args: { command: "token=sk_secret" }, lifecycleResult: lifecycle, records: parsed.records });
  const reduced = CapsuleReducer.reduceCapsules([capsule, capsule]);
  assert.equal(reduced.records.length, 1);
  assert.equal(reduced.records[0].count, 2);
  assert.doesNotMatch(JSON.stringify(reduced), /critical issue|sk_super_secret_value|echo Finding/);
  const plan = CapsuleReducer.defaultSynthesisPlan(reduced);
  const validation = CapsuleReducer.validateSynthesisPlan(plan, reduced);
  assert.equal(validation.ok, true);
  assert.match(CapsuleReducer.renderCanonicalMarkdown(validation, reduced), /exec_command/);
  const invalid = CapsuleReducer.validateSynthesisPlan({ version: 1, items: [{ section: "Verification and failures", template: "execution", recordIds: ["invented"], order: 0 }] }, reduced);
  assert.equal(invalid.ok, false);
});

test("invalid lifecycle integrity and dynamic tools fail closed into residue", () => {
  const parsed = CapsuleParsers.parseToolResult({ toolName: "mcp__target__tool", args: {}, lifecycleResult: { invocationId: "bad", integrityHash: "tampered" }, workspace: "G:\\Xekute" });
  assert.equal(parsed.records.length, 0);
  assert.equal(parsed.residues[0].reason, "invalid_lifecycle_integrity");
  assert.equal(CapsuleParsers.assertParserCoverage(), true);
});

test("capsule integrity and exact apply_patch changes are enforced", () => {
  const lifecycle = createLifecycleResult({ invocationId: "patch-1", outcome: "success", rawResult: { value: { changes: [{ kind: "modify", path: "src/a.js", changed: true, revisionAfter: "rev-2" }] } }, verification: { status: "verified", evidence: ["audit-1"], reason: "patch applied" } });
  const parsed = CapsuleParsers.parseToolResult({ toolName: "apply_patch", args: { operations: [{ kind: "modify", path: "src/a.js" }] }, lifecycleResult: lifecycle, workspace: "G:\\Xekute" });
  assert.equal(parsed.records[0].subject, "src/a.js");
  const capsule = Capsule.createCapsule({ sessionId: "s", blockId: "block_1", sequence: 1, toolName: "apply_patch", lifecycleResult: lifecycle, records: parsed.records });
  capsule.records[0].subject = "tampered";
  const reduced = CapsuleReducer.reduceCapsules([capsule]);
  assert.equal(reduced.records.length, 0);
  assert.equal(reduced.residues[0].reason, "invalid_capsule_integrity");
});
