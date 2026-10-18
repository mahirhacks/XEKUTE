# Context window management plan

Status: proposal. Three pillars working together to keep the live context small during long cybersecurity runs. Delegation keeps bulk out of the main thread. Active-conversation block eviction drops finished turns. Checkpoint summarization is the fallback when eviction is not enough.

## What already exists

Xekute already has the block model. The idea here extends it, it does not introduce it.

The Tier 1 context coordinator ([tier1-context-coordinator.js](../../src/app/services/memory/tier1-context-coordinator.js)) assembles the prompt as nine fixed rows, split into two blocks:

- **Block A, the pinned prefix** (exact, cache-stable): System Prompt, Tool Definitions, Rules, Skills, Subagents, MCP.
- **Block B, checkpoint-owned**: Summarized Conversation, Active Conversation, Current Workflow.

The meter rows are declared at `METER_ROWS` (coordinator line 12) and mirrored in the controller ([agent-controller.js:91](../../src/agent/controller/agent-controller.js)) and the renderer ([bootstrap.js:286](../../src/ui/bootstrap.js)).

**Summarization already exists** as checkpointing. When the upper bound passes `CHECKPOINT_RATIO` (0.90 of the limit), `pressure()` sets `should_checkpoint`, and `checkpoint()` collapses the whole Active Conversation into a grounded summary (facts, decisions, significant events), keeping only the live input and browser-screenshot exchanges. See `checkpointTier1IfNeeded` ([agent-controller.js:1038](../../src/agent/controller/agent-controller.js)).

**Delegation already exists**. `delegate_agent` runs a child as a background job with its own memory session and returns a short summary back to the parent. The cap is `MAX_SUMMARY_CHARS` 2000 ([delegation-provider.js:14](../../src/agent/runtime/delegation-provider.js)), child plumbing in [subagent-coordinator.js](../../src/agent/runtime/subagent-coordinator.js).

**The gaps this plan fills:**

1. Active Conversation is a flat ledger (`capActive`, `ACTIVE_MAX` 2000 messages). It has no notion of a block (one turn / one user-prompt-to-outcome unit) inside it. Eviction today is all-or-nothing: checkpoint collapses everything at once at 90%.
2. Block A (tools, skills, MCP) is effectively never shrunk. `applyToolCatalog` can swap the tool catalog under `protectedOverflow` ([agent-controller.js:1112](../../src/agent/controller/agent-controller.js)), but loaded skills and MCP definitions stay resident for the whole run. A run that loads six skills and four MCP servers early carries them forever.
3. There is no cheap, selective reclaim between "do nothing" and "collapse the entire conversation".

## Target design: three pillars

### Pillar 1. Delegation keeps Block A and bulk output out of the main thread

This is the primary mechanism. It is the only one that never costs a cache miss, because the main thread only ever appends a short summary and its prefix stays byte-stable.

Changes:

- **Route skill-heavy and MCP-heavy work to children.** When a user step needs a skill bundle or an MCP server the main agent does not already hold, prefer delegating it to a child that loads that bundle, does the work, and returns a summary plus file handles. The skill text and MCP schema live and die in the child. The main agent's Block A stays lean.
- **Fixed child archetypes for cache reuse across spawns.** A "recon" child always loads the same skill and MCP set, so its own prefix is cache-stable across repeated spawns. Dynamic per-call skill selection gives every child a cold prefix, so avoid it.
- **Children spill bulk to disk and return handles.** A child that runs a large scan writes the full output and evidence to the session store, writes durable findings to the ledger (pillar below), and returns a summary plus references. The parent opens the raw file only on demand. This also contains untrusted tool output inside the child, which matters for VAPT work where target responses can carry injection.
- **Raise or tier the summary cap when needed.** 2000 chars is tight for a recon handoff. Allow a child to return a summary plus structured artifact references instead of inlining. Child output today is `{ text, format, summary }`; `artifact_refs` exists only on tool events in the coordinator's `reduceConversation`, so this needs a new field on child output.

