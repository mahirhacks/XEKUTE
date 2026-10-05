---
id: report-writing
title: "Bug Bounty Report Writing"
description: "Turn a validated finding into a platform-ready bounty report with impact-first structure, honest severity, and evidence that triagers can replay without theoretical language."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# Bug Bounty Report Writing

## What the skill is

A quality gate and structure playbook for drafting submissions to HackerOne, Bugcrowd, Intigriti, Immunefi, and similar programs after technical validation. It enforces proved impact, human-readable triager workflow, consistent severity reasoning, and durable on-disk artifacts—not slide-deck theory or copy-pasted exploit theater.

## When to use

Load this skill after you have confirmed a bug in scope and before platform submit. Use it when polishing title, summary, reproduction steps, impact, CVSS or program severity, remediation hints, and attachments. Do not use it to invent impact you have not demonstrated, or to pad reports for recon-only or N/A topics (such as client algorithm recovery without downstream abuse).

## How to use

1. **Persistence first** — Create or update a finding folder on disk: platform-specific report draft, submission notes (checklist, caveats, references), and an evidence directory for screenshots and response excerpts. Never rely on terminal scrollback as the source of truth.

2. **Impact sentence** — Open with what an attacker can do today: which actor, which endpoint or feature, which data or action, and which victims are affected. Ban hedging phrases that imply doubt when you already proved behavior.

3. **Title** — Use the pattern: bug class, exact location, actor, and outcome. Avoid generic labels like “security issue” or “broken access control” without location and effect.

4. **Platform shape** — Adapt section headings to the target platform (summary/details/steps/impact/fix vs VRT category vs Immunefi economic impact) while keeping the same factual core. Match program CVSS version (3.1 vs 4.0) when required.

5. **Steps to reproduce** — Numbered, minimal path from clean state: accounts or roles, authentication method, one primary request description, observed response proving harm, and expected vs actual behavior. Triagers should not infer missing setup.

6. **Impact block** — Quantify where honest: user population, data classes (PII, financial, health), privilege gained, automation feasibility, and business consequence programs care about. Align narrative with chosen severity—do not claim Critical on read-only low-sensitivity metadata.

7. **Severity and CVSS** — Pick metrics from demonstrated prerequisites (network reachability, account type, user interaction, confidentiality/integrity/availability effects). Use program calculators when vectors are required. Note scope-changed scenarios only when you proved cross-boundary impact.

8. **Remediation** — One or two concrete fixes (ownership check, authz on mutation, disable dangerous resolver, add freshness to integrity tokens)—not a framework lecture.

9. **Downgrade defense** — If triagers push back, respond with specific counters tied to your evidence (free account sufficient, scale of data, reproducible response bodies, hacktivity search for duplicates)—not anger or hypotheticals.

10. **Pre-submit checklist** — Run the full gate: title formula, first-sentence impact, two-account proof where relevant, response proof attached, CVSS included, word count reasonable, endpoints spelled correctly, severity matches text, no qualifying verbs that weaken proved facts, fresh-state reproducibility.

## Mental model

Triagers skim under time pressure; the first sentence is the verdict. A report is a reproducibility contract—you are certifying that someone else can reach the same harmful state. Severity is about demonstrated harm and exploit prerequisites, not how clever the discovery was. Theoretical chaining (“could combine with…”) without proof damages credibility. Writing in first person and plain English beats formal audit voice. Platform templates differ in labels, not in the obligation to show harm.

## Tools

| Tool | Job |
| --- | --- |
| Finding folder layout | Stores draft report, submission notes, and evidence artifacts |
| `validate.py` (when present) | Updates submission notes; append rather than duplicate |
| CVSS 3.1 / 4.0 calculators | Produce defensible vector strings required by programs |
| Screen capture / short video | Shows impact for complex flows (especially valued on some EU platforms) |
| Hacktivity / duplicate search | Supports “already known” rebuttals with evidence |

## Expected output if success

A complete draft ready to paste or upload: specific title, summary paragraph, structured reproduction, impact and severity justification, concise remediation, attachment list, filled pre-submit checklist in submission notes, and evidence files referenced from the draft. Word count stays triager-friendly; every claimed outcome appears in steps or impact.

## Expected output if not success

Stop before submit: checklist failures (single-account IDOR claim, no response proof, impact overstated, out-of-scope host, unproved “may allow” language), or missing second identity where cross-user harm is asserted. The artifact is an internal “not ready” note listing exact gaps to fix—not a premature submission.

## Verification method

Self-review as a hostile triager: follow your own steps in order without insider knowledge; confirm the harmful response still appears. Have a peer or fresh session repeat if possible. Re-read for banned hedging and passive voice. Confirm CVSS inputs match the story (PR:L only if a normal account suffices). Match program rules (safe harbor, PoC constraints, chain policies). After submit, keep submission notes updated with ticket IDs and triager feedback for downgrade counters.
