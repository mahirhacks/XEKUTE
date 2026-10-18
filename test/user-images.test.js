"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_USER_IMAGES, normalizeUserImages, attachUserImages } = require("../src/app/services/chat/user-images.js");

const png = "data:image/png;base64,iVBORw0KGgo=";
const jpeg = "data:image/jpeg;base64,/9j/4AAQ";

test("attached images accept up to ten PNG, JPEG or WebP data URLs", () => {
  const ok = normalizeUserImages([{ name: "a.png", dataUrl: png }, { name: "b.jpg", dataUrl: jpeg }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.images.map((image) => image.mediaType), ["image/png", "image/jpeg"]);
  assert.equal(normalizeUserImages(undefined).images.length, 0);
  assert.equal(normalizeUserImages(Array.from({ length: MAX_USER_IMAGES + 1 }, () => ({ dataUrl: png }))).ok, false);
  assert.equal(normalizeUserImages([{ dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }]).ok, false);
  assert.equal(normalizeUserImages([{ dataUrl: "https://example.com/a.png" }]).ok, false);
});

test("images attach to the run's own user message for each provider", () => {
  const { images } = normalizeUserImages([{ dataUrl: png }]);
  const messages = [
    { role: "system", content: "rules" },
    { role: "user", content: "earlier" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "What is on this page?" },
    { role: "assistant", content: "", tool_calls: [] },
  ];
  const openrouter = attachUserImages(messages, { text: "What is on this page?", images, provider: "openrouter" });
  assert.deepEqual(openrouter[3].content, [
    { type: "text", text: "What is on this page?" },
    { type: "image_url", image_url: { url: png } },
  ]);
  assert.equal(messages[3].content, "What is on this page?", "the caller's history is not modified");
  const ollama = attachUserImages(messages, { text: "What is on this page?", images, provider: "ollama" });
  assert.deepEqual(ollama[3], { role: "user", content: "What is on this page?", images: ["iVBORw0KGgo="] });
  assert.equal(ollama[1].images, undefined);
  assert.equal(attachUserImages(messages, { text: "not present", images, provider: "ollama" }), messages);
});
