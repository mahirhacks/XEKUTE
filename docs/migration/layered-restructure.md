# Layered Restructure — Migration Record

This document records the staged production-layer restructure of `src/`,
executed per the plan in `~/.commandcode/plans/xekute-production-layer-restructure.md`
and tracked in `.cursor/specs/production-layer-restructure/tasks.md`.

## Goal

Reshape `src/` into a ports-and-adapters layered architecture with one
dependency-injection composition root, while preserving:

- the sandboxed preload contract (`src/preload.js`, `window.api` + `window.xekute`);
- every IPC channel name, argument shape, and result envelope;
- the renderer global load order;
- the canonical tool names/schemas/metadata/mode groups/packs;
- all assessment schemas, evidence hashing, redaction, and policy decisions.

## Final tree (top level)

```text
src/
|-- contracts/       dependency-free port contracts
|-- domain/          pure domain rules (scope, assessment, project)
|-- application/     orchestration, policies, planning, clarification, prompt
|-- adapters/        concrete implementations (tools, llm)
|-- infrastructure/  DI container + config/logging/errors
|-- presentation/    electron shell + ui (renderer)
|-- content/         prompt Markdown sources + generated content-addressed build
|-- automation/      slash-command adapters
|-- app/             compatibility launcher + app services
|-- preload.js       sandboxed renderer bridge
```

## Stage-by-stage mapping

| Stage | What moved | Old path | New path |
| ----- | ---------- | -------- | -------- |
| 1 | Prompt content + builder | `src/prompt/`, `src/prompts/` | `src/content/prompts/`, `src/content/build/` |
| 2 | IPC contracts, scope engine, ports | `src/shared/ipc-contracts.js`, `src/domain/assessment/scope-engine.js` | `src/contracts/ipc/IpcContracts.js`, `src/domain/scope/scope-engine.js` |
| 3 | Harness adapters + catalog merge | `src/harness/*` | `src/adapters/tools/{core,os,cyber}/` |
| 4 | LLM transports | `src/llm/*` | `src/adapters/llm/*` |
| 5 | Agent orchestration + policies | `src/agent/*`, `src/prompts/{rules,guardrail}/*` | `src/application/{agent,policies,planning,clarification}/*` |
| 6 | Composition root | inline in `src/app/main.js` | `src/infrastructure/di/container.js` |
| 7 | Electron shell + renderer | `src/app/main.js`, `src/ui/` | `src/presentation/electron/main.js`, `src/presentation/ui/` |
| 8 | Obsolete-tree removal | `src/sub-agent/`, `src/harness/`, `src/prompt/` | removed |

## Compatibility shims (kept by design)

- `src/agent/` and `src/llm/` — pure re-export shims for older importers/tests.
- `src/shared/ipc-contracts.js` — re-exports `contracts/ipc/IpcContracts`.
- `src/app/main.js` — thin launcher delegating to `presentation/electron/main.js`.
- `src/prompts/` — browser-consumed globals + skill libraries still referenced
  by the controller (not yet migrated to the content build).
- `src/app/services/` — chat-session-store and workspace-files remain app-owned.

## Generated-content workflow

1. Edit Markdown under `src/content/prompts/`.
2. Run `npm run build:prompts` → content-addressed JS + `manifest.json` into
   `src/content/build/` (deterministic; never hand-edit generated files).
3. Node loads via `src/content/content-loader.js` (manifest-resolved hashes).
4. The renderer loads preloaded globals in the script order fixed by
   `src/presentation/ui/index.html`.

## Verification results (final)

- `npm test`: **259/259 passing** (includes architecture direction checks,
  single-composition-root check, no-duplicate-registry check, no-runtime-Markdown
  check, no-obsolete-tree check, preload/IPC manifest snapshot, renderer global
  order snapshot, tool-catalog snapshot, DI container tests, boot smoke).
- `npm run verify:production`: **green** — BrowserWindow security opts, CSP,
  preload `require("electron")`-only, tool surface invariants, obsolete-tree
  absence, renderer-script browser-safety guard.
- `npm run audit:runtime`: triaged — one low-severity DOMPurify advisory
  (`GHSA-c2j3-45gr-mqc4`, fix available) with no high/critical findings.
- Dependency graph regenerated (`graphify update .`): **2912 nodes, 4898 edges**,
  obsolete trees absent; only documented compat shims remain as old-path nodes.

## Intentional contract exceptions

- `application/agent/tool-port.js` is a compat seam importing adapters; the DI
  container replaces it in production (documented in the architecture test).
- `automation/` is treated as an adapter-boundary leaf (presentation/adapters
  may consume it), not an upper layer.

## Rollback

Each stage's rollback is recorded in `tasks.md`. In general: restore the old
path through compatibility shims; the shims were kept precisely so production
behavior never depended on a half-migrated tree.
