"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
const editor = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "features", "editor", "editor-controller.js"), "utf8");
const failureMemory = fs.readFileSync(path.join(__dirname, "..", "src", "agent", "memory", "failure-memory.js"), "utf8");
const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
const styles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");

test("workspace files open in the Monaco-powered center editor", () => {
  assert.match(html, /monaco-editor\/min\/vs\/loader\.js/);
assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "ui", "core", "runtime-modules.js"), "utf8"), /features\/editor\/editor-controller\.js/);
  assert.doesNotMatch(html, /id="editor-(?:tab-bar|body)" class="ide-internal"/);
  assert.match(html, /id="markdown-preview" class="markdown-file-preview assistant-reply"/);
  assert.match(renderer, /const EditorManager = globalThis\.XekuteEditorManager/);
  assert.match(renderer, /const TerminalManager = globalThis\.XekuteTerminalManager/);
  assert.match(renderer, /path: SETTINGS_TAB_PATH[\s\S]*?preview: false[\s\S]*?special: "settings"/);
  assert.match(renderer, /path: INTERCEPTOR_TAB_PATH[\s\S]*?preview: false[\s\S]*?special: "interceptor"/);
  assert.match(renderer, /path: APPLICATION_GRAPH_TAB_PATH[\s\S]*?preview: false[\s\S]*?special: "application-graph"/);
  assert.match(renderer, /function showSecurityWorkspace\(tool = ""\) \{\s*openInterceptorTab\(tool\);/);
  assert.match(renderer, /if \(!activeTab \|\| isSettingsTab\(activeTab\) \|\| isInterceptorTab\(activeTab\) \|\| isApplicationGraphTab\(activeTab\)\) \{[\s\S]*?editorPathBar\.hidden = true;/);
  assert.match(renderer, /const specialWorkspaceTab = isSettingsTab\(tab\) \|\| isInterceptorTab\(tab\) \|\| isApplicationGraphTab\(tab\);[\s\S]*?el\.title = specialWorkspaceTab[\s\S]*?\? tab\.name/);
  assert.match(renderer, /if \(editorBody\) editorBody\.hidden = true;\s*updateEditorPathBar\(\);/);
  assert.match(renderer, /if \(isInterceptorTab\(activeTab\)\) \{[\s\S]*?showSecurityWorkspaceContent\(activeTab\.securityTool \|\| ""\);/);
  assert.match(renderer, /if \(isApplicationGraphTab\(activeTab\)\) \{[\s\S]*?await showMapWorkspace\(\);/);
  assert.match(renderer, /async function openFile\(filePath, fileName, \{ focusEditor = true, preview = false \} = \{\}\) \{[\s\S]*?showCodeEditorWorkspace\(\)/);
  assert.match(renderer, /item\.addEventListener\("click"[\s\S]*?selectItem\(item, \{ ctrlKey: e\.ctrlKey, metaKey: e\.metaKey, shiftKey: e\.shiftKey \}\)[\s\S]*?openFile\(entry\.path, entry\.name, \{ focusEditor: false, preview: true \}\)/);
  assert.match(renderer, /item\.addEventListener\("dblclick"[\s\S]*?selectItem\(item\)[\s\S]*?await openFile\(entry\.path, entry\.name, \{ focusEditor: true, preview: false \}\)/);
  assert.match(renderer, /function discardCleanPreviewTabs\(exceptPath = ""\)/);
  assert.match(renderer, /function reorderOpenTabs\(draggedPath, targetPath, \{ after = false \} = \{\}\)/);
  assert.match(renderer, /openTabs\.clear\(\);\s*entries\.forEach\(\(\[path, tab\]\) => openTabs\.set\(path, tab\)\);/);
  assert.match(renderer, /el\.draggable = true;[\s\S]*?el\.addEventListener\("dragstart"[\s\S]*?el\.addEventListener\("drop"/);
  assert.match(renderer, /preview: Boolean\(preview\)/);
  assert.match(renderer, /tab\.preview = false/);
  assert.match(renderer, /key === "s" && activeTabPath[\s\S]*?await saveActiveTab\(\)/);
  assert.match(styles, /\.editor-tab\.preview \.tab-label \{ font-style: italic; \}/);
  assert.match(styles, /\.editor-tab\.tab-dragging \{[\s\S]*?opacity: \.52;/);
  assert.match(styles, /\.editor-tab\.tab-drop-before \{[\s\S]*?box-shadow: inset 2px 0 0 var\(--accent\);/);
  assert.match(styles, /\.editor-tab\.tab-drop-after \{[\s\S]*?box-shadow: inset -2px 0 0 var\(--accent\);/);
  assert.match(renderer, /function isMarkdownFileName\(fileName = ""\)/);
  assert.match(renderer, /button\.dataset\.markdownView = mode/);
  assert.match(renderer, /markdownViewMode === "md"/);
  assert.match(renderer, /if \(isMarkdownFileName\(tab\.name\) && markdownViewMode === "md"\) return;/);
  assert.match(renderer, /renderMarkdown\(markdownPreview, text\)/);
  assert.match(styles, /#editor-tab-bar\[hidden\],[\s\S]*?#editor-body\[hidden\]\s*\{\s*display: none !important/);
});

test("editor provides VS Code-style models, syntax languages, tabs, cursor events, and saving", () => {
  assert.match(failureMemory, /const canUseCommonJs = typeof module !== "undefined"/);
  assert.match(editor, /new URL\("\.\.\/\.\.\/node_modules\/monaco-editor\/min\/vs\/loader\.js"/);
  assert.match(editor, /paths: \{ vs: "\.\.\/\.\.\/node_modules\/monaco-editor\/min\/vs" \}/);
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
  assert.match(renderer, /function canonicalApplyPatchFileStates\(tool, result\)[\s\S]*?result\?\.value\?\.changes/);
  assert.match(renderer, /async function syncCanonicalApplyPatchToEditor\(tool, result\)[\s\S]*?window\.api\.readFile\(absolutePath\)/);
  assert.match(renderer, /\{ openIfMissing: false, preserveDirty: true \}/);
  assert.match(renderer, /const canonicalPatchSynced = await syncCanonicalApplyPatchToEditor\(tool, result\);/);
  assert.match(renderer, /if \(preserveDirty && tab\.dirty\) \{[\s\S]*?tab\.savedContent = newContent;[\s\S]*?preservedDirty: tab\.dirty/);
});

test("Project activity icon only toggles the file-tree sidebar", () => {
  const start = renderer.indexOf('activityBugBounty?.addEventListener("click"');
  const end = renderer.indexOf('activitySecurity?.addEventListener', start);
  const handler = renderer.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /if \(sidebarCollapsed\) \{[\s\S]*?setSidebarView\("project"\);[\s\S]*?setSidebarCollapsed\(false\);/);
  assert.match(handler, /setSidebarCollapsed\(true\);/);
  assert.doesNotMatch(handler, /showResourceWorkspace|showSecurityWorkspace|openSettingsTab/);
});

test("workspace context menu renames files and folders without discarding open editor state", () => {
  assert.match(html, /data-workspace-context-action="cut"[\s\S]*?codicon-move[\s\S]*?<span>Cut<\/span>/);
  assert.doesNotMatch(html, /codicon-cut/);
  assert.match(html, /data-workspace-context-action="rename"[\s\S]*?<span>Rename<\/span>/);
  assert.match(renderer, /setHidden\("rename", !target \|\| multiple\)/);
  assert.match(renderer, /async function renameWorkspaceContextTarget\(target\)/);
  assert.match(renderer, /window\.api\.movePath\(\{[\s\S]*?source: target\.relativePath,[\s\S]*?destination/);
  assert.match(renderer, /function remapOpenTabsUnderWorkspacePath\(sourceAbsolute, destinationAbsolute\)/);
  assert.match(renderer, /tab\.path = nextPath;[\s\S]*?tab\.diskPath = nextPath/);
  assert.match(renderer, /if \(action === "rename"\)/);
});
