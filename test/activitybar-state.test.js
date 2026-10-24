const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { rendererDefinitions } = require("./helpers/renderer-source.js");

test("Browser and Settings selection follows the visible workspace despite proxy status updates", t => {
  const dom = new JSDOM('<button id="security"></button><button id="settings"></button><button id="browser"></button>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const context = vm.createContext({
    document, appState: { currentWorkspaceMode: "settings" },
    activitySecurity: document.getElementById("security"),
    btnTopSettings: document.getElementById("settings"),
    securityProxyBrowser: document.getElementById("browser"), syncSidebarActivity() {},
  });
  vm.runInContext(rendererDefinitions("syncWorkspaceActivity", "syncProxyBrowserUi"), context);
  const selected = () => [...document.querySelectorAll(".active")].map(button => button.id);
  context.syncWorkspaceActivity();
  assert.deepEqual(selected(), ["settings"]);
  assert.equal(context.btnTopSettings.getAttribute("aria-pressed"), "true");
  context.appState.currentWorkspaceMode = "browser";
  context.syncWorkspaceActivity();
  assert.deepEqual(selected(), ["browser"]);
  context.syncProxyBrowserUi({ running: false });
  assert.deepEqual(selected(), ["browser"], "proxy shutdown does not deselect the visible Browser workspace");
  context.appState.currentWorkspaceMode = "editor";
  context.syncWorkspaceActivity();
  context.syncProxyBrowserUi({ running: true, browser: "chrome" });
  assert.deepEqual(selected(), [], "a background proxy browser does not select an inactive workspace");
  assert.equal(context.securityProxyBrowser.getAttribute("aria-pressed"), "false");
});
