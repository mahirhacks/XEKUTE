---
id: workflow_bypass
title: Workflow bypass
summary: Test whether state transitions, approvals, sequencing, or required steps can be skipped or reordered.
category: business-logic
level: advanced
signals: ["workflow", "approval", "state", "step", "sequence"]
technologies: ["web", "rest", "mobile api"]
related: ["business_logic", "payment_logic", "race_conditions"]
---

## Workflow

Model valid transitions and actors from evidence. Attempt one omitted, duplicated, reordered, or direct transition with a disposable record. Verify server state and audit trail against the normal flow.
