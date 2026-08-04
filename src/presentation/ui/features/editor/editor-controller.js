/* Monaco-backed workspace editor. Monaco is the editor core used by VS Code. */

(function exposeXekuteEditor(globalScope) {
  const models = new Map();
  const decorations = new Map();
  let editor = null;
  let activePath = "";
  let changeHandler = () => {};
  let saveHandler = () => {};
  let cursorHandler = () => {};
  let suppressChanges = false;
  let wordWrapEnabled = globalScope.localStorage?.getItem("xekute.editorWordWrap") === "true";
  let minimapEnabled = globalScope.localStorage?.getItem("xekute.editorMinimap") === "true";

  const languageByExtension = Object.freeze({
    bat: "bat", c: "c", cc: "cpp", cfg: "ini", conf: "ini", cpp: "cpp", cs: "csharp",
    css: "css", cxx: "cpp", dockerfile: "dockerfile", env: "ini", go: "go", graphql: "graphql",
    h: "c", hpp: "cpp", htm: "html", html: "html", ini: "ini", java: "java", js: "javascript",
    json: "json", jsonl: "json", jsx: "javascript", less: "less", lua: "lua", md: "markdown",
    mjs: "javascript", php: "php", ps1: "powershell", py: "python", pyw: "python", rb: "ruby",
    rs: "rust", scss: "scss", sh: "shell", sql: "sql", svg: "xml", toml: "ini", ts: "typescript",
    tsx: "typescript", txt: "plaintext", xml: "xml", yaml: "yaml", yml: "yaml",
  });

  function languageFor(name = "") {
    const base = String(name).split(/[\\/]/).pop().toLowerCase();
    if (base === "dockerfile") return "dockerfile";
    const extension = base.includes(".") ? base.split(".").pop() : "";
    return languageByExtension[extension] || "plaintext";
  }

  function modelUri(path) {
    const safePath = String(path || "untitled").replace(/\\/g, "/").replace(/^\/+/, "");
    return globalScope.monaco.Uri.parse(`xekute://workspace/${encodeURI(safePath)}`);
  }

  function configureWorkers() {
    globalScope.MonacoEnvironment = {
      getWorkerUrl() {
        return new URL("../../../node_modules/monaco-editor/min/vs/base/worker/workerMain.js", globalScope.location.href).href;
      },
    };
  }

  const ready = new Promise((resolve, reject) => {
    if (typeof globalScope.require !== "function") {
      // Loader did not run (blocked/omitted). Inject it from the page-relative
      // node_modules path so Monaco loads regardless of script-tag timing.
      const script = globalScope.document.createElement("script");
      script.src = new URL("../../../node_modules/monaco-editor/min/vs/loader.js", globalScope.location.href).href;
      script.onload = () => {
        if (typeof globalScope.require === "function") {
          bootEditor(resolve, reject);
        } else {
          reject(new Error("Monaco loader is unavailable."));
        }
      };
      script.onerror = () => reject(new Error("Monaco loader is unavailable."));
      globalScope.document.head.appendChild(script);
      return;
    }
    bootEditor(resolve, reject);
  });

  function bootEditor(resolve, reject) {
    if (typeof globalScope.require !== "function") {
      reject(new Error("Monaco loader is unavailable."));
      return;
    }
    configureWorkers();
    // The AMD `vs` path resolves against the document base (the page
    // directory), so from src/presentation/ui/ it is ../../../node_modules.
    globalScope.require.config({ paths: { vs: "../../../node_modules/monaco-editor/min/vs" } });
    globalScope.require(["vs/editor/editor.main"], () => {
      const container = document.getElementById("monaco-container");
      if (!container) {
        reject(new Error("Editor container is unavailable."));
        return;
      }

      globalScope.monaco.editor.defineTheme("xekute-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6A9955" },
          { token: "keyword", foreground: "C586C0" },
          { token: "number", foreground: "B5CEA8" },
          { token: "string", foreground: "CE9178" },
          { token: "type", foreground: "4EC9B0" },
        ],
        colors: {
          "editor.background": "#181818",
          "editor.foreground": "#D4D4D4",
          "editor.lineHighlightBackground": "#202020",
          "editor.selectionBackground": "#264F78",
          "editor.inactiveSelectionBackground": "#3A3D41",
          "editorCursor.foreground": "#AEAFAD",
          "editorLineNumber.foreground": "#858585",
          "editorLineNumber.activeForeground": "#C6C6C6",
          "editorIndentGuide.background1": "#404040",
          "editorIndentGuide.activeBackground1": "#707070",
          "editorGutter.background": "#181818",
          "editorWidget.background": "#252526",
          "editorWidget.border": "#454545",
          "editorSuggestWidget.background": "#252526",
          "editorSuggestWidget.border": "#454545",
          "editorSuggestWidget.selectedBackground": "#04395E",
          "minimap.background": "#181818",
          "scrollbarSlider.background": "#79797966",
          "scrollbarSlider.hoverBackground": "#646464B3",
        },
      });

      editor = globalScope.monaco.editor.create(container, {
        theme: "xekute-dark",
        automaticLayout: true,
        fontFamily: "Consolas, 'Cascadia Code', monospace",
        fontSize: 13,
        lineHeight: 20,
        fontLigatures: true,
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: true,
        lineNumbers: "on",
        glyphMargin: true,
        folding: true,
        foldingHighlight: true,
        showFoldingControls: "mouseover",
        bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
        guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
        minimap: { enabled: minimapEnabled, showSlider: "mouseover", scale: 1 },
        stickyScroll: { enabled: true },
        renderWhitespace: "selection",
        renderControlCharacters: true,
        renderLineHighlight: "all",
        roundedSelection: false,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        cursorBlinking: "smooth",
        mouseWheelZoom: true,
        wordWrap: wordWrapEnabled ? "on" : "off",
        scrollBeyondLastLine: false,
        padding: { top: 8, bottom: 8 },
        contextmenu: true,
        quickSuggestions: { other: true, comments: false, strings: true },
        suggestOnTriggerCharacters: true,
        formatOnPaste: false,
        formatOnType: false,
        accessibilitySupport: "auto",
      });

      editor.onDidChangeModelContent(() => {
        if (!suppressChanges && activePath) changeHandler(activePath);
      });
      editor.onDidChangeCursorPosition((event) => cursorHandler(event.position));
      editor.addCommand(globalScope.monaco.KeyMod.CtrlCmd | globalScope.monaco.KeyCode.KeyS, () => saveHandler());
      resolve(editor);
    }, (error) => {
      // Monaco reports AMD load failures as Event objects in Chromium. Normalize
      // them here so the editor surface never renders the unhelpful "[object Event]".
      const message = error?.message || error?.type || "Monaco failed to load.";
      reject(error instanceof Error ? error : new Error(message));
    });
  }

  async function ensureModel(path, name, value = "") {
    await ready;
    if (models.has(path)) return models.get(path);
    const model = globalScope.monaco.editor.createModel(String(value), languageFor(name), modelUri(path));
    models.set(path, model);
    return model;
  }

  function changedLineDecorations(before = "", after = "") {
    if (before === after) return [];
    const oldLines = String(before).split("\n");
    const newLines = String(after).split("\n");
    let start = 0;
    while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
    let oldEnd = oldLines.length - 1;
    let newEnd = newLines.length - 1;
    while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
      oldEnd -= 1;
      newEnd -= 1;
    }
    const className = oldEnd < start ? "pointer-line-added" : "pointer-line-changed";
    return Array.from({ length: Math.max(1, newEnd - start + 1) }, (_, index) => ({
      range: new globalScope.monaco.Range(start + index + 1, 1, start + index + 1, 1),
      options: { isWholeLine: true, className },
    }));
  }

  globalScope.XekuteEditorManager = Object.freeze({
    async showTab(path, name, value = "", { loading = false, focus = true } = {}) {
      const instance = await ready;
      const model = await ensureModel(path, name, value);
      if (model.getValue() !== String(value)) {
        suppressChanges = true;
        model.setValue(String(value));
        suppressChanges = false;
      }
      activePath = path;
      instance.setModel(model);
      instance.updateOptions({ readOnly: Boolean(loading), wordWrap: wordWrapEnabled ? "on" : "off", minimap: { enabled: minimapEnabled } });
      if (focus) instance.focus();
      instance.layout();
    },
    getValue(path = activePath) {
      return models.get(path)?.getValue() ?? "";
    },
    clear() {
      activePath = "";
      editor?.setModel(null);
    },
    focus() { editor?.focus(); },
    layout() { editor?.layout(); },
    toggleWordWrap() {
      wordWrapEnabled = !wordWrapEnabled;
      globalScope.localStorage?.setItem("xekute.editorWordWrap", String(wordWrapEnabled));
      editor?.updateOptions({ wordWrap: wordWrapEnabled ? "on" : "off" });
      editor?.layout();
      return wordWrapEnabled;
    },
    isWordWrapEnabled() { return wordWrapEnabled; },
    toggleMinimap() {
      minimapEnabled = !minimapEnabled;
      globalScope.localStorage?.setItem("xekute.editorMinimap", String(minimapEnabled));
      editor?.updateOptions({ minimap: { enabled: minimapEnabled } });
      editor?.layout();
      return minimapEnabled;
    },
    isMinimapEnabled() { return minimapEnabled; },
    disposeModel(path) {
      decorations.delete(path);
      const model = models.get(path);
      if (model) model.dispose();
      models.delete(path);
      if (activePath === path) activePath = "";
    },
    async showChangeDecorations(path, before, after) {
      await ready;
      const model = models.get(path);
      if (!model) return;
      const previous = decorations.get(path) || [];
      decorations.set(path, model.deltaDecorations(previous, changedLineDecorations(before, after)));
    },
    clearChangeDecorations(path) {
      const model = models.get(path);
      if (!model) return;
      const previous = decorations.get(path) || [];
      decorations.set(path, model.deltaDecorations(previous, []));
    },
    setOnChange(callback) { changeHandler = typeof callback === "function" ? callback : () => {}; },
    setOnSave(callback) { saveHandler = typeof callback === "function" ? callback : () => {}; },
    setOnCursorChange(callback) { cursorHandler = typeof callback === "function" ? callback : () => {}; },
  });
})(globalThis);
