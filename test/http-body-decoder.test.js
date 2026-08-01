const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const {
  decodeHttpBody,
  decodeHttpRequestBody,
  formatBinaryBody,
  bufferToDisplayText,
} = require("../src/domain/assessment/http-body-decoder");

const gzip = promisify(zlib.gzip);

test("decodeHttpBody decompresses gzip without Content-Encoding header", async () => {
  const payload = JSON.stringify({ type: "telemetry", pings: 1 });
  const compressed = await gzip(Buffer.from(payload, "utf8"));
  const decoded = await decodeHttpBody(compressed, "");
  assert.equal(decoded, payload);
});

test("decodeHttpBody honors declared gzip Content-Encoding", async () => {
  const payload = "hello gzip";
  const compressed = await gzip(Buffer.from(payload, "utf8"));
  const decoded = await decodeHttpBody(compressed, "gzip");
  assert.equal(decoded, payload);
});

test("binary payloads render as a hex dump instead of mojibake", () => {
  const binary = Buffer.from([0x08, 0x96, 0x01, 0x12, 0x04, 0x74, 0x65, 0x73, 0x74]);
  const text = bufferToDisplayText(binary);
  assert.match(text, /^\[binary body, 9 bytes\]/);
  assert.match(text, /08 96 01 12/);
  assert.doesNotMatch(text, /\uFFFD/);
});

test("formatBinaryBody truncates long previews", () => {
  const binary = Buffer.alloc(600, 0xab);
  const text = formatBinaryBody(binary);
  assert.match(text, /\(88 more bytes\)/);
});

test("request decoder preserves form fields while summarizing binary multipart uploads", async () => {
  const boundary = "pointer-boundary";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nQuarterly report\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="sample.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    Buffer.from([0x00, 0x01, 0xff, 0x7f]),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const decoded = await decodeHttpRequestBody(body, { "content-type": `multipart/form-data; boundary=${boundary}` });
  assert.match(decoded, /Quarterly report/);
  assert.match(decoded, /binary upload: sample\.bin, 4 bytes/);
  assert.match(decoded, /Content-Disposition: form-data; name="title"/);
});

test("request decoder treats URL-encoded and JSON POST bodies as text", async () => {
  assert.equal(await decodeHttpRequestBody(Buffer.from("email=a%40example.com&role=admin"), { "content-type": "application/x-www-form-urlencoded" }), "email=a%40example.com&role=admin");
  assert.equal(await decodeHttpRequestBody(Buffer.from('{"active":true}'), { "content-type": "application/json; charset=utf-8" }), '{"active":true}');
});
