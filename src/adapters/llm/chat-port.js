"use strict";

const { captureOllamaStream } = require("./ollama/ollama-stream");
const {
  captureOpenRouterStream,
  normalizeOpenRouterMessages,
  openRouterHeaders,
  openRouterTools,
} = require("./openrouter/openrouter-stream");
const {
  DEFAULT_OPENROUTER_BASE_URL,
  buildChatRequest,
  normalizeBaseUrl,
  normalizeProvider,
} = require("./openrouter/providers");

/**
 * ChatPort adapter around the existing capture functions.
 *
 * This is the provider-neutral seam the application layer consumes: it exposes
 * the same operations (stream/cancel/model-context lookup) without importing
 * provider implementation files. Stream event names and payloads are the
 * existing ones — this adapter does not rewrite the stream protocol.
 *
 * `createChatPort(options)` returns a ChatPort-shaped object; the application
 * receives it from the DI container (Stage 6). Tests may substitute a fake
 * port with the same shape.
 */
function createChatPort({ ollama = {}, openrouter = {} } = {}) {
  const ollamaDefault = ollama.host ? { host: ollama.host } : {};
  const openrouterDefault = openrouter.baseUrl ? { baseUrl: openrouter.baseUrl } : {};

  return {
    stream(request, callbacks) {
      const { provider, ...rest } = request || {};
      const normalized = String(provider || "").toLowerCase();
      if (normalized === "openrouter" || normalized === "openrouter-compatible") {
        return captureOpenRouterStream(
          { ...openrouterDefault, ...openrouter, ...rest },
          callbacks,
        );
      }
      return captureOllamaStream({ ...ollamaDefault, ...ollama, ...rest }, callbacks);
    },
    cancel(requestId) {
      return { ok: false, error: "ChatPort.cancel is owned by the application controller; no in-adapter cancellation map" };
    },
    modelContext(model) {
      return Promise.resolve({ ok: false, error: "ChatPort.modelContext must be injected with a model-context provider" });
    },
    // Provider-neutral helpers kept for compatibility and application use.
    normalizeProvider,
    normalizeBaseUrl,
    buildChatRequest,
    openRouterHeaders,
    openRouterTools,
    normalizeOpenRouterMessages,
    DEFAULT_OPENROUTER_BASE_URL,
  };
}

module.exports = { createChatPort };
