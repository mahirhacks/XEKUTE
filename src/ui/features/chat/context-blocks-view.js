"use strict";

/*
 * Markup for the conversation block list in the context meter. Pure functions,
 * so the renderer and the tests share one implementation. Released blocks are
 * shown greyed out; blocks still in context get a pin control. Only the last
 * VISIBLE_TURNS turns are listed (pinned blocks always are), so a long chat
 * does not bury the panel.
 */

(function exposeContextBlocksView(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteContextBlocksView = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_BLOCKS = 40;
  const SUMMARY_MAX = 80;
  const VISIBLE_TURNS = 6;

  function wholeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  // The newest MAX_BLOCKS rows, plus any older pinned ones.
  function normalizeContextBlocks(value) {
    const rows = Array.isArray(value) ? value : [];
    const kept = rows.length > MAX_BLOCKS ? [...rows.slice(0, -MAX_BLOCKS).filter((entry) => entry?.pinned === true), ...rows.slice(-MAX_BLOCKS)] : rows;
    return kept.map((entry) => ({
      index: wholeNumber(entry?.index),
      state: entry?.state === "released" ? "released" : "in_context",
      tokens: wholeNumber(entry?.tokens),
      releasedTokens: wholeNumber(entry?.releasedTokens),
      messages: wholeNumber(entry?.messages),
      pinned: entry?.pinned === true,
      turnStart: entry?.turnStart === true,
      summary: String(entry?.summary || "").replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX),
    }));
  }

  function summarizeContextBlocks(blocks) {
    const list = normalizeContextBlocks(blocks);
    const released = list.filter((block) => block.state === "released");
    return {
      total: list.length,
      released: released.length,
      pinned: list.filter((block) => block.pinned && block.state !== "released").length,
      freedTokens: released.reduce((sum, block) => sum + Math.max(0, block.releasedTokens - block.tokens), 0),
    };
  }

  // Blocks from the last `turns` turns. A turn starts with a prompt the operator
  // sent; steering and late results inside it are not new turns.
  function visibleContextBlocks(blocks, turns = VISIBLE_TURNS) {
    const list = normalizeContextBlocks(blocks);
    const starts = list.map((block, position) => (block.turnStart ? position : -1)).filter((position) => position >= 0);
    if (starts.length <= turns) return list;
    const cutoff = starts[starts.length - turns];
    return list.filter((block, position) => position >= cutoff || block.pinned);
  }

  function renderContextBlocksHtml(blocks, { escapeHtml = (text) => String(text), formatTokenCount = (count) => String(count), pinBudgetTokens = null } = {}) {
    const all = normalizeContextBlocks(blocks);
    const list = visibleContextBlocks(all);
    if (!list.length) return "";
    const summary = summarizeContextBlocks(all);
    const budget = wholeNumber(pinBudgetTokens);
    const pinnedTokens = all.filter((block) => block.pinned && block.state !== "released").reduce((sum, block) => sum + block.tokens, 0);
    const status = [
      summary.released ? `${summary.released} released${summary.freedTokens ? ` · ${formatTokenCount(summary.freedTokens)} freed` : ""}` : "",
      summary.pinned ? `${summary.pinned} pinned${budget ? ` (${formatTokenCount(pinnedTokens)} of ${formatTokenCount(budget)})` : ""}` : "",
    ].filter(Boolean).join(" · ");
    const rows = list.map((block) => {
      const released = block.state === "released";
      const label = block.summary || (released ? "Released turn" : "Turn");
      const overBudget = !block.pinned && budget > 0 && pinnedTokens + block.tokens > budget;
      const title = block.pinned ? "Pinned: kept word for word, even through summaries. Click to unpin."
        : overBudget ? "Pinned turns can use at most a quarter of the context window."
          : "Pin: keep this turn word for word.";
      const pin = released
        ? ""
        : `<button type="button" class="context-block-pin${block.pinned ? " pinned" : ""}" data-block-pin="${block.index}" aria-pressed="${block.pinned ? "true" : "false"}" aria-label="${block.pinned ? "Unpin" : "Pin"} block ${block.index}" title="${escapeHtml(title)}"${overBudget ? " disabled" : ""}><span class="codicon ${block.pinned ? "codicon-pinned" : "codicon-pin"}" aria-hidden="true"></span></button>`;
      return `<div class="context-block-row${released ? " released" : ""}${block.pinned ? " pinned" : ""}" data-block-index="${block.index}">`
        + `<span class="context-block-index">#${block.index}</span>`
        + `<span class="context-block-summary" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`
        + `<span class="context-block-tokens">${released ? "released" : escapeHtml(formatTokenCount(block.tokens))}</span>`
        + pin
        + `</div>`;
    });
    return `<div class="context-blocks-heading"><span>Conversation blocks</span><span>${escapeHtml(status)}</span></div>${rows.join("")}`;
  }

  return { normalizeContextBlocks, summarizeContextBlocks, visibleContextBlocks, renderContextBlocksHtml, MAX_BLOCKS, VISIBLE_TURNS };
});
