import { appState } from "../../core/app-state.js";
import { setNotifications } from "../../bootstrap.js";
import {
  generalUpdatesToggle, generalCurrentVersion, updateToast, updateToastVersion,
  updateToastInstall, updateToastIgnore,
} from "../../core/dom-refs.js";

  export function beginUpdateInstallFromNotification() {
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    beginUpdateInstall();
  }

// ── In-app updates ──────────────────────────────────────────────────────────
export const updatesState = {
  availableVersion: "",
  readyVersion: "",
  ignoredVersion: "",
  deferredVersion: "",
  pendingNotification: null,
  transientTimer: null,
};

export async function loadUpdateSettings() {
  try {
    const result = await window.api.updatesSettingsGet?.();
    const settings = result?.value || (result && !result.ok ? null : result);
    if (settings) {
      const currentVersion = String(settings.currentVersion || "").trim();
      if (generalCurrentVersion) generalCurrentVersion.textContent = currentVersion ? `XEKUTE v${currentVersion}` : "Version unavailable";
      updatesState.ignoredVersion = String(settings.ignoredVersion || "");
      updatesState.deferredVersion = String(settings.deferredVersion || settings.ignoredVersion || "");
      if (generalUpdatesToggle) generalUpdatesToggle.checked = settings.checkOnLaunch !== false;
      if (updatesState.deferredVersion) showUpdateNotification(updatesState.deferredVersion);
    }
  } catch { /* bridge unavailable */ }
}

export function runUpdateCheck(manual = false) {
  window.api.updatesCheck?.({ manual }).catch(() => {});
}

export function showUpdateToast(version) {
  if (!updateToast) return;
  updatesState.availableVersion = String(version || "");
  if (updateToastVersion) updateToastVersion.textContent = updatesState.availableVersion;
  const title = updateToast.querySelector(".update-toast-title");
  if (title) title.textContent = "New version is available";
  const sub = updateToast.querySelector(".update-toast-version");
  if (sub) sub.textContent = "";
  updateToast.classList.remove("update-toast-downloading");
  updateToast.querySelectorAll(".update-toast-progress, .update-toast-progress-label").forEach((el) => el.remove());
  if (updateToastInstall) {
    updateToastInstall.hidden = false;
    updateToastInstall.textContent = "Install";
  }
  if (updateToastIgnore) {
    updateToastIgnore.hidden = false;
    updateToastIgnore.textContent = "Ignore";
  }
  updateToast.hidden = false;
  // Restart the entrance animation.
  updateToast.style.animation = "none";
  void updateToast.offsetWidth;
  updateToast.style.animation = "";
}

export function hideUpdateToast() {
  if (updateToast) updateToast.hidden = true;
}

export function showTransientUpdateNotice(titleText, subText) {
  if (!updateToast) return;
  clearTimeout(updatesState.transientTimer);
  if (updateToastVersion) updateToastVersion.textContent = "";
  const title = updateToast.querySelector(".update-toast-title");
  if (title) title.textContent = titleText;
  const sub = updateToast.querySelector(".update-toast-version");
  if (sub) sub.textContent = subText;
  updateToast.classList.remove("update-toast-downloading");
  updateToast.querySelectorAll(".update-toast-progress, .update-toast-progress-label").forEach((el) => el.remove());
  if (updateToastInstall) updateToastInstall.hidden = true;
  if (updateToastIgnore) updateToastIgnore.hidden = true;
  updateToast.hidden = false;
  updateToast.style.animation = "none";
  void updateToast.offsetWidth;
  updateToast.style.animation = "";
  updatesState.transientTimer = setTimeout(hideUpdateToast, 4000);
}

export function beginUpdateInstall() {
  if (!window.api.updatesInstall) return;
  if (updatesState.readyVersion) {
    window.api.updatesInstall().catch(() => {});
    return;
  }
  showUpdateDownloading(updatesState.availableVersion || updatesState.deferredVersion);
  window.api.updatesInstall().catch(() => {});
}

export function showUpdateDownloading(version) {
  showUpdateToast(version);
  if (updateToast) updateToast.classList.add("update-toast-downloading");
  const title = updateToast?.querySelector(".update-toast-title");
  if (title) title.textContent = "Downloading update…";
  if (updateToastInstall) updateToastInstall.hidden = true;
  if (updateToastIgnore) updateToastIgnore.hidden = true;
}

// A download that finished during an agent run waits for the operator. It
// still installs on the next quit, so "Later" only moves it to notifications.
export function showUpdateReadyToast(version) {
  showUpdateToast(version);
  const title = updateToast?.querySelector(".update-toast-title");
  if (title) title.textContent = "Update ready to install";
  const sub = updateToast?.querySelector(".update-toast-version");
  if (sub) sub.textContent = "Agent run active. Installs when you quit.";
  if (updateToastInstall) updateToastInstall.textContent = "Restart now";
  if (updateToastIgnore) updateToastIgnore.textContent = "Later";
}

export function ignoreCurrentUpdate() {
  if (updatesState.readyVersion) {
    hideUpdateToast();
    showUpdateNotification(updatesState.readyVersion);
    return;
  }
  const version = updatesState.availableVersion;
  updatesState.ignoredVersion = version;
  updatesState.deferredVersion = version;
  window.api.updatesIgnore?.({ version }).catch(() => {});
  hideUpdateToast();
  if (version) showUpdateNotification(version);
}

