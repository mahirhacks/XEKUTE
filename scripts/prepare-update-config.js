"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function yamlString(value) {
  return JSON.stringify(String(value));
}

function resolvePublishConfig(builderConfig) {
  const configured = Array.isArray(builderConfig?.publish)
    ? builderConfig.publish[0]
    : builderConfig?.publish;
  if (!configured || configured.provider !== "github") {
    throw new Error("A GitHub publish configuration is required for in-app updates.");
  }
  if (!configured.owner || !configured.repo) {
    throw new Error("The GitHub update owner and repository are required.");
  }
  return configured;
}

function buildUpdateConfig({ packageName, publish }) {
  const normalizedName = String(packageName || "").trim().toLowerCase();
  if (!normalizedName) throw new Error("package.json name is required for the updater cache.");
  return [
    `provider: ${yamlString(publish.provider)}`,
    `owner: ${yamlString(publish.owner)}`,
    `repo: ${yamlString(publish.repo)}`,
    `updaterCacheDirName: ${yamlString(`${normalizedName}-updater`)}`,
    "",
  ].join("\n");
}

function prepareUpdateConfig({
  projectRoot = root,
  resourcesDir = path.join(projectRoot, "out", "XEKUTE-win32-x64", "resources"),
} = {}) {
  const packageJson = require(path.join(projectRoot, "package.json"));
  const builderConfig = require(path.join(projectRoot, "electron-builder.config.js"));
  const publish = resolvePublishConfig(builderConfig);
  if (!fs.existsSync(resourcesDir) || !fs.statSync(resourcesDir).isDirectory()) {
    throw new Error(`Packaged resources directory is missing: ${resourcesDir}`);
  }
  const destination = path.join(resourcesDir, "app-update.yml");
  fs.writeFileSync(destination, buildUpdateConfig({ packageName: packageJson.name, publish }), "utf8");
  return destination;
}

if (require.main === module) {
  const destination = prepareUpdateConfig();
  console.log(`Prepared updater configuration: ${path.relative(root, destination)}`);
}

module.exports = {
  buildUpdateConfig,
  prepareUpdateConfig,
  resolvePublishConfig,
};
