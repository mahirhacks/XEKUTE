"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const asar = require("@electron/asar");
const { getCurrentFuseWire } = require("@electron/fuses");
const { isIgnoredPackagePath, PACKAGED_FUSES } = require("../forge.config.js");

const root = path.resolve(__dirname, "..");
const archive = path.resolve(process.argv[2] || path.join(root, "out", `XEKUTE-${process.platform}-${process.arch}`, "resources", "app.asar"));
const { header } = asar.getRawHeader(archive);
const archivePath = (relative) => relative.split("/").join(path.sep);
const extractFile = (relative) => asar.extractFile(archive, archivePath(relative));
const statFile = (relative) => asar.statFile(archive, archivePath(relative));

function checkLinks(files, directory = "") {
  for (const [name, entry] of Object.entries(files)) {
    const relative = path.posix.join(directory, name);
    if (entry.link !== undefined) {
      const target = entry.link.replaceAll("\\", "/");
      const normalized = path.posix.normalize(target);
      assert.ok(
        target && !path.posix.isAbsolute(target) && !/(?:^|\/)[a-z]:/i.test(target) &&
          normalized !== ".." && !normalized.startsWith("../"),
        `Packaged link ${relative} points outside app.asar: ${entry.link}`,
      );
      assert.doesNotThrow(
        () => statFile(relative),
        `Packaged link ${relative} has a missing target: ${entry.link}`,
      );
    }
    if (entry.files) checkLinks(entry.files, relative);
  }
}

checkLinks(header.files);

// Startup loads the proxy's crypto dependency before the first window opens.
// Read it from the archive rather than resolving the build checkout's copy.
const forgeRoot = "node_modules/node-forge";
const manifest = JSON.parse(extractFile(`${forgeRoot}/package.json`).toString("utf8"));
assert.equal(manifest.name, "node-forge");
assert.ok(extractFile(path.posix.join(forgeRoot, manifest.main)).length > 0);
const library = statFile(`${forgeRoot}/lib`);
for (const name of Object.keys(library.files)) {
  if (name.endsWith(".js")) assert.ok(extractFile(`${forgeRoot}/lib/${name}`).length > 0);
}

const uiRoot = "src/ui/dist";
const html = extractFile(`${uiRoot}/index.html`).toString("utf8");
assert.doesNotMatch(html, /\.jsx["']/);
const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
assert.ok(assets.some((asset) => asset.endsWith(".js")), "Packaged UI must reference compiled JavaScript");
for (const asset of assets) {
  assert.ok(extractFile(path.posix.join(uiRoot, asset)).length > 0);
}

// Only allowlisted runtime files may ship (no .env, tmp scripts, tests, notes).
function checkAllowlist(files, directory = "") {
  for (const [name, entry] of Object.entries(files)) {
    const relative = `${directory}/${name}`;
    assert.ok(!isIgnoredPackagePath(relative), `Packaged file is outside the runtime allowlist: ${relative}`);
    if (entry.files) checkAllowlist(entry.files, relative);
  }
}
checkAllowlist(header.files);
assert.throws(() => statFile("src/ui/index.legacy.html"), "The legacy UI shell must not ship");
assert.throws(() => statFile("node_modules/@huggingface/transformers/package.json"), "The retired embedding runtime must not ship");
assert.throws(() => statFile("node_modules/onnxruntime-node/package.json"), "The retired ONNX runtime must not ship");
assert.throws(() => statFile("resources/memory-v3"), "The retired embedding model bundle must not ship");

// node-pty loads from app.asar.unpacked, for the packaged platform only.
const resourcesDir = path.dirname(archive);
const unpacked = path.join(resourcesDir, "app.asar.unpacked", "node_modules");
const target = `${process.platform}-${process.arch}`;
const ptyPrebuilds = path.join(unpacked, "node-pty", "prebuilds");
for (const binary of ["pty.node", "conpty.node"]) {
  assert.ok(fs.existsSync(path.join(ptyPrebuilds, target, binary)), `node-pty ${target}/${binary} is not unpacked`);
}
assert.deepEqual(fs.readdirSync(ptyPrebuilds), [target], "node-pty ships prebuilds for other platforms");

async function checkFuses() {
  const executable = path.join(path.dirname(resourcesDir), process.platform === "win32" ? "XEKUTE.exe" : "XEKUTE");
  const wire = await getCurrentFuseWire(executable);
  for (const [option, enabled] of Object.entries(PACKAGED_FUSES)) {
    const expected = enabled ? 49 : 48; // FuseState.ENABLE / FuseState.DISABLE
    assert.equal(wire[option], expected, `Electron fuse ${option} is ${wire[option]}, expected ${expected}`);
  }
}

checkFuses().then(() => {
  console.log(`Package verified: archive links resolve internally, node-forge ${manifest.version} and the compiled UI are bundled, only allowlisted files ship, node-pty ${target} is unpacked, and fuses are set.`);
}, (error) => {
  console.error(error);
  process.exitCode = 1;
});
