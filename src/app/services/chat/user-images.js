"use strict";

/**
 * Images the operator attaches to a chat message.
 *
 * They travel with the run request only. They are attached to the run's user
 * message when each model request is built, so they never enter chat history,
 * checkpoints or Tier 1 memory.
 */

const MAX_USER_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

function decodedSize(base64) {
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

/** Validates renderer input; returns { ok, images } or { ok: false, error }. */
function normalizeUserImages(raw) {
  if (raw == null) return { ok: true, images: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Attached images must be a list." };
  if (raw.length > MAX_USER_IMAGES) return { ok: false, error: `Attach at most ${MAX_USER_IMAGES} images.` };
  const images = [];
  let total = 0;
  for (const item of raw) {
    const match = DATA_URL.exec(String(item?.dataUrl || ""));
    if (!match) return { ok: false, error: "Attached images must be PNG, JPEG or WebP." };
    const bytes = decodedSize(match[2]);
    if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: "An attached image is larger than 5 MB." };
    total += bytes;
    if (total > MAX_TOTAL_IMAGE_BYTES) return { ok: false, error: "Attached images are larger than 12 MB in total." };
    images.push({ name: String(item?.name || "image").slice(0, 200), mediaType: match[1], data: match[2] });
  }
  return { ok: true, images };
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((part) => part?.type === "text").map((part) => part.text).join("");
  return String(content ?? "");
}

/**
 * Returns a copy of `messages` with the images on the run's user message: the
 * last user message whose text is `text`. OpenRouter takes content parts;
 * Ollama takes base64 strings in `images`.
 */
function attachUserImages(messages, { text, images, provider }) {
  if (!Array.isArray(messages) || !images?.length) return messages;
  const wanted = String(text || "").trim();
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "user" && messageText(message.content).trim() === wanted) { index = i; break; }
  }
  if (index < 0) return messages;
  const target = messages[index];
  const attached = provider === "openrouter"
    ? {
      ...target,
      content: [
        { type: "text", text: messageText(target.content) },
        ...images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } })),
      ],
    }
    : { ...target, content: messageText(target.content), images: images.map((image) => image.data) };
  const next = messages.slice();
  next[index] = attached;
  return next;
}

module.exports = { MAX_USER_IMAGES, normalizeUserImages, attachUserImages };
