"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareChatReferenceContext, unpackChatReferences, CONTEXT_START } = require("../src/agent/runtime/chat-references.js");
const estimate = value => Math.ceil((typeof value === "string" ? value : JSON.stringify(value)).length / 4);
const packet = snapshots => CONTEXT_START + "Historical data\n" + JSON.stringify(snapshots) + "\n</referenced_chat_context>";
const snapshot = (title, chars) => ({ title, summarizedConversation: { decisions: ["Keep finding 42"] },
  activeConversation: [{ role: "assistant", content: "x".repeat(chars) }], currentWorkflow: { nextAction: "Verify finding 42" } });

test("220K used plus a 200K import compacts the destination before summarizing the copied source", async () => {
  const original = snapshot("Authentication", 800_000);
  const before = JSON.stringify(original);
  let used = 220_000;
  const order = [], statuses = [];
  const result = await prepareChatReferenceContext({ contextText: packet([original]), effectiveLimit: 262_000,
    destinationTokens: () => used, estimateTokens: estimate,
    compactDestination: async () => { order.push("compact destination"); used = 12_000; },
    summarize: async input => { order.push("summarize source"); assert.match(input.text, /Keep finding 42/);
      return { summarizedConversation: "Finding 42 is pending verification. Keep its scope." }; },
    onStatus: event => statuses.push(event),
  });
  assert.deepEqual(order, ["compact destination", "summarize source"]);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(Object.keys(unpackChatReferences(result)[0]), ["summarizedConversation", "activeConversation", "currentWorkflow"]);
  assert.deepEqual(unpackChatReferences(result)[0].activeConversation, []);
  assert.deepEqual(unpackChatReferences(result)[0].currentWorkflow, { nextAction: "Verify finding 42" });
  assert.ok(used + estimate(result) <= 262_000);
  assert.deepEqual(statuses.map(event => event.status), ["started", "completed"]);
  assert.equal(statuses[0].title, "Authentication");
});

test("an import below half the destination window stays exact when it fits", async () => {
  const original = snapshot("Recon", 500_000);
  const result = await prepareChatReferenceContext({ contextText: packet([original]), effectiveLimit: 262_000,
    destinationTokens: () => 20_000, estimateTokens: estimate,
    compactDestination: () => assert.fail("destination already has room"), summarize: () => assert.fail("source is below half"),
  });
  const imported = unpackChatReferences(result)[0];
  assert.equal(imported.activeConversation[0].content, original.activeConversation[0].content);
  assert.equal(Object.hasOwn(imported, "title"), false);
});

test("an import equal to half the window does not trigger source summarization", async () => {
  const original = snapshot("Exact boundary", 0);
  const overhead = JSON.stringify({ summarizedConversation: original.summarizedConversation, activeConversation: original.activeConversation, currentWorkflow: original.currentWorkflow }).length;
  original.activeConversation[0].content = "x".repeat(131_000 * 4 - overhead);
  const result = await prepareChatReferenceContext({ contextText: packet([original]), effectiveLimit: 262_000,
    destinationTokens: () => 10_000, estimateTokens: estimate,
    compactDestination: () => assert.fail(), summarize: () => assert.fail("exactly half is permitted"),
  });
  assert.equal(unpackChatReferences(result)[0].activeConversation[0].content.length, original.activeConversation[0].content.length);
});

test("multiple imports share available space and oversized copies use every source fragment", async () => {
  const texts = [];
  const result = await prepareChatReferenceContext({ contextText: packet([snapshot("A", 40_000), snapshot("B", 40_000)]), effectiveLimit: 8_000,
    destinationTokens: () => 1_000, estimateTokens: estimate, compactDestination: async () => {},
    summarize: async input => { texts.push(input); return { summarizedConversation: "Keep finding 42 and verify it." }; },
  });
  assert.ok(texts.length > 2, "oversized source uses bounded fragments");
  for (const input of texts) assert.ok(estimate(input.text) <= input.inputLimit - Math.min(8192, input.targetTokens) - 1024);
  assert.equal(unpackChatReferences(result).length, 2);
  assert.ok(estimate(result) + 1_000 < 8_000);
});

