# Synthesis note: checkpoint summarization plan

How `checkpoint-summarization-plan.md` was produced. Four independent candidate plans were written in parallel, scored by a cross-judge on a different model family, merged, and checked against the code.

## Candidates

| Label | Model | Biggest design choice |
|---|---|---|
| A | Opus | Derive attempts and directives from the ledger and `inputMessages.slice(1)` |
| B | Opus (re-seated) | Attempts computed inside `reduceConversation` from raw messages, no controller change |
| C | Sonnet | Code owns a deterministic spine; the model returns only a small delta |
| D | Haiku | Capture before release: record directives on arrival, write attempt digests into the tombstone |

Dropouts: the intended Fable seat failed on a usage-credits error and was re-seated on Opus. All four hit a session limit mid-run and were resumed from their saved transcripts; none had written files before the cutoff.

## Cross-judge verdict

Scores out of 30 (six criteria): D 29, C 28, B 23, A 22. The judge recommended D as the base and named C's per-tool read allowlist with residual-secret check as the most important graft. I had leaned toward C because it needs less new persisted state. Reading both rationales, D won on the durability model for operator directives (a steering message becomes a releasable block after its run ends, so it must be captured on arrival), its test seam for `main.js`, its PR shape, and its fail-closed budget behavior. C's strengths were grafted instead of lost.

## Base and grafts

Base: D. Grafted in:

- From C: the per-tool digest allowlist that never reads secret-bearing arguments, the residual-secret check and per-item quarantine, the numeric-port exception for `-p`, the fix for the model seeing only the oldest 100 messages, the entity rule for `unresolved_work` with an optional `scope_check`, the delta output contract, shedding facts before events, the `Ran:` section in tombstones, the finding that `ctrl:1819` is mid-task, the instrument-first trigger for the soft ratio, the "fails today" test discipline, and the summarizer prompt text.
- From B: the mechanism note that `reduceConversation` strips `tool_calls`, so attempts attach as a non-persisted `reduction.attempts`.
- From A: the stacked-branch fallback if block management cannot land first.

## Rejected, with reason

- A and B: `inputMessages.slice(1)` as operator directives. Verified unsafe: late tool results (`result:` ids) enter `inputMessages`.
- A and B: dropping `active_conversation` because the reduction carries it. It does not carry commands, so PR 3 must precede PR 5.
- B: the claim that `-H "X-Api-Key"` is uncovered. Verified wrong; both redactors catch it.
- D: widening `redactSecrets` and `redactText` for `-p` forms, and the allowlist of heads for `-p`. Replaced by `redactCommandLine` applied only to command-shaped strings, with C's numeric exception.
- D and A: bracket provenance tags. They cost tokens, are forgeable text, and the prefix grammar already carries provenance.
- D: default-off rolling fragments. Dropped; the spine already preserves omitted history, with a quantified revisit trigger.
- C: inferring steering from `task_revision >= 1`, a restriction-phrase regex, and a `released_directives` tombstone field. Replaced by arrival capture, which needs none of them.
- C: four PRs. Split further into five so redaction ships alone first.

## Verification

Checked against `cf0725a` with read-only probes and reads:

- Both redactors leak nine command forms today and leave `nmap -p 1-1000` and `ssh -p 2222` unchanged.
- The newest fact is dropped at 300 facts and previous events are not merged.
- The summarizer receives messages 0 to 99 of a 250-message ledger while `message_count` reads 250.
- A command password reaches the summarizer payload after both redaction layers.
- `summaryBudget(128000)` is 6,400 tokens; the judge measured 20 of 300 verbose facts surviving, and one candidate measured 23.
- The `coord:889` guard is dead because the controller passes no `reason`; `ctrl:1819` is followed by a continue nudge.
- Late results enter `inputMessages` through `deliverResult` and `boundary()`; the scope helpers `loadScopePolicy` and `evaluateNetworkTarget` exist.

Not verified: real-model behavior (Ollama front truncation, delta recall, repair rate). The plan makes these measurable and gates PR 5 on a canary run.