export function showUpdateNotification(version) {
  const v = String(version || "");
  if (!v) return;
  const ready = v === updatesState.readyVersion;
  updatesState.pendingNotification = {
    id: "update-available",
    title: ready ? `Update ready — XEKUTE ${v}` : `Update available — XEKUTE ${v}`,
    message: ready ? "Downloaded. Restart to install, or it installs when you quit." : "A new version has been released. Install it when you're ready.",
    action: "update-install",
    actionLabel: ready ? "Restart" : "Install",
    icon: "codicon-cloud-download",
    tone: "warning",
  };
  setNotifications(appState.notificationItems);
}

export function handleUpdateEvent(payload = {}) {
  const type = String(payload.type || "");
  if (type === "available") {
    const version = String(payload.version || "");
    updatesState.availableVersion = version;
    const ignored = Boolean(payload.ignored || (version && version === updatesState.ignoredVersion));
    // A newly released version supersedes an older ignored one. The newest
    // release gets one normal prompt even if several intermediate versions
    // were skipped.
    if (!ignored && version !== updatesState.ignoredVersion) {
      updatesState.ignoredVersion = "";
      updatesState.deferredVersion = "";
      updatesState.pendingNotification = null;
      setNotifications(appState.notificationItems);
    }
    // An explicit Help → Check for Updates still shows the ignored version.
    if (ignored && !payload.manual) {
      updatesState.deferredVersion = version;
      showUpdateNotification(version);
      return;
    }
    showUpdateToast(version);
  } else if (type === "downloading") {
    showUpdateDownloading(payload.version || updatesState.availableVersion || updatesState.deferredVersion);
    handleUpdateEvent({ type: "progress", percent: 0 });
  } else if (type === "progress") {
    if (!updateToast || updateToast.hidden) return;
    updateToast.classList.add("update-toast-downloading");
    if (updateToastInstall) updateToastInstall.hidden = true;
    if (updateToastIgnore) updateToastIgnore.hidden = true;
    let bar = updateToast.querySelector(".update-toast-progress");
    if (!bar) {
      updateToast.querySelector(".update-toast-actions")?.insertAdjacentHTML(
        "beforeend",
        '<span class="update-toast-progress"><i></i></span><span class="update-toast-progress-label">0%</span>'
      );
      bar = updateToast.querySelector(".update-toast-progress");
    }
    const percent = Math.max(0, Math.min(100, Math.round(Number(payload.percent) || 0)));
    bar.querySelector("i")?.style.setProperty("width", `${percent}%`);
    const label = updateToast.querySelector(".update-toast-progress-label");
    if (label) label.textContent = `${percent}%`;
  } else if (type === "downloaded") {
    updatesState.ignoredVersion = "";
    updatesState.deferredVersion = "";
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    if (payload.deferred) {
      updatesState.readyVersion = String(payload.version || updatesState.availableVersion || "");
      showUpdateReadyToast(updatesState.readyVersion);
      return;
    }
    const label = updateToast?.querySelector(".update-toast-progress-label");
    if (label) label.textContent = "Installing…";
    else showTransientUpdateNotice("Installing update…", "XEKUTE will restart automatically.");
    // The main process quits the app shortly after this event.
  } else if (type === "installing") {
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    const label = updateToast && !updateToast.hidden ? updateToast.querySelector(".update-toast-progress-label") : null;
    if (label) label.textContent = "Installing…";
    else showTransientUpdateNotice("Installing update…", "XEKUTE will restart automatically.");
  } else if (type === "none") {
    // Launch checks are silent. Explicit checks (including installing a stale
    // deferred reminder) give the user direct feedback.
    if (payload.manual || payload.reason === "install") {
      updatesState.ignoredVersion = "";
      updatesState.deferredVersion = "";
      updatesState.pendingNotification = null;
      setNotifications(appState.notificationItems);
      showTransientUpdateNotice("XEKUTE is up to date", "You're on the latest version.");
    }
  } else if (type === "updated") {
    updatesState.ignoredVersion = "";
    updatesState.deferredVersion = "";
    updatesState.pendingNotification = null;
    setNotifications(appState.notificationItems);
    showTransientUpdateNotice("XEKUTE is now up to date", `Updated successfully to version ${String(payload.version || "").trim()}.`);
  } else if (type === "disabled") {
    if (payload.manual || payload.reason === "install") {
      showTransientUpdateNotice("Development build", "Production updates are disabled. Set XEKUTE_UPDATE_MOCK=1 to test the update flow.");
    }
  } else if (type === "error") {
    if (payload.phase === "download" && updatesState.availableVersion) {
      updatesState.deferredVersion = updatesState.availableVersion;
      showUpdateNotification(updatesState.availableVersion);
    }
    if (payload.manual || payload.reason === "install" || payload.phase === "download") {
      showTransientUpdateNotice(
        "Update failed",
        String(payload.userMessage || "XEKUTE could not download or install the update. Try again from Help → Check for Updates."),
      );
    }
  }
}
