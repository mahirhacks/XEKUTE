"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { selectBlocksToRelease, DEFAULT_RELEASE_POLICY } = require("../src/agent/runtime/context-release-policy.js");

const block = (index, tokenEstimate, extra = {}) => ({ index, tokenEstimate, state: "active", ...extra });
const blocks = (sizes) => sizes.map((size, index) => block(index, size));

test("nothing is released below the trigger", () => {
  const selected = selectBlocksToRelease({ blocks: blocks([5000, 5000, 5000, 5000]), releasableBefore: 4, totalTokens: 59_000, limit: 100_000 });
  assert.deepEqual(selected, []);
  assert.equal(DEFAULT_RELEASE_POLICY.triggerRatio, 0.6);
});

test("past the trigger the oldest blocks go first until the target is reached", () => {
  const selected = selectBlocksToRelease({ blocks: blocks([8000, 8000, 8000, 8000, 8000, 8000]), releasableBefore: 6, totalTokens: 65_000, limit: 100_000 });
  assert.deepEqual(selected.map((entry) => entry.index), [0, 1, 2], "20,000 tokens must go and each release frees 7,700");
  const heavy = selectBlocksToRelease({ blocks: blocks([8000, 8000, 8000, 8000, 8000, 8000]), releasableBefore: 6, totalTokens: 70_000, limit: 100_000 });
  assert.deepEqual(heavy.map((entry) => entry.index), [0, 1, 2, 3], "25,000 tokens must go, which takes four blocks");
});

test("the two newest finished blocks and the current task are always kept", () => {
  const selected = selectBlocksToRelease({ blocks: blocks([9000, 9000, 9000, 9000, 9000]), releasableBefore: 4, totalTokens: 95_000, limit: 100_000 });
  assert.deepEqual(selected.map((entry) => entry.index), [0, 1], "blocks 2 and 3 are the newest finished blocks, block 4 is the live task");
});

test("small, pinned and already released blocks are skipped", () => {
  const selected = selectBlocksToRelease({
    blocks: [block(0, 200), block(1, 9000, { pinned: true }), block(2, 9000, { state: "evicted" }), block(3, 9000), block(4, 9000), block(5, 9000), block(6, 9000)],
    releasableBefore: 7,
    totalTokens: 90_000,
    limit: 100_000,
  });
  assert.deepEqual(selected.map((entry) => entry.index), [3, 4]);
});

test("a policy override changes the thresholds and bad input degrades to defaults", () => {
  const sizes = blocks([1000, 1000, 1000]);
  assert.deepEqual(selectBlocksToRelease({ blocks: sizes, releasableBefore: 3, totalTokens: 500, limit: 1000, policy: { keepRecent: 0, minBlockTokens: 0, triggerRatio: 0.1, targetRatio: 0 } }).map((entry) => entry.index), [0]);
  assert.deepEqual(selectBlocksToRelease({}), []);
  assert.deepEqual(selectBlocksToRelease({ blocks: sizes, releasableBefore: 3, totalTokens: "x", limit: 0 }), []);
  assert.deepEqual(selectBlocksToRelease({ blocks: sizes, releasableBefore: -5, totalTokens: 90_000, limit: 100_000 }), []);
});

test("the pre-check agrees with the selector at the trigger boundary", () => {
  const { pressureTriggersRelease } = require("../src/agent/runtime/context-release-policy.js");
  assert.equal(pressureTriggersRelease({ totalTokens: 59_999, limit: 100_000 }), false);
  assert.equal(pressureTriggersRelease({ totalTokens: 60_000, limit: 100_000 }), true);
  assert.equal(pressureTriggersRelease({ totalTokens: 10, limit: 100, policy: { triggerRatio: 0.05 } }), true);
  assert.equal(pressureTriggersRelease({ totalTokens: 10, limit: 0 }), false);
  assert.equal(pressureTriggersRelease({}), false);
});

test("newest turns are kept only while they fit: past the summary line they go too, largest first", () => {
  // Window 256K with one 357K recent turn: releasing only the older turns
  // leaves the prompt over the summary line, which used to force a summary.
  const shrunk = selectBlocksToRelease({
    blocks: [block(0, 60_000), block(1, 60_000), block(2, 55_000), block(3, 357_600), block(4, 20_000), block(5, 2_000)],
    releasableBefore: 5,
    totalTokens: 572_000,
    limit: 256_000,
  });
  assert.deepEqual(shrunk.map((entry) => entry.index), [0, 1, 2, 3], "the huge recent turn goes, the small newest one stays");

  // Below the summary line after the normal batch, the newest two stay.
  const fits = selectBlocksToRelease({ blocks: blocks([9000, 9000, 9000, 9000, 9000]), releasableBefore: 4, totalTokens: 95_000, limit: 100_000 });
  assert.deepEqual(fits.map((entry) => entry.index), [0, 1]);

  // Pinned and partial turns are never taken, even past the line.
  const guarded = selectBlocksToRelease({
    blocks: [block(0, 100_000, { pinned: true }), block(1, 100_000, { partial: true }), block(2, 50_000), block(3, 1_000)],
    releasableBefore: 3,
    totalTokens: 240_000,
    limit: 256_000,
  });
  assert.deepEqual(guarded.map((entry) => entry.index), [2]);
});

test("past the summary line, recent turns holding screenshots are left to the summary", () => {
  const selected = selectBlocksToRelease({
    blocks: [block(0, 300_000, { screenshots: true }), block(1, 2_000)],
    releasableBefore: 1,
    totalTokens: 310_000,
    limit: 256_000,
  });
  assert.deepEqual(selected, []);
});
