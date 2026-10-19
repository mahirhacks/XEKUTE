"use strict";

// Chooses which finished Active Conversation blocks to release when the prompt
// grows. Releasing a block rewrites provider history from that point on, which
// costs a prompt-cache miss, so releases come in batches: nothing happens below
// the trigger, and once it is crossed enough blocks go to land well under it.
// Checkpoint summarization stays the fallback at its own, higher threshold.

const DEFAULT_RELEASE_POLICY = Object.freeze({
  triggerRatio: 0.6,
  targetRatio: 0.45,
  // A tombstone costs tokens too, so blocks that are already small are not worth releasing.
  minBlockTokens: 600,
  // The newest finished turns are the ones the model is most likely to refer back to.
  keepRecent: 2,
  tombstoneTokens: 300,
  // Checkpoint summarization starts here (the coordinator's CHECKPOINT_RATIO).
  summaryRatio: 0.9,
});

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

// Cheap pre-check so a round that is nowhere near the trigger never builds the block view.
function pressureTriggersRelease({ totalTokens = 0, limit = 0, policy = {} } = {}) {
  const window = number(limit, 0);
  return window > 0 && number(totalTokens, 0) >= window * number(policy.triggerRatio, DEFAULT_RELEASE_POLICY.triggerRatio);
}

// `blocks` and `releasableBefore` come from the coordinator's activeBlocks view
// and the controller's task boundary. Returns release requests, oldest first.
function selectBlocksToRelease({ blocks = [], releasableBefore = 0, totalTokens = 0, limit = 0, policy = {} } = {}) {
  const settings = {
    triggerRatio: number(policy.triggerRatio, DEFAULT_RELEASE_POLICY.triggerRatio),
    targetRatio: number(policy.targetRatio, DEFAULT_RELEASE_POLICY.targetRatio),
    minBlockTokens: number(policy.minBlockTokens, DEFAULT_RELEASE_POLICY.minBlockTokens),
    keepRecent: Math.floor(number(policy.keepRecent, DEFAULT_RELEASE_POLICY.keepRecent)),
    tombstoneTokens: number(policy.tombstoneTokens, DEFAULT_RELEASE_POLICY.tombstoneTokens),
    summaryRatio: number(policy.summaryRatio, DEFAULT_RELEASE_POLICY.summaryRatio),
  };
  const window = number(limit, 0);
  const used = number(totalTokens, 0);
  if (!window || used < window * settings.triggerRatio) return [];

  const finished = (Array.isArray(blocks) ? blocks : [])
    .slice(0, Math.max(0, Math.floor(number(releasableBefore, 0))))
    .filter((block) => block.state !== "evicted" && block.pinned !== true && block.partial !== true);
  const worthReleasing = (block) => number(block.tokenEstimate, 0) >= settings.minBlockTokens;
  const kept = Math.max(0, finished.length - settings.keepRecent);
  const eligible = finished.slice(0, kept).filter(worthReleasing);

  let needed = used - window * settings.targetRatio;
  const selected = [];
  const take = (block) => {
    selected.push({ index: block.index, note: "" });
    needed -= Math.max(0, number(block.tokenEstimate, 0) - settings.tombstoneTokens);
  };
  for (const block of eligible) {
    if (needed <= 0) break;
    take(block);
  }
  // The newest turns are kept only while they fit. When everything older is
  // gone and the prompt would still reach the summary line (a smaller window,
  // or one huge recent turn), they go too, largest first, before a full
  // summary is needed.
  const projected = window * settings.targetRatio + needed;
  if (needed > 0 && projected >= window * settings.summaryRatio) {
    // Turns holding browser screenshots are left to the summary, which keeps them.
    const recent = finished.slice(kept).filter((block) => worthReleasing(block) && block.screenshots !== true)
      .sort((left, right) => number(right.tokenEstimate, 0) - number(left.tokenEstimate, 0));
    for (const block of recent) {
      if (needed <= 0) break;
      take(block);
    }
  }
  const order = new Map(finished.map((block, position) => [block.index, position]));
  return selected.sort((left, right) => order.get(left.index) - order.get(right.index));
}

module.exports = { DEFAULT_RELEASE_POLICY, pressureTriggersRelease, selectBlocksToRelease };
