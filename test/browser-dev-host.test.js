"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createDevLaunch, removeDevUserData, assertDevEntry } = require("../scripts/browser-dev/runtime.cjs");

test("browser development launch owns its temporary profile and requires a development entry", () => {
  const launch = createDevLaunch({ smoke: true });
  try {
    assert.equal(fs.existsSync(launch.userData), true);
    assert.equal(launch.args.includes("--browser-dev"), true);
    assert.equal(launch.args.includes("--smoke"), true);
    assert.equal(launch.env.ELECTRON_RUN_AS_NODE, undefined);
    const valid = { isPackaged: false, defaultApp: true, argv: launch.args, userData: launch.userData };
    assert.doesNotThrow(() => assertDevEntry(valid));
    for (const change of [{ isPackaged: true }, { defaultApp: false }, { argv: [] }, { userData: process.cwd() }]) {
      assert.throws(() => assertDevEntry({ ...valid, ...change }));
    }
    assert.throws(() => removeDevUserData(process.cwd()));
  } finally { removeDevUserData(launch.userData); }
  assert.equal(fs.existsSync(launch.userData), false);
});

test("browser development host stays outside the production import graph and packaged files", () => {
  const root = path.resolve(__dirname, "..");
  const source = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? entry.name === "dist" ? [] : source(path.join(directory, entry.name))
    : /\.(?:js|cjs|mjs|jsx|ts|tsx)$/.test(entry.name) ? [path.join(directory, entry.name)] : []);
  for (const file of source(path.join(root, "src")).filter(file => !file.includes(`${path.sep}dist${path.sep}`))) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /(?:require\s*\(|from\s*|import\s*)["'][^"']*(?:scripts[\\/]browser-dev|fixtures[\\/]browser)/, path.relative(root, file));
  }
  const forge = require("../forge.config.js");
  for (const file of ["/scripts/browser-dev/host.cjs", "/scripts/browser-dev.mjs", "/test/fixtures/browser/server.js"]) {
    assert.equal(forge.packagerConfig.ignore(file), true, file);
  }
});
