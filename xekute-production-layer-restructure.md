# XEKUTE Production Layer Restructure

Goal: reshape the complete `src/` tree into a production-oriented ports-and-adapters architecture with one dependency-injection composition root, while preserving runtime behavior and the two hard external contracts:

1. **Sandboxed preload contract** — `src/preload.js` remains the stable bridge with the same exposed API methods, IPC channel names, invocation styles, result envelopes, and listener behavior. It is not edited during the restructure.
2. **Renderer global/load-order contract** — the renderer creates the same `globalThis` names in the same semantic order before dependent scripts execute.

The restructure is behavior-preserving: no new providers, no tool/policy/UI changes, no bundler. Decode the execution into small independently verifiable stages; each stage ends green on `npm test` and `npm run verify:production` before the next begins.

## Current-state facts to preserve (Stage 0 baseline)

- `package.json` points Electron at `src/app/main.js`; `main` is updated only in Stage 7.
- `src/app/main.js` owns lifecycle, windows, IPC registration, process/workspace/provider state, and most concrete composition (~3000 lines; require block at [src/app/main.js](src/app/main.js) lines 9-50).
- `src/preload.js` is sandboxed, requires only Electron, exposes `window.api` + typed `window.xekute`.
- `src/shared/ipc-contracts.js` validates IPC payloads / normalizes envelopes.
- `src/harness/core/tool-map.js` + `src/harness/os/tool-registry.js` + `src/harness/cyber/tool-registry.js` own names/schemas/metadata/mode groups.
- `src/agent/controller.js` is the highest-risk module: imports tools, policies, domains, prompts, memories, and LLM context directly.
- Prompt system: human Markdown in `src/prompt/`, generated JS in `src/prompts/`, mixed logic in the tree, load order in `src/ui/index.html`.
- `scripts/verify-production.js` is source-text-sensitive (asserts old paths/locations/order) and must be migrated deliberately, not mechanically.
- `graphify-out/` was built from `314adf0c` and is stale vs the working tree; treat it as the authoritative historical import inventory and regenerate only at the final stage.
- Record the actual test count from the runner (do not hardcode 234).

## Final target layout (all under `src/`)

```text
contracts/
  tool/ToolPort.js  llm/ChatPort.js
  assessment/ScopePort.js  assessment/FindingPort.js  assessment/EvidencePort.js
  storage/WorkspacePort.js  ipc/IpcContracts.js

domain/
  scope/scope-engine.js
  assessment/assessment-map.js, assessment-workspace.js, http-workbench.js,
              proxy-listener.js, http-body-decoder.js, finding-gate.js
  project/project-profile-store.js

application/
  agent/controller.js, runtime.js, prompt.js, tunables.js
  agent/memory/context-memory.js, action-log.js, records.js, failure-memory.js
  policies/operating-modes.js, policy-engine.js, request-intent-rules.js,
           evidence-rules.js, runtime-policy-rules.js, agentic-loop.js, bugbounty.js
  policies/guardrails/command-guardrails.js, data-guardrails.js
  planning/plan-document.js, engagement-context.js, custom-guidance.js
  clarification/operator-questions.js, verifier.js

adapters/
  llm/context-budget.js  llm/stream-utils.js
  llm/ollama/ollama-stream.js  llm/openrouter/openrouter-stream.js  llm/openrouter/providers.js
  tools/core/tool-catalog.js, tool-handlers.js, error-class.js
  tools/os/workspace-search.js, terminal-runner.js, tool-registry.js (compat/group)
  tools/cyber/security-tool-adapters.js, subagent-runner.js, tool-registry.js (compat/group),
             web-research.js, webclone.js, executable-resolver.js
  storage/chat-session-store.js, workspace-files.js

infrastructure/
  di/container.js          # ONLY production composition root
  config/app-config.js  logging/logger.js  errors/error-class.js

presentation/
  electron/main.js         # thin lifecycle/window shell
  electron/ipc/register.js  electron/ipc/handlers/*.js   # split by stable IPC surface
  ui/index.html, bootstrap.js, core/*, features/*, styles/*

content/
  prompt_builder.js
  prompts/instructions/*.md  prompts/skills/modes/*.md  prompts/skills/libraries/*.md
  prompts/guardrails/*.md     # prose only, never deterministic logic
  build/v<version>/*.<hash>.js  build/v<version>/manifest.json
  # stable loader path so application code never hardcodes hashed filenames

automation/commands/*  automation/context/*      # stays; adapters for slash-command use cases
preload.js                                        # STABLE, not moved unless packaging forces it
```

`src/shared/ipc-contracts.js` becomes a compatibility re-export until all consumers/tests move; it may remain permanently as a documented back-compat entry point.

## Dependency rules for the final graph

