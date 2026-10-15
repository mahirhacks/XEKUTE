"use strict";

function completeExchanges(messages = []) {
  const groups = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "tool") continue;
    if (!Array.isArray(message?.tool_calls) || !message.tool_calls.length) { groups.push([message]); continue; }
    const exchange = [message];
    while (messages[index + 1]?.role === "tool") exchange.push(messages[++index]);
    const ids = message.tool_calls.map((call) => String(call.id || ""));
    const outcomes = exchange.slice(1).map((outcome) => String(outcome.tool_call_id || ""));
    if (ids.every(Boolean) && new Set(ids).size === ids.length && outcomes.length === ids.length && ids.every((id) => outcomes.includes(id))) groups.push(exchange);
  }
  return groups;
}

function coherentTail(messages, maxMessages) {
  const selected = [];
  let count = 0;
  for (const exchange of completeExchanges(messages).reverse()) {
    if (count >= maxMessages) break;
    selected.unshift(exchange);
    count += exchange.length;
  }
  return selected.flat();
}

function identifyToolCalls(result, namespace) {
  const saved = JSON.parse(JSON.stringify(result));
  const calls = Array.isArray(saved.toolCalls) ? saved.toolCalls : [];
  const reserved = new Set(calls.map((call) => String(call?.id || call?.callId || "")).filter(Boolean));
  calls.forEach((call, index) => {
    if (!call || typeof call !== "object" || call.id || call.callId) return;
    const base = `${namespace}:call:${index}`;
    let id = base; let suffix = 0;
    while (reserved.has(id)) id = `${base}:${++suffix}`;
    call.id = id; reserved.add(id);
  });
  return saved;
}
module.exports = { completeExchanges, coherentTail, identifyToolCalls };
