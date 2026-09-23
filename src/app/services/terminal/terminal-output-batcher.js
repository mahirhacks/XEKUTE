"use strict";

// Coalesce PTY chunks so a noisy command does not post one IPC message per
// write. The first chunk of a quiet command is still delivered immediately.
function createTerminalOutputBatcher(send, { intervalMs = 32, maxBytes = 32 * 1024 } = {}) {
  let pending = "";
  let timer = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    const data = pending;
    pending = "";
    send(data);
  }

  function push(data) {
    const text = String(data ?? "");
    if (!text) return;
    if (!pending && !timer) {
      send(text);
      timer = setTimeout(flush, intervalMs);
      return;
    }
    pending += text;
    if (pending.length >= maxBytes) flush();
    else if (!timer) timer = setTimeout(flush, intervalMs);
  }

  return { push, flush };
}

module.exports = { createTerminalOutputBatcher };
