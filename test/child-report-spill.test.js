"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { spillChildReport, MAX_REPORT_CHARS } = require("../src/agent/runtime/child-report-spill.js");
const { createRuntimeDelegationProvider, parseChildFinding, boundChildFinding, MAX_SUMMARY_CHARS } = require("../src/agent/runtime/delegation-provider.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");
const { endTurnCall } = require("./helpers/end-turn-call.js");

const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "child-spill-"));
const json = (summary, extra = {}) => JSON.stringify({ status: "done", summary, evidenceRefs: ["scan.txt"], unverified: [], ...extra });

test("a report is saved under .xekute/delegated with secrets redacted", () => {
  const root = workspace();
  try {
    const saved = spillChildReport({ workspace: root, childInvocationId: "child-1", text: "Found login. password=hunter2 on 10.0.0.5" });
    assert.deepEqual(saved, { ok: true, relativePath: ".xekute/delegated/child-1.md" });
    const content = fs.readFileSync(path.join(root, ".xekute", "delegated", "child-1.md"), "utf8");
    assert.match(content, /^# Delegated report child-1\n\nFound login\./);
    assert.equal(content.includes("hunter2"), false);
    assert.match(content, /10\.0\.0\.5/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("child ids cannot escape the report folder and missing input is refused", () => {
  const root = workspace();
  try {
    const saved = spillChildReport({ workspace: root, childInvocationId: "../../../etc/passwd", text: "x" });
    assert.equal(saved.ok, true);
    assert.equal(saved.relativePath.startsWith(".xekute/delegated/"), true);
    assert.equal(saved.relativePath.includes(".."), false);
    assert.equal(fs.existsSync(path.join(root, "etc")), false);
    assert.equal(spillChildReport({ workspace: "", childInvocationId: "a", text: "x" }).ok, false);
    assert.equal(spillChildReport({ workspace: root, childInvocationId: "a", text: "" }).ok, false);
    const big = spillChildReport({ workspace: root, childInvocationId: "big", text: "y".repeat(MAX_REPORT_CHARS + 500) });
    assert.equal(fs.readFileSync(path.join(root, big.relativePath), "utf8").includes("[report bounded by XEKUTE]"), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a write failure is reported, not thrown", () => {
  const failing = { mkdirSync() { throw new Error("disk full"); }, writeFileSync() {} };
  const saved = spillChildReport({ workspace: "G:/ws", childInvocationId: "a", text: "x", fsImpl: failing });
  assert.equal(saved.ok, false);
  assert.match(saved.error, /disk full/);
});

test("parseChildFinding flags a summary that did not fit and keeps short ones untouched", () => {
  const short = parseChildFinding(json("all good"));
  assert.equal(short.truncated, undefined);
  assert.equal(short.summary, "all good");
  const long = parseChildFinding(json("z".repeat(MAX_SUMMARY_CHARS + 900)));
  assert.equal(long.truncated, true);
  assert.equal(long.summary.length, MAX_SUMMARY_CHARS);
  assert.equal(parseChildFinding("w".repeat(MAX_SUMMARY_CHARS + 1)).truncated, true, "a non-JSON reply is also saved");
});

test("boundChildFinding ends an oversized summary with a pointer to the saved report", () => {
  const root = workspace();
  try {
    const bounded = boundChildFinding(parseChildFinding(json("z".repeat(MAX_SUMMARY_CHARS + 900))), { workspace: root, childInvocationId: "child-9" });
    assert.equal(bounded.truncated, undefined);
    assert.equal(bounded.fullText, undefined);
    assert.ok(bounded.summary.length <= MAX_SUMMARY_CHARS);
    assert.match(bounded.summary, /\[Summary shortened\. Full report: \.xekute\/delegated\/child-9\.md\]$/);
    assert.deepEqual(bounded.evidenceRefs, ["scan.txt", ".xekute/delegated/child-9.md"]);
    assert.equal(fs.readFileSync(path.join(root, ".xekute", "delegated", "child-9.md"), "utf8").includes("z".repeat(MAX_SUMMARY_CHARS + 900)), true, "the saved file keeps the whole summary");

    const untouched = boundChildFinding(parseChildFinding(json("fits")), { workspace: root, childInvocationId: "child-10" });
    assert.equal(untouched.summary, "fits");
    assert.equal(fs.existsSync(path.join(root, ".xekute", "delegated", "child-10.md")), false);

    const unsaved = boundChildFinding(parseChildFinding(json("z".repeat(MAX_SUMMARY_CHARS + 10))), { workspace: "", childInvocationId: "child-11" });
    assert.match(unsaved.summary, /The full report could not be saved\.\]$/);
    assert.deepEqual(unsaved.evidenceRefs, ["scan.txt"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a delegated child with an oversized report returns a bounded summary and the parent can read the rest", async () => {
  const root = workspace();
  try {
    const report = "Finding detail. ".repeat(400);
    const provider = createRuntimeDelegationProvider({
      senderId: "s", runKey: "s::parent", parentModel: "m", subagentModel: "child", workspace: root, sessionId: "parent-session-1",
      tools: [{ type: "function", function: { name: "read_file", description: "read", parameters: {} } }],
      runAgentTurn: async () => ({ ok: true, finalText: json(report), executedTools: true, evidenceIds: [], aborted: false }),
      runModelRound: async () => ({ fullText: "", toolCalls: [endTurnCall()], error: null }),
      executeToolCall: async () => ({ ok: true }),
      beginChildSession: async () => ({ ok: true, sessionId: "child-spill" }),
      sendToRenderer: () => {}, registerChildRun: () => {}, unregisterChildRun: () => {},
    });
    const result = await provider({
      task: "Enumerate the service",
      contextPackage: { role: "agent", authority: "approve_for_me", scope: {}, identity: {}, resources: {} },
      expectedOutput: { description: "service report", format: "json" },
    }, projectExecutionContext(createExecutionContext({ invocationId: "parent-invocation-1", toolName: "delegate_agent", role: "agent", authority: "approve_for_me", workspace: { root }, sessionId: "parent-session-1", mode: "agent" })), {});

    assert.ok(result.output.summary.length <= MAX_SUMMARY_CHARS);
    const pointer = /Full report: (\.xekute\/delegated\/[^\]]+\.md)\]/.exec(result.output.summary);
    assert.ok(pointer, result.output.summary.slice(-200));
    assert.equal(result.output.finding.evidenceRefs.includes(pointer[1]), true);
    assert.equal(result.output.finding.fullText, undefined);
    assert.equal(fs.readFileSync(path.join(root, pointer[1]), "utf8").includes(report.trim()), true, "the saved report holds the complete text");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
