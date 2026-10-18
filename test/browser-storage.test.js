"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { scriptLiteral } = require("../src/app/services/browser/browser-storage.js");

test("saved storage values embed as inert data in the restore script", () => {
  const items = [
    { name: "token</script><img src=x>", value: "line\u2028break\u2029end" },
    { name: "path", value: "a/b\\c\"d'e`${f}" },
  ];
  const literal = scriptLiteral(items);
  assert.doesNotMatch(literal, /[<>/\u2028\u2029]/, "characters that can end or reshape code are escaped");
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInNewContext(`(${literal})`))), items, "the value round-trips unchanged");
});
