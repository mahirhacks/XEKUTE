"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "make");
const artifactRoot = path.join(output, "nsis");
if (!fs.existsSync(artifactRoot)) throw new Error("Run npm run make before generating release metadata.");
const setupExe = path.join(artifactRoot, "XEKUTESetup.exe");
if (!fs.existsSync(setupExe)) throw new Error("XEKUTESetup.exe was not produced by the NSIS build.");
const packagedUpdateConfig = path.join(root, "out", "XEKUTE-win32-x64", "resources", "app-update.yml");
if (!fs.existsSync(packagedUpdateConfig)) {
  throw new Error("Packaged app-update.yml is missing; this release would discover updates but fail to download them.");
}
const packagedUpdateText = fs.readFileSync(packagedUpdateConfig, "utf8");
for (const required of ["provider:", "owner:", "repo:", "updaterCacheDirName:"]) {
  if (!packagedUpdateText.includes(required)) throw new Error(`Packaged app-update.yml is missing ${required}`);
}

// Keep the checksum manifest aligned with the files the release workflow
// actually publishes. In particular, never hash SHA256SUMS.txt itself and do
// not expose electron-builder's internal debug/config files as release assets.
const artifacts = [
  setupExe,
  path.join(artifactRoot, "XEKUTESetup.exe.blockmap"),
  path.join(artifactRoot, "latest.yml"),
];
for (const artifact of artifacts) {
  if (!fs.existsSync(artifact)) throw new Error(`Release artifact is missing: ${path.relative(root, artifact)}`);
}
const checksums = artifacts.map((file) => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return `${hash} *${path.relative(output, file).replace(/\\/g, "/")}`;
});
fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`, "utf8");
const sbomPath = path.join(output, "xekute-sbom.cdx.json");
const descriptor = fs.openSync(sbomPath, "w");
try {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("npm_execpath is required to generate the SBOM.");
  execFileSync(process.execPath, [npmCli, "sbom", "--sbom-format", "cyclonedx"], {
    cwd: root, stdio: ["ignore", descriptor, "inherit"],
  });
} finally {
  fs.closeSync(descriptor);
}
console.log(`Generated checksums and SBOM for ${artifacts.length} release artifacts.`);
