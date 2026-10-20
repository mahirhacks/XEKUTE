import {
  MAX_CHAT_IMAGES, isSupportedImageFile, mergeImageAttachments, prepareImageAttachment,
} from "./image-attachments.js";
import { appState } from "../../core/app-state.js";
import { attachImageBtn, composerAttachmentsEl, chatInput } from "../../core/dom-refs.js";
import { updateSendBtn } from "./composer-input.js";

export function renderComposerAttachments() {
  if (!composerAttachmentsEl) return;
  composerAttachmentsEl.replaceChildren();
  composerAttachmentsEl.hidden = !appState.composerImages.length;
  for (const image of appState.composerImages) {
    const item = document.createElement("div");
    item.className = "composer-attachment";
    item.title = image.name;
    const img = document.createElement("img");
    img.src = image.thumbUrl;
    img.alt = image.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "composer-attachment-remove";
    remove.title = "Remove image";
    remove.setAttribute("aria-label", `Remove ${image.name}`);
    remove.innerHTML = '<span class="codicon codicon-close" aria-hidden="true"></span>';
    remove.addEventListener("click", () => {
      appState.composerImages = appState.composerImages.filter((item) => item.id !== image.id);
      renderComposerAttachments();
      updateSendBtn();
    });
    item.append(img, remove);
    composerAttachmentsEl.appendChild(item);
  }
  if (attachImageBtn) attachImageBtn.disabled = appState.composerImages.length >= MAX_CHAT_IMAGES;
}

// Files past the tenth image, unsupported types and unreadable images are
// skipped silently.
export async function addComposerImageFiles(files = []) {
  const room = Math.max(0, MAX_CHAT_IMAGES - appState.composerImages.length);
  const prepared = [];
  for (const file of [...files].filter(isSupportedImageFile).slice(0, room)) {
    try { prepared.push(await prepareImageAttachment(file)); } catch { /* skipped */ }
  }
  appState.composerImages = mergeImageAttachments(appState.composerImages, prepared).list;
  renderComposerAttachments();
  updateSendBtn();
  chatInput?.focus();
}

// Full-resolution copies of images sent in this window, keyed by their saved
// preview, so the zoomed view is sharp until the chat is reloaded.
export const sentImageOriginals = new Map();

export function rememberSentImageOriginals(images = []) {
  for (const image of images) sentImageOriginals.set(image.thumbUrl, image.dataUrl);
  while (sentImageOriginals.size > 100) sentImageOriginals.delete(sentImageOriginals.keys().next().value);
}

export function takeComposerImages() {
  const taken = appState.composerImages;
  appState.composerImages = [];
  renderComposerAttachments();
  rememberSentImageOriginals(taken);
  return taken;
}

// Pasted or dropped image files attach like the clip button. Text pastes and
// in-app drags (file tree rows) carry no image files and are left alone.
export function imageFilesFrom(dataTransfer) {
  return [...(dataTransfer?.files || [])].filter(isSupportedImageFile);
}

export const hasDraggedFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
