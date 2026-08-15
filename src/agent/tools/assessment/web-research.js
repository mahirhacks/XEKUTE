"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context.js");

const WEB_RESEARCH_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    operation: { type: "string", enum: ["search", "fetch_page"] },
    query: { type: "string", minLength: 1, maxLength: 300 },
    url: { type: "string", minLength: 1, maxLength: 4_000 },
    limit: { type: "integer", minimum: 1, maximum: 10 },
    maxChars: { type: "integer", minimum: 1_000, maximum: 30_000 },
  },
  required: ["operation"],
  additionalProperties: false,
});

function invalid(message) {
  return { ok: false, code: "INVALID_INPUT", error: message };
}

function boundedSearchResult(result, limit) {
  const rows = Array.isArray(result?.results) ? result.results.slice(0, limit).map((entry, index) => ({
    rank: Number(entry?.rank) || index + 1,
    title: String(entry?.title || "").slice(0, 500),
    url: String(entry?.url || "").slice(0, 4_000),
    snippet: String(entry?.snippet || "").slice(0, 2_000),
  })) : [];
  return {
    ok: true,
    operation: "search",
    provider: String(result?.provider || "public-web").slice(0, 100),
    query: String(result?.query || "").slice(0, 300),
    count: rows.length,
    results: rows,
  };
}

function createWebResearchTool({ webResearch } = {}) {
  return {
    name: "web_research",
    description: "Search the public web or retrieve bounded readable text from a public HTTP(S) page. Private and reserved destinations are blocked.",
    inputSchema: WEB_RESEARCH_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      if (!isRestrictedToolContext(executionContext)) {
        return { ok: false, code: "INVALID_EXECUTION_CONTEXT", error: "web_research requires a restricted tool execution context projection." };
      }
      if (!webResearch?.searchWeb || !webResearch?.fetchWebPage) {
        return { ok: false, code: "WEB_RESEARCH_UNAVAILABLE", error: "Public web research is unavailable." };
      }
      const operation = String(input.operation || "").trim().toLowerCase();
      if (operation === "search") {
        const query = String(input.query || "").trim().slice(0, 300);
        if (!query) return invalid("Search requires a non-empty query.");
        const limit = Math.max(1, Math.min(Number(input.limit) || 6, 10));
        const result = await webResearch.searchWeb(query, { limit });
        if (!result?.ok) return { ok: false, code: "WEB_RESEARCH_FAILED", error: String(result?.error || "Web search failed.").slice(0, 2_000) };
        return boundedSearchResult(result, limit);
      }
      if (operation === "fetch_page") {
        const url = String(input.url || "").trim().slice(0, 4_000);
        if (!url) return invalid("Page retrieval requires a URL.");
        const maxChars = Math.max(1_000, Math.min(Number(input.maxChars) || 18_000, 30_000));
        const result = await webResearch.fetchWebPage(url, { maxChars });
        if (!result?.ok) return { ok: false, code: "WEB_RESEARCH_FAILED", error: String(result?.error || "Page fetch failed.").slice(0, 2_000) };
        return {
          ok: true,
          operation: "fetch_page",
          url: String(result.url || url).slice(0, 4_000),
          finalUrl: String(result.finalUrl || result.url || url).slice(0, 4_000),
          title: String(result.title || "").slice(0, 1_000),
          contentType: String(result.contentType || "").slice(0, 200),
          content: String(result.content || "").slice(0, maxChars + 32),
          truncated: Boolean(result.truncated),
        };
      }
      return invalid("operation must be search or fetch_page.");
    },
  };
}

module.exports = { WEB_RESEARCH_INPUT_SCHEMA, createWebResearchTool };
