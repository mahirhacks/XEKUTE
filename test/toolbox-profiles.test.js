const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "presentation", "ui", "bootstrap.js"), "utf8");

test("Toolbox built-ins expose tool-specific fields, presets, and command templates", () => {
  assert.match(renderer, /const TOOL_PROFILES = Object\.freeze/);
  assert.match(renderer, /nmap:\s*\{ fields: \["target", "scanType", "ports", "timing", "serviceFlags"/);
  assert.match(renderer, /theharvester:\s*\{ fields: \["target", "sources", "limit"/);
  assert.match(renderer, /ffuf:\s*\{ fields: \["target", "wordlist", "extensions", "matchCodes"/);
  assert.match(renderer, /sqlmap:\s*\{ fields: \["target", "parameter", "techniques", "risk", "level"/);
  assert.match(renderer, /TOOL_FIELD_DEFINITIONS\[key\]/);
  assert.match(renderer, /selectedCatalogTool\?\.presets\?\.\[preset\]/);
  assert.match(renderer, /\.\.\.\(TOOL_PROFILES\[id\] \|\| \{\}\)/);
});
