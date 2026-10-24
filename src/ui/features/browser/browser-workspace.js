const OVERLAYS = '[role="dialog"], [role="menu"], .custom-context-menu, .model-menu, .model-edit-menu, .model-controls-menu, .authority-menu, .file-tag-suggestions, .slash-command-suggestions, .terminal-session-menu, .terminal-more-menu';

export function normalizeBrowserAddress(value) {
  const text = String(value || "").trim();
  if (!text || text === "about:blank") return "about:blank";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(text) && !/^[\w.-]+:\d+(?:\/|$)/.test(text) ? text : `https://${text}`;
  const parsed = new URL(candidate);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Enter an HTTP or HTTPS address.");
  return parsed.href;
}

export function createBrowserWorkspace({ document, api, host, getAssessmentPath, getSessionId, onError = () => {} }) {
  const win = document.defaultView;
  const root = document.createElement("section");
  root.id = "browser-workspace";
  root.className = "browser-workspace";
  root.setAttribute("aria-label", "Browser workspace");
  root.hidden = true;
  root.innerHTML = `
    <div class="browser-tabbar">
      <div class="browser-web-tabs" role="tablist" aria-label="Browser pages"></div>
      <button type="button" class="browser-icon-button browser-new-toggle" data-browser-new-toggle aria-expanded="false" aria-label="New tab" title="New tab"><span class="codicon codicon-add"></span></button>
    </div>
    <div class="browser-toolbar">
      <form class="browser-navigation" aria-label="Browser navigation">
        <button type="button" class="browser-icon-button" data-browser-command="back" title="Back" aria-label="Back"><span class="codicon codicon-arrow-left"></span></button>
        <button type="button" class="browser-icon-button" data-browser-command="forward" title="Forward" aria-label="Forward"><span class="codicon codicon-arrow-right"></span></button>
        <button type="button" class="browser-icon-button" data-browser-command="reload" title="Reload" aria-label="Reload"><span class="codicon codicon-refresh"></span></button>
        <div class="browser-omnibox">
          <span class="browser-security codicon codicon-search" aria-hidden="true"></span>
          <input class="browser-address" aria-label="Browser address" placeholder="Search or enter an address" spellcheck="false" autocomplete="off" />
          <button type="submit" class="browser-go" title="Go" aria-label="Go"><span class="codicon codicon-arrow-right"></span></button>
        </div>
      </form>
      <div class="browser-controls">
        <span class="browser-context" role="img"><span class="browser-context-icon codicon codicon-shield" aria-hidden="true"></span></span>
        <button type="button" class="browser-control-toggle" data-browser-control aria-pressed="false"><span class="browser-control-knob" aria-hidden="true"><span class="codicon codicon-copilot"></span></span></button>
      </div>
    </div>
    <form class="browser-new-page" aria-label="New browser tab" hidden>
      <span class="browser-new-title">Open a new tab</span>
      <label>Purpose<select aria-label="New tab purpose"><option value="assessment">Assessment</option><option value="research">Public research</option></select></label>
      <label>Identity<select aria-label="New tab identity"><option value="">Anonymous</option></select></label>
      <div class="browser-new-actions">
        <button type="button" class="browser-secondary" data-browser-new-cancel>Cancel</button>
        <button type="submit" class="browser-primary">Open tab</button>
      </div>
    </form>
    <div class="browser-status" role="status" hidden>
      <span class="browser-status-message"></span>
      <button type="button" class="browser-status-dismiss" aria-label="Dismiss browser message" title="Dismiss message"><span class="codicon codicon-close" aria-hidden="true"></span></button>
    </div>
    <div class="browser-viewport" data-native-surface>
      <img class="browser-freeze" alt="" aria-hidden="true" hidden>
      <div class="browser-empty">
        <span class="browser-empty-icon codicon codicon-globe" aria-hidden="true"></span>
        <strong>No page open</strong>
        <span>Browse in this project, then hand a tab to a chat so the agent can work on it.</span>
        <button type="button" class="browser-primary" data-browser-empty-open>Open a tab</button>
      </div>
    </div>`;
  host.append(root);
  const $ = selector => root.querySelector(selector);
  const strip = $(".browser-web-tabs"), address = $(".browser-address"), viewport = $(".browser-viewport");
  const status = $(".browser-status"), statusMessage = $(".browser-status-message"), empty = $(".browser-empty"), creator = $(".browser-new-page");
  const freeze = $(".browser-freeze");
  const purpose = $('[aria-label="New tab purpose"]'), identity = $('[aria-label="New tab identity"]');
  const resumeSessions = new Map();
  let renderedSelection = null;
  let project = "", tabs = [], identities = [], selectedId = null, visible = false, disposed = false;
  let layoutFrame = 0, lastLayout = "", loadSequence = 0, loading = false, freezeSeq = 0;
  const active = () => tabs.find(tab => tab.id === selectedId) || null;
  function setStatus(message = "", error = false) {
    statusMessage.textContent = message;
    status.hidden = !message;
    status.classList.toggle("error", error);
    scheduleLayout();
  }
  function hideNative() {
    lastLayout = "";
    freezeSeq++;
    setFreeze(null);
    Promise.resolve(api.browserHide?.()).catch(() => {});
  }
  function syncProject() {
    const next = String(getAssessmentPath() || "");
    if (next === project) return false;
    project = next; tabs = []; identities = []; selectedId = null; loadSequence++;
    resumeSessions.clear(); hideNative(); render();
    return true;
  }
  function isShown(element) {
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
      const style = win.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }
  function obstructed(rect) {
    for (const overlay of document.querySelectorAll(OVERLAYS)) {
      if (root.contains(overlay) || !isShown(overlay)) continue;
      if (overlay.getAttribute("aria-modal") === "true") return true;
      const box = overlay.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top) return true;
    }
    return false;
  }
  function setFreeze(dataUrl) {
    if (dataUrl) { freeze.src = dataUrl; freeze.hidden = false; }
    else if (!freeze.hidden || freeze.getAttribute("src")) { freeze.hidden = true; freeze.removeAttribute("src"); }
  }
  // While an overlay covers the viewport the native view is hidden so the overlay
  // shows, but a frozen snapshot keeps the page visible underneath instead of a gap.
  async function freezeNative(tabId, expectedProject) {
    const token = ++freezeSeq;
    try {
      const result = await api.browserCapture?.({ assessmentPath: expectedProject, tabId });
      if (token !== freezeSeq || disposed || project !== expectedProject || selectedId !== tabId) return;
      if (result?.ok && result.dataUrl) setFreeze(result.dataUrl);
    } catch { /* a missing snapshot just falls back to hiding the view */ }
    finally { if (token === freezeSeq && !disposed) Promise.resolve(api.browserHide?.()).catch(() => {}); }
  }
  function syncLayout() {
    layoutFrame = 0;
    if (disposed) return;
    const rect = viewport.getBoundingClientRect();
    const open = visible && !root.hidden && isShown(root) && active() && rect.width > 0 && rect.height > 0;
    const blocked = open && obstructed(rect);
    const shown = open && !blocked;
    const bounds = { x: Math.max(0, Math.round(rect.left)), y: Math.max(0, Math.round(rect.top)), width: Math.max(0, Math.round(Math.min(rect.right, win.innerWidth) - Math.max(0, rect.left))), height: Math.max(0, Math.round(Math.min(rect.bottom, win.innerHeight) - Math.max(0, rect.top))) };
    const signature = JSON.stringify([project, selectedId, shown ? "shown" : blocked && bounds.width && bounds.height ? "frozen" : "hidden", bounds]);
    if (signature === lastLayout) return;
    lastLayout = signature;
    if (shown && bounds.width && bounds.height) {
      freezeSeq++;
      setFreeze(null);
      Promise.resolve(api.browserLayout?.({ assessmentPath: project, tabId: selectedId, bounds, visible: true })).then(result => {
        if (result?.ok === false) throw new Error(result.error?.message || result.error || "Browser view could not be displayed.");
      }).catch(error => { if (lastLayout === signature) setStatus(error.message, true); });
      return;
    }
    if (blocked && bounds.width && bounds.height && api.browserCapture) { void freezeNative(selectedId, project); return; }
    freezeSeq++;
    setFreeze(null);
    Promise.resolve(api.browserHide?.()).catch(() => {});
  }
  function scheduleLayout() {
    // Hidden, the native view is already detached; page-wide DOM changes need no layout reads.
    if (!disposed && visible && !layoutFrame) layoutFrame = win.requestAnimationFrame(syncLayout);
  }
  function renderIdentities() {
    const previous = identity.value;
    identity.replaceChildren();
    const option = document.createElement("option"); option.value = ""; option.textContent = "Anonymous"; identity.append(option);
    for (const item of identities) {
      const option = document.createElement("option"); option.value = item.identityId; option.textContent = item.name || item.identityId; identity.append(option);
    }
    identity.value = [...identity.options].some(option => option.value === previous) ? previous : "";
    identity.disabled = purpose.value === "research";
  }
  function render() {
    const scrollLeft = strip.scrollLeft;
    const existing = new Map([...strip.children].map(item => [item.querySelector("[data-browser-tab]")?.dataset.browserTab, item]));
    for (const [index, tab] of tabs.entries()) {
      let item = existing.get(tab.id);
      if (!item) {
        item = document.createElement("div");
        const select = document.createElement("button"); select.type = "button"; select.setAttribute("role", "tab");
        select.dataset.browserTab = tab.id;
        select.append(document.createElement("span"), document.createElement("span"));
        select.addEventListener("click", () => { selectedId = tab.id; setStatus(); render(); });
        const close = document.createElement("button"); close.type = "button"; close.className = "browser-web-tab-close";
        close.title = "Close tab"; close.innerHTML = '<span class="codicon codicon-close"></span>';
        close.addEventListener("click", () => { void command("close", {}, tab.id); });
        item.append(select, close);
      }
      existing.delete(tab.id);
      const classes = `browser-web-tab${tab.id === selectedId ? " is-active" : ""}${tab.owner?.kind === "chat" ? " is-agent" : ""}`;
      if (item.className !== classes) item.className = classes;
      const select = item.firstElementChild;
      select.setAttribute("aria-selected", String(tab.id === selectedId)); select.dataset.browserTab = tab.id;
      const icon = select.firstElementChild;
      const iconClass = tab.status === "loading" ? "codicon codicon-loading codicon-modifier-spin" : tab.owner?.kind === "chat" ? "codicon codicon-copilot" : "codicon codicon-globe";
      if (icon.className !== iconClass) icon.className = iconClass;
      const label = select.lastElementChild, text = tab.title || (tab.url === "about:blank" ? "New tab" : tab.url);
      if (label.textContent !== text) label.textContent = text;
      select.title = `${tab.title || tab.url}\n${tab.purpose === "research" ? "Public research" : "Assessment"}`;
      item.lastElementChild.setAttribute("aria-label", `Close ${label.textContent}`);
      if (strip.children[index] !== item) strip.insertBefore(item, strip.children[index] || null);
    }
    for (const item of existing.values()) item.remove();
    strip.scrollLeft = scrollLeft;
    if (visible && selectedId !== renderedSelection) {
      strip.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      renderedSelection = selectedId;
    }
    const tab = active(), chatId = String(getSessionId() || "");
    if (document.activeElement !== address) address.value = tab?.url === "about:blank" ? "" : tab?.url || "";
    address.disabled = !tab || tab.owner?.kind === "chat";
    for (const button of root.querySelectorAll("[data-browser-command]")) {
      const key = button.dataset.browserCommand;
      button.disabled = !tab || (tab.owner?.kind === "chat" && !(key === "reload" && tab.operation?.status === "recovery_required")) || (key === "back" && tab.canGoBack === false) || (key === "forward" && tab.canGoForward === false);
    }
    const label = identities.find(item => item.identityId === tab?.identityId)?.name || tab?.identityId || "Anonymous";
    const context = $(".browser-context"), contextLabel = tab ? `${tab.purpose === "research" ? "Public research" : "Assessment"} · ${label}` : "";
    context.title = contextLabel; context.setAttribute("aria-label", contextLabel);
    context.hidden = !tab;
    $(".browser-context-icon").className = `browser-context-icon codicon ${tab?.purpose === "research" ? "codicon-globe" : "codicon-shield"}`;
    const protocol = /^(https?):/.exec(tab?.url || "")?.[1];
    const security = $(".browser-security");
    security.className = `browser-security codicon ${protocol === "https" ? "codicon-lock" : protocol === "http" ? "codicon-unlock" : "codicon-search"}`;
    security.title = protocol === "https" ? "Secure connection" : protocol === "http" ? "Not secure" : "";
    root.dataset.protocol = protocol || "";
    const pending = tab?.operation?.status === "stopping";
    const ownedHere = tab?.owner?.kind === "chat" && tab.owner.sessionId === chatId;
    root.dataset.control = !tab ? "" : pending ? "pending" : ownedHere ? "agent" : tab.owner?.kind === "chat" ? "other" : "human";
    // One switch: while a chat controls the tab it takes the tab back,
    // otherwise it hands the tab to (or resumes) the current chat.
    const agentControls = tab?.owner?.kind === "chat";
    const owner = pending ? "Transferring control…" : agentControls ? (ownedHere ? "Current chat controls this tab" : "Another chat controls this tab") : "You control this tab";
    const action = agentControls ? "Take over" : resumeSessions.get(tab?.id) === chatId ? "Resume" : "Use in current chat";
    const control = $("[data-browser-control]");
    control.hidden = !tab;
    control.disabled = !tab || pending || (!agentControls && !chatId);
    control.dataset.action = agentControls ? "takeover" : "handoff";
    control.setAttribute("aria-pressed", String(agentControls));
    control.setAttribute("aria-label", action);
    control.title = pending ? owner : `${owner}. ${action}.`;
    // With no page open the workspace shows only the empty state.
    empty.hidden = Boolean(tab);
    $(".browser-tabbar").hidden = !tab;
    $(".browser-toolbar").hidden = !tab;
    scheduleLayout();
  }
  function accept(result, expectedProject, preferredId) {
    if (disposed || project !== expectedProject || String(getAssessmentPath() || "") !== expectedProject) return false;
    if (result?.ok === false || result?.error) throw new Error(result.error?.message || result.error || "Browser action failed.");
    if (Array.isArray(result?.identities)) { identities = result.identities; renderIdentities(); }
    if (Array.isArray(result?.tabs)) tabs = result.tabs.filter(tab => tab.status !== "closed");
    else if (result?.tab) { const index = tabs.findIndex(tab => tab.id === result.tab.id); if (index < 0) tabs.push(result.tab); else tabs[index] = result.tab; }
    selectedId = tabs.some(tab => tab.id === preferredId) ? preferredId : tabs.some(tab => tab.id === selectedId) ? selectedId : tabs[0]?.id || null;
    render(); return true;
  }
  async function refresh() {
    syncProject();
    const expected = project, sequence = ++loadSequence;
    if (!expected) { setStatus("Open a project to use the browser."); return; }
    if (!api.browserList) { setStatus("The native browser is unavailable.", true); return; }
    try {
      const result = await api.browserList({ assessmentPath: expected });
      if (sequence === loadSequence) accept(result, expected);
    } catch (error) { if (sequence === loadSequence && project === expected) setStatus(error.message, true); }
  }
  async function open({ identityId = "", purpose: tabPurpose = "assessment", url = "about:blank" } = {}) {
    syncProject();
    const expected = project;
    if (!expected) { setStatus("Open a project to use the browser.", true); return null; }
    if (!api.browserOpen || loading) return null;
    loadSequence++;
    loading = true; setStatus("Opening browser tab…");
    try {
      const result = await api.browserOpen({ assessmentPath: expected, purpose: tabPurpose, identityId: tabPurpose === "research" ? null : identityId || null, url: normalizeBrowserAddress(url), sessionId: String(getSessionId() || "") || null });
      if (accept(result, expected, result?.tab?.id)) { creator.hidden = true; $("[data-browser-new-toggle]").setAttribute("aria-expanded", "false"); setStatus(); address.focus(); }
      return result;
    } catch (error) { if (project === expected) { setStatus(error.message, true); onError(error.message); } return null; }
    finally { loading = false; }
  }
  async function command(name, extra = {}, tabId = selectedId) {
    syncProject();
    const tab = tabs.find(item => item.id === tabId), expected = project;
    if (!tab || !api.browserCommand) return;
    try {
      if (name === "takeover" && tab.owner?.kind === "chat") resumeSessions.set(tab.id, tab.owner.sessionId);
      const result = await api.browserCommand({ assessmentPath: expected, tabId, command: name, ...(["handoff", "takeover"].includes(name) ? { expectedGeneration: tab.controlGeneration } : {}), ...extra });
      if (accept(result, expected)) setStatus();
    } catch (error) { if (project === expected) { setStatus(error.message, true); void refresh(); } }
  }
  $(".browser-status-dismiss").addEventListener("click", () => setStatus());
  $(".browser-navigation").addEventListener("submit", event => { event.preventDefault(); try { void command("navigate", { url: normalizeBrowserAddress(address.value) }); } catch (error) { setStatus(error.message, true); } });
  root.querySelectorAll("[data-browser-command]").forEach(button => button.addEventListener("click", () => { void command(button.dataset.browserCommand); }));
  $("[data-browser-control]").addEventListener("click", event => {
    if (event.currentTarget.dataset.action === "takeover") void command("takeover");
    else void command("handoff", { sessionId: String(getSessionId() || "") });
  });
  const toggleCreator = show => { creator.hidden = !show; $("[data-browser-new-toggle]").setAttribute("aria-expanded", String(show)); scheduleLayout(); };
  $("[data-browser-new-toggle]").addEventListener("click", () => toggleCreator(creator.hidden));
  $("[data-browser-empty-open]").addEventListener("click", () => toggleCreator(true));
  $("[data-browser-new-cancel]").addEventListener("click", () => { creator.hidden = true; $("[data-browser-new-toggle]").setAttribute("aria-expanded", "false"); scheduleLayout(); });
  purpose.addEventListener("change", () => { identity.disabled = purpose.value === "research"; });
  creator.addEventListener("submit", event => { event.preventDefault(); void open({ identityId: identity.value, purpose: purpose.value }); });
  address.addEventListener("keydown", event => { if (event.key === "Escape") { address.value = active()?.url || ""; address.blur(); } });
  strip.addEventListener("wheel", event => {
    if (event.ctrlKey) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
    const next = Math.max(0, Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + delta * units));
    if (next === strip.scrollLeft) return;
    strip.scrollLeft = next;
    event.preventDefault();
  }, { passive: false });
  const unsubscribe = api.onBrowserEvent?.(event => {
    if (disposed || !project || String(getAssessmentPath() || "") !== project) return;
    if (event.tab) {
      const index = tabs.findIndex(tab => tab.id === event.tab.id);
      if (index < 0) {
        if (visible && event.type === "opened" && (!tabs.length || tabs[0].projectId === event.tab.projectId)) { tabs.push(event.tab); selectedId = event.tab.id; render(); }
        else if (visible) void refresh();
        return;
      }
      if (event.type === "closed" || event.tab.status === "closed") { tabs.splice(index, 1); resumeSessions.delete(event.tab.id); }
      else tabs[index] = event.tab;
      if (!tabs.some(tab => tab.id === selectedId)) selectedId = tabs[0]?.id || null;
      if (event.type === "navigation-error") setStatus(event.error?.message || "Navigation failed.", true);
      if (event.type === "crashed") setStatus("This browser page stopped. Reload it to recover.", true);
      render();
    }
  });
  const resize = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(scheduleLayout) : null;
  resize?.observe(viewport);
  const mutation = typeof win.MutationObserver === "function" ? new win.MutationObserver(scheduleLayout) : null;
  mutation?.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class", "style", "open", "aria-hidden"] });
  win.addEventListener("resize", scheduleLayout);
  win.addEventListener("scroll", scheduleLayout, true);
  const restoreLayout = () => { lastLayout = ""; scheduleLayout(); };
  win.addEventListener("focus", restoreLayout);
  document.addEventListener("visibilitychange", restoreLayout);
  return {
    root, open, refresh, syncLayout,
    setVisible(value) {
      visible = Boolean(value); root.hidden = !visible;
      if (!visible) hideNative();
      else { syncProject(); render(); void refresh(); }
    },
    projectChanged() { syncProject(); if (visible) void refresh(); },
    chatChanged() { render(); },
    dispose() {
      disposed = true; resize?.disconnect(); mutation?.disconnect(); unsubscribe?.();
      win.removeEventListener("resize", scheduleLayout); win.removeEventListener("scroll", scheduleLayout, true);
      win.removeEventListener("focus", restoreLayout); document.removeEventListener("visibilitychange", restoreLayout);
      if (layoutFrame) win.cancelAnimationFrame(layoutFrame);
      hideNative(); root.remove();
    },
  };
}
