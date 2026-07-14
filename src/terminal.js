/* ── Terminal manager (xterm + node-pty bridge) ── */

const TerminalManager = (() => {
  const $ = (id) => document.getElementById(id);

  const tabsList      = $("terminal-tabs-list");
  const viewport      = $("terminal-viewport");
  const terminalEmpty = $("terminal-empty");
  const btnNew        = $("btn-terminal-new");
  const btnClear      = $("btn-terminal-clear");
  const btnKill       = $("btn-terminal-kill");
  const activeSessionButton = $("terminal-active-session");
  const activeSessionName = $("terminal-active-name");

  /** @type {Map<string, { id: string, name: string, container: HTMLElement, term: Terminal, fitAddon: FitAddon.FitAddon, exited: boolean, lastCols: number, lastRows: number }>} */
  const sessions = new Map();
  let activeId = null;
  let counter = 0;
  let cwd = null;
  let fitAnimationFrame = 0;
  let ensurePromise = null;

  const xtermTheme = {
    background: "#1e1e1e",
    foreground: "#cccccc",
    cursor: "#cccccc",
    cursorAccent: "#1e1e1e",
    selectionBackground: "#264f78",
    black: "#000000",
    red: "#cd3131",
    green: "#0dbc79",
    yellow: "#e5e510",
    blue: "#2472c8",
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: "#e5e5e5",
    brightBlack: "#666666",
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: "#3b8eea",
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#e5e5e5",
  };

  function nextName(base = "terminal") {
    const existing = [...sessions.values()].map((s) => s.name);
    if (!existing.includes(base)) return base;
    let i = 2;
    while (existing.includes(`${base} (${i})`)) i++;
    return `${base} (${i})`;
  }

  function updateEmptyState() {
    const has = sessions.size > 0;
    terminalEmpty.hidden = has;
    tabsList.hidden = sessions.size <= 1;
    tabsList.classList.toggle("visible", sessions.size > 1);
    btnClear.disabled = !has;
    btnKill.disabled = !has;
    updateActiveSessionUi();
    globalThis.onTerminalSessionStateChange?.({ count: sessions.size, activeId });
  }

  function updateActiveSessionUi() {
    const session = activeId ? sessions.get(activeId) : null;
    if (activeSessionButton) {
      activeSessionButton.disabled = !session;
      activeSessionButton.title = session
        ? `${session.name}${session.exited ? " (exited)" : ""} - click to switch terminal`
        : "No active terminal";
    }
    if (activeSessionName) {
      activeSessionName.textContent = session?.name || "Terminal";
    }
  }

  function renderTabsList() {
    tabsList.innerHTML = "";
    for (const session of sessions.values()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = [
        "terminal-tab-item",
        session.id === activeId ? "active" : "",
        session.exited ? "exited" : "",
      ].filter(Boolean).join(" ");
      btn.title = session.exited ? `${session.name} (exited)` : session.name;
      btn.innerHTML = `
        <span class="codicon codicon-terminal"></span>
        <span class="terminal-tab-name">${escapeHtml(session.name)}</span>
        <span class="terminal-tab-status">${session.exited ? "exited" : ""}</span>
        <span class="codicon codicon-close terminal-tab-close" title="Close"></span>`;
      btn.addEventListener("click", () => switchTerminal(session.id));
      btn.querySelector(".terminal-tab-close")?.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTerminal(session.id);
      });
      tabsList.appendChild(btn);
    }
    updateActiveSessionUi();
  }

  function switchTerminal(id) {
    if (!sessions.has(id)) return;
    activeId = id;
    for (const session of sessions.values()) {
      session.container.hidden = session.id !== id;
    }
    renderTabsList();
    requestAnimationFrame(() => {
      fitSession(sessions.get(id));
      sessions.get(id)?.term.focus();
    });
  }

  function fitSession(session) {
    if (!session || session.container.hidden) return;
    try {
      session.fitAddon.fit();
      const { cols, rows } = session.term;
      if (cols > 0 && rows > 0 && (cols !== session.lastCols || rows !== session.lastRows)) {
        session.lastCols = cols;
        session.lastRows = rows;
        window.api.terminalResize(session.id, cols, rows);
      }
    } catch {
      // viewport not ready
    }
  }

  function fitActive() {
    if (!activeId || fitAnimationFrame) return;
    fitAnimationFrame = requestAnimationFrame(() => {
      fitAnimationFrame = 0;
      if (activeId) fitSession(sessions.get(activeId));
    });
  }

  function focusActive() {
    if (!activeId) return;
    globalThis.expandTerminalPanel?.();
    requestAnimationFrame(() => {
      fitActive();
      sessions.get(activeId)?.term.focus();
    });
  }

  function switchAdjacentTerminal(delta) {
    if (!activeId || sessions.size < 2) return;
    const ids = [...sessions.keys()];
    const current = ids.indexOf(activeId);
    const next = ids[(current + delta + ids.length) % ids.length];
    switchTerminal(next);
  }

  async function createTerminal() {
    if (!window.api?.terminalCreate) {
      showTerminalError("Terminal API unavailable — restart the app.");
      return null;
    }
    if (typeof globalThis.Terminal !== "function") {
      showTerminalError("xterm failed to load. Check the console for script errors.");
      return null;
    }

    try {
      const id = `term-${++counter}`;
      const name = nextName();

      const container = document.createElement("div");
      container.className = "terminal-instance";
      container.hidden = true;
      viewport.appendChild(container);

      const FitCtor = globalThis.FitAddon?.FitAddon ?? globalThis.FitAddon;
      if (typeof FitCtor !== "function") {
        showTerminalError("xterm fit addon failed to load.");
        container.remove();
        return null;
      }

      const term = new globalThis.Terminal({
        theme: xtermTheme,
        fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
        fontSize: 14,
        lineHeight: 1.15,
        letterSpacing: 0,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        convertEol: true,
        minimumContrastRatio: 1,
        allowProposedApi: false,
      });

      const fitAddon = new FitCtor();
      term.loadAddon(fitAddon);
      term.open(container);

      term.onData((data) => {
        window.api.terminalWrite(id, data);
      });

      term.attachCustomKeyEventHandler((event) => {
        const key = event.key.toLowerCase();
        const mod = event.ctrlKey || event.metaKey;

        if (event.type === "keydown" && mod && key === "`") {
          if (event.shiftKey) {
            createTerminalAndShow();
          } else {
            const opened = globalThis.toggleTerminalPanel?.() ?? true;
            if (opened) focusActive();
          }
          return false;
        }

        if (event.type === "keydown" && event.altKey && (key === "arrowleft" || key === "arrowright")) {
          switchAdjacentTerminal(key === "arrowright" ? 1 : -1);
          return false;
        }

        if (event.type === "keydown" && mod && key === "c" && term.hasSelection()) {
          navigator.clipboard?.writeText(term.getSelection());
          return false;
        }

        if (event.type === "keydown" && mod && key === "v") {
          navigator.clipboard?.readText()
            .then((text) => {
              if (text) window.api.terminalWrite(id, text);
            })
            .catch(() => {});
          return false;
        }

        return true;
      });

      const session = { id, name, container, term, fitAddon, exited: false, lastCols: 0, lastRows: 0 };
      sessions.set(id, session);

      const result = await window.api.terminalCreate({
        id,
        cwd: cwd || undefined,
      });

      if (result?.error) {
        term.writeln(`\x1b[31m${result.error}\x1b[0m`);
      } else if (result?.shell) {
        session.name = nextName(result.shell);
      }

      clearTerminalError();
      updateEmptyState();
      switchTerminal(id);

      requestAnimationFrame(() => {
        fitSession(session);
        session.term.focus();
      });

      return id;
    } catch (err) {
      console.error("createTerminal failed:", err);
      showTerminalError(err.message || "Failed to create terminal");
      return null;
    }
  }

  function showTerminalError(message) {
    if (!terminalEmpty) return;
    terminalEmpty.hidden = false;
    terminalEmpty.innerHTML = `
      <div class="terminal-error">
        <span class="codicon codicon-error"></span>
        <span>${escapeHtml(message)}</span>
        <button type="button" id="btn-terminal-create" class="terminal-create-btn">
          <span class="codicon codicon-terminal"></span>
          Retry
        </button>
      </div>`;
    terminalEmpty.querySelector("#btn-terminal-create")
      ?.addEventListener("click", () => createTerminalAndShow());
  }

  function clearTerminalError() {
    if (!terminalEmpty || sessions.size > 0) return;
    terminalEmpty.innerHTML = `
      <button type="button" id="btn-terminal-create" class="terminal-create-btn">
        <span class="codicon codicon-terminal"></span>
        Create Terminal
      </button>`;
    terminalEmpty.querySelector("#btn-terminal-create")
      ?.addEventListener("click", () => createTerminalAndShow());
  }

  async function createTerminalAndShow() {
    globalThis.expandTerminalPanel?.({ createIfMissing: false });
    return createTerminal();
  }

  function hasSessions() {
    return sessions.size > 0;
  }

  async function ensureTerminal() {
    if (sessions.size > 0) return activeId;
    if (!ensurePromise) {
      ensurePromise = createTerminal().finally(() => { ensurePromise = null; });
    }
    return ensurePromise;
  }

  async function runCommand(command) {
    const text = String(command || "").trim();
    if (!text) return false;
    globalThis.expandTerminalPanel?.({ createIfMissing: false });
    if (!activeId || !sessions.has(activeId) || sessions.get(activeId)?.exited) {
      await createTerminal();
    }
    const session = activeId ? sessions.get(activeId) : null;
    if (!session || session.exited) return false;
    session.term.focus();
    window.api.terminalWrite(session.id, `${text}\r`);
    return true;
  }

  async function killTerminal(id) {
    const target = id ?? activeId;
    if (!target || !sessions.has(target)) return;
    const session = sessions.get(target);
    if (session?.exited) {
      removeSession(target);
      return;
    }
    await window.api.terminalKill(target);
    removeSession(target);
  }

  function clearActive() {
    const session = activeId ? sessions.get(activeId) : null;
    if (!session) return;
    session.term.clear();
    session.term.focus();
  }

  function closeTerminal(id) {
    killTerminal(id);
  }

  function removeSession(id) {
    if (!sessions.has(id)) return;
    const session = sessions.get(id);
    session.term.dispose();
    session.container.remove();
    sessions.delete(id);

    if (activeId === id) {
      activeId = sessions.size ? [...sessions.keys()][0] : null;
      if (activeId) switchTerminal(activeId);
    }

    renderTabsList();
    updateEmptyState();
  }

  function onData({ id, data }) {
    const session = sessions.get(id);
    if (session) session.term.write(data);
  }

  function onExit({ id }) {
    const session = sessions.get(id);
    if (!session) return;
    session.exited = true;
    session.term.writeln("");
    session.term.writeln("\x1b[33mTerminal process exited. Press the trash icon to close this session.\x1b[0m");
    renderTabsList();
    updateEmptyState();
  }

  function setCwd(path) {
    cwd = path;
  }

  async function openWithProject(path) {
    cwd = path;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  if (window.api) {
    window.api.onTerminalData(onData);
    window.api.onTerminalExit(onExit);
  }

  btnNew?.addEventListener("click", () => {
    globalThis.expandTerminalPanel?.({ createIfMissing: false });
    createTerminal();
  });
  btnClear?.addEventListener("click", () => {
    clearActive();
  });
  btnKill?.addEventListener("click", () => killTerminal());
  activeSessionButton?.addEventListener("click", () => {
    if (sessions.size > 1) switchAdjacentTerminal(1);
    else focusActive();
  });
  viewport?.addEventListener("mousedown", () => focusActive());
  viewport?.addEventListener("wheel", () => focusActive(), { passive: true });
  terminalEmpty?.querySelector("#btn-terminal-create")
    ?.addEventListener("click", () => createTerminalAndShow());

  window.addEventListener("resize", () => fitActive());

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "`") {
      e.preventDefault();
      if (e.shiftKey) {
        createTerminalAndShow();
      } else {
        const opened = globalThis.toggleTerminalPanel?.() ?? true;
        if (opened) focusActive();
      }
      return;
    }

    if (e.altKey && (key === "arrowleft" || key === "arrowright")) {
      switchAdjacentTerminal(key === "arrowright" ? 1 : -1);
    }
  });

  if (viewport && globalThis.ResizeObserver) {
    const observer = new ResizeObserver(() => fitActive());
    observer.observe(viewport);
  }

  return {
    createTerminal,
    createTerminalAndShow,
    killTerminal,
    clearActive,
    focusActive,
    fitActive,
    runCommand,
    hasSessions,
    ensureTerminal,
    openWithProject,
    setCwd,
  };
})();
