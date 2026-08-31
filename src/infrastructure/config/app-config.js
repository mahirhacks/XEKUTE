"use strict";

const path = require("path");

/**
 * Centralized application configuration derived from environment and Electron
 * app paths. Keeps path/config derivation out of service factories so the DI
 * container can inject a stable configuration.
 */
function createAppConfig({ app, processEnv = process.env } = {}) {
  const userData = () => app?.getPath?.("userData") || processEnv.APPDATA || process.cwd();
  const home = () => app?.getPath?.("home") || processEnv.USERPROFILE || processEnv.HOME || process.cwd();
  const isDev = () => processEnv.NODE_ENV === "development" || (process.argv && process.argv.includes("--dev"));

  return {
    appRoot: path.join(__dirname, "..", "..", ".."),
    userData,
    isDev: isDev(),
    // V3 separates readable workspace state from machine-local sensitive and
    // derived data.  Keep these path factories next to the existing Electron
    // user-data configuration so every service resolves the same locations.
    memoryV3SensitiveDirectory: () => path.join(userData(), "memory-v3", "sensitive"),
    memoryV3IdentityDirectory: () => path.join(userData(), "memory-v3", "identity"),
    memoryV3CacheDirectory: () => path.join(userData(), "memory-v3", "cache"),
    memoryV3KnowledgeDirectory: () => path.join(userData(), "memory-v3", "knowledge"),
    preferencesPath: () => path.join(userData(), "pointer-preferences.json"),
    projectProfilesDirectory: () => path.join(userData(), "project-profiles"),
    identityVaultDirectory: () => path.join(home(), ".xekute", "data"),
    defaultCentralCaDirectory: () => path.join(userData(), "certificates", "proxy-ca"),
    proxyBrowserProfilesDirectory: () => path.join(userData(), "proxy-browser"),
    indexPath: () => path.join(__dirname, "..", "..", "..", "ui", "index.html"),
  };
}

module.exports = { createAppConfig };