- `contracts/` imports only built-ins and sibling contract types.
- `domain/` imports only built-ins, contracts, sibling domain. Not `app`/`application`/`adapters`/`presentation`/`infrastructure`/`automation`/renderer.
- `application/` imports contracts, domain, application. Not concrete adapters, Electron, `node-pty`, `http-mitm-proxy`, `tldts`, or renderer files.
- `adapters/` may import contracts, domain (only where an adapter needs domain validation), built-ins, third-party. It does not own application decisions.
- `infrastructure/di/container.js` is the only production composition root.
- `presentation/electron/main.js` imports Electron + the container, not individual adapters.
- `presentation/ui/` must not import Node-only modules; browser globals remain explicit and ordered.
- `automation/` is an adapter boundary for slash-command execution.

These are enforced by a new architecture import-direction test / verify helper.

## Port design (JSDoc + shape validators, no TypeScript)

- **ToolPort** (`contracts/tool/ToolPort.js`): `ToolSchema`, `ToolCall`, `ToolResult` (ok/toolName/mode/summary/mutated/errorClass/retryable), and `ToolPort` (catalog access, mode filtering, schema load, normalize/validate, `execute(call, context)`). The adapter may expose the compatibility `ToolMap` for existing renderer/test callers.
- **ChatPort** (`contracts/llm/ChatPort.js`): provider-neutral `stream`/`cancel`/model-context + normalized events. Do NOT change current event names/payloads; the port describes existing behavior.
- **Assessment ports**: `ScopePort` (canonicalize/match/resolve/private-reserved/stable), `FindingPort` (normalize/fingerprint/evidence-relevance/verifier/validation), `EvidencePort` (append/read/hash/redaction metadata).
- **WorkspacePort** (`contracts/storage/WorkspacePort.js`): safe path resolution, read/write/patch/delete/copy/move, listing, watching, runtime-dir resolution.
- Ports are dependency-free except built-ins. `tldts`, DNS, Electron, `fs`, `node-pty`, http-mitm-proxy, subprocess belong in adapters/infrastructure.

## Staged execution

### Stage 0 — Baseline and contract characterization
Record branch, `git status --short`, `git rev-parse HEAD`, Node/npm versions, scripts, and exact `npm test` output/count. Run `npm run verify:production` and record asserted invariants. Read `graphify-out/GRAPH_REPORT.md` + manifest + graph (stale from `314adf0c`). Capture snapshots: preload surface (`window.api`, `window.xekute`, all invoke/sendSync/on channels, listener removal), main-process registration channels, renderer script/global order, canonical tool snapshot (`TOOL_NAMES`, `TOOL_META`, mode groups, packs, hot tools, globals, security classification), prompt export snapshots, and every `src/sub-agent/traffsucker` reference. If baseline is not green, stop and fix/isolate before proceeding.

### Stage 1 — Content and prompt build relocation
Move Markdown + `prompt_builder.js` into `content/`; output versioned/hashed modules + manifest under `content/build/` (content-addressed, deterministic). Keep prose-vs-logic split (never convert guardrail/redaction/regex logic to MD). Add a stable content loader so Node consumers never hardcode hashes; renderer keeps logical order. Update compiler/controller/memory/verifier imports. Add `build:prompts` script + prompt-build verification. Keep old-path re-export shims during migration. Rollback: if any prompt export differs beyond path/comment metadata, restore old output and keep only the relocation.

### Stage 2 — Contracts, domain seams, and IPC compatibility
Create all ports (JSDoc + validators). Move `shared/ipc-contracts.js` → `contracts/ipc/IpcContracts.js`; keep `src/shared/ipc-contracts.js` as a re-export shim and add an equivalence test. Refactor `scope-engine.js` to inject a scope/network port (preserve default API for existing callers). Move `tldts` extraction out of `assessment-map.js` behind an injected function. Keep `http-body-decoder`/finding-gate/HTTP parsing unchanged except imports/injected deps. Split proxy-listener: domain owns capture/filtering decisions, `http-mitm-proxy` comes via adapter/injected port. Add architecture assertions (domain must reject application/adapters/presentation/infrastructure imports). Rollback if domain behavior changes: keep the old implementation as compatibility default and defer purity tightening.

