"use strict";

const { streamError } = require("../stream-utils");

/**
 * Ollama's /api/chat stream is newline-delimited JSON.  Keep this parser
 * deliberately boring: each response field is independent, and no model-name
 * heuristics are allowed to reinterpret normal answer content as reasoning.
 */

function thinkingText(message = {}) {
  const value = message.thinking ?? message.reasoning ?? message.reasoning_content ?? "";
  return value == null ? "" : String(value);
}

function contentText(message = {}) {
  const value = message.content ?? "";
  return value == null ? "" : String(value);
}

function cloneArguments(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return {};
  return { ...value };
}

function mergeToolCalls(existing = [], incoming = []) {
  if (!Array.isArray(incoming) || !incoming.length) return existing;
  const merged = existing.map((call) => ({
    ...call,
    function: {
      ...(call.function || {}),
      arguments: cloneArguments(call.function?.arguments),
    },
  }));

  for (const call of incoming) {
    if (!call || typeof call !== "object") continue;
    const fn = call.function && typeof call.function === "object" ? call.function : {};
    const args = fn.arguments ?? {};
    const index = Number.isInteger(call.index)
      ? call.index
      : Number.isInteger(fn.index) ? fn.index : null;

    let targetIndex = index;
    if (targetIndex == null) {
      targetIndex = merged.findIndex((item) => {
        if (call.id && item.id === call.id) return true;
        return Boolean(item.function?.name && fn.name && item.function.name === fn.name);
      });
      if (targetIndex < 0) targetIndex = merged.length;
    }

    while (merged.length <= targetIndex) {
      merged.push({ type: "function", function: { name: "", arguments: {} } });
    }

    const target = merged[targetIndex];
    target.function ||= { name: "", arguments: {} };
    if (call.id) target.id = call.id;
    if (call.type) target.type = call.type;
    if (fn.name) target.function.name = fn.name;
    if (index != null) target.function.index = index;

    if (typeof args === "string") {
      const previous = typeof target.function.arguments === "string"
        ? target.function.arguments
        : "";
      target.function.arguments = `${previous}${args}`;
    } else {
      const previous = target.function.arguments && typeof target.function.arguments === "object"
        ? target.function.arguments
        : {};
      target.function.arguments = { ...previous, ...cloneArguments(args) };
    }
  }

  return merged.filter((call) => call.function?.name);
}

function usageFromResponse(response = {}) {
  const promptTokens = response?.prompt_eval_count == null ? Number.NaN : Number(response.prompt_eval_count);
  const completionTokens = response?.eval_count == null ? Number.NaN : Number(response.eval_count);
  const normalizedPrompt = Number.isFinite(promptTokens) && promptTokens >= 0 ? promptTokens : null;
  const normalizedCompletion = Number.isFinite(completionTokens) && completionTokens >= 0 ? completionTokens : null;
  if (normalizedPrompt == null && normalizedCompletion == null) return null;
  return {
    promptTokens: normalizedPrompt,
    completionTokens: normalizedCompletion,
    totalTokens: (normalizedPrompt || 0) + (normalizedCompletion || 0),
    source: normalizedPrompt == null ? "ollama-partial" : "ollama",
  };
}

/**
 * Consume an Ollama NDJSON ReadableStream without dropping fragmented UTF-8,
 * a final record without a newline, or fields that share the same response.
 */
async function captureOllamaStream(readable, callbacks = {}) {
  if (!readable || typeof readable.getReader !== "function") {
    throw streamError("Ollama returned no readable response body.", "OLLAMA_STREAM_MISSING");
  }

  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sequence = 0;
  let fullText = "";
  let fullThinking = "";
  let toolCalls = [];
  let done = false;
  let doneResponse = null;

  const handleLine = (rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line) return;

    let response;
    try {
      response = JSON.parse(line);
    } catch (cause) {
      throw streamError("Ollama returned malformed streaming JSON.", "OLLAMA_STREAM_PARSE", {
        sequence: sequence + 1,
        line: line.slice(0, 500),
        cause: cause?.message || String(cause),
      });
    }

    if (response?.error) {
      throw streamError(String(response.error), "OLLAMA_STREAM_REMOTE", { sequence: sequence + 1 });
    }

    sequence += 1;
    const message = response?.message && typeof response.message === "object"
      ? response.message
      : {};
    const thinking = thinkingText(message);
    const content = contentText(message);
    const incomingToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const event = {
      sequence,
      thinking,
      content,
      toolCalls: incomingToolCalls,
      done: response?.done === true,
      response,
    };

    // Preserve Ollama's independent fields. A single chunk may legitimately
    // contain reasoning, answer content, and tool calls together.
    callbacks.onEvent?.(event);
    if (thinking) {
      fullThinking += thinking;
      callbacks.onThinking?.(thinking, event);
    }
    if (content) {
      fullText += content;
      callbacks.onContent?.(content, event);
    }
    if (incomingToolCalls.length) {
      toolCalls = mergeToolCalls(toolCalls, incomingToolCalls);
      callbacks.onToolCalls?.(toolCalls, event);
    }

    if (response?.done === true) {
      done = true;
      doneResponse = response;
    }
  };

  const drainCompleteLines = () => {
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      handleLine(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    drainCompleteLines();
  }

  buffer += decoder.decode();
  drainCompleteLines();
  if (buffer.trim()) handleLine(buffer);

  const result = {
    fullText,
    thinking: fullThinking,
    toolCalls,
    done,
    sequence,
    doneResponse,
    usage: usageFromResponse(doneResponse),
  };
  callbacks.onComplete?.(result);
  return result;
}

module.exports = {
  captureOllamaStream,
  contentText,
  mergeToolCalls,
  thinkingText,
  usageFromResponse,
};
