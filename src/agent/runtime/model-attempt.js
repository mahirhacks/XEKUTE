"use strict";

async function runModelAttempt({ run, request, timeoutMs = 600_000 }) {
  const parent = request.signal;
  if (parent?.aborted) return { ok: false, aborted: true, code: "MODEL_ATTEMPT_ABORTED", error: "The agent turn was stopped." };
  const controller = new AbortController();
  let active = true;
  let timer;
  let abort;
  const callbacks = Object.fromEntries(["onThinking", "onToken", "onToolCalls", "onStreamEvent"].map((key) => [key, (...args) => {
    if (active && !controller.signal.aborted) request[key]?.(...args);
  }]));
  const failure = new Promise((resolve) => {
    abort = () => {
      active = false;
      controller.abort(parent?.reason);
      resolve({ ok: false, aborted: true, code: "MODEL_ATTEMPT_ABORTED", error: "The agent turn was stopped." });
    };
    parent?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      active = false;
      controller.abort();
      resolve({ ok: false, code: "MODEL_ATTEMPT_TIMEOUT", error: "The model request exceeded its attempt deadline." });
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 600_000);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) return { ok: false, aborted: true, code: "MODEL_ATTEMPT_ABORTED", error: "The agent turn was stopped." };
        return run({ ...request, ...callbacks, signal: controller.signal });
      }).catch((error) => ({ ok: false, error: error.message || String(error), code: error.code || "MODEL_ROUND_FAILED", aborted: parent?.aborted === true })),
      failure,
    ]);
  } finally {
    active = false;
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }
}

module.exports = { runModelAttempt };