test("a tiny import does not force a larger import to summarize when both fit below half the window", async () => {
  const large = snapshot("Large", 8400), small = snapshot("Tiny", 20);
  const result = await prepareChatReferenceContext({ contextText: packet([large, small]), effectiveLimit: 6000,
    destinationTokens: () => 2000, estimateTokens: estimate,
    compactDestination: () => assert.fail("the combined context already fits"), summarize: () => assert.fail("both imports fit exactly"),
  });
  assert.equal(unpackChatReferences(result)[0].activeConversation[0].content, large.activeConversation[0].content);
  assert.equal(unpackChatReferences(result)[1].activeConversation[0].content, small.activeConversation[0].content);
});

test("when combined imports do not fit, only the largest imports lose detail", async () => {
  const large = snapshot("Large", 15000), small = snapshot("Tiny", 20);
  let calls = 0;
  const result = await prepareChatReferenceContext({ contextText: packet([small, large]), effectiveLimit: 8000,
    destinationTokens: () => 5000, estimateTokens: estimate, compactDestination: async () => {},
    summarize: async input => { calls++; assert.match(input.text, /x{100}/); return { summarizedConversation: "Large source reduced" }; },
  });
  assert.equal(calls, 1);
  assert.equal(unpackChatReferences(result)[0].activeConversation[0].content, small.activeConversation[0].content);
  assert.equal(unpackChatReferences(result)[1].summarizedConversation, "Large source reduced");
});

test("free space is reassessed after each summary so a second large import can stay exact", async () => {
  const first = snapshot("A", 12000), second = snapshot("B", 11600);
  let calls = 0;
  const result = await prepareChatReferenceContext({ contextText: packet([first, second]), effectiveLimit: 10000,
    destinationTokens: () => 5000, estimateTokens: estimate, compactDestination: async () => {},
    summarize: async () => { calls++; return { summarizedConversation: "A reduced" }; },
  });
  assert.equal(calls, 1);
  assert.equal(unpackChatReferences(result)[1].activeConversation[0].content, second.activeConversation[0].content);
});

test("failed summarization reports failure without dispatching raw oversized context", async () => {
  const statuses = [];
  await assert.rejects(prepareChatReferenceContext({ contextText: packet([snapshot("Source", 40_000)]), effectiveLimit: 8_000,
    destinationTokens: () => 1_000, estimateTokens: estimate, compactDestination: async () => {},
    summarize: async () => { throw new Error("provider unavailable"); }, onStatus: event => statuses.push(event.status),
  }), /provider unavailable/);
  assert.deepEqual(statuses, ["started", "failed"]);
});

test("an oversized workflow is summarized into the copied workflow section without changing its source", async () => {
  const original = snapshot("Long workflow", 0);
  original.currentWorkflow = { nextAction: "Verify finding 42", notes: "x".repeat(40_000) };
  const before = JSON.stringify(original);
  const result = await prepareChatReferenceContext({ contextText: packet([original]), effectiveLimit: 8_000,
    destinationTokens: () => 1_000, estimateTokens: estimate, compactDestination: async () => {},
    summarize: async () => ({ summarizedConversation: "Finding 42 remains pending.", currentWorkflow: { nextAction: "Verify finding 42" } }),
  });
  const imported = unpackChatReferences(result)[0];
  assert.ok(JSON.stringify(imported.currentWorkflow).includes("Verify finding 42"));
  assert.ok(estimate(result) + 1_000 < 8_000);
  assert.equal(JSON.stringify(original), before);
});

test("an oversized workflow cannot silently disappear when the summarizer omits its continuity", async () => {
  const original = snapshot("Long workflow", 0);
  original.currentWorkflow = { nextAction: "Verify finding 42", notes: "x".repeat(40_000) };
  await assert.rejects(prepareChatReferenceContext({ contextText: packet([original]), effectiveLimit: 8_000,
    destinationTokens: () => 1_000, estimateTokens: estimate, compactDestination: async () => {},
    summarize: async () => ({ summarizedConversation: "Finding 42 remains pending." }),
  }), /workflow could not be summarized/);
});
