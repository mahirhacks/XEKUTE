(function installInstallerController(global) {
  "use strict";

  /**
   * XEKUTE Installer wizard.
   *
   * Three steps: Options (install dir + shortcuts) → Installing (live log) →
   * Finish (with "Launch on finish"). Error steps switch the footer to Retry.
   * All IPC goes through window.api.* (see preload.js).
   */

  const overlay = document.getElementById("installer-overlay");
  const closeBtn = document.getElementById("installer-close");
  const backBtn = document.getElementById("installer-back");
  const nextBtn = document.getElementById("installer-next");
  const finishBtn = document.getElementById("installer-finish");
  const retryBtn = document.getElementById("installer-retry");
  const dirInput = document.getElementById("installer-dir");
  const browseBtn = document.getElementById("installer-browse");
  const dirError = document.getElementById("installer-dir-error");
  const desktopCheck = document.getElementById("installer-desktop-shortcut");
  const taskbarCheck = document.getElementById("installer-taskbar-shortcut");
  const launchCheck = document.getElementById("installer-launch-on-finish");
  const logEl = document.getElementById("installer-log");
  const panes = [...document.querySelectorAll("[data-installer-step]")];
  const indicators = [...document.querySelectorAll("[data-installer-step-indicator]")];

  const STEP_OPTIONS = "options";
  const STEP_INSTALLING = "installing";
  const STEP_FINISH = "finish";

  let currentStep = STEP_OPTIONS;
  let installing = false;
  let installFailed = false;
  let initialDir = "";

  function showStep(step) {
    currentStep = step;
    panes.forEach((pane) => { pane.hidden = pane.dataset.installerStep !== step; });
    indicators.forEach((ind) => ind.classList.toggle("active", ind.dataset.installerStepIndicator === step));
    backBtn.hidden = step !== STEP_INSTALLING;
    nextBtn.hidden = step !== STEP_OPTIONS;
    finishBtn.hidden = step !== STEP_FINISH || installFailed;
    retryBtn.hidden = step !== STEP_FINISH || !installFailed;
  }

  function open() {
    if (!overlay) return;
    overlay.hidden = false;
    installFailed = false;
    installing = false;
    logEl.textContent = "";
    dirError.hidden = true;
    showStep(STEP_OPTIONS);
    loadDefaults();
  }

  function close() {
    if (!overlay) return;
    if (installing) return; // never dismiss mid-install
    overlay.hidden = true;
  }

  async function loadDefaults() {
    try {
      const result = await window.api.installerGetDefault();
      const value = result?.ok ? result.value : result;
      if (value?.dir) {
        initialDir = String(value.dir);
        dirInput.value = initialDir;
      }
      if (typeof value?.desktopShortcut === "boolean") desktopCheck.checked = value.desktopShortcut;
      if (typeof value?.taskbarShortcut === "boolean") taskbarCheck.checked = value.taskbarShortcut;
    } catch {
      // Fall back to the input's placeholder.
    }
  }

  function appendLog(level, message) {
    if (!logEl) return;
    const line = document.createElement("span");
    line.className = `log-line log-${level || "info"}`;
    line.textContent = message;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function validateOptions() {
    const dir = (dirInput.value || "").trim();
    if (!dir) {
      dirError.textContent = "Choose an install directory.";
      dirError.hidden = false;
      dirInput.focus();
      return false;
    }
    dirError.hidden = true;
    return true;
  }

  async function startInstall() {
    if (!validateOptions()) return;
    installing = true;
    installFailed = false;
    appendLog("info", `Installing XEKUTE to ${(dirInput.value || "").trim()}…`);
    showStep(STEP_INSTALLING);

    try {
      const result = await window.api.installerInstall({
        dir: (dirInput.value || "").trim(),
        desktopShortcut: desktopCheck.checked,
        taskbarShortcut: taskbarCheck.checked,
      });
      if (result?.ok === false && result.error?.message && !installFailed) {
        appendLog("error", `Install failed: ${result.error.message}`);
      }
    } catch (error) {
      if (!installFailed) appendLog("error", `Install failed: ${error?.message || error}`);
    }
  }

  function finish() {
    const shouldLaunch = launchCheck.checked;
    close();
    if (shouldLaunch) {
      window.api.installerLaunch?.().catch(() => { /* app relaunches or is gone */ });
    }
  }

  function handleInstallerEvent(payload = {}) {
    const type = String(payload.type || "");
    if (type === "log") {
      appendLog(String(payload.level || "info"), String(payload.message || ""));
      return;
    }
    if (type === "done") {
      installing = false;
      if (payload.ok === false) {
        installFailed = true;
        appendLog("error", String(payload.error || "Install failed"));
      } else {
        appendLog("success", "Installation complete.");
      }
      showStep(STEP_FINISH);
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  document.getElementById("btn-top-installer")?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay?.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  browseBtn?.addEventListener("click", async () => {
    try {
      const result = await window.api.installerBrowseDirectory();
      const value = result?.ok ? result.value : result;
      if (value) {
        dirInput.value = String(value);
        dirError.hidden = true;
      }
    } catch {
      // Leave the current value.
    }
  });

  nextBtn?.addEventListener("click", startInstall);

  backBtn?.addEventListener("click", () => {
    if (installing) return;
    showStep(STEP_OPTIONS);
  });

  retryBtn?.addEventListener("click", startInstall);
  finishBtn?.addEventListener("click", finish);

  dirInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (currentStep === STEP_OPTIONS && !installing) nextBtn?.click();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (overlay?.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  window.api.onInstallerEvent?.(handleInstallerEvent);

  // Expose for tests / other controllers.
  global.AppInstaller = { open, close, handleInstallerEvent };
})(globalThis);
