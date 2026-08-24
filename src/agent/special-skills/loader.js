"use strict";

const fsDefault = require("node:fs");
const pathDefault = require("node:path");
const { parseFrontmatter } = require("../../app/services/assessment/knowledge/skill-knowledge-graph.js");
const { normalizeManifest, validateManifest } = require("./schema.js");

const MAX_SKILL_FILE_BYTES = 256 * 1024;
const MAX_PACKAGE_FILES = 32;

function safeRelative(root, candidate, path = pathDefault) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return relative.replace(/\\/g, "/");
}

function readText(file, fs = fsDefault) {
  let handle = null;
  try {
    handle = fs.openSync(file, "r");
    const stat = fs.fstatSync(handle);
    if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) throw Object.assign(new Error("Special-skill resource is missing or too large."), { code: "SPECIAL_SKILL_RESOURCE_INVALID" });
    return fs.readFileSync(handle, "utf8");
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch { /* preserve the read or validation result */ }
    }
  }
}

function loadPackage(packageRoot, { fs = fsDefault, path = pathDefault } = {}) {
  const manifestPath = path.join(packageRoot, "SKILL.md");
  const source = readText(manifestPath, fs);
  const parsed = parseFrontmatter(source);
  if (parsed.error || !source.startsWith("---")) throw Object.assign(new Error(parsed.error || "SKILL.md must start with frontmatter."), { code: "SPECIAL_SKILL_MANIFEST_INVALID" });
  const packageId = path.basename(packageRoot).toLowerCase();
  const resourceNames = Array.isArray(parsed.metadata?.resources) ? parsed.metadata.resources : [];
  const manifest = normalizeManifest(parsed.metadata, { id: packageId, source: path.relative(path.dirname(packageRoot), manifestPath), resources: resourceNames });
  const errors = validateManifest(manifest);
  if (manifest.id !== packageId) errors.push("manifest id must match its package directory");
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { code: "SPECIAL_SKILL_MANIFEST_INVALID" });
  const resources = [{ path: "SKILL.md", content: parsed.body }];
  const declared = [...new Set([manifest.entrypoint, ...manifest.resources].filter((name) => name && name !== "SKILL.md"))];
  if (declared.length > MAX_PACKAGE_FILES) throw Object.assign(new Error("Special-skill package declares too many resources."), { code: "SPECIAL_SKILL_PACKAGE_TOO_LARGE" });
  for (const name of declared) {
    const relative = safeRelative(packageRoot, name, path);
    if (!relative || !relative.toLowerCase().endsWith(".md")) throw Object.assign(new Error(`Invalid special-skill resource: ${name}`), { code: "SPECIAL_SKILL_RESOURCE_INVALID" });
    const file = path.join(packageRoot, ...relative.split("/"));
    resources.push({ path: relative, content: readText(file, fs) });
  }
  return Object.freeze({ manifest, packageRoot, resources });
}

function discoverPackages({ root = pathDefault.resolve(__dirname), fs = fsDefault, path = pathDefault } = {}) {
  const packages = [];
  const diagnostics = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return { packages, diagnostics: [{ code: "SPECIAL_SKILL_ROOT_UNAVAILABLE", error: error.message }] }; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    try { packages.push(loadPackage(path.join(root, entry.name), { fs, path })); }
    catch (error) { diagnostics.push({ package: entry.name, code: error.code || "SPECIAL_SKILL_INVALID", error: error.message }); }
  }
  return { packages, diagnostics };
}

module.exports = Object.freeze({ MAX_PACKAGE_FILES, MAX_SKILL_FILE_BYTES, discoverPackages, loadPackage, safeRelative });
