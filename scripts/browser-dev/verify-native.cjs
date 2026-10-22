"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { _electron } = require("playwright-core");
const { createDevLaunch, removeDevUserData } = require("./runtime.cjs");
const { startBrowserFixtures } = require("../../test/fixtures/browser/server.js");
const { startTlsFixture } = require("../../test/fixtures/browser/tls-server.js");

async function verifyNativeBrowserHost() {
  const launch = createDevLaunch({ native: true, smoke: true });
  const fixtures = await startBrowserFixtures();
  const tls = await startTlsFixture();
  launch.env.XEKUTE_BROWSER_DEV_FIXTURE_ORIGINS = JSON.stringify(fixtures.origins);
  launch.env.XEKUTE_BROWSER_DEV_TLS_ORIGIN = tls.origin;
  const upstreamCa = path.join(launch.userData, "fixture-upstream-ca.pem");
  fs.writeFileSync(upstreamCa, tls.certificatePem);
  launch.env.NODE_EXTRA_CA_CERTS = upstreamCa;
  let application;
  const passed = [], pass = name => { passed.push(name); console.log(`PASS ${name}`); };
  const start = async () => {
    const app = await _electron.launch({ executablePath: launch.executablePath, args: launch.args, env: launch.env, timeout: 30000 });
    application = app;
    app.process().stderr.on("data", data => { if (/Error|Exception/.test(String(data))) console.error(String(data)); });
    await app.evaluate(async () => {
      for (let i = 0; i < 500; i++) {
        if (globalThis.xekuteNativeBrowserDevelopment) { await globalThis.xekuteNativeBrowserDevelopment.initial; return; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("The native browser development host did not initialize.");
    });
    return app;
  };
  // Calls cross the real Electron main-process boundary. Every page assertion
  // observes a real native view rather than a fake provider or a second browser.
  const run = (fn, arg) => application.evaluate(fn, arg);
  const evaluate = (id, code) => run((_electron, { id, code }) => globalThis.xekuteNativeBrowserDevelopment.browser.getContents(id).executeJavaScript(code), { id, code });
  const open = input => run((_electron, input) => globalThis.xekuteNativeBrowserDevelopment.browser.open(input), input);
  const navigate = (id, url) => run((_electron, { id, url }) => globalThis.xekuteNativeBrowserDevelopment.browser.navigate(id, url), { id, url });
  try {
    application = await start();
    const origins = fixtures.origins;
    const initial = await run(() => globalThis.xekuteNativeBrowserDevelopment.initial);
    assert.equal(await evaluate(initial.id, "typeof require + ':' + typeof window.api"), "undefined:undefined");
    assert.equal(await run(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    assert.equal(initial.owner.kind, "human");
    assert.equal(await run((_electron, id) => globalThis.xekuteNativeBrowserDevelopment.browser.getContents(id).session.getStoragePath(), initial.id), null);
    await assert.rejects(open({ purpose: "research", identityId: "alice", url: origins.primary }), /Invalid browser/);
    await assert.rejects(open({ purpose: "assessment", identityId: "missing", url: origins.primary }), /does not exist/);
    await navigate(initial.id, origins.primary + "/spa");
    const updated = await run(() => globalThis.xekuteNativeBrowserDevelopment.browser.list()[0]);
    assert.equal(updated.url, origins.primary + "/spa");
    assert.equal(updated.title, "Dynamic page fixture");
    assert.ok(updated.documentVersion > initial.documentVersion);
    assert.equal(updated.status, "ready");
    pass("real sandboxed WebContentsView tabs and navigation metadata");

    const confinement = await run(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment, service = h.createService();
      const bounds = { x: 80, y: 100, width: 400, height: 300 };
      const viewFor = id => h.window.contentView.children.find(view => view.webContents?.id === service.getContents(id).id);
      try {
        await service.activateProject(h.projectB);
        const tab = await service.open({ purpose: "research", url: h.fixtures.origins.primary + "/popups" });
        service.select(tab.id);
        const beforeLayout = viewFor(tab.id).getVisible();
        service.layout(tab.id, bounds);
        const afterLayout = viewFor(tab.id).getVisible();
        service.hide(); service.select(tab.id);
        const hiddenSelection = viewFor(tab.id).getVisible();
        await service.getContents(tab.id).executeJavaScript("void window.open('/popup-child','hidden-popup')", true);
        for (let attempt = 0; attempt < 200 && service.list().length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
        const popup = service.list().find(item => item.id !== tab.id);
        if (!popup) throw new Error("The popup was not created as an embedded tab.");
        const hiddenPopup = viewFor(popup.id).getVisible();
        service.layout(popup.id, bounds);
        return { beforeLayout, afterLayout, hiddenSelection, hiddenPopup, popupBounds: viewFor(popup.id).getBounds(), popupVisible: viewFor(popup.id).getVisible() };
      } finally { await service.shutdown(); }
    });
    assert.equal(confinement.beforeLayout, false, "selecting an agent page before the first workspace layout cannot cover the app");
    assert.equal(confinement.afterLayout, true);
    assert.equal(confinement.hiddenSelection, false, "select cannot undo a hidden browser workspace");
    assert.equal(confinement.hiddenPopup, false, "a popup cannot undo a hidden workspace");
    assert.deepEqual(confinement.popupBounds, { x: 80, y: 100, width: 400, height: 300 });
    assert.equal(confinement.popupVisible, true);
    assert.equal(await run(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    pass("agent selection and popups stay hidden until the embedded workspace supplies visible bounds");

    const saved = await run(async (_electron, origin) => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      return h.vault.saveSecretAsync(h.projectA.workspace, "alice", {
        storageState: { cookies: [{ name: "seed", value: "alice-cookie", domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }],
          origins: [{ origin, localStorage: [{ name: "restored-before-script", value: "alice-storage" }] }] },
        headerBindings: [{ origin: origin + "/health", headers: { "X-Fixture-Identity": "alice-header" } }],
      });
    }, origins.primary);
    assert.equal(saved.ok, true);
    const alice = await open({ purpose: "assessment", identityId: "alice", url: origins.primary + "/form" });
    assert.equal(await evaluate(alice.id, "localStorage.getItem('restored-before-script')"), "alice-storage");
    assert.equal(await evaluate(alice.id, "document.cookie.includes('alice-cookie')"), false);
    const cookies = await run((_electron, id) => globalThis.xekuteNativeBrowserDevelopment.browser.getContents(id).session.cookies.get({ name: "seed" }), alice.id);
    assert.equal(cookies[0].value, "alice-cookie");
    await evaluate(alice.id, "localStorage.setItem('changed','Alice updated'); document.querySelector('#username').value='Alice'; document.querySelector('#password').value='fixture-password'; document.querySelector('#login').requestSubmit();");
    await run(async (_electron, id) => {
      const w = globalThis.xekuteNativeBrowserDevelopment.browser.getContents(id);
      for (let i = 0; i < 100; i++) {
        if ((await w.executeJavaScript("document.querySelector('#status').textContent")).startsWith("Signed in")) return;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Fixture login did not finish.");
    }, alice.id);
    const alice2 = await open({ purpose: "assessment", identityId: "alice", url: origins.primary + "/api/me" });
    assert.equal(JSON.parse(await evaluate(alice2.id, "document.body.textContent")).user, "Alice");
    assert.equal(await evaluate(alice2.id, "localStorage.getItem('changed')"), "Alice updated");
    const bob = await open({ purpose: "assessment", identityId: "bob", url: origins.primary + "/api/me" });
    assert.equal(JSON.parse(await evaluate(bob.id, "document.body.textContent")).user, null);
    assert.equal(await evaluate(bob.id, "localStorage.getItem('changed')"), null);
    pass("encrypted identity import, shared identity continuity, and different identity isolation");

    await navigate(alice.id, origins.primary + "/health");
    await navigate(bob.id, origins.primary + "/health");
    await navigate(alice.id, origins.secondary + "/health");
    const captured = await run(() => globalThis.xekuteNativeBrowserDevelopment.captures);
    const requests = captured.filter(item => item.url.endsWith("/health"));
    assert.ok(requests.some(item => item.captureIdentity?.id === "alice" && /x-fixture-identity: alice-header/i.test(item.request)));
    assert.ok(requests.some(item => item.captureIdentity?.id === "bob" && !/alice-header/.test(item.request)));
    assert.ok(requests.some(item => item.url === origins.secondary + "/health" && item.captureIdentity?.id === "alice" && !/alice-header/.test(item.request)));
    assert.ok(captured.every(item => !/x-xekute-capture-context/i.test(item.request)));
    assert.ok(captured.every(item => !item.url.includes(".xekute-storage-")));
    pass("production capture listener attribution and origin-bound identity headers");

    const beforeResearch = captured.length;
    const research = await open({ purpose: "research", url: origins.primary + "/api/me" });
    assert.equal(JSON.parse(await evaluate(research.id, "document.body.textContent")).user, null);
    assert.equal(await evaluate(research.id, "localStorage.getItem('changed')"), null);
    assert.equal(await run(() => globalThis.xekuteNativeBrowserDevelopment.captures.length), beforeResearch);
    await evaluate(research.id, "localStorage.setItem('research','ephemeral')");
    pass("anonymous research uses separate storage and bypasses assessment capture");

    await navigate(alice.id, tls.origin);
    assert.equal(JSON.parse(await evaluate(alice.id, "document.body.textContent")).tls, true);
    await assert.rejects(navigate(research.id, tls.origin), /CERT_AUTHORITY_INVALID/);
    pass("HTTPS capture trusts only the project proxy CA while research rejects it");

    await navigate(alice.id, origins.primary + "/form");
    await run((_electron, { first, second }) => {
      const b = globalThis.xekuteNativeBrowserDevelopment.browser;
      b.select(first, { x: 0, y: 0, width: 800, height: 600 }); b.hide();
      b.select(second, { x: 0, y: 0, width: 800, height: 600 });
    }, { first: alice.id, second: bob.id });
    assert.equal(await evaluate(alice.id, "localStorage.getItem('changed')"), "Alice updated");
    await run((_electron, id) => globalThis.xekuteNativeBrowserDevelopment.browser.close(id), initial.id);
    assert.equal(await run((_electron, id) => globalThis.xekuteNativeBrowserDevelopment.browser.list().some(tab => tab.id === id), initial.id), false);
    pass("native view selection, hiding, and destruction preserve other live tabs");

    await run(async (_electron, id) => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const contents = h.browser.getContents(id);
      const crashed = new Promise(resolve => contents.once("render-process-gone", resolve));
      contents.forcefullyCrashRenderer(); await crashed;
      if (h.browser.list().find(tab => tab.id === id).status !== "crashed") throw new Error("Crash state was not reported.");
      await h.browser.reload(id);
    }, bob.id);
    assert.equal(await evaluate(bob.id, "JSON.parse(document.body.textContent).ok"), true);
    pass("renderer crash is visible and reload recovers the native tab");

    await run(async (_electron, id) => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      globalThis.nativePendingNavigation = h.browser.navigate(id, h.fixtures.origins.primary + "/slow")
        .then(() => ({ completed: true }), error => ({ completed: false, code: error.code }));
      for (let i = 0; i < 100; i++) {
        if (h.browser.list().find(tab => tab.id === id).status === "loading") return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Slow navigation did not start.");
    }, bob.id);

    const switched = await run(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const old = h.browser.list().map(tab => h.browser.getContents(tab.id));
      let allClosedBeforeProxyChange = false;
      await h.browser.activateProject(h.projectB, async () => {
        allClosedBeforeProxyChange = old.every(contents => contents.isDestroyed());
        await h.configureProxy(h.projectB);
      });
      const tab = await h.browser.open({ purpose: "assessment", identityId: "alice", url: h.fixtures.origins.primary + "/api/me" });
      return { allClosedBeforeProxyChange, tab, text: await h.browser.getContents(tab.id).executeJavaScript("document.body.textContent"),
        storage: await h.browser.getContents(tab.id).executeJavaScript("localStorage.getItem('changed')") };
    });
    assert.equal(switched.allClosedBeforeProxyChange, true);
    assert.equal(JSON.parse(switched.text).user, null);
    assert.equal(switched.storage, null);
    assert.equal((await run(() => globalThis.nativePendingNavigation)).completed, false);
    pass("project switch closes native contents before proxy ownership changes");

    await run(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      await h.browser.activateProject(h.projectA, () => h.configureProxy(h.projectA));
      await h.browser.restore();
    });
    const restored = await run(() => globalThis.xekuteNativeBrowserDevelopment.browser.list());
    assert.ok(restored.some(tab => tab.id === alice.id));
    assert.ok(restored.every(tab => tab.owner.kind === "human" && tab.operation.status === "idle"));
    assert.equal(await evaluate(alice.id, "localStorage.getItem('changed')"), "Alice updated");
    await navigate(alice.id, origins.primary + "/api/me");
    assert.equal(JSON.parse(await evaluate(alice.id, "document.body.textContent")).user, "Alice");
    assert.equal(await evaluate(research.id, "localStorage.getItem('research')"), null);
    pass("encrypted restore preserves assessment authentication and resets research state");

    await application.close(); application = null;
    application = await start();
    await run(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      await h.browser.restore();
    });
    assert.equal(await evaluate(alice.id, "localStorage.getItem('changed')"), "Alice updated");
    assert.equal(JSON.parse(await evaluate(alice.id, "document.body.textContent")).user, "Alice");
    assert.ok((await run(() => globalThis.xekuteNativeBrowserDevelopment.browser.list())).every(tab => tab.owner.kind === "human"));
    pass("actual Electron quit and reopen restores tabs and encrypted identity state");

    const failedSave = await run(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const errors = [];
      const service = h.createService({ tabStore: null, onEvent: event => errors.push(event),
        identityVault: { ...h.vault, saveSecretAsync: async () => ({ ok: false, error: { code: "FIXTURE_WRITE_FAILED", message: "Fixture encrypted write failed." } }) } });
      await service.activateProject(h.projectA);
      const tab = await service.open({ purpose: "assessment", identityId: "alice", url: h.fixtures.origins.primary + "/health" });
      const contents = service.getContents(tab.id);
      let rejected = false;
      try { await service.shutdown(); } catch { rejected = true; }
      return { rejected, destroyed: contents.isDestroyed(), status: service.status(), warnings: errors.filter(event => event.type === "warning") };
    });
    assert.equal(failedSave.rejected, true); assert.equal(failedSave.destroyed, true);
    assert.equal(failedSave.status.sessions, 0);
    assert.ok(failedSave.warnings.some(warning => warning.code === "FIXTURE_WRITE_FAILED"));
    pass("encrypted persistence failure is reported while native resources still close");

    await run(() => globalThis.xekuteNativeBrowserDevelopment.proxy.stop());
    await assert.rejects(navigate(alice.id, origins.primary + "/health"), /PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|BLOCKED_BY_CLIENT|ABORTED/);
    await assert.rejects(open({ purpose: "assessment", identityId: "bob", url: origins.primary }), /capture listener/);
    pass("listener failure never falls back to a direct assessment connection");

    const cleanup = await run(async () => {
      const h = globalThis.xekuteNativeBrowserDevelopment;
      const old = h.browser.list().map(tab => h.browser.getContents(tab.id));
      await h.browser.shutdown(); await h.browser.shutdown();
      return { ...h.browser.status(), destroyed: old.every(contents => contents.isDestroyed()) };
    });
    assert.equal(cleanup.destroyed, true); assert.equal(cleanup.tabs, 0); assert.equal(cleanup.sessions, 0); assert.equal(cleanup.disposed, true);
    pass("idempotent shutdown destroys native tabs and releases sessions");
    return { passed };
  } finally {
    try { await application?.close(); }
    finally { await tls.close(); await fixtures.close(); removeDevUserData(launch.userData); }
  }
}

module.exports = { verifyNativeBrowserHost };
