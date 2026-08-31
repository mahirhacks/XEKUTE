"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { createInProcessEmbeddingService } = require("./local-embedding-service.js");

if (!parentPort) throw new Error("The local embedding worker requires a worker_threads parent port.");

const service = createInProcessEmbeddingService({
  modelPath: String(workerData?.modelPath || ""),
  model: String(workerData?.model || "BAAI/bge-base-en-v1.5"),
  idleMs: Math.max(1_000, Number(workerData?.idleMs) || 5 * 60 * 1_000),
});

parentPort.on("message", async ({ id, type, payload = {} } = {}) => {
  let result;
  try {
    if (type === "load") {
      const loaded = await service.load();
      result = loaded ? { ok: true, loaded: true } : { ok: false, code: "MEMORY_EMBEDDING_UNAVAILABLE", loaded: false };
    } else if (type === "embed") {
      result = await service.embed(payload.texts || [], payload.options || {});
    } else if (type === "health") {
      result = service.health();
    } else if (type === "dispose") {
      service.dispose();
      result = { ok: true, disposed: true };
    } else {
      result = { ok: false, code: "MEMORY_EMBEDDING_WORKER_REQUEST_INVALID", error: "The embedding worker request is unsupported." };
    }
  } catch (error) {
    result = { ok: false, code: error?.code || "MEMORY_EMBEDDING_WORKER_FAILED", error: String(error?.message || "Embedding worker failed.").slice(0, 1_000) };
  }
  parentPort.postMessage({ id, result, health: service.health() });
});
