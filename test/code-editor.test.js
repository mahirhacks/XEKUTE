"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
const editor = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "features", "editor", "editor-controller.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");

test("workspace files open in the Monaco-powered center editor", () => {
  assert.match(html, /monaco-editor\/min\/vs\/loader\.js/);
assert.match(html, /<script src="features\/editor\/editor-controller\.js"><\/script>/);
  assert.doesNotMatch(html, /id="editor-(?:tab-bar|body)" class="ide-internal"/);
  assert.match(renderer, /const EditorManager = globalThis\.XekuteEditorManager/);
  assert.match(renderer, /async function openFile\(filePath, fileName\) \{[\s\S]*?showCodeEditorWorkspace\(\)/);
  assert.match(renderer, /item\.addEventListener\("click"[\s\S]*?await openFile\(entry\.path, entry\.name\)/);
  assert.match(styles, /#editor-tab-bar\[hidden\],[\s\S]*?#editor-body\[hidden\]\s*\{\s*display: none !important/);
});

test("editor provides VS Code-style models, syntax languages, tabs, cursor events, and saving", () => {
  assert.match(editor, /monaco\.editor\.create\(container/);
  assert.match(editor, /monaco\.editor\.createModel\(String\(value\), languageFor\(name\), modelUri\(path\)\)/);
  for (const language of ["javascript", "typescript", "python", "html", "css", "json", "markdown"]) {
    assert.match(editor, new RegExp(`"${language}"`));
  }
  assert.match(editor, /bracketPairColorization: \{ enabled: true/);
  assert.match(editor, /minimap: \{ enabled: true/);
  assert.match(editor, /stickyScroll: \{ enabled: true \}/);
  assert.match(editor, /KeyMod\.CtrlCmd \| globalScope\.monaco\.KeyCode\.KeyS/);
  assert.match(editor, /onDidChangeCursorPosition/);
  assert.match(renderer, /const openTabs\s+= new Map\(\)/);
  assert.match(renderer, /tab\.dirty = tab\.content !== tab\.savedContent/);
});
