"use strict";

const { streamError } = require("../common/stream-utils");

function mergeToolCalls(existing = [], incoming = []) {
  const merged = existing.map((call) => ({ ...call, function: { ...(call.function || {}), arguments: String(call.function?.arguments || "") } }));
  for (const call of Array.isArray(incoming) ? incoming : []) {
    if (!call || typeof call !== "object") continue;
    const index = Number.isInteger(call.index) ? call.index : merged.findIndex((item) => call.id && item.id === call.id);
    const targetIndex = index >= 0 ? index : merged.length;
    while (merged.length <= targetIndex) merged.push({ type: "function", function: { name: "", arguments: "" } });
    const target = merged[targetIndex];
    if (call.id) target.id = call.id;
    if (call.type) target.type = call.type;
    target.function ||= {};
    if (call.function?.name) target.function.name = call.function.name;
    if (call.function?.arguments) target.function.arguments = `${target.function.arguments || ""}${call.function.arguments}`;
  }
  return merged;
}

function completedToolCalls(toolCalls = []) {
  return (Array.isArray(toolCalls) ? toolCalls : []).filter(
    (call) => typeof call?.function?.name === "string" && call.function.name.trim(),
  );
}

function usageFromResponse(usage) {
  if (!usage || typeof usage !== "object") return null;
  const promptTokens = Number(usage.prompt_tokens);
  const completionTokens = Number(usage.completion_tokens);
  if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return null;
  const details = usage.completion_tokens_details || {};
  const promptDetails = usage.prompt_tokens_details || {};
  return {
    promptTokens: Number.isFinite(promptTokens) ? promptTokens : null,
    completionTokens: Number.isFinite(completionTokens) ? completionTokens : null,
    totalTokens: Number(usage.total_tokens) || (promptTokens || 0) + (completionTokens || 0),
    reasoningTokens: Number.isFinite(Number(details.reasoning_tokens)) ? Number(details.reasoning_tokens) : null,
    cachedTokens: Number.isFinite(Number(promptDetails.cached_tokens)) ? Number(promptDetails.cached_tokens) : null,
    cost: Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : null,
    source: "openrouter",
  };
}

async function captureOpenRouterStream(readable, callbacks = {}, options = {}) {
  const idleTimeoutMs = Number.isFinite(Number(options.idleTimeoutMs))
    ? Math.max(1000, Number(options.idleTimeoutMs))
    : 120000;
  const configuredTotalTimeoutMs = Number(options.totalTimeoutMs);
  const totalTimeoutMs = Number.isFinite(configuredTotalTimeoutMs) && configuredTotalTimeoutMs > 0
    ? Math.max(idleTimeoutMs, configuredTotalTimeoutMs)
    : null;
  if (!readable || typeof readable.getReader !== "function") throw streamError("OpenRouter returned no readable response body.", "OPENROUTER_STREAM_MISSING");
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "", sequence = 0, fullText = "", thinking = "", toolCalls = [], usage = null, done = false, finishReason = null;
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  const ensureNotTimedOut = () => {
    const now = Date.now();
    if (totalTimeoutMs && now - startedAt > totalTimeoutMs) {
      throw streamError(`OpenRouter stream exceeded ${Math.round(totalTimeoutMs / 1000)}s.`, "OPENROUTER_STREAM_TIMEOUT");
    }
    if (now - lastActivityAt > idleTimeoutMs) {
      throw streamError(`OpenRouter stream stalled for ${Math.round(idleTimeoutMs / 1000)}s.`, "OPENROUTER_STREAM_IDLE_TIMEOUT");
    }
  };
  const touch = () => { lastActivityAt = Date.now(); };
  const readChunk = () => {
    let timer;
    return Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        const remainingIdle = idleTimeoutMs - (Date.now() - lastActivityAt);
        timer = setTimeout(() => {
          reject(streamError(`OpenRouter stream stalled for ${Math.round(idleTimeoutMs / 1000)}s.`, "OPENROUTER_STREAM_IDLE_TIMEOUT"));
        }, Math.max(1, remainingIdle));
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };
  const handle = (raw) => {
    touch();
    ensureNotTimedOut();
    const line = String(raw || "").trim();
    if (!line || line.startsWith(":")) return;
    const data = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (data === "[DONE]") { done = true; return; }
    let response;
    try { response = JSON.parse(data); } catch (cause) { throw streamError("OpenRouter returned malformed SSE JSON.", "OPENROUTER_STREAM_PARSE", { sequence: sequence + 1, line: data.slice(0, 500), cause: cause.message }); }
    if (response.error) throw streamError(String(response.error.message || response.error), "OPENROUTER_STREAM_REMOTE");
    sequence += 1;
    const choice = response.choices?.[0] || {};
    const delta = choice.delta || {};
    const content = String(delta.content || "");
    const deltaThinking = String(delta.reasoning_content || delta.reasoning || delta.thinking || "");
    const incoming = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    if (choice.finish_reason != null) finishReason = String(choice.finish_reason);
    const event = { sequence, thinking: deltaThinking, content, toolCalls: incoming, done: choice.finish_reason != null, response };
    callbacks.onEvent?.(event);
    if (deltaThinking) { thinking += deltaThinking; callbacks.onThinking?.(deltaThinking, event); }
    if (content) { fullText += content; callbacks.onContent?.(content, event); }
    if (incoming.length) { toolCalls = mergeToolCalls(toolCalls, incoming); callbacks.onToolCalls?.(toolCalls, event); }
    if (response.usage) usage = usageFromResponse(response.usage);
  };
  let readerTimedOut = false;
  try {
    while (true) {
      ensureNotTimedOut();
      const chunk = await readChunk();
      touch();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) { handle(buffer.slice(0, newline).replace(/\r$/, "")); buffer = buffer.slice(newline + 1); }
    }
  } catch (error) {
    if (/STALL|TIMEOUT/.test(String(error.code || ""))) readerTimedOut = true;
    throw error;
  } finally {
    if (readerTimedOut) await reader.cancel().catch(() => {});
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  const result = {
    fullText,
    thinking,
    toolCalls: completedToolCalls(toolCalls),
    done,
    finishReason,
    streamCompleted: done,
    sequence,
    usage,
  };
  callbacks.onComplete?.(result);
  return result;
}

function normalizeOpenRouterMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => {
    const out = { role: message.role, content: message.content == null ? "" : String(message.content) };
    if (message.name) out.name = message.name;
    if (message.tool_call_id) out.tool_call_id = message.tool_call_id;
    if (Array.isArray(message.tool_calls)) out.tool_calls = message.tool_calls.map((call) => ({ id: call.id, type: "function", function: { name: call.function?.name, arguments: typeof call.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call.function?.arguments || {}) } }));
    return out;
  });
}

function openRouterHeaders(apiKey, options = {}) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
  if (options.referer) headers["HTTP-Referer"] = options.referer;
  if (options.title) headers["X-Title"] = options.title;
  return headers;
}

function openRouterTools(tools = []) { return (Array.isArray(tools) ? tools : []).map((tool) => tool?.type === "function" ? tool : { type: "function", function: tool.function || tool }); }

module.exports = { captureOpenRouterStream, mergeToolCalls, completedToolCalls, normalizeOpenRouterMessages, openRouterHeaders, openRouterTools, usageFromResponse };
