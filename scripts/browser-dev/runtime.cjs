"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const entry = path.join(__dirname, "host.cjs");
function createDevLaunch({ smoke = false, native = false } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-browser-dev-"));
  const env = { ...process.env, XEKUTE_BROWSER_DEV_USER_DATA: userData };
  for (const key of Object.keys(env)) if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("ELECTRON_")) delete env[key];
  return { executablePath: require("electron"), args: [native ? path.join(__dirname, "native-host.cjs") : entry, "--browser-dev", ...(smoke ? ["--smoke"] : [])], env, userData };
}
function removeDevUserData(directory) {
  const absolute = path.resolve(directory);
  if (path.dirname(absolute) !== path.resolve(os.tmpdir()) || !path.basename(absolute).startsWith("xekute-browser-dev-")) {
    throw new Error("Refusing to remove a path outside the browser development temporary directory.");
  }
  fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
function assertDevEntry({ isPackaged, defaultApp, argv, userData }) {
  if (isPackaged || !defaultApp || !argv.includes("--browser-dev")) throw new Error("The browser development host requires an unpackaged Electron development launch.");
  if (!userData || path.dirname(path.resolve(userData)) !== path.resolve(os.tmpdir()) || !path.basename(userData).startsWith("xekute-browser-dev-")) {
    throw new Error("The browser development host requires its own temporary profile.");
  }
}

module.exports = { createDevLaunch, removeDevUserData, assertDevEntry };
