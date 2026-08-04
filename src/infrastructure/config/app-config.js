"use strict";

const path = require("path");

/**
 * Centralized application configuration derived from environment and Electron
 * app paths. Keeps path/config derivation out of service factories so the DI
 * container can inject a stable configuration.
 */
function createAppConfig({ app, processEnv = process.env } = {}) {
  const userData = () => app?.getPath?.("userData") || processEnv.APPDATA || process.cwd();
  const isDev = () => processEnv.NODE_ENV === "development" || (process.argv && process.argv.includes("--dev"));

  return {
    appRoot: path.join(__dirname, "..", "..", ".."),
    userData,
    isDev: isDev(),
    preferencesPath: () => path.join(userData(), "pointer-preferences.json"),
    projectProfilesDirectory: () => path.join(userData(), "project-profiles"),
    chatSessionsDirectory: () => userData(),
    defaultCentralCaDirectory: () => path.join(userData(), "certificates", "proxy-ca"),
    indexPath: () => path.join(__dirname, "..", "..", "..", "ui", "index.html"),
  };
}

module.exports = { createAppConfig };
