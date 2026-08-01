# XEKUTE source layout

XEKUTE is organized by runtime boundary and capability. The renderer only talks to the privileged process through the sandboxed preload bridge; agent orchestration consumes prompts and harness contracts; harness implementations own deterministic tool execution.

```text
src/
|-- app/
|   |-- main.js              # Electron lifecycle and privileged composition
|   |-- ipc/                 # Grouped IPC registration boundary
|   `-- services/            # App-level persistence and services
|-- preload.js               # Sandboxed renderer API bridge; intentionally self-contained
|-- ui/
|   |-- index.html           # Browser application shell
|   |-- bootstrap.js         # Renderer composition entry point
|   |-- core/                # Browser state, DOM, markdown, and lifecycle helpers
|   |-- templates/            # Reusable browser markup builders
|   |-- features/             # Chat, editor, explorer, terminal, settings, and security UI
|   `-- styles/               # Shared tokens and feature styles
|-- agent/                    # Agent orchestration, runtime, policy, memory, and verification
|-- harness/
|   |-- core/                 # Canonical tool schemas, routing, and handlers
|   |-- os/                   # Workspace, terminal, and filesystem capabilities
|   `-- cyber/                # Research and security adapters
|-- domain/
|   |-- assessment/           # Scope, traffic, Map, evidence, and assessment workspace
|   `-- project/              # App-managed project profile data
|-- llm/                      # Provider normalization and streaming transports
|-- prompts/                  # Human-editable instructions, skills, rules, and guardrails
|-- shared/                   # Cross-process contracts
`-- automation/               # Typed Python commands and context ingestion
```

## Boundaries

- `ui/` can use `window.xekute`/`window.api`, but must not import Node modules.
- `app/` owns Electron IPC and composes domain, agent, harness, and LLM services.
- `agent/` decides and records orchestration; it does not perform unvalidated OS or cyber work directly.
- `harness/` owns model-facing tool schemas and deterministic adapters.
- `domain/` owns assessment and project data rules.
- `prompts/` contains human-editable behavior sources; runtime policy remains authoritative.
- `preload.js` stays a single file until a preload bundling step is introduced because production verification requires no local CommonJS imports in the sandboxed bridge.

## Where to start

- Change chat, terminal, settings, or workspace presentation in `ui/features/`, `ui/templates/`, and `ui/styles/`.
- Change tool exposure or mode routing in `harness/core/tool-map.js`.
- Change deterministic tool implementations in `harness/os/` or `harness/cyber/`.
- Change agent wording in `prompts/`; change orchestration in `agent/`.
- Change privileged behavior in `app/main.js`, then expose only the required operation through `preload.js` and `shared/ipc-contracts.js`.
- Add behavior verification under `../test/` with paths mirroring the source boundary.

Generated reports, runtime logs, Python caches, dependencies, and local editor metadata remain outside the source tree.
