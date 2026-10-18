"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { startBrowserFixtures } = require("./fixtures/browser/server.js");

test("browser fixtures bind distinct loopback origins and close idempotently", async t => {
  const fixture = await startBrowserFixtures(); t.after(() => fixture.close());
  assert.notEqual(fixture.origins.primary, fixture.origins.secondary);
  for (const origin of Object.values(fixture.origins)) assert.equal(new URL(origin).hostname, "127.0.0.1");
  assert.equal(fixture.allows("https://example.com"), false);
  assert.equal(fixture.allows(fixture.origins.primary + "/form"), true);
  for (const route of ["/", "/form", "/spa", "/frames", "/frame-content", "/nested-content", "/popups", "/popup-child", "/dialogs", "/canvas", "/files"]) {
    assert.equal((await fetch(fixture.origins.primary + route)).status, 200, route);
  }
  await fixture.close(); await fixture.close();
  await assert.rejects(fetch(fixture.origins.primary));
});

test("synthetic authentication, uploads, downloads and redirects retain observable state", async t => {
  const fixture = await startBrowserFixtures(); t.after(() => fixture.close());
  const login = await fetch(fixture.origins.primary + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Alice", password: "fixture-password", role: "admin" }) });
  assert.deepEqual(await login.json(), { user: "Alice", role: "admin" });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.deepEqual(await (await fetch(fixture.origins.primary + "/api/me", { headers: { cookie } })).json(), { user: "Alice", role: "admin" });
  assert.deepEqual(await (await fetch(fixture.origins.primary + "/api/me")).json(), { user: null });
  const data = new FormData(); data.append("file", new Blob(["fixture upload"]), "evidence.txt");
  assert.deepEqual(await (await fetch(fixture.origins.primary + "/api/upload", { method: "POST", body: data })).json(), { ok: true, name: "evidence.txt", bytes: 14 });
  assert.equal(fixture.uploads[0].content, "fixture upload");
  const download = await fetch(fixture.origins.primary + "/download");
  assert.match(download.headers.get("content-disposition"), /fixture-report.txt/);
  assert.equal(await download.text(), fixture.download);
  assert.equal((await fetch(fixture.origins.primary + "/redirect")).url, fixture.origins.secondary + "/frame-content");
  assert.equal((await fetch(fixture.origins.primary + "/redirect?to=https://example.com")).status, 400);
});

test("fixture proxy captures local traffic and never forwards outside its origins", async t => {
  const fixture = await startBrowserFixtures(); t.after(() => fixture.close());
  function viaProxy(url) {
    return new Promise((resolve, reject) => {
      const request = http.request(fixture.origins.proxy, { path: url, headers: { "x-fixture-identity": "user-a" } }, response => {
        const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
      }); request.on("error", reject); request.end();
    });
  }
  assert.deepEqual(await viaProxy(fixture.origins.primary + "/health"), { status: 200, body: '{"ok":true,"origin":"primary"}' });
  assert.equal(fixture.captures.length, 1);
  assert.equal(fixture.captures[0].identity, "user-a");
  assert.equal(fixture.captures[0].responseBody, '{"ok":true,"origin":"primary"}');
  assert.equal((await viaProxy("http://127.0.0.1:1/not-a-fixture")).status, 403);
  assert.equal(fixture.captures.length, 1);
});
