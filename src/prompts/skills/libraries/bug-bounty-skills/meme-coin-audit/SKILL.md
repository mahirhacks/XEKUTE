---
id: meme-coin-audit
title: "Meme Coin and Token Security Audit"
description: "Token and meme-coin due diligence on EVM and Solana when you must quickly separate obvious rugs from reviewable contracts and judge holder, liquidity, and authority risk before investment or bounty work."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Meme Coin and Token Security Audit

## What the skill is

A fast-triage and deep-review playbook for fungible tokens and launchpad-style assets. It treats retained privileges, transfer restrictions, and liquidity control as the primary rug surface, then walks eight recurring scam patterns on EVM and Solana (including Token-2022 extensions). Automation accelerates pattern discovery; on-chain state confirms whether “safe-looking” source matches live authority and pool facts.

## When to use

Load this skill for new token launches, pre-trade due diligence, bounty or audit requests on meme coins, pump-style bonding curves, or when recon surfaces an unverified or highly centralized holder profile. Use before committing long manual review—hard kills should fire in minutes.

## How to use

**Phase 0 — Hard kill screen (no source required on Solana)**

- Reject or defer when bytecode is unverified on the relevant explorer, deployer history shows serial rugs, or the asset is minutes old with no independent team signal.
- On Solana: treat non-null mint authority without a hard cap, retained freeze authority on tradeable memes, mutable transfer hooks, and permanent delegate extensions as immediate critical risk.
- On EVM: treat unverified contracts, obvious proxy admin retention without disclosure, and sub-threshold pool liquidity as stop or extreme-caution signals.

**Phase 1 — Soft risk scoring**

- Measure top-holder concentration excluding known pool addresses, LP burn or lock status, upgradeability, social/deployer traceability, and liquidity depth.
- Proceed to source review only when hard kills are clear and the economic question (trade, report, or invest) still matters.

**Phase 2 — Privilege inventory (the core pass)**

- Enumerate every owner, admin, minter, pauser, fee setter, pair/router setter, migrator, and emergency withdraw path.
- Ask: can any single key inflate supply, block sells, raise sell tax without bound, pull LP, or redirect swaps?
- On Solana, map mint, freeze, update, and close authorities; prefer on-chain `None` revocation verified independently of README claims.

**Phase 3 — Class-ordered pattern review**

Work categories in order of prevalence and user harm:

1. **Hidden or unlimited mint** — Supply caps enforced on every mint path; no shadow balance writes.
2. **Honeypot and transfer gates** — Blacklists, trading toggles, max wallet rules, freeze hooks, or hook programs that can block exits.
3. **Fee manipulation** — Mutable buy/sell taxes without enforced ceilings or timelocks.
4. **Liquidity drain** — LP removal, migration, pair replacement, or sync-style manipulation reserved to privileged roles.
5. **Bonding curve abuse** — Mutable virtual reserves, graduation gates, or pricing knobs that benefit insiders.
6. **Authority retention (Solana-focused)** — Any live authority that can change metadata, mint, or freeze after “launch”.
7. **Fake renounce** — Apparent ownership renounce with shadow admins, secondary roles, or destruct paths.
8. **Sandwich-friendly design** — Mandatory zero-slippage market sells, rebase or auto-liquidity triggers that punish exits.

**Phase 4 — Automation then on-chain corroboration**

- Run the token pattern scanner on verified source trees to flag regex-level hits across all eight classes.
- Close gaps the scanner cannot see: live holder distribution, locker contracts, deployer wallet graph, and pool token destinations (burn address versus deployer EOA).

**Phase 5 — Verdict**

- Classify as: likely rug, high-risk trade only, or no material privileged vector found subject to on-chain checks.
- If reviewing for bounty, tie conclusions to in-scope assets and demonstrable user harm (funds stuck, supply inflation, LP pull)—not mere high fees on a disclosed memecoin.

## Mental model

- **The retained privilege is the rug:** Every exit scam needs a privileged lever; find the lever first.
- **Source lies; chain persists:** Renounce in code means nothing if mint authority still exists on-chain.
- **Buy path ≠ sell path:** Honeypots optimize the buy; scrutiny belongs on sell and transfer-out.
- **Liquidity is the exit:** LP location (burn, lock, deployer wallet) dominates short-term price honesty.
- **Extensions are attack surface:** Token-2022 hooks and delegates are first-class review objects, not extras.
- **Concentration is signal:** Supply in a few EOAs is not always a bug, but it changes who must be trusted.

## Tools

| Tool / artifact | Job |
|-----------------|-----|
| Etherscan / Solscan (verification, read contract) | Source availability, live roles, and holder tabs |
| token_scanner.py | Regex sweep across eight rug classes on EVM or Solana source trees |
| DEX analytics (DEXTools, Birdeye, etc.) | Liquidity depth, pool pairing, and holder concentration |
| LP lock explorers (Unicrypt, PinkLock, etc.) | Whether liquidity time-lock matches marketing |
| Solana CLI / RPC JSON | Mint and freeze authority fields when source is absent |
| Foundry (optional) | Local behavior checks on verified EVM tokens—not a substitute for on-chain authority reads |

## Expected output if success

- Clear triage label: skip, caution, or continue deep review—with which hard or soft kills fired.
- Authority matrix: who can mint, freeze, tax, migrate LP, upgrade logic, and whether each is revoked on-chain.
- Category findings mapped to the eight classes, each with evidence type (source pattern, on-chain field, or market fact).
- For “clean enough” tokens: explicit residual risks (concentration, low liquidity, upgradeable proxy) and what would change the verdict.

## Expected output if not success

- Stop reason: unverified code, confirmed honeypot authority, or insufficient data for the decision (too new, no pool).
- Scanner-only hits without on-chain confirmation flagged as “unverified leads,” not final conclusions.
- No false “safe” when freeze or mint authority remains set—absence of source review is itself a failure mode to report.

## Verification method

- Independently read mint/freeze/update authorities from chain state; do not trust UI labels or social posts.
- For EVM fee and blacklist claims, trace the actual setter transaction path and maximum constants in source.
- Confirm LP tokens sit in burn, audited locker, or documented multisig—not deployer-controlled EOAs.
- Reconcile top holders with team, vesting, and pool contracts; exclude known AMM pool addresses before judging concentration.
- If claiming honeypot behavior, demonstrate sell or transfer failure under realistic wallet conditions without relying on a single failed RPC call.
- Re-run scanner after any contract upgrade or proxy implementation change; treat upgrades as full re-audit events.
