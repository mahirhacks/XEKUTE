import { statusAgent, messages, chatHeader, chatPane, $, inputBar } from "../../core/dom-refs.js";
import { appState } from "../../core/app-state.js";
import { formatRelativeMessageTime } from "../../core/text-format.js";
import {
  ensureAgentResponseHost, chatExchangeBody, appendChatTurn, appendSteeringUserTurn,
} from "./turn-structure.js";
import { forkChatSession, syncChatEmptyState, activeChatSession } from "./chat-sessions.js";
import { chatScroller } from "../../bootstrap.js";
import { createUserPromptBox } from "./user-prompt-box.js";
import { activeChatRuns, isChatSessionRunning } from "./chat-run-state.js";

export function setAgentStatus(text) {
  const raw = String(text || "Ready");
  const value = /(?:^|\s)ready$/i.test(raw.trim())
    ? "Ready"
    : /stopping|stopped/i.test(raw) ? "Stopping…"
      : /warn|fail|error|blocked/i.test(raw) ? "Needs attention" : "Working…";
  if (statusAgent) statusAgent.textContent = value;
}

export function renderMarkdown(el, md, { streaming = false } = {}) {
  if (globalThis.MarkdownRenderer) {
    if (streaming) {
      globalThis.MarkdownRenderer.scheduleRender(el, () => md, true);
    } else {
      globalThis.MarkdownRenderer.renderToElement(el, md);
    }
  } else {
    el.dataset.rawMd = md;
    el.textContent = md;
  }
}

// Adds a single "Copy" button at the end of an AI response's exchange so the
// exact raw response can be copied. One button per user⇄assistant exchange
// (a "session"), not per individual message segment. Idempotent across
// re-renders: never adds more than one button per exchange.
export async function writeChatClipboardText(text) {
  const value = String(text ?? "");
  if (!value) return { ok: false, error: "Nothing to copy." };
  if (window.api?.copyText) {
    const result = await window.api.copyText(value);
    if (result?.ok === false) throw new Error(result.error?.message || result.error || "Clipboard write failed.");
    return { ok: true };
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return { ok: true };
  }
  throw new Error("Clipboard access is unavailable.");
}

