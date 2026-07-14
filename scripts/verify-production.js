"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src/main.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/index.html"), "utf8");
const preload = fs.readFileSync(path.join(root, "src/preload.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

assert.match(main, /sandbox:\s*true/);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /webviewTag:\s*false/);
assert.match(main, /setPermissionRequestHandler/);
assert.match(main, /setWindowOpenHandler/);
assert.match(html, /Content-Security-Policy/);
assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i);
assert.match(preload, /contextBridge\.exposeInMainWorld\("pointer"/);
const preloadRequires = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);
assert.deepEqual(preloadRequires, ["electron"], "sandboxed preload must not require local CommonJS modules");
assert.equal(packageJson.devDependencies.electron, "43.1.0");
assert.equal(packageJson.dependencies["@vscode/codicons"], "0.0.45");

console.log("Pointer production security invariants verified.");