### Stage 3 — Adapter relocation, THEN tool-catalog merge (two substages)
Relocation first: move `harness/**` → `adapters/tools/**` unchanged (update only import paths, preserve exports/factory signatures); keep `src/harness/` shims only if needed. Verify green before merging. Merge substage: create `adapters/tools/core/tool-catalog.js` from `TOOL_DEFS` + OS/cyber registry groups, preserving exact order/descriptions/schemas, all exports (`TOOLS`, `TOOL_META`, `TOOL_NAMES`, `TOOL_GROUPS`, `MODE_TOOL_GROUPS`, `TOOL_PACKS`, `LOADABLE_PACK_NAMES`, `AGENT_HOT_TOOLS`, normalization/validation functions), and globals (`XekuteOsTools` < `XekuteCyberTools` < `ToolMap`, preserving creation order). Keep OS/cyber registries as delegating compatibility modules. Update handlers, HTML tags (after a logical-order snapshot test exists), verify-production, generate-tools-doc, tests. Rollback if the merge changes any schema/order/meta/global timing: restore the three compat modules, keep only the relocation.

### Stage 4 — LLM adapter split
Move `context-budget.js` + `stream-utils.js` to `adapters/llm/` root (shared/provider-neutral). Move `ollama-stream.js` → `adapters/llm/ollama/`, `openrouter-stream.js` → `adapters/llm/openrouter/`, provider normalization → `adapters/llm/openrouter/providers.js` (or root if provider-neutral). Implement `ChatPort` around the existing capture functions (no stream-protocol rewrite). Preserve `captureOllamaStream`, `captureOpenRouterStream`, `normalizeOpenRouterMessages`, `openRouterHeaders`, `openRouterTools`, `normalizeProvider`, `normalizeBaseUrl`, `buildChatRequest`, default-URL exports. Keep cancellation maps in application/container boundary, not inside provider modules. Keep `src/llm/` shims until consumers move. Verify all stream/timeout/context/budget/thinking/controller tests green.

### Stage 5 — Application relocation + dependency inversion
Move orchestration (`controller`, `runtime`, `prompt`, `tunables`), memory, policies (`operating-modes`, `policy-engine`, `request-intent`, `evidence-rules`, `runtime-policy`, `agentic-loop`, `bugbounty`, guardrails), planning (`plan-document`, `engagement-context`, custom-guidance formatting), clarification (`operator-questions`, `verifier`) into `application/`, with old `src/agent/` re-export shims. Then invert: remove direct `ToolMap`/LLM-stream imports from orchestration (accept ToolPort/ChatPort via options with migration defaults); pass scope ports where resolution is needed; move fs-dependent guidance ops behind `WorkspacePort`; verifier uses ChatPort + EvidencePort. Preserve signatures by adding optional dependency args with defaults the container later fills. Add a test constructing controller with fake ToolPort/ChatPort. Do not rewrite the controller state machine this stage.

### Stage 6 — Infrastructure services + DI composition root (highest risk)
Create `config/app-config.js`, `logging/logger.js` (structured + source-level redaction, preserve current console/error behavior), `errors/error-class.js` (keep adapter/tool error-class compat path). Move `main.js`'s require block + construction (workspace search/files, web research, webclone, assessment workspace/map, HTTP workbench, proxy, project-profile, chat-session, tool handlers, terminal runner, subagent runner, LLM adapters, policy, agent services) into `di/container.js` in dependency order. Preserve singleton/lazy semantics, injected callbacks (proxy events, OpenRouter key, CA dir, watches, terminal wait, approvals/questions), and reset/dispose (watchers, terminals, processes, proxy, preview). Accept `mainWindow`/window sinks via an explicit presentation callback. Make `src/app/main.js` a temporary compatibility shell that calls the container/startup path. Unit-test container construction with fake Electron/fs/path/crypto/process without launching Electron. Verify BrowserWindow options keep `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webviewTag:false`. Launch `npm run dev`, exercise chat/tool/terminal, clean shutdown. Rollback: restore previous main composition shell behind a feature-equivalent container entry point; do not proceed until `npm run dev` is green.

### Stage 7 — Presentation/Electron + IPC split + renderer move
Move lifecycle shell to `presentation/electron/main.js`; update `package.json.main` only after the new entry boots the container. Preserve BrowserWindow options, preload path, index path, navigation restrictions, webview denial, permission handlers, sender validation, `APP_INDEX_URL` trust checks exactly. Split IPC registration into stable modules (project/workspace/files; assessment/settings/entries; traffic/evidence/runs/map; webclone; security/proxy/certificates; tools/processes/terminal; llm/settings/chat/agent; guidance/commands; window/menu), each receiving the container/service object; keep sync `chat-sessions:save-before-close` synchronous; centralize trust + `validateIpcRequest` around `IpcContracts`. Move `ui/` → `presentation/ui/`, updating relative paths while preserving complete logical script order; no script requests an old path or Node-only module. Add registration-manifest test comparing old vs new channel sets. Keep `src/preload.js` byte-identical. Rollback on any preload/channel/global/timing change: revert only the presentation move and restore old paths via shims.

