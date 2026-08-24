---
id: report
command: /report
title: VAPT report generation
description: Generate an evidence-linked, structured VAPT Markdown report from the current assessment records.
version: 1.0.0
entrypoint: SKILL.md
resources: ["vapt-report.md"]
modes: ["agent", "ask", "plan", "hypothesis"]
required_tools: ["query_assessment", "expand_evidence"]
parameter_policy: context-only
---

## Purpose

`/report` is a parameterless reporting skill. It reads the current scope, engagement, intelligence, assets, coverage, runs, evidence, findings, and retest state. It creates the current working report and an immutable timestamped export.

## Evidence policy

Never invent scope, authorization, impact, test coverage, or evidence. Keep verified findings separate from suspected, rejected, blocked, and inconclusive observations. Preserve stable evidence IDs and report limitations explicitly.

## Outputs

Write UTF-8 Markdown to `report/report.md` and `report/exports/vapt-report-<timestamp>.md` atomically. The report can be generated independently of `/pentest` and must remain useful for an empty or partially configured assessment.
