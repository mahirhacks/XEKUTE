"use strict";

const fs = require("node:fs");
const path = require("node:path");

const uiRoot = path.join(__dirname, "..", "..", "src", "ui");
const RENDERER_FILES = [
  "bootstrap.js",
  "core/app-state.js",
  "core/dom-refs.js",
  "core/runtime-globals.js",
  "core/text-format.js",
  "core/workspace-paths.js",
  "features/chat/chat-persistence.js",
  "features/chat/user-prompt-box.js",
  "features/chat/turn-structure.js",
  "features/chat/transcript-replay.js",
  "features/chat/chat-run-state.js",
  "features/chat/chat-sessions.js",
  "features/chat/chat-history-popover.js",
  "features/chat/chat-mode.js",
  "features/chat/context-usage.js",
  "features/chat/context-checkpoints.js",
  "features/chat/prompt-context.js",
  "features/chat/chat-messages.js",
  "features/chat/tool-labels.js",
  "features/chat/tool-cards.js",
  "features/chat/command-timeline.js",
  "features/chat/composer-questions.js",
  "features/chat/assistant-turn.js",
  "features/chat/slash-commands.js",
];

// Tests slice renderer functions out by text and run them in a vm context, so
// module syntax is stripped and every renderer file reads as one script.
function rendererSource() {
  return RENDERER_FILES
    .map(file => fs.readFileSync(path.join(uiRoot, file), "utf8"))
    .join("\n")
    .replace(/^export \{[^}]*\};[^\S\n]*\r?$/gm, "")
    .replace(/^export (?=(?:async )?function|const |let |class )/gm, "");
}

let declarationIndex = null;
function declarations() {
  if (declarationIndex) return declarationIndex;
  const acorn = require("acorn");
  declarationIndex = new Map();
  for (const file of RENDERER_FILES) {
    const text = fs.readFileSync(path.join(uiRoot, file), "utf8");
    for (const node of acorn.parse(text, { ecmaVersion: "latest", sourceType: "module" }).body) {
      const declaration = node.type === "ExportNamedDeclaration" ? node.declaration : node;
      if (!declaration) continue;
      const names = declaration.type === "VariableDeclaration" ? declaration.declarations.map(item => item.id.name) : [declaration.id?.name];
      for (const name of names) if (name) declarationIndex.set(name, text.slice(declaration.start, declaration.end));
    }
  }
  return declarationIndex;
}

// The source of named top-level renderer declarations, wherever they live, in
// the order given, for tests that run a slice of the renderer in a vm context.
function rendererDefinitions(...names) {
  return names.map(name => {
    const text = declarations().get(name);
    if (!text) throw new Error(`No top-level renderer declaration named ${name}`);
    return text;
  }).join("\n");
}

// Renderer state lives on `appState`. Pointing it at the vm context keeps
// `appState.x` resolving exactly where a sliced `x` used to, and seeds every
// field the test did not provide with the renderer's own initial value.
function withAppState(context) {
  const text = fs.readFileSync(path.join(uiRoot, "core", "app-state.js"), "utf8");
  const defaults = new Function(text.replace(/^export const appState = /m, "return "))();
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(context, key)) context[key] = value;
  }
  context.appState = context;
  return context;
}

module.exports = { rendererSource, rendererDefinitions, withAppState };
