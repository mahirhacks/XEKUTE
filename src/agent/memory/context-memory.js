const ContextMemory = (() => {
  const InitialPrompts = typeof module !== "undefined" && module.exports
    ? require("../../prompts/instructs/initial_prompt")
    : globalThis.XekuteInitialPrompts;
  const SUMMARY_SYSTEM_PROMPT = InitialPrompts.CONTEXT_MEMORY_SYSTEM_PROMPT;

  function cleanText(value) {
    return String(value == null ? "" : value)
      .replace(/\u0000/g, "")
      .replace(/\r\n/g, "\n")
      .trim();
  }

  function oneLine(value, maxChars = 1000) {
    const text = cleanText(value).replace(/\s+/g, " ");
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 15))}... [truncated]`;
  }

  function summaryCharLimit(contextTokens) {
    const tokens = Number(contextTokens) || 4096;
    if (tokens <= 4096) return 1800;
    if (tokens <= 8192) return 3200;
    if (tokens <= 16384) return 5200;
    return 8000;
  }

  function transcriptCharLimit(contextTokens) {
    const tokens = Number(contextTokens) || 4096;
    if (tokens <= 4096) return 7000;
    if (tokens <= 8192) return 13000;
    if (tokens <= 16384) return 24000;
    return 40000;
  }

  function toolCallLabel(call) {
    const fn = call?.function || {};
    const name = String(fn.name || "tool");
    let args = fn.arguments;
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    args = args && typeof args === "object" ? args : {};
    const target = args.path || args.url || args.command || args.query || args.id || "";
    return target ? `${name}(${oneLine(target, 180)})` : name;
  }

  function messageEntry(message) {
    const role = String(message?.role || "message");
    const contentLimit = role === "tool" ? 850 : role === "assistant" ? 1100 : 1400;
    const content = oneLine(message?.content, contentLimit);
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls.map(toolCallLabel).filter(Boolean)
      : [];

    if (role === "user") return content ? `USER: ${content}` : "";
    if (role === "tool") {
      const name = message?.tool_name || "tool";
      return content ? `TOOL RESULT (${name}): ${content}` : `TOOL RESULT (${name}): no content`;
    }
    if (role === "assistant") {
      const pieces = [];
      if (content) pieces.push(`ASSISTANT: ${content}`);
      if (toolCalls.length) pieces.push(`ASSISTANT TOOL CALLS: ${toolCalls.join(", ")}`);
      return pieces.join("\n");
    }
    return content ? `${role.toUpperCase()}: ${content}` : "";
  }

  function normalizeSummary(rawSummary, maxChars) {
    let summary = cleanText(rawSummary)
      .replace(/^```(?:markdown|md)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/^(?:here(?:'s| is) (?:the )?(?:updated )?(?:context )?(?:summary|memory)[:.]?)\s*/i, "")
      .trim();
    if (!summary) return "";
    if (summary.length <= maxChars) return summary;

    const headSize = Math.floor(maxChars * 0.68);
    const tailSize = maxChars - headSize;
    summary = `${summary.slice(0, headSize).trimEnd()}\n\n... older detail omitted ...\n\n${summary.slice(-tailSize).trimStart()}`;
    return summary;
  }

  function buildMemoryTranscript(previousSummary, messages, { contextTokens = 4096 } = {}) {
    const maxChars = transcriptCharLimit(contextTokens);
    const memoryLimit = Math.min(summaryCharLimit(contextTokens), Math.floor(maxChars * 0.4));
    const previous = normalizeSummary(previousSummary, memoryLimit);
    const entries = (Array.isArray(messages) ? messages : [])
      .map(messageEntry)
      .filter(Boolean);

    const header = [
      "EXISTING MEMORY (older; may be stale):",
      previous || "None",
      "",
      "NEW CONVERSATION TO MERGE (oldest to newest):",
    ].join("\n");
    const available = Math.max(1200, maxChars - header.length - 1);
    const selected = [];
    let used = 0;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (selected.length && used + entry.length + 1 > available) break;
      const bounded = entry.length > available ? oneLine(entry, available) : entry;
      selected.unshift(bounded);
      used += bounded.length + 1;
    }

    return `${header}\n${selected.join("\n") || "None"}`;
  }

  function buildFallbackSummary(previousSummary, messages, { contextTokens = 4096 } = {}) {
    const maxChars = summaryCharLimit(contextTokens);
    const buckets = { user: [], assistant: [], tool: [] };
    for (const message of Array.isArray(messages) ? messages : []) {
      const entry = messageEntry(message);
      if (!entry) continue;
      if (message.role === "user") buckets.user.push(entry.replace(/^USER:\s*/, ""));
      else if (message.role === "tool") buckets.tool.push(entry.replace(/^TOOL RESULT\s*/, ""));
      else if (message.role === "assistant") buckets.assistant.push(entry.replace(/^ASSISTANT:\s*/, ""));
    }

    const previous = normalizeSummary(previousSummary, Math.floor(maxChars * 0.42));
    const lines = [
      "## Objective",
      ...buckets.user.slice(-4).map((item) => `- ${oneLine(item, 360)}`),
      "## Requirements and preferences",
      previous ? `- Prior memory retained below:\n${previous}` : "- None recorded",
      "## Decisions and approach",
      ...buckets.assistant.slice(-4).map((item) => `- ${oneLine(item, 340)}`),
      "## Workspace state and completed work",
      ...buckets.tool.slice(-5).map((item) => `- ${oneLine(item, 320)}`),
      "## Verification and failures",
      "- See recorded tool evidence above; no additional result inferred.",
      "## Open work and next step",
      "- Continue from the recent live messages and verify remaining requirements against current workspace state.",
    ];

    return normalizeSummary(lines.join("\n"), maxChars);
  }

  function mergeRecentWithAppended(recentMessages, liveHistory, snapshotLength) {
    const recent = Array.isArray(recentMessages) ? recentMessages : [];
    const live = Array.isArray(liveHistory) ? liveHistory : [];
    const start = Math.max(0, Number(snapshotLength) || 0);
    const appended = live.length > start ? live.slice(start) : [];
    return [...recent, ...appended];
  }

  return {
    SUMMARY_SYSTEM_PROMPT,
    buildFallbackSummary,
    buildMemoryTranscript,
    mergeRecentWithAppended,
    messageEntry,
    normalizeSummary,
    summaryCharLimit,
    transcriptCharLimit,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ContextMemory;
}

globalThis.ContextMemory = ContextMemory;
