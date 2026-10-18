/* Full-size view of an image attached to a sent message. Closes with the ×
 * pinned to the window's top-right, Escape, or a click on the backdrop. The
 * bar pinned at the bottom centre zooms in and out (also +, - and 0). */

const ZOOM_STEP = 1.25;
// Zoom is relative to the fitted size: 100% is the image fitted to the window.
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
// Room around the fitted image so it clears the pinned close button and bar.
const SIDE_GAP = 112;
const VERTICAL_GAP = 160;

let openLightbox = null;

export function closeImageLightbox() {
  openLightbox?.close();
}

function iconButton(doc, className, label, icon) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = className;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<span class="codicon ${icon}" aria-hidden="true"></span>`;
  return button;
}

export function openImageLightbox(src, { alt = "Attached image", doc = globalThis.document } = {}) {
  if (!src || !doc?.body) return null;
  closeImageLightbox();
  const view = doc.defaultView || globalThis;
  const previousFocus = doc.activeElement;
  const overlay = doc.createElement("div");
  overlay.className = "image-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", alt);
  const frame = doc.createElement("div");
  frame.className = "image-lightbox-frame";
  const img = doc.createElement("img");
  img.className = "image-lightbox-image";
  img.src = src;
  img.alt = alt;
  const close = iconButton(doc, "image-lightbox-close", "Close image", "codicon-close");
  const bar = doc.createElement("div");
  bar.className = "image-lightbox-zoom";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Zoom");
  const zoomIn = iconButton(doc, "image-lightbox-zoom-button", "Zoom in", "codicon-add");
  const level = doc.createElement("span");
  level.className = "image-lightbox-zoom-level";
  level.setAttribute("aria-live", "polite");
  const zoomOut = iconButton(doc, "image-lightbox-zoom-button", "Zoom out", "codicon-remove");
  const divider = () => {
    const line = doc.createElement("span");
    line.className = "image-lightbox-zoom-divider";
    line.setAttribute("aria-hidden", "true");
    return line;
  };
  bar.append(zoomIn, divider(), level, divider(), zoomOut);
  // The close button and the zoom bar are pinned to the window, not the image,
  // so they stay in place at any zoom level and while the view scrolls.
  frame.append(img);
  overlay.append(frame, close, bar);

  // The fitted size fills the window (enlarging small images at most 3x) and
  // follows window resizes; zoom scales from it, so the same view reads the
  // same percentage whether the full image or the saved preview is shown.
  let zoom = 1;
  const fittedScale = () => Math.min(
    3,
    Math.min(1400, view.innerWidth - SIDE_GAP) / img.naturalWidth,
    (view.innerHeight - VERTICAL_GAP) / img.naturalHeight,
  );
  const apply = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const scale = fittedScale() * zoom;
    img.style.width = `${Math.max(1, Math.round(img.naturalWidth * scale))}px`;
    img.style.height = `${Math.max(1, Math.round(img.naturalHeight * scale))}px`;
    level.textContent = `${Math.round(zoom * 100)}%`;
    zoomIn.disabled = zoom >= MAX_ZOOM - 1e-9;
    zoomOut.disabled = zoom <= MIN_ZOOM + 1e-9;
  };
  const fit = apply;
  const zoomBy = (factor) => {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    apply();
  };
  const refit = () => { zoom = 1; apply(); };
  img.addEventListener("load", fit);
  view.addEventListener("resize", fit);
  zoomIn.addEventListener("click", () => zoomBy(ZOOM_STEP));
  zoomOut.addEventListener("click", () => zoomBy(1 / ZOOM_STEP));
  level.addEventListener("dblclick", refit);

  const onKey = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") controller.close();
    else if (event.key === "+" || event.key === "=") zoomBy(ZOOM_STEP);
    else if (event.key === "-") zoomBy(1 / ZOOM_STEP);
    else if (event.key === "0") refit();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const controller = {
    overlay,
    zoom: () => zoom,
    // Swap in a sharper copy; the view keeps its zoom level.
    setSource(url) {
      if (openLightbox === controller && url) img.src = url;
    },
    close() {
      if (openLightbox !== controller) return;
      openLightbox = null;
      doc.removeEventListener("keydown", onKey, true);
      view.removeEventListener("resize", fit);
      overlay.remove();
      previousFocus?.focus?.();
    },
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) controller.close();
  });
  close.addEventListener("click", () => controller.close());
  doc.addEventListener("keydown", onKey, true);
  doc.body.appendChild(overlay);
  openLightbox = controller;
  if (img.complete) fit();
  // The click that opened the view may still move focus; take it afterwards.
  view.requestAnimationFrame(() => close.focus());
  return controller;
}
