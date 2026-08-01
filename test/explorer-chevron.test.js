const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src", "ui", "bootstrap.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "ui", "styles", "base.css"), "utf8");

test("explorer chevrons use native right and down glyphs in one fixed slot", () => {
  assert.match(renderer, /function setTreeChevronExpanded\(chevron, expanded\)/);
  assert.match(renderer, /classList\.toggle\("codicon-chevron-down", isExpanded\)/);
  assert.match(renderer, /classList\.toggle\("codicon-chevron-right", !isExpanded\)/);
  assert.doesNotMatch(css, /\.tree-chevron\.expanded\s*\{[^}]*transform:\s*rotate/);
  assert.match(css, /\.tree-chevron::before\s*\{\s*width:\s*16px;\s*text-align:\s*center;/);
});
