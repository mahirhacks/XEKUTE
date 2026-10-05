---
id: web3-audit
title: "Web3 Smart Contract Audit"
description: "Structured smart-contract security review for DeFi and on-chain protocols when you need invariant-driven code review, economic triage, and severity-grounded conclusions on Solidity or similar contract code."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Web3 Smart Contract Audit

## What the skill is

A judgment-first playbook for reviewing on-chain programs: when a target is worth the effort, how to walk code in an order that matches real paid findings, and which invariant families most often explain critical loss. It emphasizes paired functions, accounting consistency, and upgrade/oracle boundaries—not a checklist of generic CWE labels.

## When to use

Load this skill when auditing protocol source (EVM or comparable contract languages), scoping an Immunefi or similar program, or deciding whether a DeFi deployment merits deep review versus a quick economic pass. Use after basic asset identification; pair with program policy and chain-specific deployment facts from recon.

## How to use

**Phase 0 — Economic and effort gate**

- Estimate realistic maximum payout from program caps and protocol TVL; skip or defer when effort clearly dominates upside unless you have rare domain expertise.
- Treat heavy prior audit coverage on a small, linear codebase as a soft kill; treat very large, heavily audited bridges as high hours for uncertain yield unless bounty floors justify it.
- Score targets on TVL, bounty tier, audit freshness, deploy age, familiarity, documentation quality, and upgrade surface; proceed only when the score supports a multi-hour review.

**Phase 1 — Map the system**

- Identify asset flows: deposits, withdrawals, mint/burn, rewards, debt, and share accounting.
- List external dependencies: oracles, bridges, routers, callbacks, and privileged roles.
- Note proxy or upgrade paths and initialization entrypoints before reading business logic.

**Phase 2 — Function-family pass (do this early)**

- For each guarded entrypoint, enumerate siblings (`vote` / `poke` / `reset`, `deposit` / `mint`, `claim` variants). Ask whether every sibling enforces the same epoch, role, and state prerequisites.
- For each “create” or “lock” path, trace the matching “update”, “cancel”, or “release” path and verify every state delta and token movement has a symmetric undo or explicit intentional exception.

**Phase 3 — Class-ordered deep review**

Work one family at a time; finish accounting and access control before exotic edge cases.

1. **Accounting desynchronization** — Multiple variables that must move together; fast paths, early returns, and ordering of updates versus share or rate calculations.
2. **Access control** — Role modifiers, ownership versus existence checks, initializer exposure on implementations, and modifiers that fail open.
3. **Incomplete code paths** — Partial fills, order updates without refunds, alternate mint/deposit routes that skip validation present on the primary route.
4. **Boundaries and precision** — Strict versus non-strict comparisons at epoch ends, deadlines, loop limits, and rounding that can zero out legitimate value.
5. **Oracle and price trust** — Staleness, confidence bands, TWAP windows, single-source spot reads, and anything flash liquidity can distort.
6. **Vault share semantics** — Empty-vault exchange rate, virtual offsets, and whether transfers move lock or stake metadata with shares.
7. **Reentrancy and callback ordering** — External calls before state finalization; cross-function and cross-contract re-entry with stale reads.
8. **Liquidity-amplified manipulation** — Designs that combine spot or short-window prices with borrowable liquidity (treat as oracle/trust-boundary review, not a separate hunt thread).
9. **Signed message replay** — Domain separation: nonce, chain, contract address, and expiry in signed payloads.
10. **Proxy and upgrades** — Storage layout alignment, uninitialized logic contracts, and delegated execution to untrusted targets.

**Phase 4 — Conclude or pivot**

- If no invariant break survives skeptical “attacker with gas and capital” reasoning, document dead ends and downgrade priority.
- If a break is credible, narrow to minimal state transition and impact (fund freeze, unauthorized mint, bad debt, governance capture) before any local simulation.

## Mental model

- **Siblings share fate:** The bug is often the one function in the family missing a check the others have.
- **Accounting is a ledger:** Any code path that changes one total without the paired total is suspect until proven safe.
- **Symmetry:** Every lock has an unlock; every debit has a credit; every approval has a revocation story.
- **Equality cases matter:** When `A > B` guards logic, explicitly reason about `A == B`.
- **Trust boundaries:** Oracles, callbacks, and signatures are inputs—validate freshness, scope, and binding.
- **Effects before interactions:** State committed before untrusted execution unless reentrancy risk is provably absent.
- **Economics gate truth:** A technically interesting bug below payout or TVL reality is a research note, not a hunt outcome.

## Tools

| Tool / artifact | Job |
|-----------------|-----|
| Block explorer (verified source, proxy implementation) | Confirm deployed code matches review target and role holders |
| Static search (ripgrep or IDE) | Locate accounting totals, early returns, oracle calls, `initialize`, and modifier families |
| Foundry (or equivalent test runner) | Reproduce state transitions on a fork or local deployment to validate impact hypotheses |
| Immunefi / program docs | Scope, severity definitions, and payout caps |
| Prior audit reports | Known fixed areas versus unaudited modules and version drift |
| Slither / semgrep (optional) | Triage obvious access-control and reentrancy patterns before manual pass |

## Expected output if success

- A short target verdict: worth hunting or skip, with economic rationale.
- A prioritized finding list: invariant violated, affected functions, plausible impact class (fund loss, freeze, unauthorized mint, bad collateralization), and severity aligned to program rules.
- A review map: function families checked, oracle and upgrade touchpoints, and explicit “reviewed and clean” areas to avoid duplicate work.
- If validation ran: reproducible test narrative describing initial state, triggering action, and observable balance or role change—without production exploit steps.

## Expected output if not success

- Documented stop condition: economic kill, scope mismatch, unverified bytecode, or insufficient time for codebase size.
- Annotated dead ends: patterns searched (e.g., sibling modifiers, staleness checks) with no credible break.
- Residual risk notes: areas not reviewed (unaudited dependencies, off-chain keeper behavior) so conclusions are not overstated.

## Verification method

- Re-read the violating path with CEI and symmetry checks; have a second mental pass ask “what if caller re-enters or uses the sibling function?”
- Confirm impact on a fork or isolated deployment using the same compiler settings and proxy layout as production.
- Cross-check that the vulnerable path is reachable by an unprivileged or realistically compromised role assumed in the threat model.
- Validate finding against program scope (chain, contract address, impact type) and that reported severity matches demonstrable harm, not theoretical griefing.
- For oracle or price issues, show the trusted input is actually consumed in a decision that moves funds or mints shares—not a dead view function.
