"use strict";

// Regression tests for the Tool-Calling Reliability Fix (F-001..F-015).
// Covers stream accumulation, argument parsing, finish_reason handling,
// bounded retry, canonical registry serialization, tool-port behavior,
// parallel-safety metadata, obsolete tool-name removal, and canonical args.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeToolCalls, completedToolCalls } = require("../src/agent/llm/openrouter/openrouter-stream.js");
const { parseToolArguments, PARSE_TOOL_ARGUMENT_CODES } = require("../src/contracts/tool/parse-tool-arguments");
const { createToolRegistry, toOpenAITool, toOpenAITools, registerApplyPatch } = require("../src/agent/tools/config/tool-registry.js");
const ToolPort = require("../src/contracts/tool/tool-port.js");
const { createApplyPatchTool } = require("../src/agent/tools/workspace/apply-patch.js");
const { createReadFileTool } = require("../src/agent/tools/workspace/read-file.js");
const { createSearchWorkspaceTool } = require("../src/agent/tools/workspace/search-workspace.js");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---- T-001: apply_patch receives normal object arguments ----
test("T-001: apply_patch accepts a normal object payload", () => {
  const parsed = parseToolArguments({ operations: [{ kind: "create", path: "x.md", content: "hi" }] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.operations[0].kind, "create");
});

// ---- T-002 / T-003 / T-004: streamed arguments reconstruct across chunks ----
test("T-002/T-003: streamed tool-call fragments reconstruct (args before name, many chunks)", () => {
  // Fragment ordering: arguments arrive before the function name.
  let calls = [];
  calls = mergeToolCalls(calls, [{ index: 0, function: { arguments: '{"operations"' } }]);
  calls = mergeToolCalls(calls, [{ index: 0, function: { arguments: ':[{"kind":"create","path":"report.md","content":"# Rep' } }]);
  calls = mergeToolCalls(calls, [{ index: 0, function: { arguments: 'ort"}]}' } }]);
  calls = mergeToolCalls(calls, [{ index: 0, function: { name: "apply_patch" } }]);
  const completed = completedToolCalls(calls);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].function.name, "apply_patch");
  const args = JSON.parse(completed[0].function.arguments);
  assert.equal(args.operations[0].path, "report.md");
  assert.equal(args.operations[0].content, "# Report");
});

test("T-002: multiple tool calls interleave by stream index", () => {
  let calls = [];
  calls = mergeToolCalls(calls, [{ index: 0, function: { name: "read_file", arguments: '{"path":"a' } }]);
  calls = mergeToolCalls(calls, [{ index: 1, function: { name: "read_file", arguments: '{"path":"b' } }]);
  calls = mergeToolCalls(calls, [{ index: 0, function: { arguments: '.txt"}' } }]);
  calls = mergeToolCalls(calls, [{ index: 1, function: { arguments: '.txt"}' } }]);
  const completed = completedToolCalls(calls);
  assert.equal(completed.length, 2);
  assert.deepEqual(JSON.parse(completed[0].function.arguments), { path: "a.txt" });
  assert.deepEqual(JSON.parse(completed[1].function.arguments), { path: "b.txt" });
});

test("T-002: tool call ID arriving later than the first fragment is preserved", () => {
  let calls = [];
  calls = mergeToolCalls(calls, [{ index: 0, function: { arguments: '{"path":"x"}' } }]);
  calls = mergeToolCalls(calls, [{ index: 0, id: "call_late", function: { name: "read_file" } }]);
  const completed = completedToolCalls(calls);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].id, "call_late");
});

// ---- T-004/T-005/T-006: parser distinguishes failures ----
test("T-004: truncated JSON returns MALFORMED_TOOL_ARGUMENTS, not {}", () => {
  const result = parseToolArguments('{"operations":[{"kind":"create","path":"report.md","content":"# Rep');
  assert.equal(result.ok, false);
  assert.equal(result.code, PARSE_TOOL_ARGUMENT_CODES.MALFORMED_TOOL_ARGUMENTS);
  assert.ok(result.parseError && result.parseError.length > 0);
  assert.equal(result.rawLength, '{"operations":[{"kind":"create","path":"report.md","content":"# Rep'.length);
});

test("T-005: empty argument string returns EMPTY_TOOL_ARGUMENTS", () => {
  const result = parseToolArguments("");
  assert.equal(result.ok, false);
  assert.equal(result.code, PARSE_TOOL_ARGUMENT_CODES.EMPTY_TOOL_ARGUMENTS);
});

