const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const theme = require("../src/ui/features/project/seti-icon-theme.js");
const html = fs.readFileSync(path.join(root, "src", "ui", "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src", "ui", "bootstrap.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "ui", "styles", "base.css"), "utf8");
const layoutStyles = fs.readFileSync(path.join(root, "src", "ui", "styles", "layout-revamp.css"), "utf8");

test("VS Code Seti theme resolves filenames, compound extensions, and languages", () => {
  const fallback = theme.iconForFile("unknown.zzz");
  assert.notDeepEqual(theme.iconForFile("README.md"), fallback);
  assert.notDeepEqual(theme.iconForFile(".gitignore"), fallback);
  assert.notDeepEqual(theme.iconForFile("fetch_passive.ps1"), fallback);
  assert.notDeepEqual(theme.iconForFile("raw.jsonl"), fallback);
  assert.notDeepEqual(theme.iconForFile("component.tsx"), theme.iconForFile("component.ts"));
  assert.notDeepEqual(theme.iconForFile("widget.spec.js"), theme.iconForFile("widget.js"));
});

test("Explorer renders the pinned Seti font theme instead of hand-mapped Codicons", () => {
  assert.match(theme.sourceRef, /^[a-f0-9]{40}$/);
  assert.match(renderer, /SetiIconTheme\.iconForFile\(entry\.name\)/);
  assert.doesNotMatch(renderer, /fileIconInfo\(/);
  assert.match(styles, /@font-face\s*\{[^}]*font-family:\s*"Xekute Seti";[^}]*seti\.woff/);
  assert.match(styles, /\.tree-dir\s*>\s*\.tree-icon\s*\{\s*display:\s*none\s*!important;/);
});

test("file opening and secondary file surfaces no longer call the removed icon helper", () => {
  assert.doesNotMatch(renderer, /fileIconInfo\(/);
  assert.match(renderer, /const info = SetiIconTheme\.iconForFile\(tab\.name\);/);
  assert.match(renderer, /icon\.className = "tab-icon seti-icon";/);
  assert.match(renderer, /icon:\s*sourceIcons\[row\.source\]\s*\|\|\s*"codicon-file"/);
});

test("project header omits Settings and editor tabs display their file icons", () => {
  assert.doesNotMatch(html, /id="btn-project-settings"/);
  assert.doesNotMatch(renderer, /btnProjectSettings/);
  assert.match(layoutStyles, /\.editor-tab \.tab-icon\s*\{[^}]*display:\s*inline-flex\s*!important;[^}]*width:\s*16px;/);
  assert.match(renderer, /const info = SetiIconTheme\.iconForFile\(tab\.name\);[\s\S]*?icon\.className = "tab-icon seti-icon";/);
});
