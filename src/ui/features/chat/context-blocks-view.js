"use strict";

/*
 * Markup for the conversation block list in the context meter. Pure functions,
 * so the renderer and the tests share one implementation. Released blocks are
 * shown greyed out; blocks still in context get a pin control.
 */

(function exposeContextBlocksView(globalScope, factory) {
  const value = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = value;
  if (globalScope) globalScope.XekuteContextBlocksView = value;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const MAX_BLOCKS = 40;
  const SUMMARY_MAX = 80;

  function wholeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function normalizeContextBlocks(value) {
    return (Array.isArray(value) ? value : []).slice(-MAX_BLOCKS).map((entry) => ({
      index: wholeNumber(entry?.index),
      state: entry?.state === "released" ? "released" : "in_context",
      tokens: wholeNumber(entry?.tokens),
      releasedTokens: wholeNumber(entry?.releasedTokens),
      messages: wholeNumber(entry?.messages),
      pinned: entry?.pinned === true,
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

  function renderContextBlocksHtml(blocks, { escapeHtml = (text) => String(text), formatTokenCount = (count) => String(count) } = {}) {
    const list = normalizeContextBlocks(blocks);
    if (!list.length) return "";
    const summary = summarizeContextBlocks(list);
    const status = [
      summary.released ? `${summary.released} released${summary.freedTokens ? ` · ${formatTokenCount(summary.freedTokens)} freed` : ""}` : "",
      summary.pinned ? `${summary.pinned} pinned` : "",
    ].filter(Boolean).join(" · ");
    const rows = list.map((block) => {
      const released = block.state === "released";
      const label = block.summary || (released ? "Released turn" : "Turn");
      const pin = released
        ? ""
        : `<button type="button" class="context-block-pin${block.pinned ? " pinned" : ""}" data-block-pin="${block.index}" aria-pressed="${block.pinned ? "true" : "false"}" aria-label="${block.pinned ? "Unpin" : "Pin"} block ${block.index}" title="${block.pinned ? "Pinned: never released. A checkpoint still summarizes it. Click to unpin." : "Pin: never release this block. A checkpoint still summarizes it."}"><span class="codicon ${block.pinned ? "codicon-pinned" : "codicon-pin"}" aria-hidden="true"></span></button>`;
      return `<div class="context-block-row${released ? " released" : ""}${block.pinned ? " pinned" : ""}" data-block-index="${block.index}">`
        + `<span class="context-block-index">#${block.index}</span>`
        + `<span class="context-block-summary" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`
        + `<span class="context-block-tokens">${released ? "released" : escapeHtml(formatTokenCount(block.tokens))}</span>`
        + pin
        + `</div>`;
    });
    return `<div class="context-blocks-heading"><span>Conversation blocks</span><span>${escapeHtml(status)}</span></div>${rows.join("")}`;
  }

  return { normalizeContextBlocks, summarizeContextBlocks, renderContextBlocksHtml, MAX_BLOCKS };
});