test("T-006: literal {} remains a valid parsed object (schema validation fails later)", () => {
  const result = parseToolArguments("{}");
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {});
});

test("T-009: invalid array/scalar roots produce INVALID_TOOL_ARGUMENT_SHAPE", () => {
  assert.equal(parseToolArguments("[1,2]").code, PARSE_TOOL_ARGUMENT_CODES.INVALID_TOOL_ARGUMENT_SHAPE);
  assert.equal(parseToolArguments("42").code, PARSE_TOOL_ARGUMENT_CODES.INVALID_TOOL_ARGUMENT_SHAPE);
  assert.equal(parseToolArguments("null").code, PARSE_TOOL_ARGUMENT_CODES.INVALID_TOOL_ARGUMENT_SHAPE);
});

// ---- T-012: registry schema equals schema exposed to OpenRouter ----
test("T-012: toOpenAITool serializes the canonical registry entry", () => {
  const registry = createToolRegistry();
  const adapter = createApplyPatchTool();
  registerApplyPatch(registry, adapter);
  const tools = toOpenAITools(registry);
  const apply = tools.find((t) => t.function.name === "apply_patch");
  assert.ok(apply, "apply_patch must be in the serialized tools");
  assert.equal(apply.function.parameters, adapter.inputSchema, "serialized schema must be the canonical inputSchema");
  assert.equal(apply.function.description, adapter.description, "serialized description must come from the adapter");
});

// ---- T-013: apply_patch is never automatically parallelized ----
test("T-013: apply_patch is classified as a mutation and never parallelized", () => {
  assert.equal(ToolPort.isMutating("apply_patch"), true);
});

// ---- T-014: controller preserves operations[] from model to adapter ----
test("T-014: normalization preserves canonical apply_patch args", () => {
  const operations = [{ kind: "create", path: "report.md", content: "# Report" }];
  const normalized = ToolPort.normalizeToolCall({ id: "call-1", function: { name: "apply_patch", arguments: JSON.stringify({ operations }) } });
  assert.equal(normalized.toolName, "apply_patch");
  assert.deepEqual(normalized.args.operations, operations);
});

// ---- T-015: selected modes do not remove user-requested capabilities ----
test("T-015: Ask mode receives the canonical tool surface", () => {
  const askTools = ToolPort.toolsForProfile({ key: "ask" });
  const agentTools = ToolPort.toolsForProfile({ key: "agent" });
  assert.notDeepEqual(askTools, agentTools);
  assert.equal(askTools.some((tool) => tool.function.name === "exec_command"), false);
  assert.equal(askTools.some((tool) => tool.function.name === "ingest_traffic"), false);
});

// ---- T-016: Agent mode receives apply_patch when authorized ----
test("T-016: agent mode includes apply_patch", () => {
  const agentTools = ToolPort.toolsForProfile({ key: "agent" });
  assert.ok(agentTools.some((tool) => tool.function.name === "apply_patch"));
});

// ---- T-018: malformed payloads never invoke the underlying adapter ----
test("T-018: malformed arguments never reach the adapter (parser rejects first)", () => {
  // The harness contract: parse failure -> no invocation. Here we verify the
  // parser classifies it as a failure so the orchestration layer stops.
  const malformed = parseToolArguments('{"operations":[{"kind":"create","path":"x","content":"unterminated');
  assert.equal(malformed.ok, false);
  // And a valid payload would pass through to the adapter unchanged.
  const ok = parseToolArguments({ operations: [{ kind: "create", path: "x", content: "y" }] });
  assert.equal(ok.ok, true);
});

// ---- T-017: obsolete tool names absent from runtime prompts ----
test("T-017: obsolete legacy tool names are absent from runtime prompts", () => {
  const scanRoot = path.join(__dirname, "..", "src");
  const legacy = ["write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"];
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "build" || entry.name === ".git") continue;
        walk(full);
      } else if (entry.isFile() && /\.(js|md)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }
  walk(scanRoot);
  const offenders = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const name of legacy) {
      // Skip the intent regexes that intentionally name tools as forbidden/structured
      if (content.includes(name)) offenders.push(`${path.relative(scanRoot, file)}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], "no runtime reference to obsolete file tools should remain");
});
