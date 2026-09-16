"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) => fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
const { readUiShell } = require("./helpers/ui-shell.js");

test("Alt+Z toggles line wrapping while Ctrl+Z remains available for undo", () => {
  const bootstrap = read("src/ui/bootstrap.js");
  const index = readUiShell();

  assert.match(bootstrap, /Line wrapping on · Alt\+Z to unwrap/);
  assert.match(bootstrap, /event\.altKey && !event\.ctrlKey && !event\.metaKey && !event\.shiftKey && event\.key\.toLowerCase\(\) === "z"/);
  assert.match(bootstrap, /e\.altKey && !mod && !e\.shiftKey && key === "z" && editorSurfaceFocused/);
  assert.doesNotMatch(bootstrap, /Line wrapping (?:on|off) · Ctrl\+Z/);
  assert.match(index, /data-action="undo"[\s\S]*?Ctrl\+Z/);
});