export function attachAssistantCopyButton(contentEl) {
  if (!contentEl?.classList?.contains("assistant-reply")) return;
  const turn = contentEl.closest(".chat-turn.assistant");
  if (!turn) return;
  const exchange = turn.closest(".chat-exchange") || turn;

  // A restored transcript can contain several assistant messages for one
  // user exchange, and an automatic continuation can resume an exchange that
  // already had a footer. Rebuild it at the end of the chunk body so copy/time
  // stay inside the user prompt + assistant response group.
  exchange.querySelectorAll(".assistant-reply-footer").forEach((node) => node.remove());
  const assistantStillRunning = [...exchange.querySelectorAll(".chat-turn.assistant")]
    .some((assistantTurn) => assistantTurn.getAttribute("aria-busy") === "true");
  const subagentStillRunning = [...exchange.querySelectorAll(".subagent-run-card")]
    .some((card) => ["queued", "running", "working"].includes(String(card.dataset.state || "")));
  if (assistantStillRunning || subagentStillRunning) return;

  // One timestamp per exchange, taken from the first assistant reply in it.
  const firstAssistantTurn = exchange.querySelector(".chat-turn.assistant");
  const createdIso = firstAssistantTurn?.dataset?.createdAt || turn.dataset.createdAt || "";
  const timeLabel = document.createElement("span");
  timeLabel.className = "assistant-reply-time";
  timeLabel.textContent = formatRelativeMessageTime(createdIso);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "assistant-reply-copy";
  button.setAttribute("aria-label", "Copy AI response");
  button.title = "Copy";

  const swapIcon = (icon) => {
    button.innerHTML = icon === "codicon-copy"
      ? '<img class="chat-action-icon" src="assets/icons/copy_icon.svg" alt="" aria-hidden="true">'
      : `<span class="codicon ${icon}" aria-hidden="true"></span>`;
  };
  swapIcon("codicon-copy");
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const assistantTurns = [...exchange.querySelectorAll(".chat-turn.assistant[data-raw-assistant]")];
    const turnParts = assistantTurns
      .map((assistantTurn) => String(assistantTurn.dataset.rawAssistant || "").trim())
      .filter(Boolean);
    const replies = [...exchange.querySelectorAll(".assistant-reply[data-raw-md], .assistant-reply")];
    const parts = turnParts.length ? turnParts : replies
      .map((reply) => String(reply.dataset.rawMd || reply.textContent || "").trim())
      .filter(Boolean);
    const text = parts.join("\n\n");
    if (!text) return;
    const done = () => {
      swapIcon("codicon-check");
      button.title = "Copied";
      button.setAttribute("aria-label", "Copied");
      setTimeout(() => {
        swapIcon("codicon-copy");
        button.title = "Copy";
        button.setAttribute("aria-label", "Copy AI response");
      }, 1500);
    };
    const fail = () => button.classList.add("copy-failed");
    // Prefer Electron's native clipboard (reliable in renderers); fall back to
    // the browser Clipboard API only when the IPC bridge is unavailable.
    writeChatClipboardText(text).then(done).catch(fail);
  });

  const forkButton = document.createElement("button");
  forkButton.type = "button";
  forkButton.className = "assistant-reply-copy assistant-reply-fork";
  forkButton.setAttribute("aria-label", "Fork chat");
  forkButton.title = "Fork chat";
  forkButton.innerHTML = '<img class="chat-action-icon" src="assets/icons/fork.svg" alt="" aria-hidden="true">';
  forkButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    forkChatSession(appState.activeChatSessionId);
  });

  const footer = document.createElement("div");
  footer.className = "assistant-reply-footer";
  footer.appendChild(button);
  footer.appendChild(forkButton);
  footer.appendChild(timeLabel);
  const host = ensureAgentResponseHost(exchange) || chatExchangeBody(exchange);
  host.appendChild(footer);
}

