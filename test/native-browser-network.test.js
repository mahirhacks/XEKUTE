"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const forge = require("node-forge");
const { certificateVerifier, matchesBinding } = require("../src/app/services/browser/native-browser-sessions.js");

function certificate({ issuer = null, hostname = "fixture.test", expired = false } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const value = forge.pki.createCertificate();
  value.publicKey = keys.publicKey; value.serialNumber = "01";
  value.validity.notBefore = new Date(Date.now() - 86400000 * 2);
  value.validity.notAfter = new Date(Date.now() + (expired ? -86400000 : 86400000));
  value.setSubject([{ name: "commonName", value: hostname }]);
  value.setIssuer(issuer ? issuer.value.subject.attributes : value.subject.attributes);
  value.setExtensions([{ name: "basicConstraints", cA: !issuer },
    { name: "subjectAltName", altNames: [{ type: 2, value: hostname }] },
    { name: "keyUsage", keyCertSign: !issuer, digitalSignature: true, keyEncipherment: true }]);
  value.sign(issuer ? issuer.keys.privateKey : keys.privateKey, forge.md.sha256.create());
  return { value, keys, data: forge.pki.certificateToPem(value) };
}

test("native browser TLS accepts a valid project CA chain and rejects unrelated, expired, or wrong-host certificates", () => {
  const ca = certificate({ hostname: "Project fixture CA" });
  const leaf = certificate({ issuer: ca });
  const unrelated = certificate();
  const expired = certificate({ issuer: ca, expired: true });
  const verify = certificateVerifier(ca.data);
  const check = (certificate, hostname = "fixture.test", verificationResult = "CERT_AUTHORITY_INVALID") => {
    let result; verify({ hostname, certificate, verificationResult }, code => { result = code; }); return result;
  };
  assert.equal(check(leaf), 0);
  assert.equal(check(unrelated), -2);
  assert.equal(check(expired), -2);
  assert.equal(check(leaf, "other.test"), -2);
  assert.equal(check({ data: "invalid" }), -2);
  assert.equal(check(leaf, "fixture.test", "OK"), -3);
});

test("identity header bindings match exact origins and complete path segments", () => {
  assert.equal(matchesBinding("https://a.test/api/items?q=1", "https://a.test/api"), true);
  assert.equal(matchesBinding("https://a.test/api", "https://a.test/api"), true);
  assert.equal(matchesBinding("https://a.test/apikey", "https://a.test/api"), false);
  assert.equal(matchesBinding("https://a.test:444/api", "https://a.test/api"), false);
  assert.equal(matchesBinding("http://a.test/api", "https://a.test/api"), false);
  assert.equal(matchesBinding("https://b.test/api", "https://a.test/api"), false);
});

test("agent request policy screens only page and frame loads, failing closed on errors", async () => {
  const { createNativeBrowserSessions } = require("../src/app/services/browser/native-browser-sessions.js");
  let onBeforeRequest = null;
  const fakeSession = {
    setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setProxy: async () => {}, setCertificateVerifyProc() {},
    webRequest: { onBeforeRequest: handler => { onBeforeRequest = handler; }, onBeforeSendHeaders() {} },
    cookies: { get: async () => [], set: async () => {} },
    closeAllConnections: async () => {}, clearStorageData: async () => {}, clearCache: async () => {},
  };
  const seen = [];
  const sessions = createNativeBrowserSessions({ electron: { session: { fromPartition: () => fakeSession } }, identityVault: null, proxyListener: null,
    requestPolicy: async details => { seen.push(details.resourceType); if (details.url.includes("boom")) throw new Error("boom"); return details.url.includes("blocked"); } });
  await sessions.get({ id: "p", workspace: process.cwd() }, "research", null);
  const verdict = details => new Promise(resolve => onBeforeRequest({ webContentsId: 7, ...details }, resolve));
  assert.deepEqual(await verdict({ url: "https://blocked.test/", resourceType: "mainFrame" }), { cancel: true });
  assert.deepEqual(await verdict({ url: "https://fine.test/", resourceType: "subFrame" }), { cancel: false });
  assert.deepEqual(await verdict({ url: "https://blocked.test/a.png", resourceType: "image" }), { cancel: false });
  assert.deepEqual(await verdict({ url: "https://boom.test/", resourceType: "mainFrame" }), { cancel: true });
  assert.deepEqual(seen, ["mainFrame", "subFrame", "mainFrame"]);
});
