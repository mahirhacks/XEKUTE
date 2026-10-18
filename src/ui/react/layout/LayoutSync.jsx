import React, { useEffect, useRef } from "react";
import { useLayout } from "./LayoutContext.jsx";
import { fitPanelWidths } from "./fit-panels.mjs";

const isShown = (element) => Boolean(element) && !element.classList.contains("collapsed") && getComputedStyle(element).display !== "none";

/**
 * Renders the sidebar and chat at their preferred widths, narrowed to fit the
 * current viewport. `keep` names the panel being dragged.
 */
function applyPanelFit(preferred, keep = null) {
  const row = document.getElementById("layout");
  const sidebar = document.getElementById("sidebar");
  const chatPane = document.getElementById("chat-pane");
  const center = document.getElementById("center-panel");
  if (!row || !sidebar || !chatPane || !center) return null;
  let fixed = 0;
  for (const child of row.children) {
    if (child !== sidebar && child !== chatPane && child !== center) fixed += child.offsetWidth;
  }
  const sidebarShown = isShown(sidebar);
  const chatShown = isShown(chatPane);
  const fit = fitPanelWidths({
    available: row.clientWidth - fixed,
    viewportWidth: window.innerWidth,
    sidebar: sidebarShown ? preferred.sidebar : 0,
    chat: chatShown ? preferred.chat : 0,
    keep,
  });
  if (sidebarShown) sidebar.style.width = `${fit.sidebar}px`;
  if (chatShown) chatPane.style.width = `${fit.chat}px`;
  return { ...fit, sidebarShown, chatShown };
}

/**
 * Applies panel widths to the frozen shell DOM. Drag updates the DOM live and
 * only commits React state when the pointer is released, so resize cannot
 * remount the workspace. Window resizing and zoom re-fit the rendered widths
 * without touching the stored preferences.
 */
export default function LayoutSync() {
  const layout = useLayout();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const sidebarResize = document.getElementById("sidebar-resize");
    const chatResize = document.getElementById("chat-resize");

    applyPanelFit({ sidebar: layout.sidebarWidth, chat: layout.chatWidth });
    if (sidebarResize) {
      sidebarResize.setAttribute("aria-valuenow", String(Math.round(layout.sidebarWidth)));
    }
    if (chatResize) {
      chatResize.setAttribute("aria-valuemin", String(layout.chatMinWidth()));
      chatResize.setAttribute("aria-valuemax", String(layout.chatMaxWidth()));
      chatResize.setAttribute("aria-valuenow", String(Math.round(layout.chatWidth)));
    }
  }, [
    layout.sidebarWidth,
    layout.sidebarCollapsed,
    layout.chatWidth,
    layout.chatCollapsed,
  ]);

  useEffect(() => {
    const sidebar = document.getElementById("sidebar");
    const chatPane = document.getElementById("chat-pane");
    const sidebarResize = document.getElementById("sidebar-resize");
    const chatResize = document.getElementById("chat-resize");
    const cleanups = [];

    const preferred = () => ({ sidebar: layoutRef.current.sidebarWidth, chat: layoutRef.current.chatWidth });
    let refitFrame = 0;
    const refit = () => {
      if (refitFrame) return;
      refitFrame = requestAnimationFrame(() => {
        refitFrame = 0;
        if (document.documentElement.classList.contains("panel-resizing")) return;
        applyPanelFit(preferred());
        globalThis.XekuteEditorManager?.layout?.();
        globalThis.resizeChatInput?.();
      });
    };
    window.addEventListener("resize", refit);
    cleanups.push(() => window.removeEventListener("resize", refit));
    // bootstrap.js collapses and expands panels by class.
    const collapseObserver = new MutationObserver(refit);
    for (const pane of [sidebar, chatPane]) if (pane) collapseObserver.observe(pane, { attributes: true, attributeFilter: ["class"] });
    cleanups.push(() => collapseObserver.disconnect());
    cleanups.push(() => { if (refitFrame) cancelAnimationFrame(refitFrame); });

    // Ending a drag saves what is on screen. If the drag pressed the other
    // panel below its preference, that narrower width is saved too, so the
    // dragged width survives the next re-fit.
    const settle = (dragged) => {
      const next = layoutRef.current;
      if (dragged === "sidebar") next.setSidebarWidth(sidebar.offsetWidth);
      else next.setChatWidth(chatPane.offsetWidth);
      if (dragged === "sidebar" && isShown(chatPane) && chatPane.offsetWidth < next.chatWidth) next.setChatWidth(chatPane.offsetWidth);
      if (dragged === "chat" && isShown(sidebar) && sidebar.offsetWidth < next.sidebarWidth) next.setSidebarWidth(sidebar.offsetWidth);
    };

    function makeDraggable(handle, onMove, onEnd) {
      if (!handle) return;
      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const pointerId = event.pointerId;
        let latestEvent = null;
        let animationFrame = 0;
        const resizeClass = handle.classList.contains("sash-h") ? "resizing-row" : "resizing-column";

        const flush = () => {
          animationFrame = 0;
          if (!latestEvent) return;
          onMove(latestEvent);
        };
        const move = (next) => {
          if (next.pointerId !== pointerId) return;
          latestEvent = next;
          if (!animationFrame) animationFrame = requestAnimationFrame(flush);
        };
        const finish = (next) => {
          if (next.pointerId !== pointerId) return;
          if (animationFrame) cancelAnimationFrame(animationFrame);
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
      };
      handle.addEventListener("pointerdown", onPointerDown);
      cleanups.push(() => handle.removeEventListener("pointerdown", onPointerDown));
    }

    makeDraggable(sidebarResize, (e) => {
      if (!sidebar) return;
      const next = layoutRef.current;
      const desired = next.clampSidebar(e.clientX - sidebar.getBoundingClientRect().left);
      const fit = applyPanelFit({ ...preferred(), sidebar: desired }, "sidebar");
      sidebarResize?.setAttribute("aria-valuenow", String(Math.round(fit?.sidebar ?? desired)));
      globalThis.XekuteEditorManager?.layout?.();
    }, () => {
      if (!sidebar) return;
      settle("sidebar");
    });

    makeDraggable(chatResize, (e) => {
      if (!chatPane) return;
      const next = layoutRef.current;
      const desired = next.clampChat(window.innerWidth - e.clientX);
      const fit = applyPanelFit({ ...preferred(), chat: desired }, "chat");
      chatResize?.setAttribute("aria-valuenow", String(Math.round(fit?.chat ?? desired)));
      globalThis.resizeChatInput?.();
    }, () => {
      if (!chatPane) return;
      settle("chat");
      globalThis.resizeChatInput?.();
    });

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return null;
}
