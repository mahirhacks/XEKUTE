"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out", "make");
if (!fs.existsSync(output)) throw new Error("Run npm run make before generating release metadata.");

function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

const artifacts = files(output).filter((file) => !/\.(?:sha256|json)$/i.test(file));
const checksums = artifacts.map((file) => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return `${hash} *${path.relative(output, file).replace(/\\/g, "/")}`;
});
fs.writeFileSync(path.join(output, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`, "utf8");
const sbomPath = path.join(output, "xekute-sbom.cdx.json");
const descriptor = fs.openSync(sbomPath, "w");
try {
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["sbom", "--sbom-format", "cyclonedx"], {
    cwd: root, stdio: ["ignore", descriptor, "inherit"],
  });
} finally {
  fs.closeSync(descriptor);
}
console.log(`Generated checksums and SBOM for ${artifacts.length} release artifacts.`);
