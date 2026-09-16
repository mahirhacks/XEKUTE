import React, { useEffect, useRef } from "react";
import { useLayout } from "./LayoutContext.jsx";

/**
 * Applies panel widths to the frozen shell DOM. Drag updates the DOM live and
 * only commits React state when the pointer is released, so resize cannot
 * remount the workspace.
 */
export default function LayoutSync() {
  const layout = useLayout();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const sidebar = document.getElementById("sidebar");
    const chatPane = document.getElementById("chat-pane");
    const sidebarResize = document.getElementById("sidebar-resize");
    const chatResize = document.getElementById("chat-resize");

    if (sidebar && !layout.sidebarCollapsed) {
      sidebar.style.width = `${layout.sidebarWidth}px`;
    }
    if (chatPane && !layout.chatCollapsed) {
      chatPane.style.width = `${layout.chatWidth}px`;
    }
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
      const width = next.clampSidebar(e.clientX - sidebar.getBoundingClientRect().left);
      sidebar.style.width = `${width}px`;
      sidebarResize?.setAttribute("aria-valuenow", String(Math.round(width)));
      globalThis.XekuteEditorManager?.layout?.();
    }, () => {
      if (!sidebar) return;
      layoutRef.current.setSidebarWidth(sidebar.offsetWidth);
    });

    makeDraggable(chatResize, (e) => {
      if (!chatPane) return;
      const next = layoutRef.current;
      const width = next.clampChat(window.innerWidth - e.clientX);
      chatPane.style.width = `${width}px`;
      chatResize?.setAttribute("aria-valuenow", String(Math.round(width)));
      globalThis.resizeChatInput?.();
    }, () => {
      if (!chatPane) return;
      layoutRef.current.setChatWidth(chatPane.offsetWidth);
      globalThis.resizeChatInput?.();
    });

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return null;
}
