import React, { useCallback, useRef } from "react";

/**
 * Pointer-driven resize sash. Replaces imperative makeDraggable in bootstrap.js.
 */
export default function ResizeHandle({
  id,
  className = "",
  orientation = "vertical",
  ariaLabel,
  ariaValueMin,
  ariaValueMax,
  ariaValueNow,
  collapsed = false,
  collapsedHint = false,
  onResize,
  onResizeEnd,
  onDoubleClick,
  onKeyDown,
}) {
  const dragging = useRef(false);
  const frame = useRef(0);
  const latest = useRef(null);

  const flush = useCallback(() => {
    frame.current = 0;
    if (latest.current && onResize) onResize(latest.current);
  }, [onResize]);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const handle = event.currentTarget;
      const resizeClass = orientation === "horizontal" ? "resizing-row" : "resizing-column";
      dragging.current = true;

      const move = (next) => {
        if (next.pointerId !== pointerId) return;
        latest.current = next;
        if (!frame.current) frame.current = requestAnimationFrame(flush);
      };

      const finish = (next) => {
        if (next.pointerId !== pointerId) return;
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = 0;
        if (latest.current) flush();
        dragging.current = false;
        handle.classList.remove("dragging");
        document.documentElement.classList.remove("panel-resizing", resizeClass);
        handle.releasePointerCapture?.(pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        onResizeEnd?.(next);
      };

      handle.classList.add("dragging");
      document.documentElement.classList.add("panel-resizing", resizeClass);
      handle.setPointerCapture?.(pointerId);
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    },
    [orientation, flush, onResizeEnd],
  );

  const classes = [
    className,
    collapsed ? "collapsed" : "",
    collapsedHint ? "collapsed-hint" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      id={id}
      className={classes}
      role="separator"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation={orientation}
      aria-valuemin={ariaValueMin}
      aria-valuemax={ariaValueMax}
      aria-valuenow={ariaValueNow}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    />
  );
}
