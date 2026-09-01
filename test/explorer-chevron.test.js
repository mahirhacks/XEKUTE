const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src", "ui", "bootstrap.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "ui", "styles", "base.css"), "utf8");
const layoutCss = fs.readFileSync(path.join(root, "src", "ui", "styles", "layout-revamp.css"), "utf8");

test("explorer chevrons use native right and down glyphs in one fixed slot", () => {
  assert.match(renderer, /function setTreeChevronExpanded\(chevron, expanded\)/);
  assert.match(renderer, /classList\.toggle\("codicon-chevron-down", isExpanded\)/);
  assert.match(renderer, /classList\.toggle\("codicon-chevron-right", !isExpanded\)/);
  assert.doesNotMatch(css, /\.tree-chevron\.expanded\s*\{[^}]*transform:\s*rotate/);
  assert.match(css, /\.tree-chevron::before\s*\{[^}]*display:\s*block;[^}]*width:\s*16px;[^}]*height:\s*22px;[^}]*line-height:\s*22px;[^}]*transform:\s*none;/);
  assert.match(css, /\.sidebar-actions \.icon-btn \{ opacity: 0; \}/);
  assert.match(css, /#sidebar:hover \.sidebar-actions \.icon-btn,[\s\S]*\.sidebar-actions \.icon-btn:focus-visible \{ opacity: 1; \}/);
  assert.match(css, /\.explorer-root-toggle:hover \{ background: transparent; \}/);
  assert.match(css, /#explorer-title[\s\S]*opacity: 0\.6;/);
});

test("root project label stays compact and bold at every window width", () => {
  assert.match(layoutCss, /#explorer-title\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*700;/);
  assert.doesNotMatch(layoutCss, /#explorer-title,\s*\n\s*\.tree-name/);
});

test("Explorer tree uses Cursor-like compact rows with centered chevrons", () => {
  assert.match(layoutCss, /\.tree-item\s*\{[^}]*height:\s*22px;[^}]*font-size:\s*13px;/);
  assert.match(layoutCss, /\.tree-name\s*\{[^}]*font-size:\s*13px;[^}]*line-height:\s*22px;/);
  assert.match(css, /\.tree-file-icon\.seti-icon\s*\{[^}]*font-size:\s*18px\s*!important;/);
});

test("Explorer rows use one stable leading slot and a consistent depth indent", () => {
  assert.match(renderer, /const EXPLORER_TREE_LEVEL_INDENT = 14;/);
  assert.match(renderer, /function setExplorerTreeDepth\(item, depth = 0\)/);
  assert.match(renderer, /item\.dataset\.treeDepth = String\(normalized\)/);
  assert.match(renderer, /normalized \* EXPLORER_TREE_LEVEL_INDENT/);
  assert.match(renderer, /item\.setAttribute\("aria-level", String\(normalized \+ 1\)\)/);
  assert.match(renderer, /setExplorerTreeDepth\(item, depth\)/);
  assert.match(css, /\.tree-file > \.tree-chevron\.hidden \{ display: none; \}/);
  assert.match(css, /\.tree-file-icon\s*\{[^}]*width:\s*16px;[^}]*margin-right:\s*0;/);
});
