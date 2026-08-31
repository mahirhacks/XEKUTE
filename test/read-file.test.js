"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createReadFileTool } = require("../src/agent/tools/workspace/read-file.js");
const { createToolRegistry, registerReadFile } = require("../src/agent/tools/config/tool-registry.js");
const { createExecutionContext, projectExecutionContext } = require("../src/contracts/tool/execution-context");

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "read-file-test-"));
  const file = path.join(dir, "sample.txt");
  fs.writeFileSync(file, "line one\nline two\nline three\nline four\nline five\n", "utf8");
  const nested = path.join(dir, "nested");
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, "inner.txt"), "inner content\n", "utf8");
  return { dir, file, nested };
}

function execContext(overrides = {}) {
  return projectExecutionContext(createExecutionContext({
    invocationId: "invocation-read-1",
    toolName: "read_file",
    role: "agent",
    authority: "approve_for_me",
    workspace: { root: overrides.root || null },
    ...overrides,
  }));
}

test("read_file reads an exact file", async () => {
  const { dir, file } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: file }, execContext({ root: dir }));
  assert.equal(result.ok, true);
  assert.equal(result.value.mode, "file");
  assert.equal(result.value.content, "line one\nline two\nline three\nline four\nline five");
  assert.equal(result.value.lineCount, 5);
  assert.equal(result.value.path, path.normalize(file).replace(/\\/g, "/"));
  assert.equal(result.value.relativePath, "sample.txt");
  assert.equal(result.value.truncated, false);
});

test("read_file reads a selected line range", async () => {
  const { dir, file } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: file, startLine: 2, endLine: 3 }, execContext({ root: dir }));
  assert.equal(result.ok, true);
  assert.equal(result.value.content, "line two\nline three");
  assert.equal(result.value.startLine, 2);
  assert.equal(result.value.endLine, 3);
});

test("read_file reads a range with only startLine", async () => {
  const { dir, file } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: file, startLine: 4 }, execContext({ root: dir }));
  assert.equal(result.ok, true);
  assert.equal(result.value.content, "line four\nline five");
  assert.equal(result.value.startLine, 4);
  assert.equal(result.value.endLine, 5);
});

test("read_file rejects a range beyond the file", async () => {
  const { dir, file } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: file, startLine: 99 }, execContext({ root: dir }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "READ_FILE_INVALID_RANGE");
});

test("read_file reads a directory with structured entries", async () => {
  const { dir, file, nested } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: dir }, execContext({ root: dir }));
  assert.equal(result.ok, true);
  assert.equal(result.value.mode, "directory");
  assert.equal(result.value.entryCount, 2);
  const names = result.value.entries.map(e => e.name).sort();
  assert.deepEqual(names, ["nested", "sample.txt"]);
  const fileEntry = result.value.entries.find(e => e.name === "sample.txt");
  assert.equal(fileEntry.isFile, true);
  assert.equal(fileEntry.isDirectory, false);
  assert.equal(fileEntry.metadata.size, 49);
  assert.equal(fileEntry.metadata.relativePath, "sample.txt");
});

test("read_file reads metadata", async () => {
  const { dir, file } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: file, mode: "metadata" }, execContext({ root: dir }));
  assert.equal(result.ok, true);
  assert.equal(result.value.mode, "metadata");
  assert.equal(result.value.metadata.isFile, true);
  assert.equal(result.value.metadata.relativePath, "sample.txt");
  assert.equal(typeof result.value.metadata.modifiedAt, "string");
  assert.equal(typeof result.value.metadata.createdAt, "string");
});

test("read_file returns a structured error for a missing path without fuzzy guessing", async () => {
  const { dir } = makeFixture();
  const tool = createReadFileTool();
  const missing = path.join(dir, "does-not-exist.txt");
  const result = await tool.execute({ path: missing }, execContext({ root: dir }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "READ_FILE_NOT_FOUND");
  assert.equal(result.error.path, "does-not-exist.txt");
});

test("read_file rejects binary content without returning decoded text", async () => {
  const { dir } = makeFixture();
  const binary = path.join(dir, "blob.bin");
  fs.writeFileSync(binary, Buffer.from([0x00, 0x01, 0x02, 0xff]));
  const tool = createReadFileTool();
  const result = await tool.execute({ path: binary }, execContext({ root: dir }));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "READ_FILE_BINARY_CONTENT");
  assert.equal(result.value, undefined);
});

test("read_file rejects malformed capability input", async () => {
  const tool = createReadFileTool();
  assert.equal((await tool.execute({ path: "" }, execContext())).error.code, "INVALID_READ_FILE_INPUT");
  assert.equal((await tool.execute({ path: "a\nb" }, execContext())).error.code, "INVALID_READ_FILE_INPUT");
  assert.equal((await tool.execute({ path: "x", mode: "other" }, execContext())).error.code, "INVALID_READ_FILE_INPUT");
  assert.equal((await tool.execute({ path: "x", startLine: 0 }, execContext())).error.code, "INVALID_READ_FILE_INPUT");
  assert.equal((await tool.execute({ path: "x", startLine: 5, endLine: 2 }, execContext())).error.code, "INVALID_READ_FILE_INPUT");
  assert.equal((await tool.execute(null, execContext())).error.code, "INVALID_READ_FILE_INPUT");
});

test("read_file rejects an unrestricted execution context projection", async () => {
  const tool = createReadFileTool();
  const fullContext = createExecutionContext({
    invocationId: "invocation-read-2",
    toolName: "read_file",
    role: "agent",
    authority: "approve_for_me",
  });
  const result = await tool.execute({ path: "anything.txt" }, fullContext);
  assert.equal(result.error.code, "INVALID_EXECUTION_CONTEXT");
});

test("read_file registration adds exactly one raw tool entry", () => {
  const tool = createReadFileTool();
  const registry = createToolRegistry();
  const entry = registerReadFile(registry, tool);
  assert.equal(entry.name, "read_file");
  assert.deepEqual(registry.names(), ["read_file"]);
  assert.throws(() => registerReadFile(registry, tool), /DUPLICATE_TOOL_NAME/);
  assert.deepEqual(entry.metadata.targetTypes, ["file", "workspace"]);
  assert.equal(entry.metadata.mutating, false);
});

test("read_file raw adapter contains no authority decision result", async () => {
  const { dir, file } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: file }, execContext({ root: dir }));
  assert.equal(result.ok, true);
  assert.equal("decision" in result.value, false);
  assert.equal("approval" in result.value, false);
  assert.equal("scope" in result.value, false);
});

test("read_file does not guess filenames for a missing relative path", async () => {
  const { dir } = makeFixture();
  const tool = createReadFileTool();
  const result = await tool.execute({ path: "sample.txt", mode: "metadata" }, execContext({ root: dir }));
  assert.equal(result.ok, true);
  assert.equal(result.value.metadata.relativePath, "sample.txt");
});