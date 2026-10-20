import { messages } from "../../core/dom-refs.js";
import { validPromptImages } from "./image-attachments.js";
import { appendFileTagText } from "./file-tags.js";
import { syncChatStickyMask } from "../../bootstrap.js";

export function syncUserPromptDisclosure(box) {
  const content = box?.querySelector(".chat-box-content.user-prompt-preview");
  if (!content || box.classList.contains("is-expanded") || content.clientHeight <= 0) return;
  const expandable = content.scrollHeight > content.clientHeight + 1;
  box.classList.toggle("user-prompt-expandable", expandable);
  if (expandable) {
    box.setAttribute("role", "button");
    box.setAttribute("tabindex", "0");
    box.setAttribute("aria-expanded", "false");
  } else {
    box.classList.remove("is-expanded");
    box.removeAttribute("role");
    box.removeAttribute("tabindex");
    box.removeAttribute("aria-expanded");
  }
}

export function refreshUserPromptDisclosures(root = messages) {
  root?.querySelectorAll(".chat-turn.user .chat-box").forEach(syncUserPromptDisclosure);
}

export function createUserPromptBox(text, images = []) {
  const box = document.createElement("div");
  box.className = "chat-box";
  const promptImages = validPromptImages(images);
  if (promptImages.length) {
    const strip = document.createElement("div");
    strip.className = "user-prompt-images";
    for (const image of promptImages) {
      const img = document.createElement("img");
      img.src = image.thumb;
      if (image.id) img.dataset.imageId = image.id;
      img.alt = "Attached image";
      img.title = "View image";
      strip.appendChild(img);
    }
    box.appendChild(strip);
  }
  const content = document.createElement("div");
  content.className = "chat-box-content user-prompt-preview";
  content.dataset.promptText = text;
  appendFileTagText(content, text);
  box.appendChild(content);
  requestAnimationFrame(() => syncUserPromptDisclosure(box));
  return box;
}

export function setUserPromptExpanded(box, expanded) {
  if (!box?.classList.contains("user-prompt-expandable")) return;
  box.classList.toggle("is-expanded", expanded);
  box.setAttribute("aria-expanded", String(expanded));
  requestAnimationFrame(() => {
    if (!expanded) syncUserPromptDisclosure(box);
    syncChatStickyMask();
  });
}

export function collapseExpandedUserPrompts(except = null) {
  messages?.querySelectorAll(".chat-box.user-prompt-expandable.is-expanded").forEach((box) => {
    if (box !== except) setUserPromptExpanded(box, false);
  });
}

export function placeCaretAtClientPoint(clientX, clientY) {
  const selection = window.getSelection?.();
  if (!selection) return false;
  selection.removeAllRanges();
  if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range) {
      selection.addRange(range);
      return true;
    }
  }
  if (typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(clientX, clientY);
    if (position) {
      const range = document.createRange();
      range.setStart(position.offsetNode, position.offset);
      range.collapse(true);
      selection.addRange(range);
      return true;
    }
  }
  return false;
}

export function focusUserPromptCaretAtEnd(content) {
  if (!content) return;
  content.focus({ preventScroll: false });
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(content);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function userPromptSelectionInside(content) {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || !content) return null;
  const node = selection.anchorNode;
  const host = node?.nodeType === 1 ? node : node?.parentElement;
  if (!host || !content.contains(host) && host !== content) return null;
  return selection;
}

export function selectWholeUserPrompt(content) {
  if (!content) return;
  content.focus({ preventScroll: false });
  const selection = window.getSelection?.();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(content);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function enableUserPromptReading(content) {
  if (!content) return;
  const text = content.textContent ?? "";
  content.contentEditable = "true";
  content.spellcheck = false;
  content.setAttribute("role", "textbox");
  content.setAttribute("aria-readonly", "true");
  if (content.textContent !== text) content.textContent = text;
}

export function disableUserPromptReading(content) {
  if (!content) return;
  const text = content.textContent ?? "";
  content.contentEditable = "false";
  content.removeAttribute("role");
  content.removeAttribute("aria-readonly");
  content.blur();
  content.replaceChildren();
  appendFileTagText(content, content.dataset.promptText ?? text);
}

export function deactivateUserPromptSelection(except = null) {
  let clearedSelection = false;
  messages?.querySelectorAll(".chat-turn.user .chat-box.user-prompt-selectable").forEach((box) => {
    if (box === except) return;
    box.classList.remove("user-prompt-selectable");
    disableUserPromptReading(box.querySelector(".chat-box-content"));
    if (box.classList.contains("user-prompt-expandable") && box.classList.contains("is-expanded")) {
      setUserPromptExpanded(box, false);
    } else {
      syncUserPromptDisclosure(box);
    }
    clearedSelection = true;
  });
  if (clearedSelection && !except) window.getSelection?.()?.removeAllRanges();
}

export function dismissUserPromptSelectionIfOutside(target) {
  if (target?.closest?.(".chat-turn.user .chat-box")) return;
  if (!messages?.querySelector(".chat-turn.user .chat-box.user-prompt-selectable")) return;
  deactivateUserPromptSelection();
  collapseExpandedUserPrompts();
}

export function activateUserPromptSelection(box, clientX = null, clientY = null) {
  if (!box?.classList.contains("chat-box")) return;
  const alreadyReading = box.classList.contains("user-prompt-selectable");
  deactivateUserPromptSelection(box);
  box.classList.add("user-prompt-selectable");
  box.removeAttribute("role");
  box.removeAttribute("tabindex");
  box.removeAttribute("aria-expanded");
  if (box.classList.contains("user-prompt-expandable") && !box.classList.contains("is-expanded")) {
    collapseExpandedUserPrompts(box);
    setUserPromptExpanded(box, true);
  }
  const content = box.querySelector(".chat-box-content");
  enableUserPromptReading(content);
  if (alreadyReading) return;
  const placeCaret = () => {
    if (!content || userPromptSelectionInside(content)) return;
    content.focus({ preventScroll: false });
    const placed = Number.isFinite(clientX) && Number.isFinite(clientY)
      ? placeCaretAtClientPoint(clientX, clientY)
      : false;
    if (!placed) focusUserPromptCaretAtEnd(content);
  };
  requestAnimationFrame(() => requestAnimationFrame(placeCaret));
}
