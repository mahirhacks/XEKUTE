"use strict";

const HIDDEN_COMMAND_REVEAL_MS = 1500;

function createHiddenCommandReveal({
  delayMs = HIDDEN_COMMAND_REVEAL_MS,
  schedule = setTimeout,
  unschedule = clearTimeout,
} = {}) {
  let revealed = false;
  let finished = false;
  let timer = null;
  const pendingOutput = [];

  function revealNow(onReveal) {
    if (finished || revealed) return false;
    revealed = true;
    if (timer) {
      unschedule(timer);
      timer = null;
    }
    const replay = pendingOutput.splice(0, pendingOutput.length);
    onReveal?.({ replay });
    return true;
  }

  function start({ wantVisible = true, onReveal } = {}) {
    if (wantVisible) {
      revealNow(onReveal);
      return;
    }
    timer = schedule(() => {
      timer = null;
      revealNow(onReveal);
    }, Math.max(0, Number(delayMs) || 0));
  }

  function pushOutput(data) {
    const text = data == null ? "" : String(data);
    if (!text) return { live: revealed };
    if (revealed) return { live: true, data: text };
    pendingOutput.push(text);
    return { live: false, data: text };
  }

  function complete() {
    finished = true;
    if (timer) {
      unschedule(timer);
      timer = null;
    }
    return { revealed };
  }

  return {
    start,
    revealNow,
    pushOutput,
    complete,
    isRevealed: () => revealed,
  };
}

module.exports = { HIDDEN_COMMAND_REVEAL_MS, createHiddenCommandReveal };
