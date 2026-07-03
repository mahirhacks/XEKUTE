/* ── Terminal manager (xterm + node-pty bridge) ── */

const TerminalManager = (() => {
  const $ = (id) => document.getElementById(id);

  const tabsList      = $("terminal-tabs-list");
  const viewport      = $("terminal-viewport");
  const terminalEmpty = $("terminal-empty");
  const btnNew        = $("btn-terminal-new");
  const btnKill       = $("btn-terminal-kill");
  const btnCreate     = $("btn-terminal-create");

  /** @type {Map<string, { id: string, name: string, container: HTMLElement, term: Terminal, fitAddon: FitAddon.FitAddon }>} */
  const sessions = new Map();
  let activeId = null;
  let counter = 0;
  let cwd = null;

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

  function nextName() {
    const base = "powershell";
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
    btnKill.disabled = !has;
  }

  function renderTabsList() {
    tabsList.innerHTML = "";
    for (const session of sessions.values()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "terminal-tab-item" + (session.id === activeId ? " active" : "");
      btn.title = session.name;
      btn.innerHTML = `
        <span class="codicon codicon-terminal"></span>
        <span class="terminal-tab-name">${escapeHtml(session.name)}</span>`;
      btn.addEventListener("click", () => switchTerminal(session.id));
      tabsList.appendChild(btn);
    }
  }

  function switchTerminal(id) {
    if (!sessions.has(id)) return;
    activeId = id;
    for (const session of sessions.values()) {
      session.container.hidden = session.id !== id;
    }
    renderTabsList();
    const session = sessions.get(id);
    requestAnimationFrame(() => fitSession(session));
    session.term.focus();
  }

  function fitSession(session) {
    if (!session) return;
    try {
      session.fitAddon.fit();
      const { cols, rows } = session.term;
      window.api.terminalResize(session.id, cols, rows);
    } catch {
      // viewport not ready
    }
  }

  function fitActive() {
    if (activeId) fitSession(sessions.get(activeId));
  }

  async function createTerminal() {
    const id = `term-${++counter}`;
    const name = nextName();

    const container = document.createElement("div");
    container.className = "terminal-instance";
    container.hidden = true;
    viewport.appendChild(container);

    const term = new Terminal({
      theme: xtermTheme,
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    term.onData((data) => window.api.terminalWrite(id, data));

    const session = { id, name, container, term, fitAddon };
    sessions.set(id, session);

    const result = await window.api.terminalCreate({
      id,
      cwd: cwd || undefined,
    });

    if (result.error) {
      term.writeln(`\x1b[31m${result.error}\x1b[0m`);
    }

    updateEmptyState();
    switchTerminal(id);
    return id;
  }

  async function killTerminal(id) {
    const target = id ?? activeId;
    if (!target || !sessions.has(target)) return;
    await window.api.terminalKill(target);
    removeSession(target);
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
    removeSession(id);
  }

  function setCwd(path) {
    cwd = path;
  }

  async function openWithProject(path) {
    cwd = path;
    if (sessions.size === 0) await createTerminal();
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

  btnNew.addEventListener("click", () => createTerminal());
  btnKill.addEventListener("click", () => killTerminal());
  btnCreate.addEventListener("click", () => createTerminal());

  window.addEventListener("resize", () => fitActive());

  return {
    createTerminal,
    killTerminal,
    fitActive,
    openWithProject,
    setCwd,
  };
})();
