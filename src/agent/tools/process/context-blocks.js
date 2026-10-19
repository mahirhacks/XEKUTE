"use strict";

// release_blocks and recall_block manage the model's own Active Conversation.
// The registry entries only publish the schemas. Execution belongs to the agent
// controller because it must rewrite the run's provider history and Tier 1
// ledger together, which no registry adapter can reach.

const { assertToolAdapter } = require("../../../contracts/tool/tool-adapter.js");

const RELEASE_BLOCKS_TOOL_NAME = "release_blocks";
const RECALL_BLOCK_TOOL_NAME = "recall_block";
const CONTEXT_BLOCK_TOOL_NAMES = Object.freeze([RELEASE_BLOCKS_TOOL_NAME, RECALL_BLOCK_TOOL_NAME]);
const MAX_RELEASE_BLOCKS = 32;
const MAX_LIST_BLOCKS = 40;
const NOTE_MAX = 240;
const SUMMARY_MAX = 120;

const RELEASE_BLOCKS_DESCRIPTION = "Manage context space. Each earlier user turn of this conversation is a numbered block. Use operation list to see which finished blocks can be released, then operation release to replace finished blocks you no longer need with a one-line placeholder. Put anything you still need (hosts, credentials, findings, file paths) in your reply or notes first, because a released block leaves context. A released block can be restored with recall_block. Blocks from the task you are working on now cannot be released.";
const RECALL_BLOCK_DESCRIPTION = "Read a released block again. Pass the block index shown in its placeholder or in the release_blocks list. The block is returned in this tool result and does not return to its old place in the conversation. A block too large for one result comes back cut, with next_offset: call again with that offset to read the omitted part.";

const RELEASE_BLOCKS_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: RELEASE_BLOCKS_DESCRIPTION,
  properties: {
    operation: {
      type: "string",
      enum: ["list", "release"],
      description: "list shows releasable blocks. release replaces the given blocks with a placeholder.",
    },
    blocks: {
      type: "array",
      maxItems: MAX_RELEASE_BLOCKS,
      description: "Blocks to release. Required for operation release.",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 0, description: "Block number from the list or from a placeholder." },
          note: { type: "string", maxLength: NOTE_MAX, description: "One line saying what the block did or where its results were recorded." },
        },
        required: ["index"],
        additionalProperties: false,
      },
    },
  },
  required: ["operation"],
  additionalProperties: false,
});

const RECALL_BLOCK_INPUT_SCHEMA = Object.freeze({
  type: "object",
  description: RECALL_BLOCK_DESCRIPTION,
  properties: {
    index: { type: "integer", minimum: 0, description: "Block number of a released block." },
    offset: { type: "integer", minimum: 0, description: "Character offset into the block's transcript, from a previous result's next_offset. Omit to read from the start." },
  },
  required: ["index"],
  additionalProperties: false,
});

function failure(errorCode, error) {
  return { ok: false, error, errorCode, retryable: false };
}

function normalizeReleaseRequest(input = {}) {
  const operation = String(input?.operation || "").trim().toLowerCase();
  if (operation !== "list" && operation !== "release") {
    return failure("INVALID_CONTEXT_OPERATION", "release_blocks operation must be list or release.");
  }
  if (operation === "list") return { ok: true, operation, blocks: [] };
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  if (!blocks.length) return failure("INVALID_CONTEXT_OPERATION", "release_blocks release needs at least one block.");
  if (blocks.length > MAX_RELEASE_BLOCKS) return failure("INVALID_CONTEXT_OPERATION", `release_blocks releases at most ${MAX_RELEASE_BLOCKS} blocks per call.`);
  return {
    ok: true,
    operation,
    blocks: blocks.map((entry) => {
      const source = entry && typeof entry === "object" ? entry : { index: entry };
      return { index: source.index, note: typeof source.note === "string" ? source.note.slice(0, NOTE_MAX) : "" };
    }),
  };
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part.text === "string") return part.text;
    return part && /image/i.test(String(part.type || "")) ? "[image omitted]" : "";
  }).filter(Boolean).join("\n");
}

function toolNamesOf(messages) {
  const names = new Map();
  for (const message of messages) {
    if (message?.role !== "assistant" || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      const name = String(call?.function?.name || call?.name || "").trim();
      if (name) names.set(name, (names.get(name) || 0) + 1);
    }
  }
  return [...names].map(([name, calls]) => (calls > 1 ? `${name} x${calls}` : name));
}

