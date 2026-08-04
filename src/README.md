# XEKUTE source layout

XEKUTE is organized as a ports-and-adapters layered architecture with a single
dependency-injection composition root. The renderer only talks to the
privileged process through the sandboxed preload bridge; application
orchestration consumes ports and injected services; adapters own concrete
implementations.

```text
src/
|-- contracts/                 # Dependency-free port contracts (JSDoc + shape)
|   |-- tool/                  # ToolCatalogPort, ToolExecutionPort
|   |-- llm/                   # ChatPort
|   |-- assessment/            # ScopePort, FindingPort, EvidencePort
|   |-- storage/               # WorkspacePort
|   `-- ipc/                   # IpcContracts (validation + result envelopes)
|-- domain/                    # Pure domain rules, no third-party/network deps
|   |-- scope/                 # Canonicalization, matching, injected resolver
|   |-- assessment/            # Map, workspace, workbench, proxy decisions, gate
|   `-- project/               # App-managed project profile data
|-- application/               # Orchestration, policies, planning, clarification
|   |-- agent/                 # Controller, runtime, prompt, tunables, memory
|   |-- policies/              # Operating modes, policy engine, guardrails
|   |-- planning/              # Plan documents, engagement context, guidance
|   |-- clarification/         # Operator questions, verifier
|   `-- prompt/                # Prompt compiler + PromptSourcePort adapter
|-- adapters/                  # Concrete implementations of the ports
|   |-- tools/                 # Tool catalog, handlers, OS/cyber registries
|   |   |-- core/              # tool-catalog, tool-handlers, error-class
|   |   |-- os/                # workspace-search, terminal-runner, registry
|   |   `-- cyber/             # security adapters, subagent, web research
|   `-- llm/                   # context-budget, stream-utils, chat-port
|       |-- ollama/            # Ollama transport
|       `-- openrouter/        # OpenRouter transport + provider normalization
|-- infrastructure/            # Composition root + config/logging/errors
|   |-- di/container.js        # THE DI composition root (constructs all services)
|   |-- config/app-config.js
|   |-- logging/logger.js
|   `-- errors/error-class.js
|-- presentation/              # Electron shell + renderer
|   |-- electron/main.js       # Thin lifecycle/window shell (consumes container)
|   |-- electron/ipc/          # IPC registration helper
|   `-- ui/                    # Renderer (browser globals, ordered scripts)
|-- content/                   # Human-editable prompt sources + generated build
|   |-- prompts/               # Markdown sources (instructions/skills)
|   |-- prompt_builder.js      # Builds content-addressed modules
|   |-- content-loader.js      # Manifest-based loader (no runtime Markdown)
|   `-- build/                 # Generated JS modules + manifest.json
|-- automation/                # Slash-command adapters (command parser, ingestion)
|-- app/                       # Compatibility launcher (delegates to presentation)
|   `-- services/              # chat-session-store, workspace-files
|-- preload.js                 # Sandboxed renderer API bridge; intentionally self-contained
```

## Dependency rules

- `contracts/` imports only built-ins and sibling contracts.
- `domain/` imports only built-ins, contracts, and sibling domain modules.
- `application/` imports contracts, domain, and application modules; it never
  imports concrete adapters except the documented `application/agent/tool-port.js`
  compat seam (replaced by the container in production).
- `adapters/` may import contracts, domain, and third-party dependencies.
- `infrastructure/di/container.js` is the **only** production composition root.
- `presentation/electron/main.js` imports Electron and the container, not
  individual adapters.
- `presentation/ui/` must not import Node-only modules; browser globals remain
  explicit and ordered.
- `automation/` is an adapter boundary for slash-command execution.

## Compatibility shims (documented, migration-only)

- `src/agent/` and `src/llm/` contain pure re-export shims to the new
  application/adapter paths for older importers and tests.
- `src/shared/ipc-contracts.js` re-exports `contracts/ipc/IpcContracts`.
- `src/app/main.js` is a thin launcher for the presentation entry.
- `src/prompts/` retains browser-consumed globals and skill libraries still
  referenced by the controller.

## Generated content workflow

- Edit Markdown under `src/content/prompts/`, then run `npm run build:prompts`.
- The builder writes content-addressed modules + `manifest.json` into
  `src/content/build/`; never hand-edit generated files.
- Node loads prompts through `content-loader.js` (manifest-resolved, hashed
  filenames); the renderer loads preloaded globals in the script order defined
  by `presentation/ui/index.html`.
- Runtime never parses Markdown; deterministic policy/guardrail logic lives in
  `application/policies/` as JavaScript.

## Key invariants (enforced by tests + `npm run verify:production`)

- `src/preload.js` stays a single file requiring only Electron; every main IPC
  channel is bridged by it.
- Renderer global load order is snapshot-tested (OS tools < cyber tools <
  ToolMap < prompt sources < compiler < bootstrap).
- Tool names/schemas/packs/mode groups are snapshot-tested.
- The DI container is the single composition root (architecture-tested).
- `npm test` and `npm run verify:production` must stay green after every change.

## Where to start

- Change feature presentation in `presentation/ui/features/` and
  `presentation/ui/styles/`; renderer composition remains in
  `presentation/ui/bootstrap.js`.
- Change tool exposure or mode routing in `adapters/tools/core/tool-catalog.js`.
- Change deterministic tool implementations in `adapters/tools/os/` or
  `adapters/tools/cyber/`.
- Change agent wording in `content/prompts/` (then run `npm run build:prompts`);
  change orchestration in `application/agent/`.
- Change privileged behavior in `presentation/electron/main.js` or the DI
  container, then expose only the required operation through `preload.js` and
  `contracts/ipc/IpcContracts`.
- Add behavior verification under `../test/` with paths mirroring the source
  boundary.

Generated reports, runtime logs, Python caches, dependencies, and local editor
metadata remain outside the source tree. Traffsucker subagent output is written
to the gitignored `runtime/traffsucker/` directory.