Keep in the main thread: back-and-forth with the user, reasoning that spans the whole engagement, and short tool calls whose output is smaller than their conclusion.

### Pillar 2. Active-conversation block eviction (the new piece)

Give the Active Conversation ledger an explicit block index and evict finished blocks selectively, below the checkpoint threshold, append-only.

Data model. Today `active` is `message[]`. Add a block layer:

```
activeBlock = {
  index,            // 0,1,2,... monotonic, never renumbered
  blockId,          // reuse the existing V3 block_id
  state,            // "active" | "evicted"
  pinned,           // user- or system-pinned, never evictable
  messages,         // the turn's messages (user -> tool -> assistant)
  tokenEstimate,
  tombstone,        // 1-2 line stub shown after eviction
}
```

The V3 session store stamps a `block_id` per turn ([v3-session-store.js:313](../../src/app/storage/memory/v3-session-store.js)), but the Tier 1 coordinator never receives it: active messages carry only `source_message_id` on user messages. Phase 1 therefore derives `blockId` from the opening user message's `source_message_id`, falling back to a content hash. Threading the V3 `block_id` onto active messages is a later step. The meter's "Active Conversation" row sums only `state === "active"` blocks plus their tombstones.

Rules (these match the user's spec):

- **Append-only, never reinsert in place.** An evicted block is replaced by its tombstone. It is never spliced back into the middle. If its content is needed again, `recall_block(index)` appends the full content as a *new* block at the end. This is what keeps the provider prefix stable and the cache warm. Reinserting mid-stream would break the cache from that point to the end on every call.
- **Eviction runs on pressure, in batches, before checkpoint.** Trigger at a lower threshold than checkpoint (say 0.6 of limit). Pick candidate blocks by: `state active`, not pinned, outcome `completed`, age, and no later reference to the block's artifacts (hosts, paths, IDs). Evict oldest-eligible first until back under the band. Checkpoint stays the 0.90 fallback.
- **Model-driven release as the first signal.** Add a `release_blocks([indices])` tool so the agent can say it is finished with a turn (for example, after a skill did its job). Cheapest and most accurate signal, no extra model call. Heuristics propose, the model confirms.
- **Tombstones, not silent deletion.** Replace an evicted block with a stub like `[block 5 evicted: ran dirbust on /admin, findings in ledger]`. Without it the agent forgets it already did the work and repeats it. Full content stays on disk for `recall_block`.
- **API validity is automatic at block granularity.** A block is a complete user→tool→assistant exchange, so evicting whole blocks keeps `tool_use`/`tool_result` pairs matched and roles alternating. Never evict half a block.

Protect the same things the current tail logic protects: the live input, the coherent tail, browser-screenshot exchanges, and `inputMessages` (`protectedHistory`/`coherentTail`, [agent-controller.js:1121](../../src/agent/controller/agent-controller.js)). Those feed the eviction candidate filter as hard excludes.

### Pillar 3. Checkpoint summarization as the fallback

Unchanged in spirit, demoted in frequency. When eviction cannot reclaim enough (a single giant in-flight turn, or everything is pinned or referenced), the existing 0.90 checkpoint collapses Block B into the grounded summary. Because eviction now runs first and blocks are small, checkpoints become rare and cheap.

One addition: a **findings ledger** that eviction and delegation both write to. Before a block is evicted or a child returns, durable engagement facts (hosts, credentials found, vulns, open ports, artifact paths) are extracted into a pinned, never-evicted section. This stops the real risk in VAPT work: a block that loaded an irrelevant skill *and* found a live token gets evicted and the token is lost. The ledger is the single source of truth that survives both eviction and checkpoint. It can live as grounded facts in the checkpoint schema, which already carries `grounded_facts` ([tier1-context-coordinator.js](../../src/app/services/memory/tier1-context-coordinator.js)).

## How the three interact per model call

1. Assemble Block A + Block B, measure pressure (already done in `prepareModelRequest`, [agent-controller.js:1255](../../src/agent/controller/agent-controller.js)).
2. If any just-finished work was skill/MCP-heavy and self-contained, it should have been a child (pillar 1), so Block A is already lean.
3. If pressure ≥ eviction band and eviction candidates exist, evict a batch of finished active blocks to tombstones (pillar 2).
4. If still ≥ 0.90 after eviction, checkpoint-collapse Block B (pillar 3).
5. Findings ledger is written on every eviction and every child return, and is pinned.

Order matters: eviction before checkpoint (cheap before expensive), delegation before either (the bulk never arrives).

## Where things live

- `src/app/services/memory/tier1-context-coordinator.js` owns the block ledger, `assemble`, `pressure`, `checkpoint`, `capActive`. The block-index layer, `release`/`recall`, and the eviction pass go here.
- `src/agent/controller/agent-controller.js` drives pressure and checkpoint per round (`checkpointTier1IfNeeded`, `prepareModelRequest`, `protectedHistory`). The eviction trigger and the new tools wire in here.
- `src/agent/runtime/subagent-coordinator.js` and `delegation-provider.js` own child lifecycle and the return summary. Pillar 1's archetypes, summary cap, and spill-to-disk land here.
- `src/agent/runtime/context-budget.js` owns token estimation and the limit math. No change needed; eviction reuses `estimateTokenCount`.
- `src/ui/bootstrap.js` renders the meter rows. The Active Conversation row needs to show evicted/tombstoned blocks greyed out, and expose a pin control.

## Phasing

1. **Block-index the active ledger** in the coordinator. Done as a derived, read-only view: `blocksFromActive` and `coordinator.activeBlocks(projectId, sessionId)` return `{ index, blockId, start, messages, tokenEstimate }`, one block per user turn. The ledger stays a flat array, so `assemble`, `capActive`, `checkpoint` and the persisted format are unchanged. `state`, `pinned` and `tombstone` are not stored yet. They need a persisted block layer, which phase 2 adds together with `release_blocks`. Index is positional until then.
2. **`release_blocks` + `recall_block` tools** and the model-driven path. Measurable reclaim with zero heuristics.
3. **Heuristic eviction pass** at the eviction band, batched, reference-aware.
4. **Findings ledger** pinned section, written by eviction.
5. **Delegation archetypes + spill-to-disk** for skill/MCP-heavy work, so Block A stays lean.
6. **UI**: greyed evicted blocks, pin control.

Measure tokens-saved against cache-miss cost after each phase before adding the next. Do not add the heuristic classifier unless phases 2 and 3 leave reclaim on the table.

## Gotchas

- **Cache is the whole point.** Block A sits at the start of the provider prefix. Unloading a real `tools` entry or a skill mid-run breaks the cache for everything after it. Keep Block A append-stable; shrink it by not loading bulk there in the first place (pillar 1), not by removing entries mid-run. If MCP schemas must be evictable, expose them as text inside a block rather than as live `tools` entries.
- **One giant turn can blow the window on its own.** Block-level eviction cannot touch the turn still running. That case needs tool-result trimming inside the turn (cap big outputs, spill to file, hand back a handle). This is pillar 1's spill mechanism applied in-thread, and it likely saves more than block eviction.
- **Never renumber blocks.** Block 7 stays 7 after 3 is gone, or the model's references and `recall_block` break.
- **Mixed-content blocks are the real hazard.** A block that is irrelevant *and* holds a critical finding must write the finding to the ledger before eviction. The ledger plus tombstones is what makes eviction safe for VAPT.
- **Secret redaction already runs** in `reduceConversation`/`redactText`. Eviction tombstones and the findings ledger must pass through the same redaction, or secrets re-enter the prompt through the summary path.
