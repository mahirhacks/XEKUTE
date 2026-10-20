"use strict";

const fs = require("node:fs");
const path = require("node:path");

const uiRoot = path.join(__dirname, "..", "..", "src", "ui");
const RENDERER_FILES = [
  "bootstrap.js",
  "core/app-state.js",
];

// Tests slice renderer functions out by text and run them in a vm context, so
// module syntax is stripped and every renderer file reads as one script.
function rendererSource() {
  return RENDERER_FILES
    .map(file => fs.readFileSync(path.join(uiRoot, file), "utf8"))
    .join("\n")
    .replace(/^export (?=(?:async )?function|const |let |class )/gm, "");
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

module.exports = { rendererSource, withAppState };
