/* Images attached to a chat message (clip button, paste or drop).
 * Each image is downscaled once in the renderer: a model-sized copy is sent
 * with the run request, and a preview is shown in the composer and kept with
 * the sent message in the saved transcript, where it opens zoomed. */

export const MAX_CHAT_IMAGES = 10;
const MAX_EDGE = 1568;
// Previews are kept with the saved chat and opened in the zoomed view.
const THUMB_EDGE = 480;
const MAX_DATA_URL_CHARS = 2_000_000;
export const MAX_THUMB_CHARS = 120_000;
const SUPPORTED = /^image\/(?:png|jpeg|webp|gif|bmp)$/;
const THUMB_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isSupportedImageFile(file) {
  return SUPPORTED.test(String(file?.type || ""));
}

/** Adds `incoming` until `max` is reached; reports how many did not fit. */
export function mergeImageAttachments(existing = [], incoming = [], max = MAX_CHAT_IMAGES) {
  const room = Math.max(0, max - existing.length);
  return { list: [...existing, ...incoming.slice(0, room)], dropped: Math.max(0, incoming.length - room) };
}

const IMAGE_ID = /^[a-f0-9]{64}$/;

/**
 * Images of a sent message as kept in a saved transcript: the preview, plus
 * the id of the full-quality original stored with the chat. Older saves kept
 * only preview strings.
 */
export function validPromptImages(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => (typeof item === "string" ? { thumb: item } : { thumb: String(item?.thumb || ""), id: String(item?.id || "") }))
    .filter((item) => item.thumb.length <= MAX_THUMB_CHARS && THUMB_URL.test(item.thumb))
    .map((item) => (IMAGE_ID.test(item.id || "") ? item : { thumb: item.thumb }))
    .slice(0, MAX_CHAT_IMAGES);
}

/** The id the main process stores an image under: SHA-256 of its base64 data. */
export async function imageIdFor(dataUrl) {
  const data = String(dataUrl || "").split(",")[1] || "";
  const digest = await globalThis.crypto?.subtle?.digest?.("SHA-256", new TextEncoder().encode(data));
  return digest ? [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("") : "";
}

function draw(bitmap, edge, type, quality, doc) {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = doc.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (type === "image/jpeg") {
    // JPEG has no transparency; keep transparent areas white, not black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, quality);
}

// A busy image can make a large preview; lower its quality until it fits the
// limit a saved transcript accepts.
function preview(bitmap, doc) {
  let url = "";
  for (const quality of [0.75, 0.6, 0.45, 0.3]) {
    url = draw(bitmap, THUMB_EDGE, "image/jpeg", quality, doc);
    if (url.length <= MAX_THUMB_CHARS) return url;
  }
  return draw(bitmap, THUMB_EDGE / 2, "image/jpeg", 0.5, doc);
}

export async function prepareImageAttachment(file, doc = globalThis.document) {
  const bitmap = await createImageBitmap(file);
  try {
    // PNG and GIF may carry transparency, so they stay PNG unless that is too large.
    let mediaType = /png|gif/.test(file.type) ? "image/png" : "image/jpeg";
    let dataUrl = draw(bitmap, MAX_EDGE, mediaType, 0.88, doc);
    for (const quality of [0.85, 0.72, 0.6]) {
      if (dataUrl.length <= MAX_DATA_URL_CHARS) break;
      mediaType = "image/jpeg";
      dataUrl = draw(bitmap, MAX_EDGE, mediaType, quality, doc);
    }
    if (dataUrl.length > MAX_DATA_URL_CHARS) throw new Error(`${file.name || "Image"} is too large to attach.`);
    let storedId = "";
    try { storedId = await imageIdFor(dataUrl); } catch { /* the zoom view then uses the preview */ }
    return {
      id: `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      storedId,
      name: String(file.name || "image").slice(0, 200),
      mediaType,
      dataUrl,
      thumbUrl: preview(bitmap, doc),
    };
  } finally {
    bitmap.close?.();
  }
}
