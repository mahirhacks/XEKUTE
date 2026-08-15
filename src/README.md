# XEKUTE source guide

The source tree is organized by responsibility and feature. Start at the
composition roots (`src/app/electron/main.js` and
`src/infrastructure/di/container.js`), then follow the canonical contracts.

```text
src/
├── agent/
│   ├── controller/       # agent-controller, turn runner/lifecycle, questions
│   ├── runtime/          # parser, dispatcher, budgets, prompt/context runtime
│   ├── tools/
│   │   ├── assessment/   # browser, traffic, identity, test, finding, graph
│   │   ├── process/      # exec_command, delegate_agent, executable resolution
│   │   ├── workspace/    # files, search, plan, state, environment
│   │   └── config/       # exact 21-tool registry and mode surface metadata
│   ├── llm/              # common stream contracts plus Ollama/OpenRouter
│   ├── memory/           # context, failure, action, and evidence memory
│   ├── modes/            # ask, agent, plan, hypothesis and mode registry
│   └── authority/
│       ├── scope/        # hard filesystem/network scope boundaries
│       ├── gates/        # active deterministic authority/lifecycle pipeline
│       └── profiles/     # Ask, Approve, and Full interaction policies
├── app/
│   ├── electron/         # main, preload, lifecycle
│   ├── ipc/              # feature channel manifests and registration
│   ├── services/         # assessment, guidance, research, terminal, workspace
│   ├── storage/          # session memory and project profile stores
│   └── commands/         # slash-command parsing and responses
├── interceptor/          # proxy listener, HTTP workbench, body/certificate code
├── prompts/              # one system prompt plus rules, guardrails, skills
├── ui/                   # native ES-module renderer and feature controllers
├── domain/               # pure scope, project, and assessment rules
├── contracts/            # stable tool, LLM, IPC, storage, assessment shapes
├── infrastructure/      # config, DI, logging, and error classification
└── shared/               # small dependency-free cross-feature utilities
```

The exact tool inventory, mode surfaces, authority module/profile composition,
IPC contracts, memory schema, and scope behavior are tested. `temp_test` is a
separate testing harness and is intentionally outside this source tree.
