"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const asar = require("@electron/asar");

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

console.log(`Package verified: archive links resolve internally, node-forge ${manifest.version} and the compiled UI are bundled.`);
