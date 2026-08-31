"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("Tools and MCP settings keep generic MCP configuration separate from optional Kali access", () => {
  const html = read("src/ui/index.html");
  const renderer = read("src/ui/bootstrap.js");
  const preload = read("src/app/electron/preload.js");
  for (const id of ["mcp-settings-list", "kali-access-panel", "kali-access-enabled", "kali-access-host", "kali-access-key", "kali-access-test"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(html, /id=["']kali-access-save["']/);
  assert.match(html, /Local Kali access/);
  assert.match(html, /Password login is intentionally unsupported/);
  assert.match(html, /Using Kali-hosted MCP servers/);
  assert.match(html, /SQLMap requires an MCP wrapper/);
  assert.doesNotMatch(html, /mcp-server-preset|Metasploit MCP/);
  assert.match(renderer, /<strong>Add MCP server<\/strong><small>Open the standard mcp\.json configuration/);
  assert.match(renderer, /kaliAccessForm\?\.addEventListener\("submit", saveKaliAccess\)/);
  assert.match(renderer, /kaliAccessFields\?\.addEventListener\("input", \(\) => queueKaliAccessAutosave\(\)\)/);
  assert.match(renderer, /window\.api\.kaliAccessTest/);
  assert.match(renderer, /window\.api\.kaliAccessPickIdentity/);
  assert.match(preload, /kaliAccessGet:.*kali-access:get/);
  assert.match(preload, /kaliAccessSave:.*kali-access:save/);
  assert.match(preload, /kaliAccessTest:.*kali-access:test/);
  assert.match(preload, /kaliAccessPickIdentity:.*kali-access:pickIdentity/);
});

test("vulnerability knowledge files remain separate from the MCP settings model", () => {
  const skill = read("src/prompts/skills/libraries/ssrf.md");
  const registry = read("src/agent/tools/config/tool-registry.js");
  assert.match(skill, /^id: ssrf/m);
  assert.match(skill, /summary:/);
  assert.match(skill, /## Prerequisites|## Workflow/);
  assert.match(skill, /server-side fetch|collaborator|redirect/i);
  assert.doesNotMatch(registry, /run_exploit|send_session_command|msf_module_execute/);
});

test("SQL injection knowledge is indexed as a bounded assessment skill", () => {
  const skill = read("src/prompts/skills/libraries/sqli.md");
  assert.match(skill, /^id: sqli/m);
  assert.match(skill, /category: injection/);
  assert.match(skill, /non-destructive|negative control|verification/i);
  assert.doesNotMatch(skill, /dump table|read file|execute command/i);
});
