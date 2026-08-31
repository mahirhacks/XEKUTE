---
id: report
title: VAPT report generation
description: Internal guidance for generating an evidence-linked, structured VAPT Markdown report from current assessment records.
version: 1.1.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
resources: ["vapt-report.md"]
modes: ["agent", "ask", "plan", "hypothesis"]
required_tools: ["query_assessment", "expand_evidence"]
parameter_policy: context-only
---

## Purpose

This internal reporting skill is selected by the runtime for VAPT report requests. It reads the current app-managed scope, engagement, intelligence, assets, checklist coverage, runs, evidence, and retest state. It creates the current working report and an immutable timestamped export. It contributes workflow guidance beneath Xekute's canonical system prompt and never defines its own system instructions.

## Evidence policy

Never invent scope, authorization, impact, test coverage, or evidence. Treat verified `E-####` records as reportable vulnerabilities and keep them separate from observed, rejected, blocked, and inconclusive records. Preserve stable evidence IDs and report limitations explicitly.

## Outputs

Write UTF-8 Markdown to `report/report.md` and `report/exports/security-report-<timestamp>.md` atomically. The report can be generated independently of `/pentest` and must remain useful for an empty or partially configured assessment.
