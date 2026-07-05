/* ── Monaco editor (VS Code / Cursor syntax highlighting) ── */

function monacoWorkerHref(subpath) {
  return new URL(subpath, new URL("../node_modules/monaco-editor/min/vs/", window.location.href)).href;
}

window.MonacoEnvironment = {
  getWorkerUrl(_workerId, label) {
    if (label === "json") return monacoWorkerHref("language/json/json.worker.js");
    if (label === "css" || label === "scss" || label === "less") {
      return monacoWorkerHref("language/css/css.worker.js");
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return monacoWorkerHref("language/html/html.worker.js");
    }
    if (label === "typescript" || label === "javascript" || label === "javascriptreact") {
      return monacoWorkerHref("language/typescript/ts.worker.js");
    }
    return monacoWorkerHref("editor/editor.worker.js");
  },
};

const EditorManager = (() => {
  const container = document.getElementById("monaco-container");
  let editor = null;
  let monacoReady = null;
  let activePath = null;
  let onChangeCb = null;
  let onSaveCb = null;
  let onCursorCb = null;

  /** @type {Map<string, monaco.editor.ITextModel>} */
  const models = new Map();
  const changeDecorations = new Map();

  function languageForFile(name) {
    const ext = name.split(".").pop().toLowerCase();
    const map = {
      js: "javascript", mjs: "javascript", cjs: "javascript",
      jsx: "javascript", ts: "typescript", tsx: "typescript",
      json: "json", jsonc: "json",
      md: "markdown", mdx: "markdown",
      css: "css", scss: "scss", less: "less",
      html: "html", htm: "html", vue: "html", svelte: "html",
      py: "python", pyw: "python",
      rs: "rust", go: "go", rb: "ruby",
      sh: "shell", bash: "shell", zsh: "shell",
      yml: "yaml", yaml: "yaml",
      toml: "toml", xml: "xml", sql: "sql",
      java: "java", c: "c", cpp: "cpp", h: "c", hpp: "cpp",
      cs: "csharp", php: "php", swift: "swift", kt: "kotlin",
      dockerfile: "dockerfile", ini: "ini", env: "ini",
      gitignore: "plaintext", lock: "json",
    };
    return map[ext] ?? "plaintext";
  }

  function defineTheme() {
    monaco.editor.defineTheme("pointer-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "keyword", foreground: "569cd6" },
        { token: "string", foreground: "ce9178" },
        { token: "number", foreground: "b5cea8" },
        { token: "regexp", foreground: "d16969" },
        { token: "type", foreground: "4ec9b0" },
        { token: "class", foreground: "4ec9b0" },
        { token: "interface", foreground: "4ec9b0" },
        { token: "function", foreground: "dcdcaa" },
        { token: "variable", foreground: "9cdcfe" },
        { token: "constant", foreground: "4fc1ff" },
        { token: "tag", foreground: "569cd6" },
        { token: "attribute.name", foreground: "9cdcfe" },
        { token: "attribute.value", foreground: "ce9178" },
      ],
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#d4d4d4",
        "editorLineNumber.foreground": "#858585",
        "editorLineNumber.activeForeground": "#c6c6c6",
        "editor.selectionBackground": "#264f78",
        "editor.inactiveSelectionBackground": "#3a3d41",
        "editor.lineHighlightBackground": "#2a2d2e",
        "editor.lineHighlightBorder": "#2a2d2e",
        "editorCursor.foreground": "#aeafad",
        "editorWhitespace.foreground": "#3b3b3b",
        "editorIndentGuide.background": "#404040",
        "editorIndentGuide.activeBackground": "#707070",
        "editorGutter.background": "#1e1e1e",
        "minimap.background": "#1e1e1e",
        "scrollbarSlider.background": "#79797966",
        "scrollbarSlider.hoverBackground": "#646464b3",
        "scrollbarSlider.activeBackground": "#bfbfbf66",
      },
    });
  }

  function initMonaco() {
    if (monacoReady) return monacoReady;
    monacoReady = new Promise((resolve, reject) => {
      if (typeof require === "undefined") {
        reject(new Error("Monaco loader not available"));
        return;
      }
      require.config({ paths: { vs: window.api.monacoVsPath } });
      require(["vs/editor/editor.main"], () => {
        defineTheme();
        monaco.editor.setTheme("pointer-dark");
        resolve(monaco);
      }, reject);
    });
    return monacoReady;
  }

  async function ensureEditor() {
    await initMonaco();
    if (!editor) {
      editor = monaco.editor.create(container, {
        theme: "pointer-dark",
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "Consolas, 'Courier New', monospace",
        lineHeight: 19,
        minimap: { enabled: true, scale: 1 },
        glyphMargin: true,
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        padding: { top: 8 },
        wordWrap: "off",
        tabSize: 4,
        insertSpaces: true,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10,
        },
      });

      editor.onDidChangeModelContent(() => {
        if (onChangeCb && activePath) onChangeCb(activePath);
      });

      editor.onDidChangeCursorPosition((e) => {
        if (onCursorCb) onCursorCb(e.position);
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        if (onSaveCb) onSaveCb();
      });
    }
    return editor;
  }

  function modelUri(filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    return monaco.Uri.parse(`file:///${normalized.replace(/^\//, "")}`);
  }

  function getOrCreateModel(filePath, fileName, content) {
    if (models.has(filePath)) {
      return models.get(filePath);
    }
    const model = monaco.editor.createModel(
      content ?? "",
      languageForFile(fileName),
      modelUri(filePath),
    );
    models.set(filePath, model);
    return model;
  }

  async function showTab(filePath, fileName, content, { loading = false } = {}) {
    await ensureEditor();
    activePath = filePath;

    if (loading) {
      editor.setModel(null);
      return;
    }

    let model = models.get(filePath);
    if (!model) {
      model = getOrCreateModel(filePath, fileName, content ?? "");
    } else if (model.getValue() !== content) {
      model.setValue(content ?? "");
    }

    monaco.editor.setModelLanguage(model, languageForFile(fileName));
    editor.setModel(model);
    editor.focus();
    const pos = editor.getPosition();
    if (pos && onCursorCb) onCursorCb(pos);
  }

  function getValue(filePath) {
    const path = filePath ?? activePath;
    const model = models.get(path);
    return model ? model.getValue() : "";
  }

  function changedRanges(before, after) {
    const oldLines = String(before ?? "").split(/\r?\n/);
    const newLines = String(after ?? "").split(/\r?\n/);
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
      start += 1;
    }

    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
      oldEnd -= 1;
      newEnd -= 1;
    }

    if (start > oldEnd && start > newEnd) return [];

    const addedStart = Math.min(newLines.length, start + 1);
    const addedEnd = Math.max(addedStart, newEnd + 1);
    const removedCount = Math.max(0, oldEnd - start + 1);
    const addedCount = Math.max(0, newEnd - start + 1);
    return [{ addedStart, addedEnd, addedCount, removedCount }];
  }

  function clearChangeDecorations(filePath = activePath) {
    const path = filePath ?? activePath;
    if (!path || !models.has(path)) return;
    const model = models.get(path);
    const previous = changeDecorations.get(path) || [];
    const next = model.deltaDecorations(previous, []);
    changeDecorations.set(path, next);
  }

  function showChangeDecorations(filePath, before, after) {
    const model = models.get(filePath);
    if (!model || before == null || before === after) {
      clearChangeDecorations(filePath);
      return;
    }

    const decorations = [];
    for (const range of changedRanges(before, after)) {
      if (range.addedCount > 0) {
        decorations.push({
          range: new monaco.Range(range.addedStart, 1, range.addedEnd, 1),
          options: {
            isWholeLine: true,
            className: "pointer-line-added",
            glyphMarginClassName: "pointer-glyph-added",
            overviewRuler: { color: "#2ea043", position: monaco.editor.OverviewRulerLane.Left },
          },
        });
      }
      if (range.removedCount > 0) {
        const line = Math.min(Math.max(1, range.addedStart), Math.max(1, model.getLineCount()));
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: range.addedCount ? "pointer-line-changed" : "pointer-line-removed",
            glyphMarginClassName: "pointer-glyph-removed",
            overviewRuler: { color: "#f85149", position: monaco.editor.OverviewRulerLane.Left },
          },
        });
      }
    }

    const previous = changeDecorations.get(filePath) || [];
    changeDecorations.set(filePath, model.deltaDecorations(previous, decorations));
  }

  function setOnChange(cb) {
    onChangeCb = cb;
  }

  function setOnSave(cb) {
    onSaveCb = cb;
  }

  function setOnCursorChange(cb) {
    onCursorCb = cb;
    if (editor) {
      const pos = editor.getPosition();
      if (pos) cb(pos);
    }
  }

  function disposeModel(filePath) {
    const model = models.get(filePath);
    if (model) {
      if (editor?.getModel() === model) {
        editor.setModel(null);
      }
      model.dispose();
      models.delete(filePath);
    }
    if (activePath === filePath) activePath = null;
    changeDecorations.delete(filePath);
  }

  function clear() {
    if (editor) editor.setModel(null);
    activePath = null;
  }

  function layout() {
    editor?.layout();
  }

  return {
    showTab,
    getValue,
    setOnChange,
    setOnSave,
    setOnCursorChange,
    disposeModel,
    clear,
    clearChangeDecorations,
    showChangeDecorations,
    layout,
  };
})();
