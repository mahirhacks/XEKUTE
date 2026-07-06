const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ToolMap = require("../src/tools/tool-map");
const { createWorkspaceSearch } = require("../src/tools/workspace-search");

test("ToolMap.validateToolCall sanitizes paths and normalizes patch args", () => {
  const result = ToolMap.validateToolCall("patch_file", {
    path: "\\src\\app.js",
    search: "oldValue",
    replace: "newValue",
  });

  assert.equal(result.ok, true);
  assert.equal(result.args.path, "src/app.js");
  assert.deepEqual(result.args.patches, [
    { search: "oldValue", replace: "newValue" },
  ]);
});

test("workspace search finds files by basename and content", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-search-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "chat-controller.js"), "export function runAgentTurn() {}\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "The chat runtime uses runAgentTurn for tool orchestration.\n", "utf8");

  const search = createWorkspaceSearch({ fs, path });

  const fileMatches = search.findWorkspaceFiles(root, "chat-controller", { limit: 5 });
  assert.equal(fileMatches.ok, true);
  assert.equal(fileMatches.results[0].path, "src/chat-controller.js");

  const codeMatches = search.searchWorkspaceIndex(root, "runAgentTurn", { limit: 5 });
  assert.equal(codeMatches.ok, true);
  assert.equal(codeMatches.results[0].path, "src/chat-controller.js");
  assert.match(codeMatches.results[0].snippet, /runAgentTurn/);

  fs.rmSync(root, { recursive: true, force: true });
});