// One row per block for operation list. `releasableBefore` is the position of
// the first block that belongs to the task in progress; blocks from there on
// stay in context.
function describeBlocks(blocks, releasableBefore, redact = (value) => value) {
  const rows = blocks.map((block, position) => {
    const tombstone = block.messages[0]?.block_tombstone === true ? block.messages[0] : null;
    const opener = tombstone ? null : block.messages.find((message) => message?.role === "user");
    const startedBy = tombstone ? /started by "([^"]*)"/.exec(textOf(tombstone.content))?.[1] : "";
    const summary = redact(textOf(opener?.content ?? startedBy ?? "").replace(/\s+/g, " ").trim().slice(0, SUMMARY_MAX));
    return {
      index: block.index,
      state: block.state === "evicted" ? "released" : "in_context",
      releasable: block.state !== "evicted" && block.pinned !== true && block.partial !== true && position < releasableBefore,
      pinned: block.pinned === true,
      releasedTokens: tombstone ? Math.max(0, Number(tombstone.released_tokens) || 0) : 0,
      messages: block.messages.length,
      tokens: block.tokenEstimate,
      tools: toolNamesOf(block.messages),
      summary,
    };
  });
  return rows.length > MAX_LIST_BLOCKS ? rows.slice(-MAX_LIST_BLOCKS) : rows;
}

function sameMessages(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((message, position) => {
    const other = right[position];
    return Boolean(message) && Boolean(other)
      && message.role === other.role
      && (message.tool_call_id || "") === (other.tool_call_id || "")
      && JSON.stringify(message.content ?? "") === JSON.stringify(other.content ?? "");
  });
}

// Plain-text transcript of a released block for the recall_block result.
// Without an offset a large block shows its head and tail; `nextOffset` is where
// the omitted middle starts. With an offset it returns the page from there.
function renderReleasedBlock(messages, { maxChars = 60_000, offset = 0 } = {}) {
  const lines = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message) continue;
    const role = String(message.role || "unknown");
    if (role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const text = textOf(message.content).trim();
      if (text) lines.push(`[assistant] ${text}`);
      for (const call of message.tool_calls) {
        const args = typeof call?.function?.arguments === "string" ? call.function.arguments : JSON.stringify(call?.function?.arguments ?? {});
        lines.push(`[assistant called ${call?.function?.name || "tool"}] ${args}`);
      }
      continue;
    }
    if (role === "tool") {
      lines.push(`[tool result${message.tool_name ? ` ${message.tool_name}` : ""}] ${textOf(message.content)}`);
      continue;
    }
    lines.push(`[${role}] ${textOf(message.content)}`);
  }
  const text = lines.join("\n");
  const limit = Math.max(1_000, Math.floor(Number(maxChars) || 60_000));
  const from = Math.max(0, Math.floor(Number(offset) || 0));
  if (from > 0) {
    const end = Math.min(text.length, from + limit);
    return { text: text.slice(from, end), truncated: end < text.length, nextOffset: end < text.length ? end : null, totalChars: text.length };
  }
  if (text.length <= limit) return { text, truncated: false, nextOffset: null, totalChars: text.length };
  const head = Math.floor(limit * 0.68);
  return { text: `${text.slice(0, head)}\n... ${text.length - limit} characters omitted (read them with offset ${head}) ...\n${text.slice(-(limit - head))}`, truncated: true, nextOffset: head, totalChars: text.length };
}

function createContextBlockTool(name, description, inputSchema) {
  return assertToolAdapter({
    name,
    description,
    inputSchema,
    async execute() {
      return failure("CONTEXT_TOOL_CONTROLLER_ONLY", `${name} runs inside the agent controller and has no standalone execution path.`);
    },
  });
}

const createReleaseBlocksTool = () => createContextBlockTool(RELEASE_BLOCKS_TOOL_NAME, RELEASE_BLOCKS_DESCRIPTION, RELEASE_BLOCKS_INPUT_SCHEMA);
const createRecallBlockTool = () => createContextBlockTool(RECALL_BLOCK_TOOL_NAME, RECALL_BLOCK_DESCRIPTION, RECALL_BLOCK_INPUT_SCHEMA);

module.exports = {
  RELEASE_BLOCKS_TOOL_NAME,
  RECALL_BLOCK_TOOL_NAME,
  CONTEXT_BLOCK_TOOL_NAMES,
  RELEASE_BLOCKS_INPUT_SCHEMA,
  RECALL_BLOCK_INPUT_SCHEMA,
  MAX_RELEASE_BLOCKS,
  normalizeReleaseRequest,
  describeBlocks,
  sameMessages,
  renderReleasedBlock,
  createReleaseBlocksTool,
  createRecallBlockTool,
};
