# Pointer - Focused Security Workspace

A local-first Electron workspace centered on four tools: Search, Target, Terminal, and Chat.

## Features

- **Search** - indexed target-workspace search with editable file results
- **Editable workspace** - open files with `Ctrl+P`, edit them in the central workspace, and save with `Ctrl+S`
- **Target** - assessment creation, verification, repair, structured phases, and security tooling
- **Dynamic workspace** - file selections show the editor; Security switches the same area to Interceptor, Repeater, or Intruder
- **HTTP history** - browse bounded `Traffic/Raw` captures and load any exchange into the Request/Response workbench
- **Settings views** - `settings.config` can be viewed as JSON or edited through a structured input-field UI
- **Terminal** - multiple shell sessions, clear/kill controls, maximize/restore, and xterm rendering
- **Chat** - Agent, Plan, and Ask modes with local Ollama models and assessment context
- **Small-model agent loop** - focused tools, inspect/read/act/verify steps, repeated-call guards, and destructive-command blocking
- **Context controls** - structured memory, automatic compaction, bounded workspace context, thinking controls, and model selection

## Requirements

- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com) running locally with a model pulled

## Quick Start

```bash
npm install
ollama pull qwen2.5-coder:7b
npm start
```

## Project Structure

```text
pointer-app/
|-- package.json
`-- src/
    |-- main.js       # Electron main process, IPC, terminal, and Ollama
    |-- preload.js    # Secure bridge between main and renderer
    |-- index.html    # Focused application shell
    |-- style.css     # Dark workspace theme
    `-- renderer.js   # Search, Target, Terminal, and Chat UI logic
```
