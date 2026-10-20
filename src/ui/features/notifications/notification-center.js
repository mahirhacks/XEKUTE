import { appState } from "../../core/app-state.js";
import {
  btnNotifications, notificationCount, notificationPanel, notificationList,
} from "../../core/dom-refs.js";
import { escapeHtml } from "../../core/text-format.js";
import { openAssessmentRepairDialog } from "../assessment/assessment-workspace.js";
import { beginUpdateInstallFromNotification, updatesState } from "../updates/update-flow.js";

export function setNotifications(items = []) {
  const baseItems = (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .filter((item) => item.id !== "update-available");
  const merged = updatesState.pendingNotification
    ? [updatesState.pendingNotification, ...baseItems]
    : baseItems;
  appState.notificationItems = merged.filter(Boolean);
  if (notificationCount) {
    notificationCount.textContent = String(appState.notificationItems.length);
    notificationCount.hidden = appState.notificationItems.length === 0;
  }
  if (btnNotifications) {
    btnNotifications.classList.toggle("has-notifications", appState.notificationItems.length > 0);
    btnNotifications.title = appState.notificationItems.length ? `${appState.notificationItems.length} notification${appState.notificationItems.length === 1 ? "" : "s"}` : "Notifications";
  }
  if (!notificationList) return;
  notificationList.innerHTML = appState.notificationItems.length
    ? appState.notificationItems.map((item) => `<article class="notification-item ${escapeHtml(item.tone || "warning")}"><span class="codicon ${escapeHtml(item.icon || "codicon-warning")}"></span><div><strong>${escapeHtml(item.title || "Notification")}</strong><p>${escapeHtml(item.message || "")}</p>${item.action ? `<button type="button" class="notification-action" data-notification-action="${escapeHtml(item.action)}">${escapeHtml(item.actionLabel || "Review")}</button>` : ""}</div></article>`).join("")
    : '<div class="notification-empty">No notifications</div>';
  notificationList.querySelectorAll("[data-notification-action]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.notificationAction === "assessment-repair") openAssessmentRepairDialog();
      if (button.dataset.notificationAction === "update-install") beginUpdateInstallFromNotification();
      if (notificationPanel) notificationPanel.hidden = true;
      btnNotifications?.setAttribute("aria-expanded", "false");
    }));
  }

export function positionNotificationPanel() {
  if (!notificationPanel || notificationPanel.hidden || !btnNotifications) return;
  const anchor = btnNotifications.getBoundingClientRect();
  const margin = 8;
  const width = notificationPanel.offsetWidth || 320;
  const height = notificationPanel.offsetHeight || 0;
  const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(anchor.bottom + 8, window.innerHeight - height - margin));
  notificationPanel.style.left = `${Math.round(left)}px`;
  notificationPanel.style.top = `${Math.round(top)}px`;
  notificationPanel.style.right = "auto";
}
