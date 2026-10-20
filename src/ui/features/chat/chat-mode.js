import {
  CHAT_PROFILE_KEYS, ToolMap, updateContextUsage, setAgentStatus, closeAuthorityMenu,
  closeModelMenu,
} from "../../bootstrap.js";
import { appState } from "../../core/app-state.js";
import {
  chatInput, chatModeButton, chatModeIcon, chatModeButtonLabel, chatModeMenu,
} from "../../core/dom-refs.js";
import { isRunningChatActive, activeSessionRun } from "./chat-run-state.js";
import { syncActiveChatSession } from "./chat-sessions.js";

export const CHAT_MODE_KEY = "pointer:chatMode";
export const CHAT_FAMILY_KEY = "pointer:chatFamily";

export const CHAT_ROLES = new Set(["agent", "ask"]);
export const CHAT_FAMILIES = new Set(["testing", "assist", "xekute"]);
export const CHAT_PROFILE_DEFS = ToolParser.MODE_PROFILES || {};

export const CHAT_ROLE_ALIASES = Object.freeze({
  "testing:analyze": "ask",
  "testing:execution": "agent",
  "testing:exploit": "agent",
  "assist:executor": "agent",
  "assist:observer": "ask",
  "assist:verifier": "ask",
  "assist:reporter": "ask",
  "assist:ask": "ask",
  "assist:hypothesis": "ask",
  "assist:planner": "ask",
  "assist:agent": "agent",
  "testing:ask": "ask",
  "testing:hypothesis": "ask",
  "testing:planner": "ask",
  "testing:agent": "agent",
  ask: "ask",
  hypothesis: "ask",
  plan: "ask",
  planner: "ask",
  agent: "agent",
});

export function canonicalChatMode(value) {
  const raw = String(value || "").toLowerCase();
  const aliased = CHAT_ROLE_ALIASES[raw] || raw;
  if (CHAT_PROFILE_KEYS.has(aliased)) return aliased;
  const role = aliased.includes(":") ? aliased.split(":").pop() : aliased;
  if (CHAT_ROLES.has(role)) return role;
  return "agent";
}

export function modeLabel(mode = appState.chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode)] || {};
  return profile?.label || "Agent";
}

export function modeButtonClass(mode = appState.chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode)];
  if (profile?.key === "agent" || profile?.key === "executor" || profile?.key === "execution" || profile?.key === "exploit") return "mode-agent";
  return "mode-ask";
}

export function modeIconClass(mode = appState.chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode)];
  if (profile?.key === "agent" || profile?.key === "executor") return "codicon-copilot";
  return "codicon-comment-discussion";
}

export function modePlaceholder(mode = appState.chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode)];
  if (profile?.key === "ask") return "Ask, analyze, observe, or explain";
  if (profile?.key === "agent") return "Describe the investigation or workspace action";
  return "Ask, investigate, run, or search";
}

export function syncChatInputPlaceholder() {
  if (chatInput) chatInput.placeholder = appState.selectedSlashCommand ? "" : modePlaceholder();
}

export function modeTools(mode = appState.chatMode) {
  const profile = CHAT_PROFILE_DEFS[canonicalChatMode(mode)] || {};
  return ToolMap.toolsForProfile(profile.key || appState.chatMode || "agent");
}

export function syncChatModeUi() {
  if (chatModeButton) {
    chatModeButton.classList.remove("mode-ask", "mode-agent", "mode-exploit");
    chatModeButton.classList.add(modeButtonClass());
  }
  if (chatModeButtonLabel) {
    chatModeButtonLabel.textContent = modeLabel();
  }
  if (chatModeButton) chatModeButton.title = `${modeLabel()} mode`;
  if (chatModeIcon) {
    chatModeIcon.classList.remove("codicon-copilot", "codicon-comment-discussion", "codicon-play", "codicon-warning", "codicon-shield", "codicon-search", "codicon-eye", "codicon-verified", "codicon-file-text");
    chatModeIcon.classList.add(modeIconClass());
  }
  chatModeMenu?.querySelectorAll("[data-chat-mode]").forEach((button) => {
    const active = button.dataset.chatMode === appState.chatMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  syncChatInputPlaceholder();
  const liveRun = activeSessionRun();
  setAgentStatus(isRunningChatActive()
    ? `${modeLabel(liveRun?.mode || appState.chatMode)} working`
    : `${modeLabel()} ready`);
  updateContextUsage();
  if (chatModeMenu && !chatModeMenu.hidden) {
    requestAnimationFrame(() => positionChatModeMenu());
  }
}

export function openChatModeMenu() {
  if (!chatModeMenu || !chatModeButton) return;
  closeModelMenu();
  closeAuthorityMenu();
  chatModeMenu.hidden = false;
  chatModeButton.setAttribute("aria-expanded", "true");
  positionChatModeMenu();
}

export function closeChatModeMenu() {
  if (!chatModeMenu || !chatModeButton) return;
  chatModeMenu.hidden = true;
  chatModeButton.setAttribute("aria-expanded", "false");
}

export function toggleChatModeMenu() {
  if (!chatModeMenu || !chatModeButton) return;
  if (chatModeMenu.hidden) openChatModeMenu();
  else closeChatModeMenu();
}

export function positionChatModeMenu() {
  if (!chatModeMenu || !chatModeButton || chatModeMenu.hidden) return;
  const rect = chatModeButton.getBoundingClientRect();
  const menuW = chatModeMenu.offsetWidth || 174;
  const pad = 8;
  // Keep the bottom edge anchored above the trigger. Extra content can only
  // move the top edge upward; it must never push the picker downward.
  chatModeMenu.style.maxHeight = `${Math.max(120, rect.top - pad * 2)}px`;
  const menuH = chatModeMenu.offsetHeight || 99;
  let left = Math.min(rect.left, window.innerWidth - menuW - pad);
  // Keep the picker anchored above the Agent button. When the menu is taller
  // than the available space, clamp its top instead of letting it flip below.
  const top = Math.max(pad, rect.top - menuH - pad);
  left = Math.max(pad, left);
  chatModeMenu.style.left = `${left}px`;
  chatModeMenu.style.top = `${top}px`;
}

export function setChatMode(mode) {
  const canonical = canonicalChatMode(mode);
  if (!CHAT_ROLES.has(canonical) && !CHAT_PROFILE_KEYS.has(canonical)) return;
  appState.chatMode = canonical;
  appState.chatFamily = "xekute";
  localStorage.setItem(CHAT_MODE_KEY, canonical);
  localStorage.setItem(CHAT_FAMILY_KEY, appState.chatFamily);
  closeChatModeMenu();
  syncChatModeUi();
  syncActiveChatSession();
  chatInput?.focus();
}

export function setChatFamily(_family) {
  appState.chatFamily = "xekute";
  localStorage.setItem(CHAT_FAMILY_KEY, appState.chatFamily);
  syncChatModeUi();
  syncActiveChatSession();
}
