"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { createLocalEmbeddingService } = require("../src/app/services/memory/local-embedding-service.js");

test("production local embeddings are hosted by a dedicated worker", async (t) => {
  const service = createLocalEmbeddingService({ modelPath: path.join(__dirname, "missing-model-fixture") });
  t.after(() => service.dispose());
  assert.equal(service.health().worker, true);
  const result = await service.embed(["fixture"], { allowFallback: true });
  assert.equal(result.ok, true);
  assert.equal(result.vectors.length, 1);
  assert.equal(result.vectors[0].length, 768);
  assert.equal(result.degraded, true);
});
