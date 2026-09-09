"use strict";

const MAX_EXEC_COMMAND_CONTEXT_WORDS = 5;
const MAX_EXEC_COMMAND_CONTEXT_CHARS = 80;

function contextWords(value) {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean);
}

function validateExecCommandContext(value) {
  if (typeof value !== "string") {
    return { ok: false, message: "context must be a string of at most 5 words" };
  }
  if (/\u0000/.test(value)) {
    return { ok: false, message: "context contains an invalid null character" };
  }
  const text = value.trim();
  if (!text) {
    return { ok: false, message: "context must be 1 to 5 words" };
  }
  if (text.length > MAX_EXEC_COMMAND_CONTEXT_CHARS) {
    return { ok: false, message: "context must be at most 80 characters" };
  }
  const words = contextWords(text);
  if (words.length > MAX_EXEC_COMMAND_CONTEXT_WORDS) {
    return { ok: false, message: "context must be at most 5 words" };
  }
  return { ok: true, text, words };
}

module.exports = {
  MAX_EXEC_COMMAND_CONTEXT_CHARS,
  MAX_EXEC_COMMAND_CONTEXT_WORDS,
  contextWords,
  validateExecCommandContext,
};
