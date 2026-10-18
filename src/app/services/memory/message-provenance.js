"use strict";

// Who wrote a ledger message. Operator input is a user message that carries a real
// source id from the session supervisor. Late tool results (`result:`), tombstones,
// internal runtime notices and unstamped user messages (a referenced terminal
// capture is one) can all contain target-controlled text, so none of them is
// operator input.

const NON_OPERATOR_ID = /^(?:result|execution):/;

function isOperatorInput(message) {
  return Boolean(message) && message.role === "user" && message.block_tombstone !== true && message.__xekuteInternalRuntimeInput !== true
    && typeof message.source_message_id === "string" && message.source_message_id.trim() !== "" && !NON_OPERATOR_ID.test(message.source_message_id);
}

// "" for anything that is not a user message. An unstamped user message is
// "unattributed": it is not trusted, but it is not known to be hostile either.
function messageOrigin(message) {
  if (!message || message.role !== "user" || message.block_tombstone === true) return "";
  if (message.__xekuteInternalRuntimeInput === true) return "runtime";
  if (NON_OPERATOR_ID.test(String(message.source_message_id || ""))) return "tool_delivery";
  return isOperatorInput(message) ? "operator" : "unattributed";
}

// The words the operator typed, without the chat context the app appends to them.
function operatorText(message) {
  if (typeof message?.source_text === "string" && message.source_text) return message.source_text;
  const content = typeof message?.content === "string" ? message.content : "";
  const cut = content.indexOf("<referenced_chat_context>");
  return (cut >= 0 ? content.slice(0, cut) : content).trimEnd();
}

module.exports = { NON_OPERATOR_ID, isOperatorInput, messageOrigin, operatorText };
