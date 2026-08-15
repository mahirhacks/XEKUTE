"use strict";

// Compatibility composition wrapper. The real provider is the multi-context
// browser session manager; this module keeps the old factory import usable for
// callers that inject a Playwright provider in tests.
const { chromium } = require("playwright-core");
const { createBrowserSessionManager, findInstalledBrowser } = require("./browser-session-manager.js");

function createPlaywrightProvider({ timeoutMs = 30_000, beforeNavigation = null, identityVault = null, loginNavigation = null } = {}) {
  const manager = createBrowserSessionManager({ chromium, timeoutMs, beforeNavigation, identityVault, loginNavigation });
  return {
    execute: (input, executionContext) => manager.execute(input, executionContext),
    startLogin: (input) => manager.startLogin(input),
    saveLogin: (input) => manager.saveLogin(input),
    cancelLogin: (input) => manager.cancelLogin(input),
    close: () => manager.close(),
    runtime: () => manager.runtime(),
  };
}

module.exports = { createPlaywrightProvider, findInstalledBrowser };
