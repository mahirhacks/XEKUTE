const ContextMemory = (() => {
  const InitialPrompts = typeof module !== "undefined" && module.exports
    ? require("../../../prompts/instructs/initial_prompt")
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

  function ensureMessageIdentity(messages, prefix = "legacy") {
    return (Array.isArray(messages) ? messages : []).map((message, index) => {
      const copy = message && typeof message === "object" ? { ...message } : { role: "message", content: String(message || "") };
      if (!String(copy.id || "").trim()) copy.id = `legacy-${prefix}-${index + 1}`;
      if (!copy.createdAt) copy.createdAt = null;
      return copy;
    });
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

    const previousSections = parseSummarySections(previousSummary);
    const appendUnique = (items, extra) => {
      const seen = new Set(items.map((item) => item.toLowerCase()));
      for (const item of extra) {
        const key = item.toLowerCase();
        if (!seen.has(key)) { items.push(item); seen.add(key); }
      }
      return items;
    };
    const objective = appendUnique([...previousSections.objective], buckets.user.slice(-4).map((item) => oneLine(item, 360)));
    const decisions = appendUnique([...previousSections.decisions], buckets.assistant.slice(-4).map((item) => `[assistant-unverified] ${oneLine(item, 340)}`));
    const workspace = appendUnique([...previousSections.workspace], buckets.tool.slice(-5).map((item) => oneLine(item, 320)));
    const requirements = previousSections.requirements.length ? previousSections.requirements : ["None recorded"];
    const verification = previousSections.verification.length ? previousSections.verification : ["See recorded tool evidence above; no additional result inferred."];
    const openWork = previousSections.openWork.length ? previousSections.openWork : ["Continue from the recent live messages and verify remaining requirements against current workspace state."];
    const lines = [
      "## Objective",
      ...(objective.length ? objective.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Requirements and preferences",
      ...requirements.map((item) => `- ${item}`),
      "## Decisions and approach",
      ...(decisions.length ? decisions.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Workspace state and completed work",
      ...(workspace.length ? workspace.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Verification and failures",
      ...verification.map((item) => `- ${item}`),
      "## Open work and next step",
      ...openWork.map((item) => `- ${item}`),
    ];

    return normalizeSummary(lines.join("\n"), maxChars);
  }

  const BLOCKED_PATTERNS_HEADING = "## Blocked tool patterns";

  function parseBlockedPatterns(summary) {
    const output = [];
    let inSection = false;
    for (const raw of cleanText(summary).split("\n")) {
      const heading = raw.match(/^##\s+(.+?)\s*$/i)?.[1]?.trim().toLowerCase();
      if (heading) {
        inSection = heading === "blocked tool patterns";
        continue;
      }
      if (!inSection) continue;
      const item = raw.replace(/^\s*[-*]\s*/, "").trim();
      if (item) output.push(oneLine(item, 240));
    }
    return output;
  }

  function mergeBlockedPatterns(summary, patterns = [], { maxItems = 12 } = {}) {
    const existing = parseBlockedPatterns(summary);
    const seen = new Set(existing.map((item) => item.toLowerCase()));
    const merged = [...existing];
    for (const pattern of Array.isArray(patterns) ? patterns : []) {
      const line = oneLine(pattern, 240);
      const key = line.toLowerCase();
      if (!line || seen.has(key)) continue;
      merged.push(line);
      seen.add(key);
    }
    const trimmed = merged.slice(-maxItems);
    const sections = parseSummarySections(summary);
    const lines = [
      "## Objective",
      ...(sections.objective.length ? sections.objective.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Requirements and preferences",
      ...(sections.requirements.length ? sections.requirements.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Decisions and approach",
      ...(sections.decisions.length ? sections.decisions.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Workspace state and completed work",
      ...(sections.workspace.length ? sections.workspace.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Verification and failures",
      ...(sections.verification.length ? sections.verification.map((item) => `- ${item}`) : ["- None recorded"]),
      "## Open work and next step",
      ...(sections.openWork.length ? sections.openWork.map((item) => `- ${item}`) : ["- None recorded"]),
      BLOCKED_PATTERNS_HEADING,
      ...trimmed.map((item) => `- ${item}`),
    ];
    return normalizeSummary(lines.join("\n"), summaryCharLimit(8192));
  }

  function parseSummarySections(summary) {
    const headings = {
      objective: "Objective",
      requirements: "Requirements and preferences",
      decisions: "Decisions and approach",
      workspace: "Workspace state and completed work",
      verification: "Verification and failures",
      openWork: "Open work and next step",
    };
    const output = Object.fromEntries(Object.keys(headings).map((key) => [key, []]));
    let active = null;
    for (const raw of cleanText(summary).split("\n")) {
      const heading = raw.match(/^##\s+(.+?)\s*$/)?.[1]?.trim().toLowerCase();
      if (heading) {
        active = Object.entries(headings).find(([, value]) => value.toLowerCase() === heading)?.[0] || null;
        continue;
      }
      if (!active) continue;
      const item = raw.replace(/^\s*[-*]\s*/, "").trim();
      if (item && item.toLowerCase() !== "none recorded") output[active].push(oneLine(item, 700));
    }
    return output;
  }

  function mergeRecentWithAppended(recentMessages, liveHistory, snapshotLength, snapshotIds = null) {
    const recent = Array.isArray(recentMessages) ? recentMessages : [];
    const live = Array.isArray(liveHistory) ? liveHistory : [];
    if (Array.isArray(snapshotIds) && snapshotIds.length) {
      const ids = new Set(snapshotIds.map(String));
      const appendedById = live.filter((message) => message?.id && !ids.has(String(message.id)));
      return [...recent, ...appendedById];
    }
    const start = Math.max(0, Number(snapshotLength) || 0);
    const appended = live.length > start ? live.slice(start) : [];
    return [...recent, ...appended];
  }

  return {
    SUMMARY_SYSTEM_PROMPT,
    buildFallbackSummary,
    buildMemoryTranscript,
    ensureMessageIdentity,
    mergeRecentWithAppended,
    messageEntry,
    normalizeSummary,
    mergeBlockedPatterns,
    parseBlockedPatterns,
    parseSummarySections,
    summaryCharLimit,
    transcriptCharLimit,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ContextMemory;
}

globalThis.ContextMemory = ContextMemory;
