# XEKUTE source layout

This is the canonical feature-oriented layout. Runtime imports flow from the
application composition root toward contracts, domain rules, services, and
adapters; the renderer only reaches privileged capabilities through preload
and IPC.

```text
src/
├── agent/
│   ├── controller/       # Turn orchestration, questions, lifecycle seams
│   ├── runtime/          # Streaming, dispatch, budgets, result/evidence projection
│   ├── tools/            # The exact 19 raw tool adapters and their registry
│   │   ├── assessment/   # Network, browser, identity, finding, graph tools
│   │   ├── process/      # exec_command and delegation
│   │   ├── workspace/    # Files, search, plan, state, environment
│   │   └── config/       # Registry, mode surface, tool metadata
│   ├── llm/              # Provider-neutral, Ollama, and OpenRouter transports
│   ├── memory/           # Context, failure, action, and evidence memory
│   ├── modes/            # Ask, Agent, Plan, Hypothesis mode definitions
│   └── authority/        # Scope policy; gate/profile folders are roadmap metadata
├── app/                  # Electron composition, IPC, services, storage, commands
├── interceptor/          # HTTP proxy/workbench implementation
├── prompts/              # Direct JS prompt instructions, rules, guardrails, skills
├── ui/                   # Native browser ES modules and feature controllers
├── domain/               # Pure assessment, project, and scope rules
├── contracts/            # IPC, tool, LLM, assessment, and storage contracts
├── infrastructure/      # Configuration, dependency injection, logging, errors
└── shared/               # Dependency-free utilities used across boundaries
```

## Ownership rules

- `src/infrastructure/di/container.js` is the production composition root.
- `src/app/electron/main.js` composes Electron, lifecycle, and feature IPC
  modules; it does not define domain policy or own project/session handlers.
- `src/app/ipc/**` owns feature registration. Handler modules receive explicit
  services/state from the Electron composition root instead of reaching into
  Electron globals or importing unrelated features.
- `src/agent/tools/**` adapters perform capabilities and never decide authority.
  Scope is evaluated at the agent/app boundary before an adapter executes.
- `src/prompts/**` is model guidance. It cannot authorize, reject, or approve
  a tool call.
- `src/shared/**` may contain only dependency-free utilities genuinely shared
  by multiple top-level features.
- `src/ui/**` remains browser-safe. Node and Electron access belongs behind the
  preload bridge and feature IPC handlers.

No compatibility layer, generated prompt output, legacy chat store, approval
gate, or policy-engine directory is part of this tree.
