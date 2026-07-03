# Pointer — Standalone AI Editor

A minimal Cursor-like desktop app built with **Electron** (no VS Code dependency).

## Features
- **File Explorer** — open any folder, browse the tree, click files to preview them
- **File Viewer** — read-only code preview panel (resizable)
- **Chat** — streaming chat with a local Ollama model (resizable panel)
- Resizable sidebar and panels (drag the dividers)

## Requirements
- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com) running locally with a model pulled

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Pull a model if you haven't already
ollama pull qwen2.5-coder:7b

# 3. Run
npm start
```

## Changing the Model
You can change the model and Ollama URL directly in the chat panel header — no restart needed.

## Project Structure
```
pointer-app/
├── package.json
└── src/
    ├── main.js       # Electron main process (IPC, file system, Ollama)
    ├── preload.js    # Secure bridge between main and renderer
    ├── index.html    # App shell
    ├── style.css     # Dark theme
    └── renderer.js   # UI logic (file tree, chat, panel resize)
```
