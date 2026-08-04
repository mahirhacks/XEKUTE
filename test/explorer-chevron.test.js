const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src", "presentation", "ui", "bootstrap.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "presentation", "ui", "styles", "base.css"), "utf8");

test("explorer chevrons use native right and down glyphs in one fixed slot", () => {
  assert.match(renderer, /function setTreeChevronExpanded\(chevron, expanded\)/);
  assert.match(renderer, /classList\.toggle\("codicon-chevron-down", isExpanded\)/);
  assert.match(renderer, /classList\.toggle\("codicon-chevron-right", !isExpanded\)/);
  assert.doesNotMatch(css, /\.tree-chevron\.expanded\s*\{[^}]*transform:\s*rotate/);
  assert.match(css, /\.tree-chevron::before\s*\{\s*width:\s*16px;\s*text-align:\s*center;/);
  assert.match(css, /\.tree-chevron::before\s*\{[\s\S]*display:\s*block;[\s\S]*line-height:\s*1;[\s\S]*transform:\s*translateY\(1px\)/);
  assert.match(css, /\.sidebar-actions \.icon-btn \{ opacity: 0; \}/);
  assert.match(css, /#sidebar:hover \.sidebar-actions \.icon-btn,[\s\S]*\.sidebar-actions \.icon-btn:focus-visible \{ opacity: 1; \}/);
  assert.match(css, /\.explorer-root-toggle:hover \{ background: transparent; \}/);
  assert.match(css, /#explorer-title[\s\S]*opacity: 0\.6;/);
});
