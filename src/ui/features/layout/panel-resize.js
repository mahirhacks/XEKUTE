import { appState } from "../../core/app-state.js";
import { chatPane, chatResize } from "../../core/dom-refs.js";

export const EDITOR_MIN_HEIGHT = 120;
export const WORKBENCH_MIN_H = 80;  // min height for history panel when dragging
export const WORKBENCH_TOOL_MIN_H = 120; // min height for the tool panel (interceptor etc.)

export const UI_ZOOM_KEY = "pointer:uiZoom";

// Zoom is applied as native page zoom. The chosen level is kept, but the
// applied level is capped so the layout always has at least this many CSS
// pixels; growing the window restores the chosen level.
export const UI_MIN_LAYOUT_WIDTH = 640;
export const UI_MIN_LAYOUT_HEIGHT = 480;

export function applyUiZoom() {
  if (!window.api?.setUiZoom) return;
  const current = Number(window.api.getUiZoom?.()) || 1;
  const fit = Math.min(
    (window.innerWidth * current) / UI_MIN_LAYOUT_WIDTH,
    (window.innerHeight * current) / UI_MIN_LAYOUT_HEIGHT,
  );
  const next = Math.max(0.5, Math.min(appState.uiZoom, Math.floor(fit * 100) / 100));
  if (Math.abs(next - current) > 0.001) window.api.setUiZoom(next);
}

export function setUiZoom(value) {
  appState.uiZoom = Math.round(Math.max(0.8, Math.min(1.5, Number(value) || 1)) * 10) / 10;
  localStorage.setItem(UI_ZOOM_KEY, String(appState.uiZoom));
  applyUiZoom();
}

export function makeDraggable(handle, onMove, { onStart, onEnd } = {}) {
  if (!handle) return;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    let latestEvent = null;
    let animationFrame = 0;
    const resizeClass = handle.classList.contains("sash-h") ? "resizing-row" : "resizing-column";

    const flush = () => {
      animationFrame = 0;
      if (!latestEvent) return;
      const next = latestEvent;
      latestEvent = null;
      onMove(next);
    };
    const move = (next) => {
      if (next.pointerId !== pointerId) return;
      latestEvent = next;
      if (!animationFrame) animationFrame = requestAnimationFrame(flush);
    };
    const finish = (next) => {
      if (next.pointerId !== pointerId) return;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (latestEvent) flush();
      handle.classList.remove("dragging");
      document.documentElement.classList.remove("panel-resizing", resizeClass);
      handle.releasePointerCapture?.(pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      onEnd?.(next);
    };

    handle.classList.add("dragging");
    document.documentElement.classList.add("panel-resizing", resizeClass);
    handle.setPointerCapture?.(pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    onStart?.(event);
  });
}

export const CHAT_MIN_VIEWPORT_RATIO = 0.2;

export function chatViewportMinWidth() {
  return Math.floor(window.innerWidth * CHAT_MIN_VIEWPORT_RATIO);
}

export function chatViewportMaxWidth() {
  return Math.max(chatViewportMinWidth(), Math.floor(window.innerWidth * 0.5));
}

export function syncChatResizeLimit({ clamp = false } = {}) {
  const min = chatViewportMinWidth();
  const max = chatViewportMaxWidth();
  chatResize?.setAttribute("aria-valuemin", String(min));
  chatResize?.setAttribute("aria-valuemax", String(max));
  if (clamp && chatPane && !chatPane.classList.contains("collapsed")) {
    const width = Math.min(max, Math.max(min, chatPane.offsetWidth));
    chatPane.style.width = `${width}px`;
    chatResize?.setAttribute("aria-valuenow", String(Math.round(chatPane.offsetWidth)));
  }
  return max;
}

export function installSeparatorKeyboard(handle, { orientation, minimum, maximum, read, write, step = 8, reset }) {
  if (!handle) return;
  const readMinimum = () => typeof minimum === "function" ? minimum() : minimum;
  const sync = () => handle.setAttribute("aria-valuenow", String(Math.round(read())));
  sync();
  handle.addEventListener("keydown", (event) => {
    const decrement = orientation === "vertical" ? "ArrowLeft" : "ArrowUp";
    const increment = orientation === "vertical" ? "ArrowRight" : "ArrowDown";
    let next = read();
    if (event.key === decrement) next -= step;
    else if (event.key === increment) next += step;
    else if (event.key === "Home") next = readMinimum();
    else if (event.key === "End") next = maximum();
    else return;
    event.preventDefault();
    write(Math.max(readMinimum(), Math.min(maximum(), next)));
    sync();
  });
  handle.addEventListener("dblclick", () => {
    reset?.();
    requestAnimationFrame(sync);
  });
}
