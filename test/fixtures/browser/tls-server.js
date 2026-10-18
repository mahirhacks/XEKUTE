"use strict";

const https = require("node:https");
const { once } = require("node:events");
const forge = require("node-forge");

async function startTlsFixture() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date(Date.now() - 60000);
  certificate.validity.notAfter = new Date(Date.now() + 86400000);
  certificate.setSubject([{ name: "commonName", value: "localhost" }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.setExtensions([{ name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] }]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const server = https.createServer({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(certificate) }, (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ tls: true, headers: request.headers }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { origin: `https://localhost:${server.address().port}`, certificatePem: forge.pki.certificateToPem(certificate), async close() {
    const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed;
  } };
}

module.exports = { startTlsFixture };
