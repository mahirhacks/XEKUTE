/* ── Terminal manager (xterm + node-pty bridge) ── */

const TerminalManager = (() => {
  const $ = (id) => document.getElementById(id);

  const tabsList      = $("terminal-tabs-list");
  const tabsResize    = $("terminal-tabs-resize");
  const terminalBody  = $("terminal-body");
  const viewport      = $("terminal-viewport");
  const terminalEmpty = $("terminal-empty");
  const btnNew        = $("btn-terminal-new");
  const btnNewMenu    = $("btn-terminal-new-menu");
  const btnSplit      = $("btn-terminal-split");
  const btnClear      = $("btn-terminal-clear");
  const btnKill       = $("btn-terminal-kill");
  const btnMore       = $("btn-terminal-more");
  const activeSessionButton = $("terminal-active-session");
  const activeSessionName = $("terminal-active-name");
  const sessionMenu = $("terminal-session-menu");
  const moreMenu = $("terminal-more-menu");

  /** @type {Map<string, { id: string, name: string, profileId: string, groupId: string, container: HTMLElement, term: Terminal, fitAddon: FitAddon.FitAddon, exited: boolean, lastCols: number, lastRows: number }>} */
  const sessions = new Map();
  let activeId = null;
  let panelOpen = true;
  let counter = 0;
  let cwd = null;
  let fitAnimationFrame = 0;
  let ensurePromise = null;
  let shellProfiles = [];

  const xtermTheme = {
    background: "#121212",
    foreground: "#cccccc",
    cursor: "#cccccc",
    cursorAccent: "#121212",
    selectionBackground: "#3b3b3b",
    selectionInactiveBackground: "#303030",
    scrollbarSliderBackground: "transparent",
    scrollbarSliderHoverBackground: "transparent",
    scrollbarSliderActiveBackground: "transparent",
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

  // Dense Windows-terminal stack. Cascadia is the WT/VS Code face; Consolas
  // and Courier New stay as fallbacks so cells never drop to the UI sans-serif.
  const xtermFontFamily = `"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace`;

  function xtermOptions({ cursorBlink = true } = {}) {
    return {
      theme: xtermTheme,
      fontFamily: xtermFontFamily,
      fontSize: 12,
      fontWeight: "400",
      fontWeightBold: "700",
      lineHeight: 1,
      letterSpacing: 0,
      cursorBlink,
      cursorStyle: "block",
      scrollback: 5000,
      convertEol: true,
      minimumContrastRatio: 1,
      allowProposedApi: false,
    };
  }

  function nextName(base = "terminal") {
    const existing = [...sessions.values()].map((s) => s.name);
    if (!existing.includes(base)) return base;
    let i = 2;
    while (existing.includes(`${base} (${i})`)) i++;
    return `${base} (${i})`;
  }

  const TABS_MIN_RATIO = 0.02;
  const TABS_MAX_RATIO = 0.30;
  const TABS_DEFAULT_PX = 140;
  const TABS_COMPACT_PX = 72;
  let tabsWidthRatio = null;
  let tabsResizeFrame = 0;

  function tabsHostWidth() {
    return terminalBody?.clientWidth || tabsList?.parentElement?.clientWidth || 0;
  }

  function tabsWidthBounds() {
    const width = tabsHostWidth();
    return {
      width,
      min: Math.max(1, Math.round(width * TABS_MIN_RATIO)),
      max: Math.max(1, Math.round(width * TABS_MAX_RATIO)),
    };
  }

  function preferredTabsWidth() {
    const { width, min, max } = tabsWidthBounds();
    if (!width) return TABS_DEFAULT_PX;
    const raw = tabsWidthRatio == null ? TABS_DEFAULT_PX : width * tabsWidthRatio;
    return Math.max(min, Math.min(max, Math.round(raw)));
  }

  function setTabsCompact(widthPx) {
    tabsList?.classList.toggle("compact", widthPx < TABS_COMPACT_PX);
  }

  function applyTabsWidth(px, { persist = true } = {}) {
    if (!tabsList) return 0;
    const { width, min, max } = tabsWidthBounds();
    const next = Math.max(min, Math.min(max, Math.round(Number(px) || TABS_DEFAULT_PX)));
    if (persist && width) tabsWidthRatio = next / width;
    tabsList.style.width = `${next}px`;
    tabsList.style.flex = `0 0 ${next}px`;
    setTabsCompact(next);
    if (tabsResize) {
      tabsResize.setAttribute("aria-valuemin", String(min));
      tabsResize.setAttribute("aria-valuemax", String(max));
      tabsResize.setAttribute("aria-valuenow", String(next));
    }
    return next;
  }

  function syncTabsWidth() {
    if (!tabsList?.classList.contains("visible")) return;
    applyTabsWidth(preferredTabsWidth(), { persist: tabsWidthRatio != null });
  }

  function setTabsListVisible(visible) {
    if (!tabsList) return;
    tabsList.hidden = !visible;
    tabsList.classList.toggle("visible", visible);
    if (tabsResize) tabsResize.hidden = !visible;
    if (visible) syncTabsWidth();
    else {
      tabsList.style.width = "";
      tabsList.style.flex = "";
      tabsList.classList.remove("compact");
    }
  }

  function bindTabsResize() {
    if (!tabsResize || !terminalBody || !tabsList) return;
    let dragging = false;
    let pointerId = null;

    const onMove = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const rect = terminalBody.getBoundingClientRect();
      applyTabsWidth(rect.right - event.clientX);
      if (tabsResizeFrame) return;
      tabsResizeFrame = requestAnimationFrame(() => {
        tabsResizeFrame = 0;
        fitActive();
      });
    };
    const onEnd = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      tabsResize.classList.remove("dragging");
      document.documentElement.classList.remove("panel-resizing", "resizing-column");
      try { tabsResize.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      if (tabsResizeFrame) {
        cancelAnimationFrame(tabsResizeFrame);
        tabsResizeFrame = 0;
      }
      fitActive();
    };

    tabsResize.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || tabsResize.hidden) return;
      event.preventDefault();
      dragging = true;
      pointerId = event.pointerId;
      tabsResize.classList.add("dragging");
      document.documentElement.classList.add("panel-resizing", "resizing-column");
      tabsResize.setPointerCapture(event.pointerId);
    });
    tabsResize.addEventListener("pointermove", onMove);
    tabsResize.addEventListener("pointerup", onEnd);
    tabsResize.addEventListener("pointercancel", onEnd);
    tabsResize.addEventListener("keydown", (event) => {
      if (tabsResize.hidden) return;
      const step = event.shiftKey ? 24 : 8;
      if (event.key === "ArrowLeft") {
        applyTabsWidth(tabsList.offsetWidth + step);
        fitActive();
        event.preventDefault();
      } else if (event.key === "ArrowRight") {
        applyTabsWidth(tabsList.offsetWidth - step);
        fitActive();
        event.preventDefault();
      }
    });
  }

  function displayShellName(label) {
    return /powershell/i.test(String(label || "")) ? "powershell" : String(label || "terminal");
  }

  function shellIconClass(profileId = "", label = "") {
    const key = `${profileId} ${label}`.toLowerCase();
    if (/\b(pwsh|powershell)\b/.test(key)) return "codicon-terminal-powershell";
    if (/\b(cmd|command prompt)\b/.test(key)) return "codicon-terminal-cmd";
    if (/\bgit[- ]?bash\b/.test(key)) return "codicon-terminal-git-bash";
    if (/\bbash\b/.test(key)) return "codicon-terminal-bash";
    return "codicon-terminal";
  }

  function sessionIconClass(session) {
    if (session?.agent) return "codicon-copilot";
    return shellIconClass(session?.profileId, session?.name);
  }

  function updateEmptyState() {
    const has = sessions.size > 0;
    if (terminalEmpty) terminalEmpty.hidden = true;
    setTabsListVisible(sessions.size > 1);
    btnClear.disabled = !has;
    btnKill.disabled = !has;
    if (btnSplit) btnSplit.disabled = !has;
    updateActiveSessionUi();
    publishUserActiveTerminal();
    globalThis.onTerminalSessionStateChange?.({ count: sessions.size, activeId });
  }

  function terminalTabSnapshot() {
    return [...sessions.values()].map((session) => ({
      id: session.id,
      name: session.name,
      agent: Boolean(session.agent),
      exited: Boolean(session.exited),
    }));
  }

  function publishUserActiveTerminal() {
    window.api?.terminalSetActive?.({
      terminalId: panelOpen && activeId ? activeId : null,
      panelOpen: Boolean(panelOpen && activeId),
      tabs: terminalTabSnapshot(),
    });
  }

  function setPanelOpen(open) {
    panelOpen = Boolean(open);
    publishUserActiveTerminal();
  }

  function updateActiveSessionUi() {
    const session = activeId ? sessions.get(activeId) : null;
    if (activeSessionButton) {
      activeSessionButton.disabled = !session && !shellProfiles.length;
      activeSessionButton.title = session
        ? `${session.name}${session.exited ? " (exited)" : ""} - click to switch terminal`
        : shellProfiles.length ? "Select a shell profile" : "No terminal shell is available";
    }
    if (activeSessionName) {
      activeSessionName.textContent = session?.name || "Terminal";
    }
    renderSessionMenu();
  }

  function groupSessions(groupId) {
    return [...sessions.values()].filter((session) => session.groupId === groupId);
  }

  function renderSessionMenu() {
    if (!sessionMenu) return;
    const sessionRows = [...sessions.values()].map((session) => `
      <button type="button" class="terminal-menu-item${session.id === activeId ? " active" : ""}" data-terminal-id="${escapeHtml(session.id)}" role="menuitem">
        <span class="codicon terminal-shell-icon ${sessionIconClass(session)}"></span><span>${escapeHtml(session.name)}</span>${session.exited ? "<small>exited</small>" : ""}<span class="codicon codicon-check"></span>
      </button>`).join("");
    const shellRows = shellProfiles.map((profile) => `
      <button type="button" class="terminal-menu-item" data-shell-profile="${escapeHtml(profile.id)}" role="menuitem">
        <span class="codicon terminal-shell-icon ${shellIconClass(profile.id, profile.label)}"></span><span>New ${escapeHtml(profile.label)}</span>${profile.default ? "<small>default</small>" : ""}
      </button>`).join("");
    sessionMenu.innerHTML = `
      ${sessionRows || '<div class="terminal-menu-empty">No terminal sessions</div>'}
      ${sessionRows && shellRows ? '<div class="terminal-menu-separator"></div>' : ""}
      ${shellRows}`;
    sessionMenu.querySelectorAll("[data-terminal-id]").forEach((button) => button.addEventListener("click", () => {
      switchTerminal(button.dataset.terminalId);
      closeSessionMenu();
    }));
    sessionMenu.querySelectorAll("[data-shell-profile]").forEach((button) => button.addEventListener("click", () => {
      closeSessionMenu();
      createTerminalAndShow({ profileId: button.dataset.shellProfile });
    }));
  }

  function closeSessionMenu() {
    if (!sessionMenu || !activeSessionButton) return;
    sessionMenu.hidden = true;
    activeSessionButton.setAttribute("aria-expanded", "false");
    btnNewMenu?.setAttribute("aria-expanded", "false");
  }

  function closeMoreMenu() {
    if (!moreMenu || !btnMore) return;
    moreMenu.hidden = true;
    btnMore.setAttribute("aria-expanded", "false");
  }

  function toggleMoreMenu() {
    if (!moreMenu || !btnMore) return;
    closeSessionMenu();
    moreMenu.hidden = !moreMenu.hidden;
    btnMore.setAttribute("aria-expanded", String(!moreMenu.hidden));
  }

  function toggleSessionMenu() {
    if (!sessionMenu) return;
    renderSessionMenu();
    sessionMenu.hidden = !sessionMenu.hidden;
    const expanded = String(!sessionMenu.hidden);
    activeSessionButton?.setAttribute("aria-expanded", expanded);
    btnNewMenu?.setAttribute("aria-expanded", expanded);
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
        session.agent ? "agent" : "",
      ].filter(Boolean).join(" ");
      btn.title = session.exited ? `${session.name} (exited)` : session.name;
      btn.innerHTML = `
        <span class="codicon terminal-shell-icon ${sessionIconClass(session)}"></span>
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
    const active = sessions.get(id);
    for (const session of sessions.values()) {
      const visible = session.groupId === active.groupId;
      session.container.hidden = !visible;
      session.container.classList.toggle("active", session.id === id);
    }
    renderTabsList();
    requestAnimationFrame(() => {
      fitVisibleSessions();
      active.term.focus();
    });
    publishUserActiveTerminal();
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
      if (activeId) fitVisibleSessions();
    });
  }

  function fitVisibleSessions() {
    for (const session of sessions.values()) {
      if (!session.container.hidden) fitSession(session);
    }
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

  async function createTerminal({ profileId = "", groupId = "", cwd: requestedCwd = "" } = {}) {
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
      const resolvedGroupId = groupId || id;

      const container = document.createElement("div");
      container.className = "terminal-instance";
      container.dataset.terminalId = id;
      container.hidden = true;
      viewport.appendChild(container);

      const FitCtor = globalThis.FitAddon?.FitAddon ?? globalThis.FitAddon;
      if (typeof FitCtor !== "function") {
        showTerminalError("xterm fit addon failed to load.");
        container.remove();
        return null;
      }

      const term = new globalThis.Terminal(xtermOptions({ cursorBlink: true }));

      const fitAddon = new FitCtor();
      term.loadAddon(fitAddon);
      term.open(container);
      container.addEventListener("pointerdown", () => {
        if (activeId !== id) switchTerminal(id);
      });

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

      const session = { id, name, profileId, groupId: resolvedGroupId, container, term, fitAddon, exited: false, lastCols: 0, lastRows: 0 };
      sessions.set(id, session);

      const result = await window.api.terminalCreate({
        id,
        cwd: requestedCwd || cwd || undefined,
        profileId: profileId || undefined,
      });

      if (result?.error) {
        term.writeln(`\x1b[31m${result.error}\x1b[0m`);
        session.exited = true;
      } else if (result?.shell) {
        session.name = nextName(displayShellName(result.shell));
        session.profileId = result.profileId || profileId;
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
      </div>`;
    if (sessions.size === 0) globalThis.collapseTerminalPanel?.();
  }

  function clearTerminalError() {
    if (!terminalEmpty) return;
    terminalEmpty.hidden = true;
    terminalEmpty.innerHTML = "";
  }

  async function createTerminalAndShow(options = {}) {
    const id = await createTerminal(options);
    if (id) globalThis.expandTerminalPanel?.({ createIfMissing: false });
    return id;
  }

  async function splitActive() {
    const active = activeId ? sessions.get(activeId) : null;
    if (!active || active.exited) return createTerminalAndShow();
    return createTerminalAndShow({ profileId: active.profileId, groupId: active.groupId });
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
    const active = activeId ? sessions.get(activeId) : null;
    if (!activeId || !active || active.exited || active.agent) {
      await createTerminal();
    }
    const session = activeId ? sessions.get(activeId) : null;
    if (!session || session.exited || session.agent) return false;
    globalThis.expandTerminalPanel?.({ createIfMissing: false });
    session.term.focus();
    window.api.terminalWrite(session.id, `${text}\r`);
    return true;
  }

  function shortenCommand(command, max = 42) {
    const text = String(command || "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
  }

  async function interruptAgentTerminal(id, term) {
    const session = sessions.get(id);
    if (!session || session.exited || session.interrupting) return;
    session.interrupting = true;
    term.writeln("\r\n\x1b[33m^C  Stopping command…\x1b[0m");
    try {
      const result = await window.api.terminalKill(id);
      if (result?.alreadyStopped) {
        session.interrupting = false;
        session.exited = true;
        term.writeln("\x1b[90mThis command is no longer running.\x1b[0m");
        renderTabsList();
        return;
      }
      if (result?.ok === false || result?.error) {
        session.interrupting = false;
        term.writeln(`\x1b[31mCould not stop command: ${result.error?.message || result.error || "unknown error"}\x1b[0m`);
      }
    } catch (error) {
      session.interrupting = false;
      term.writeln(`\x1b[31mCould not stop command: ${error?.message || "unknown error"}\x1b[0m`);
    }
  }

  async function attachAgentSession({ id, command = "", toolName = "run_command" } = {}) {
    if (!id) return null;
    if (sessions.has(id)) {
      switchTerminal(id);
      globalThis.expandTerminalPanel?.({ createIfMissing: false });
      return id;
    }
    if (!window.api?.terminalWrite || typeof globalThis.Terminal !== "function") {
      return null;
    }

    globalThis.expandTerminalPanel?.({ createIfMissing: false });

    const container = document.createElement("div");
    container.className = "terminal-instance agent-terminal";
    container.dataset.terminalId = id;
    container.hidden = true;
    viewport.appendChild(container);

    const FitCtor = globalThis.FitAddon?.FitAddon ?? globalThis.FitAddon;
    if (typeof FitCtor !== "function") {
      container.remove();
      return null;
    }

    const term = new globalThis.Terminal(xtermOptions({ cursorBlink: true }));

    const fitAddon = new FitCtor();
    term.loadAddon(fitAddon);
    term.open(container);
    container.addEventListener("pointerdown", () => {
      if (activeId !== id) switchTerminal(id);
    });

    term.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (event.type === "keydown" && mod && key === "c" && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection());
        return false;
      }
      if (event.type === "keydown" && mod && key === "c") {
        void interruptAgentTerminal(id, term);
        return false;
      }
      return false;
    });

    const label = shortenCommand(command) || toolName.replace(/_/g, " ");
    const session = {
      id,
      name: label,
      profileId: "agent",
      groupId: id,
      container,
      term,
      fitAddon,
      exited: false,
      lastCols: 0,
      lastRows: 0,
      agent: true,
      command,
      toolName,
    };
    sessions.set(id, session);

    term.writeln("\x1b[90mread-only output\x1b[0m");

    clearTerminalError();
    updateEmptyState();
    switchTerminal(id);

    requestAnimationFrame(() => {
      fitSession(session);
      session.term.focus();
    });

    return id;
  }

  async function killTerminal(id) {
    const target = id ?? activeId;
    if (!target || !sessions.has(target)) return;
    const session = sessions.get(target);
    if (session?.exited) {
      removeSession(target);
      return;
    }
    const result = await window.api.terminalKill(target);
    if (result?.alreadyStopped) {
      if (session.agent) {
        session.interrupting = false;
        session.exited = true;
        session.term.writeln("\x1b[90mThis command is no longer running.\x1b[0m");
        renderTabsList();
        return;
      }
      removeSession(target);
      return;
    }
    if (result?.ok === false || result?.error) {
      session.term.writeln(`\r\n\x1b[31mCould not stop command: ${result.error?.message || result.error || "unknown error"}\x1b[0m`);
      session.interrupting = false;
      return;
    }
    if (session.agent) return;
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
    const previousGroupId = session.groupId;
    session.term.dispose();
    session.container.remove();
    sessions.delete(id);
    window.api?.terminalForget?.(id);

    if (activeId === id) {
      activeId = groupSessions(previousGroupId)[0]?.id || (sessions.size ? [...sessions.keys()][0] : null);
      if (activeId) switchTerminal(activeId);
    }

    renderTabsList();
    updateEmptyState();
    fitActive();
  }

  function onData({ id, data }) {
    const session = sessions.get(id);
    if (session) session.term.write(data);
  }

  function onExit({ id }) {
    const session = sessions.get(id);
    if (!session) return;
    session.exited = true;
    session.interrupting = false;
    session.term.writeln("");
    session.term.writeln(session.agent
      ? "\x1b[33mCommand exited. Press the trash icon to close this session.\x1b[0m"
      : "\x1b[33mTerminal process exited. Press the trash icon to close this session.\x1b[0m");
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
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  if (window.api) {
    window.api.onTerminalData(onData);
    window.api.onTerminalExit(onExit);
    window.api.terminalShells?.().then((result) => {
      shellProfiles = Array.isArray(result?.profiles) ? result.profiles : [];
      updateActiveSessionUi();
    }).catch(() => {});
  }

  btnNew?.addEventListener("click", () => {
    createTerminalAndShow();
  });
  btnNewMenu?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSessionMenu();
  });
  btnSplit?.addEventListener("click", () => splitActive());
  btnClear?.addEventListener("click", () => {
    clearActive();
  });
  btnKill?.addEventListener("click", () => killTerminal());
  btnMore?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMoreMenu();
  });
  moreMenu?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-terminal-more-action]")?.dataset.terminalMoreAction;
    if (!action) return;
    if (action === "split") splitActive();
    if (action === "clear") clearActive();
    if (action === "kill") killTerminal();
    closeMoreMenu();
  });
  activeSessionButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSessionMenu();
  });
  sessionMenu?.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", () => {
    closeSessionMenu();
    closeMoreMenu();
  });
  viewport?.addEventListener("mousedown", () => focusActive());
  viewport?.addEventListener("wheel", () => focusActive(), { passive: true });

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
      return;
    }
    if (key === "escape") {
      closeSessionMenu();
      closeMoreMenu();
    }
  });

  bindTabsResize();
  if (terminalBody && globalThis.ResizeObserver) {
    const tabsHostObserver = new ResizeObserver(() => {
      syncTabsWidth();
      fitActive();
    });
    tabsHostObserver.observe(terminalBody);
  }
  if (viewport && globalThis.ResizeObserver) {
    const observer = new ResizeObserver(() => fitActive());
    observer.observe(viewport);
  }

  return {
    createTerminal,
    createTerminalAndShow,
    killTerminal,
    clearActive,
    splitActive,
    focusActive,
    fitActive,
    runCommand,
    attachAgentSession,
    hasSessions,
    ensureTerminal,
    openWithProject,
    setCwd,
    setPanelOpen,
    publishUserActiveTerminal,
  };
})();

globalThis.XekuteTerminalManager = TerminalManager;