### Stage 8 — Automation boundary, traffsucker runtime path, obsolete-tree removal
Keep `automation/commands` + `automation/context` in place; define the slash-command use-case boundary with command-parser/runCommand/ingestion as adapters; keep external-command details out of domain/policy. Replace default `run_dir` `src/sub-agent/traffsucker` with a gitignored runtime path (`runtime/traffsucker`); keep explicit caller `run_dir` compatible but reject source-tree paths; add runtime path to `.gitignore` without ignoring persisted evidence. Delete `src/sub-agent/` only after a repo-wide authoritative graph/path check finds no dependency. Remove `src/harness/`, `src/prompt/`, `src/prompts/`, then old `src/llm/`, `src/agent/`, `src/app/services/`, old UI paths only after their compatibility tests pass and no graph edge points to them. Run `npm run package` to confirm ASAR/packaging includes content build, automation assets, native modules, new entry.

### Stage 9 — Final architecture verification + graph regeneration (LAST)
Run `npm test` (actual final count), `npm run verify:production` (checking final paths, retaining all security/behavior assertions), architecture checks (import direction; no application→adapter; no domain→app/presentation/infrastructure; one composition root; no duplicate tool registry; no runtime Markdown parsing; no old source-tree runtime path). Add preload-contract snapshot test + renderer global-order snapshot test + tool-catalog compat test + DI smoke test with fake ports. Confirm generated manifests/hashes current; package entry + Forge asarUnpack correct; no unhandled rejections during startup/chat/tool/terminal/shutdown. Run `graphify update .` LAST; confirm graph commit matches final HEAD, no cycles, old trees absent (or only shims). Update `docs/migration/layered-restructure.md` + `src/README.md` + root architecture docs to the final tree and composition-root rule.

## Definition of done

- `npm test` green after every stage with the actual (not assumed) count.
- `npm run verify:production` green after every stage.
- `npm run dev` launches, renderer loads with the same globals in the same order, no console errors.
- `npm run package` succeeds or the supported packaging workflow passes (final stage).
- preload source + API/channel snapshots unchanged (not edited).
- tool names/schemas/meta/modes/packs/security routing unchanged.
- `main.js` no longer composes concrete adapters; the DI container does; `presentation/electron/main.js` is thin.
- domain obeys dependency direction; third-party/network behind ports/adapters.
- runtime prompt loading consumes generated `content/build` and never reparses Markdown.
- `src/sub-agent/` gone; traffsucker uses a gitignored runtime path.
- authoritative graph regenerated last with no unexpected cycles.

## Implementation discipline

- Dedicated branch/worktree preserving the dirty working tree as the baseline; do not reset/discard work.
- One atomic move/refactor group per stage; keep the tree buildable after each group.
- Prefer filesystem renames + compatibility re-exports over copy-and-diverge.
- Never edit generated prompt modules; never hand-edit `src/preload.js`.
- Do not silently leave production code on old paths — update or add an intentional shim assertion.
- Keep production verification assertions explicit; do not weaken them to pass path moves.
- Treat any change in IPC channels, renderer global order, tool schemas, prompt exports, assessment formats, or security policy as a blocker requiring a separate decision.
- Record every intentional contract exception in `docs/migration/layered-restructure.md`.

## Files most likely to change (highest blast radius)

- [src/app/main.js](src/app/main.js) — compose via DI; becomes a thin compatibility shell, then moves to `presentation/electron/`.
- [src/agent/controller.js](src/agent/controller.js) — 20+ requires (harness/prompts/llm/domain); all move + inverted onto ports.
- [src/harness/core/tool-map.js](src/harness/core/tool-map.js) + both `tool-registry.js` — merged into `tool-catalog.js`.
- [src/ui/index.html](src/ui/index.html) script tags + [src/ui/bootstrap.js](src/ui/bootstrap.js) globals — paths only, then `ui/` → `presentation/ui/`.
- [src/preload.js](src/preload.js) — untouched (contract).
- [test/*.js] (~20+ files) + [scripts/verify-production.js](scripts/verify-production.js) + [scripts/generate-tools-doc.js](scripts/generate-tools-doc.js) — require-path updates.
- [src/prompt/prompt_builder.js](src/prompt/prompt_builder.js) — relocated to `content/`, output to `build/`.

## Explicitly out of scope

- Introducing a bundler or replacing the script-tag loading model.
- Adding new LLM providers, security tools, UI features, or assessment features.
- Rewriting state machines, regex logic, policy rules, finding gates, or stream protocols for style reasons.
- Converting deterministic JavaScript enforcement logic into Markdown.
- Changing the preload bridge API or IPC channel naming.
- Changing assessment schemas, evidence formats, finding promotion, or security authorization behavior.
- Removing compatibility shims before the final graph and production verification prove they are unnecessary.