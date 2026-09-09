#!/usr/bin/env node
/** Copies static assets required by the built React UI into dist/. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dist = path.join(root, "src", "ui", "dist");
const uiAssets = path.join(root, "src", "ui", "assets");
const monacoSrc = path.join(root, "node_modules", "monaco-editor", "min");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

if (!fs.existsSync(dist)) {
  console.error("UI dist not found — run vite build first");
  process.exit(1);
}

copyDir(uiAssets, path.join(dist, "assets"));
copyDir(monacoSrc, path.join(dist, "monaco-editor", "min"));
console.log("Copied UI static assets to dist/");
