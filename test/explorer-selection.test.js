"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { nextSelection, topLevelTargets } = require("../src/ui/features/project/explorer-selection.js");

const ordered = ["/root/a", "/root/b", "/root/folder", "/root/folder/c", "/root/d"];

test("plain, Ctrl, and Shift explorer selection follows VS Code-style semantics", () => {
  const plain = nextSelection({ clickedPath: ordered[1], orderedVisiblePaths: ordered });
  assert.deepEqual(plain.selectedPaths, [ordered[1]]);

  const toggled = nextSelection({ ...plain, clickedPath: ordered[3], orderedVisiblePaths: ordered, additive: true });
  assert.deepEqual(toggled.selectedPaths, [ordered[1], ordered[3]]);

  const range = nextSelection({ selectedPaths: plain.selectedPaths, anchorPath: plain.anchorPath, clickedPath: ordered[4], orderedVisiblePaths: ordered, range: true });
  assert.deepEqual(range.selectedPaths, ordered.slice(1));

  const removed = nextSelection({ ...toggled, clickedPath: ordered[3], orderedVisiblePaths: ordered, additive: true });
  assert.deepEqual(removed.selectedPaths, [ordered[1]]);
});

test("right-click preserves a selected group and Ctrl+Shift adds a range", () => {
  const preserved = nextSelection({ selectedPaths: [ordered[0], ordered[2]], anchorPath: ordered[2], clickedPath: ordered[0], orderedVisiblePaths: ordered, contextMenu: true });
  assert.deepEqual(preserved.selectedPaths, [ordered[0], ordered[2]]);

  const added = nextSelection({ selectedPaths: [ordered[0]], anchorPath: ordered[2], clickedPath: ordered[4], orderedVisiblePaths: ordered, additive: true, range: true });
  assert.deepEqual(added.selectedPaths, [ordered[0], ordered[2], ordered[3], ordered[4]]);
});

test("batch operations omit descendants when their selected parent is included", () => {
  const targets = topLevelTargets([
    { path: "C:\\work\\folder\\child.txt", isDir: false },
    { path: "C:\\work\\folder", isDir: true },
    { path: "C:\\work\\other.txt", isDir: false },
  ]);
  assert.deepEqual(targets.map((target) => target.path), ["C:/work/folder", "C:/work/other.txt"]);
});

test("the project explorer wires modifier clicks, accessible multi-selection, and batch deletion", () => {
  const bootstrap = fs.readFileSync(path.join(__dirname, "..", "src/ui/bootstrap.js"), "utf8");
  const index = fs.readFileSync(path.join(__dirname, "..", "src/ui/index.html"), "utf8");
  assert.match(index, /id="file-tree" role="tree" aria-multiselectable="true"/);
  assert.match(bootstrap, /selectItem\(item, \{ ctrlKey: e\.ctrlKey, metaKey: e\.metaKey, shiftKey: e\.shiftKey \}\)/);
  assert.match(bootstrap, /const orderedVisiblePaths = visibleExplorerItems\(\)\.map/);
  assert.match(bootstrap, /const targets = selectedExplorerTargets\(\)/);
  assert.match(bootstrap, /Delete \$\{targets\.length\} selected items/);
});
