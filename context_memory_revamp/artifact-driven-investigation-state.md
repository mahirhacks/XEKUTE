# Artifact-driven investigation state

Canonical investigation state lives in project-owned Markdown under `.xekute/`.
The model context window is not a database. Runtime stages and commits artifacts
through `update_project_artifacts`. There is no Tier 2 memory store, migration,
dual-write path, or compatibility adapter.

## Canonical tree

```text
.xekute/
├── .gitignore
├── project_info/
│   ├── index.md          (regenerated projection)
│   ├── engagement.md
│   ├── targets.md
│   ├── identities.md
│   ├── surface.md
│   └── controls.md
├── hypotheses.md
├── checklist.md
├── evidence/
│   ├── index.md          (regenerated projection)
│   └── E-####.md
├── findings/
│   ├── index.md          (regenerated projection)
│   └── F-####.md
└── .internal/
    └── transactions/
```

Filenames encode identity only. Status, severity, phase, and confidence live in
file bodies. `apply_patch` and other non-artifact writers must not mutate
canonical investigation Markdown.

## Layers that remain

- **Tier 1** — encrypted transcript and conversation checkpoint storage.
- **Tier 3** — bundled knowledge packs (WSTG), local BGE embeddings, native KAG.
  Project/investigation input to KAG is derived from the artifact tree.
- **Operational sources** — `traffic/*.jsonl`, tool output, runs, and maps stay
  as raw sources. Assessment-root `findings/findings.json` may remain unread.

## Locked decisions

- Checklist `phase` is `preflight`, `passive_recon`, `active_recon`, `planning`,
  `execution`, `verification`, `retest`.
- Agent `project.remove` is rejected. Plan/project facts are upsert/correct only.
- `query_assessment` investigation-state domains: `engagement`, `hypotheses`,
  `checklist`, `evidence`, `findings`.
- Evidence records security signals. Findings record only verified reportable
  results. `.xekute/findings/F-####` is the only AI/reportable findings store.
- Old `.xekute/project_info.md`, `.xekute/investigation_checklist.md`, leftover
  Tier 2/V3 files, and `findings/findings.json` are never migrated or deleted.
