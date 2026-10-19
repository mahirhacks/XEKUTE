# Context window management plan

Status: implemented (see Status below). Three pillars working together to keep the live context small during long cybersecurity runs. Delegation keeps bulk out of the main thread. Active-conversation block eviction drops finished turns. Checkpoint summarization is the fallback when eviction is not enough.

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

## Status

All six phases are implemented and covered by tests. The plan above is the original design. This section records what was built and where it differs.

| Phase | What shipped | Where |
|---|---|---|
| 1 | Block view over the flat ledger | `blocksFromActive`, `activeBlocks` in the Tier 1 coordinator |
| 2 | Stable persisted block indexes, `evictBlocks`, `recallBlock`, encrypted per-block storage, `release_blocks` and `recall_block` tools | coordinator, `tier1-sensitive-store.js`, `tools/process/context-blocks.js`, controller |
| 3 | Pressure-triggered batch release before checkpointing | `runtime/context-release-policy.js`, `maybeAutoReleaseContext` in the controller |
| 4 | Deterministic findings in every tombstone, carried through a checkpoint as "Released work" facts | `extractBlockFindings` in the coordinator |
| 5 | Oversized child reports saved under `.xekute/delegated/`, `recon` and `analyst` child roles | `runtime/child-report-spill.js`, `runtime/child-archetypes.js`, `delegation-provider.js` |
| 6 | Block list in the context meter with greyed released blocks and a pin control, release notice in the chat | `ui/features/chat/context-blocks-view.js`, `bootstrap.js`, `context:pinBlock` IPC |

### How it behaves

- A block is one user turn. Each block opener carries a `block_index` that is stamped once and never reused, so index 7 stays 7 after block 3 is released. A counter is persisted with the active ledger.
- Releasing replaces the whole block with one tombstone that keeps its index. The full messages are written to the encrypted session store first. If that write fails the block stays in context.
- The model learns block numbers from tombstones and from `release_blocks` with `operation: "list"`. Blocks are not labelled in the prompt, because rewriting an old message would break the prompt cache for everything after it.
- `recall_block` returns the old messages as a text transcript in a tool result of the current turn. Nothing is spliced back into the middle of history. A transcript larger than about 20% of the window comes back as head and tail with `next_offset`, and `recall_block` with that `offset` pages through the rest.
- Only blocks from before the task in progress can be released. The live task, its steering messages and any open tool exchange are protected.
- Automatic release starts at 60% of the context window and releases the oldest finished blocks until usage is near 45%. It keeps the two newest finished blocks, skips pinned blocks and blocks under 600 tokens, and never runs in preview mode or when the coordinator has no block support. Checkpoint summarization still runs at 90%.
- Pins are a set of block indexes stored with the active ledger, not a flag on messages, so they survive the controller re-sending its own copy of the ledger. A pin stops release only: a checkpoint still summarizes a pinned block, and its pin is dropped unless the block comes back as the live task.
- The coordinator keeps the newest `ACTIVE_MAX` (2,000) messages. A trim that cuts into a block leaves that block's index on its surviving head and marks it partial, and the controller offsets its own longer ledger by the trimmed count when it releases. A partial block is never released (`BLOCK_PARTIAL`): releasing only its tail would let a re-sent ledger bring its opener back as a second block with the same index.
- After a checkpoint the task's own messages go back into the ledger as messages, with or without a live-input supervisor, so the task stays an instruction rather than summarized data. A checkpoint before a model call is skipped when the ledger holds nothing but those messages.
- Tests: `memory-v3-tier1-blocks-model.test.js` checks the coordinator against a reference model through trims, forks, restarts and checkpoints; `context-blocks-controller-fuzz.test.js` runs whole agent turns with random block tool use, forced checkpoints and live steering; `npm run verify:context-blocks` drives the real app against a scripted Ollama.
- A forked chat gets a copy of every released block, so the "Released work" lines its summary carries stay recallable.

### Where the build differs from the plan

- **No separate findings ledger.** Facts live in each tombstone, in the position the block occupied. A pinned section in the early prompt would have invalidated the cache on every update. Checkpointing carries tombstones forward as facts.
- **No block labels and no model-facing "context map".** See above.
- **Pins live in the coordinator, not on messages.**
- **Archetypes narrow tools and add role guidance. They are not a cache feature.** The cache benefit was not measured against a real provider.
- **Reports go to `.xekute/delegated/`.** A full child transcript was already persisted in the encrypted child session store; the saved file is the part the parent can open with `read_file`.
- **A redaction bug was fixed on the way.** `redactText` left the token in `Authorization: Bearer <token>`.

### Not done

- Making the orchestrator hold no MCP schemas and delegate MCP work to children. It changes which agent can call which tool and needs a product decision.
- Capping and saving a single huge tool output inside one running turn. Block release cannot touch the turn that is still running.
- A model-based relevance classifier. The model-driven tool and the size and age policy came first; add a classifier only if they leave reclaim unused.
- Measuring the real prompt-cache cost of a release against a live provider.
- Pillar 2's candidate filter is simpler than designed: release picks by age, size and the newest-two rule. It does not check "outcome completed" or later references to a block's artifacts, and blocks holding older browser-screenshot exchanges can be released.

## Gotchas

- **Cache is the whole point.** Block A sits at the start of the provider prefix. Unloading a real `tools` entry or a skill mid-run breaks the cache for everything after it. Keep Block A append-stable; shrink it by not loading bulk there in the first place (pillar 1), not by removing entries mid-run. If MCP schemas must be evictable, expose them as text inside a block rather than as live `tools` entries.
- **One giant turn can blow the window on its own.** Block-level eviction cannot touch the turn still running. That case needs tool-result trimming inside the turn (cap big outputs, spill to file, hand back a handle). This is pillar 1's spill mechanism applied in-thread, and it likely saves more than block eviction.
- **Never renumber blocks.** Block 7 stays 7 after 3 is gone, or the model's references and `recall_block` break.
- **Mixed-content blocks are the real hazard.** A block that is irrelevant *and* holds a critical finding must write the finding to the ledger before eviction. The ledger plus tombstones is what makes eviction safe for VAPT.
- **Secret redaction already runs** in `reduceConversation`/`redactText`. Eviction tombstones and the findings ledger must pass through the same redaction, or secrets re-enter the prompt through the summary path.
