const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const hook = require("../forge.config.js").packagerConfig.afterPrune[0];

test("the packager hook keeps only the target platform's node-pty binaries", t => {
  const buildPath = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-package-pruning-"));
  t.after(() => fs.rmSync(buildPath, { recursive: true, force: true }));
  const prebuilds = path.join(buildPath, "node_modules", "node-pty", "prebuilds");
  for (const platform of ["win32-x64", "win32-arm64", "linux-x64"]) {
    fs.mkdirSync(path.join(prebuilds, platform), { recursive: true });
    fs.writeFileSync(path.join(prebuilds, platform, "fixture.node"), platform);
  }
  const options = { buildPath, platform: "win32", arch: "x64", electronVersion: "43.8.3" };
  hook(options);
  assert.deepEqual(fs.readdirSync(prebuilds), ["win32-x64"]);
  assert.equal(fs.readFileSync(path.join(prebuilds, "win32-x64", "fixture.node"), "utf8"), "win32-x64");
  hook(options);
  assert.deepEqual(fs.readdirSync(prebuilds), ["win32-x64"]);
});
