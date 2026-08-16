const test = require("node:test");
const assert = require("node:assert/strict");

const Inspector = require("../src/ui/features/security/security-inspector");

test("Inspector round-trips URL, Base64, Base64URL, HTML, and hex transforms", () => {
  const value = "hello world ✓ & <tag>";
  for (const format of ["url-component", "base64", "base64url", "html", "hex"]) {
    assert.equal(Inspector.decodeTransform(Inspector.encodeTransform(value, format), format), value, format);
  }
  assert.equal(Inspector.decodeTransform('{"ok":true}', "json"), '{\n  "ok": true\n}');
});

test("Inspector decodes and analyzes JWT claims without treating them as verified", () => {
  const header = Inspector.toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = Inspector.toBase64Url(JSON.stringify({ sub: "user-1", exp: 1 }));
  const parsed = Inspector.parseJwt(`${header}.${payload}.`);
  assert.equal(parsed.payload.sub, "user-1");
  const analysis = Inspector.analyzeJwt(parsed, 10);
  assert.equal(analysis.signed, false);
  assert.ok(analysis.warnings.includes("Unsigned JWT uses alg=none"));
  assert.ok(analysis.warnings.includes("Token is expired"));
});

test("Inspector finds bearer JWTs and HTTP cookie headers", () => {
  const token = `${Inspector.toBase64Url('{"alg":"HS256"}')}.${Inspector.toBase64Url('{"sub":"1"}')}.signature`;
  const raw = `GET / HTTP/1.1\r\nAuthorization: Bearer ${token}\r\nCookie: session=abc; theme=dark\r\n\r\n`;
  assert.equal(Inspector.findJwt(raw), token);
  assert.deepEqual(Inspector.extractHeaderValues(raw, "cookie"), ["session=abc; theme=dark"]);
});

test("Inspector parses request and Set-Cookie values with security observations", () => {
  const request = Inspector.parseCookies("session=hello%20world; theme=dark");
  assert.equal(request.length, 2);
  assert.equal(request[0].decodedValue, "hello world");
  const response = Inspector.parseCookies("sid=abc; Path=/; SameSite=Lax");
  assert.equal(response.length, 1);
  assert.equal(response[0].attributes.samesite, "Lax");
  assert.ok(response[0].notes.includes("Secure missing"));
  assert.ok(response[0].notes.includes("HttpOnly missing"));
  assert.equal(Inspector.transformCookieValues("name=hello world", "encode"), "name=hello%20world");
});
