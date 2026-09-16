let started = false;

/**
 * Run the existing composition root once. bootstrap.js caches DOM nodes, so a
 * React remount would leave those refs pointing at detached elements.
 */
export function startRenderer() {
  if (started) return;
  if (!document.getElementById("app-shell")) return;
  started = true;
  void (async () => {
    try {
      await import("../core/runtime-modules.js");
      await import("../bootstrap.js");
    } catch (error) {
      started = false;
      console.error("XEKUTE renderer bootstrap failed:", error);
    }
  })();
}
