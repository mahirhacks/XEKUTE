"use strict";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
function normalizeProvider(value) { return String(value || "ollama").toLowerCase() === "openrouter" ? "openrouter" : "ollama"; }
function normalizeBaseUrl(value) { const raw = String(value || DEFAULT_OPENROUTER_BASE_URL).trim().replace(/\/$/, ""); const url = new URL(raw); if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error("OpenRouter base URL must use http or https."); return url.toString().replace(/\/$/, ""); }
function buildChatRequest({ baseUrl = DEFAULT_OPENROUTER_BASE_URL, apiKey, model, messages = [], tools = [], stream = true, temperature, responseFormat, maxCompletionTokens, plugins, provider } = {}) {
  if (!String(apiKey || "").trim()) throw new Error("OpenRouter API key is required.");
  if (!String(model || "").trim()) throw new Error("OpenRouter model is required.");
  const body = { model: String(model), messages, stream: Boolean(stream) };
  if (tools?.length) body.tools = tools;
  if (temperature != null) body.temperature = temperature;
  if (responseFormat) body.response_format = responseFormat;
  const completionLimit = Number(maxCompletionTokens);
  if (Number.isFinite(completionLimit) && completionLimit > 0) body.max_completion_tokens = Math.floor(completionLimit);
  if (Array.isArray(plugins) && plugins.length) body.plugins = plugins;
  if (provider && typeof provider === "object") body.provider = provider;
  return { url: `${normalizeBaseUrl(baseUrl)}/chat/completions`, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body };
}
module.exports = { DEFAULT_OPENROUTER_BASE_URL, normalizeProvider, normalizeBaseUrl, buildChatRequest };
