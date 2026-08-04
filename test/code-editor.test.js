"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "index.html"), "utf8");
const editor = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "features", "editor", "editor-controller.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "bootstrap.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "styles", "base.css"), "utf8");

test("workspace files open in the Monaco-powered center editor", () => {
  assert.match(html, /monaco-editor\/min\/vs\/loader\.js/);
assert.match(html, /<script src="features\/editor\/editor-controller\.js"><\/script>/);
  assert.doesNotMatch(html, /id="editor-(?:tab-bar|body)" class="ide-internal"/);
  assert.match(html, /id="markdown-preview" class="markdown-file-preview assistant-reply"/);
  assert.match(renderer, /const EditorManager = globalThis\.XekuteEditorManager/);
  assert.match(renderer, /async function openFile\(filePath, fileName, \{ focusEditor = true, preview = false \} = \{\}\) \{[\s\S]*?showCodeEditorWorkspace\(\)/);
  assert.match(renderer, /item\.addEventListener\("click"[\s\S]*?selectItem\(item\)[\s\S]*?openFile\(entry\.path, entry\.name, \{ focusEditor: false, preview: true \}\)/);
  assert.match(renderer, /item\.addEventListener\("dblclick"[\s\S]*?selectItem\(item\)[\s\S]*?await openFile\(entry\.path, entry\.name, \{ focusEditor: true, preview: false \}\)/);
  assert.match(renderer, /function discardCleanPreviewTabs\(exceptPath = ""\)/);
  assert.match(renderer, /preview: Boolean\(preview\)/);
  assert.match(renderer, /tab\.preview = false/);
  assert.match(renderer, /key === "s" && activeTabPath[\s\S]*?await saveActiveTab\(\)/);
  assert.match(styles, /\.editor-tab\.preview \.tab-label \{ font-style: italic; \}/);
  assert.match(renderer, /function isMarkdownFileName\(fileName = ""\)/);
  assert.match(renderer, /button\.dataset\.markdownView = mode/);
  assert.match(renderer, /markdownViewMode === "md"/);
  assert.match(renderer, /renderMarkdown\(markdownPreview, text\)/);
  assert.match(styles, /#editor-tab-bar\[hidden\],[\s\S]*?#editor-body\[hidden\]\s*\{\s*display: none !important/);
});

test("editor provides VS Code-style models, syntax languages, tabs, cursor events, and saving", () => {
  assert.match(editor, /monaco\.editor\.create\(container/);
  assert.match(editor, /monaco\.editor\.createModel\(String\(value\), languageFor\(name\), modelUri\(path\)\)/);
  for (const language of ["javascript", "typescript", "python", "html", "css", "json", "markdown"]) {
    assert.match(editor, new RegExp(`"${language}"`));
  }
  assert.match(editor, /bracketPairColorization: \{ enabled: true/);
  assert.match(editor, /let minimapEnabled = globalScope\.localStorage\?\.getItem\("xekute\.editorMinimap"\) === "true"/);
  assert.match(editor, /minimap: \{ enabled: minimapEnabled/);
  assert.match(editor, /toggleMinimap\(\)/);
  assert.match(editor, /isMinimapEnabled\(\)/);
  assert.match(editor, /stickyScroll: \{ enabled: true \}/);
  assert.match(editor, /KeyMod\.CtrlCmd \| globalScope\.monaco\.KeyCode\.KeyS/);
  assert.match(editor, /onDidChangeCursorPosition/);
  assert.match(editor, /async showTab\(path, name, value = "", \{ loading = false, focus = true \} = \{\}\)/);
  assert.match(editor, /if \(focus\) instance\.focus\(\)/);
  assert.match(renderer, /const openTabs\s+= new Map\(\)/);
  assert.match(renderer, /tab\.dirty = tab\.content !== tab\.savedContent/);
});