export function syncChatStickyMask() {
  if (!chatPane || !messages || appState.chatStickyMaskFrame) return;
  appState.chatStickyMaskFrame = requestAnimationFrame(() => {
    appState.chatStickyMaskFrame = 0;
    const paneRect = chatPane.getBoundingClientRect();
    const messagesRect = messages.getBoundingClientRect();
    const maskTop = chatHeader?.getBoundingClientRect().bottom || (paneRect.top + 35);
    const visibleBoxes = [...messages.querySelectorAll(".chat-turn.user:not(.chat-turn.user ~ .chat-turn.user) .chat-box")]
      .map((box) => ({ box, rect: box.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > messagesRect.top && rect.top < messagesRect.bottom);

    if (!visibleBoxes.length || paneRect.width <= 0 || paneRect.height <= 0) {
      chatPane.style.removeProperty("--chat-sticky-mask-solid-height");
      return;
    }

    const stickyLine = messagesRect.top + 16;
    const pinned = visibleBoxes.filter(({ rect }) => rect.top <= stickyLine && rect.bottom > messagesRect.top);
    const target = (pinned.length ? pinned : visibleBoxes)
      .sort((a, b) => pinned.length ? b.rect.top - a.rect.top : a.rect.top - b.rect.top)[0];
    const promptBottom = target.rect.bottom - maskTop;
    const solidHeight = Math.max(0, Math.ceil(promptBottom));
    chatPane.style.setProperty("--chat-sticky-mask-solid-height", `${solidHeight}px`);
  });
}

export function scrollMessages({ force = false } = {}) {
  chatScroller.follow({ force });
}

export function syncScrollerScrollbarHover(scroller, event) {
  if (!scroller || !event) return;
  const rect = scroller.getBoundingClientRect();
  const reservedWidth = scroller.offsetWidth - scroller.clientWidth;
  const scrollbarLaneWidth = Math.max(12, reservedWidth + 2);
  const inScrollbarLane = event.clientX >= rect.right - scrollbarLaneWidth
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  scroller.classList.toggle("scrollbar-hover", inScrollbarLane);
}

export function bindScrollbarHoverLane(scroller) {
  if (!scroller) return;
  const sync = (event) => syncScrollerScrollbarHover(scroller, event);
  scroller.addEventListener("pointermove", sync, { passive: true });
  scroller.addEventListener("mousemove", sync, { passive: true });
  scroller.addEventListener("pointerleave", () => scroller.classList.remove("scrollbar-hover"), { passive: true });
  scroller.addEventListener("mouseleave", () => scroller.classList.remove("scrollbar-hover"), { passive: true });
}

export function conciseAgentStatus(text = "", kind = "working") {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const lower = value.toLowerCase();
  if (kind === "thinking" || /thinking|reasoning/.test(lower)) return "Thinking\u2026";
  if (kind === "question") return "Waiting for input";
  if (kind === "error" || /fail|error|blocked/.test(lower)) return "Action failed";
  if (kind === "success") return "Action complete";
  if (kind === "verify") return "Verifying\u2026";
  if (kind === "planning") return "Planning\u2026";
  if (/retry|trying again/.test(lower)) return "Trying again\u2026";
  if (/writing response|drafting|composing/.test(lower)) return "Writing response\u2026";
  if (/terminal|command/.test(lower)) return "Running command\u2026";
  if (/edit|patch|writ|creat|delet|mutat/.test(lower)) return "Editing files\u2026";
  if (/search|grep|find/.test(lower)) return "Searching workspace\u2026";
  if (/read/.test(lower)) return "Reading files\u2026";
  if (/inspect|context|discover|inventory/.test(lower)) return "Inspecting workspace\u2026";
  if (/verify|verification|checking|test result/.test(lower)) return "Verifying\u2026";
  if (/plan|preflight|ground/.test(lower)) return "Planning\u2026";
  if (/complete|finished|ready/.test(lower)) return "Action complete";
  if (/tool|using|execut|action|working|running|starting/.test(lower)) return "Working\u2026";
  return value ? `${value.slice(0, 68)}${value.length > 68 ? "\u2026" : ""}` : "Working\u2026";
}

export function isSilentToolRoutingActivity(text = "") {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return /^(?:no tools? (?:were )?(?:routed|used|called)(?: for this request)?\.?|profile .+ routed 0 tools?)$/i.test(value);
}

export function latestExchangeUserPromptText(container = messages) {
  const exchange = container?.querySelector?.(":scope > .chat-exchange:last-child");
  if (!exchange || exchange.querySelector(":scope > .chat-turn.assistant")) return "";
  const userTurn = [...exchange.querySelectorAll(":scope > .chat-turn.user")].at(-1);
  return String(userTurn?.querySelector(".chat-box-content")?.textContent || "").trim();
}

export function mergeAppendedChatMessages(history, appended) {
  const list = Array.isArray(history) ? history : [];
  const seenIds = new Set(list.map((message) => String(message?.id || "")).filter(Boolean));
  for (const message of Array.isArray(appended) ? appended : []) {
    if (!message || typeof message !== "object") continue;
    const id = String(message.id || "");
    if (id && seenIds.has(id)) continue;
    if (message.role === "user") {
      const last = list.at(-1);
      if (last?.role === "user" && String(last.content || "") === String(message.content || "")) continue;
    }
    if (id) seenIds.add(id);
    list.push(message);
  }
  return list;
}

export function addUserMessage(text, sourceMessageId = "", images = []) {
  const value = String(text || "");
  if (sourceMessageId && [...messages.querySelectorAll(".chat-turn.user")].some((turn) => turn.dataset.sourceMessageId === sourceMessageId)) return;
  if (!sourceMessageId && value && latestExchangeUserPromptText() === value.trim()) return;
  const run = activeChatRuns.get(appState.activeChatSessionId);
  const running = run && isChatSessionRunning(appState.activeChatSessionId);
  const turn = document.createElement("div");
  turn.className = "chat-turn user";
  turn.dataset.sourceMessageId = sourceMessageId;
  turn.dataset.taskId = running ? String(run.taskId || run.session?.taskId || "") : "";
  turn.dataset.createdAt = new Date().toISOString();
  const box = createUserPromptBox(value, images);
  turn.appendChild(box);
  const initialUserTurn = running && run.initialInputId
    ? [...messages.querySelectorAll(".chat-turn.user")].find((item) => item.dataset.sourceMessageId === run.initialInputId)
    : null;
  const exchange = running
    ? run.assistant?.turn?.closest(".chat-exchange") || initialUserTurn?.closest(".chat-exchange")
    : null;
  if (exchange) appendSteeringUserTurn(turn, exchange, run.assistant);
  else appendChatTurn(turn, { startsExchange: true });
  syncChatStickyMask();
  syncChatEmptyState();
  scrollMessages({ force: true });
  return turn;
}

export const CHAT_ERROR_TOAST_MS = 15_000;

export function hideChatErrorToast() {
  if (appState.chatErrorToastTimer) {
    clearTimeout(appState.chatErrorToastTimer);
    appState.chatErrorToastTimer = 0;
  }
  const toast = $("chat-error-toast");
  if (toast) toast.hidden = true;
}

export function ensureChatErrorToast() {
  let toast = $("chat-error-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "chat-error-toast";
    toast.className = "chat-error-toast";
    toast.hidden = true;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.innerHTML = `<p class="chat-error-toast-text"></p><button type="button" class="chat-error-toast-close" title="Dismiss" aria-label="Dismiss"><span class="codicon codicon-close" aria-hidden="true"></span></button>`;
    const host = inputBar || $("input-bar");
    const composer = host?.querySelector?.(".composer");
    if (host && composer) host.insertBefore(toast, composer);
    else host?.insertBefore?.(toast, host.firstChild);
  }
  if (toast && toast.dataset.bound !== "1") {
    toast.dataset.bound = "1";
    toast.querySelector(".chat-error-toast-close")?.addEventListener("click", hideChatErrorToast);
  }
  return toast;
}

export function addErrorMessage(text, { container = messages, session = activeChatSession() } = {}) {
  void container;
  void session;
  const message = String(text || "").trim();
  if (!message) return;
  const toast = ensureChatErrorToast();
  const label = toast?.querySelector?.(".chat-error-toast-text");
  if (label) label.textContent = message;
  if (!toast) return;
  toast.hidden = false;
  if (appState.chatErrorToastTimer) clearTimeout(appState.chatErrorToastTimer);
  appState.chatErrorToastTimer = setTimeout(hideChatErrorToast, CHAT_ERROR_TOAST_MS);
}

export function agentStateKindForText(text = "") {
  const value = String(text || "").toLowerCase();
  if (/thinking|reasoning/.test(value)) return "thinking";
  if (/question|clarif|need your input/.test(value)) return "question";
  if (/verify|verification|checking|test result|finished|complete|ready/.test(value)) return "verify";
  if (/plan|ground|inspect|analyz|preflight|context|discover/.test(value)) return "planning";
  if (/tool|terminal|command|running|using|execut|action|reading|writing/.test(value)) return "working";
  if (/fail|error|stopp|warn|blocked|denied/.test(value)) return "error";
  return "working";
}

export function agentStateIcon(kind = "working") {
  return {
    thinking: "codicon-loading codicon-modifier-spin",
    planning: "codicon-checklist",
    working: "codicon-tools",
    question: "codicon-comment-discussion",
    verify: "codicon-verified",
    success: "codicon-check",
    error: "codicon-error",
  }[kind] || "codicon-sparkle";
}
