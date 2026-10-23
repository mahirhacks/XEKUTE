"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("the editor loads on the first file, retains edits, and shares one initialization", async () => {
  let loads = 0, editors = 0, save, saved = 0, selected;
  const instance = { onDidChangeModelContent() {}, onDidChangeCursorPosition() {},
    addCommand(_key, callback) { save = callback; }, setModel(model) { selected = model; }, updateOptions() {}, focus() {}, layout() {} };
  const amd = (_modules, callback) => { loads++; callback(); };
  amd.config = () => {};
  const scope = { require: amd, localStorage: { getItem: () => null, setItem() {} }, document: { getElementById: () => ({}) },
    monaco: { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 }, Uri: { parse: uri => uri }, editor: {
      defineTheme() {}, create: () => { editors++; return instance; },
      createModel: (value, language, uri) => ({ uri, language, getValue: () => value, setValue: next => { value = next; } }),
    } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/ui/features/editor/editor-controller.js"), "utf8"), scope);
  const editor = scope.XekuteEditorManager;
  editor.layout(); editor.clear(); editor.setOnSave(() => { saved++; });
  assert.equal(loads, 0, "chat and browser startup do not load the code editor");
  await editor.showTab("G:/fixture.js", "fixture.js", "const value = 1;");
  assert.equal(loads, 1); assert.equal(editors, 1);
  assert.equal(selected.language, "javascript");
  selected.setValue("const value = 2;"); save();
  assert.equal(saved, 1);
  assert.equal(editor.getValue("G:/fixture.js"), "const value = 2;");
  await editor.showTab("G:/other.py", "other.py", "value = 3");
  assert.equal(loads, 1); assert.equal(editors, 1);
  assert.equal(selected.language, "python");
});
