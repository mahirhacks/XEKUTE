"use strict";

/**
 * ChatPort
 *
 * Provider-neutral contract for LLM streaming, cancellation, and model-context
 * lookup. Application orchestration depends on this port rather than concrete
 * Ollama/OpenRouter transports. Event names and payloads must match the existing
 * stream protocol exactly.
 */

const ChatPort = Object.freeze({
  stream(request, callbacks) { return Promise.resolve({ ok: false, error: "ChatPort.stream must be injected" }); },
  cancel(requestId) { return { ok: false, error: "ChatPort.cancel must be injected" }; },
  modelContext(model) { return Promise.resolve({ ok: false, error: "ChatPort.modelContext must be injected" }); },
});

module.exports = ChatPort;
