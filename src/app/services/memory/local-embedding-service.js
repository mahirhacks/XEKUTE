"use strict";

const nodeCrypto = require("node:crypto");
const nodeFs = require("node:fs");
const nodePath = require("node:path");
const { Worker: NodeWorker } = require("node:worker_threads");

const MODEL_ASSET_MANIFEST = "manifest.json";
const MODEL_ASSET_SCHEMA_VERSION = 1;
const MODEL_ID = "BAAI/bge-base-en-v1.5";
const TRANSFORMERS_MODEL_ID = "Xenova/bge-base-en-v1.5";
const MODEL_DTYPE = "q8";

// Transformers.js is deliberately loaded lazily.  This keeps startup cheap
// and, more importantly, lets the application boot when an optional packaged
// model is unavailable.  The factory is still injectable for deterministic
// tests and for alternate worker hosts.
function verifyModelAssets(modelPath, { fs = nodeFs, path = nodePath, crypto = nodeCrypto } = {}) {
  const root = String(modelPath || "").trim();
  if (!root) return { ok: false, code: "MEMORY_MODEL_PATH_REQUIRED", error: "A local model path is required." };
  try {
    const manifestPath = path.join(root, MODEL_ASSET_MANIFEST);
    if (!fs.existsSync(manifestPath)) return { ok: false, code: "MEMORY_MODEL_MANIFEST_MISSING", error: "The bundled BGE model manifest is missing." };
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.schema_version !== MODEL_ASSET_SCHEMA_VERSION
      || manifest.model_id !== MODEL_ID
      || manifest.transformers_model_id !== TRANSFORMERS_MODEL_ID
      || manifest.embedding_dimension !== 768
      || manifest.max_input_tokens !== 512
      || manifest.dtype !== MODEL_DTYPE
      || !manifest.files || typeof manifest.files !== "object") {
      return { ok: false, code: "MEMORY_MODEL_MANIFEST_INVALID", error: "The bundled BGE model manifest is invalid." };
    }
    for (const [relative, expected] of Object.entries(manifest.files)) {
      const normalized = String(relative || "").replaceAll("\\", "/");
      if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
        return { ok: false, code: "MEMORY_MODEL_ASSET_PATH_INVALID", error: "The bundled BGE model manifest contains an invalid asset path." };
      }
      const file = path.resolve(root, ...normalized.split("/"));
      if (!file.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(file)) {
        return { ok: false, code: "MEMORY_MODEL_ASSET_MISSING", error: `The bundled BGE model asset is missing: ${normalized}.` };
      }
      const stat = fs.statSync(file);
      const bytes = Number(expected?.bytes);
      if (!stat.isFile() || !Number.isSafeInteger(bytes) || stat.size !== bytes) {
        return { ok: false, code: "MEMORY_MODEL_ASSET_SIZE_MISMATCH", error: `The bundled BGE model asset size is invalid: ${normalized}.` };
      }
      const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      if (!/^[a-f0-9]{64}$/i.test(String(expected?.sha256 || "")) || actual !== String(expected.sha256).toLowerCase()) {
        return { ok: false, code: "MEMORY_MODEL_ASSET_HASH_MISMATCH", error: `The bundled BGE model asset hash is invalid: ${normalized}.` };
      }
    }
    return { ok: true, manifest };
  } catch (error) {
    return { ok: false, code: "MEMORY_MODEL_ASSET_INVALID", error: `The bundled BGE model could not be verified: ${error.message}.` };
  }
}

async function defaultPipelineFactory(modelPath, model) {
  const location = String(modelPath || model || "").trim();
  if (!location) return null;
  if (modelPath && !nodeFs.existsSync(modelPath)) return null;
  try {
    if (modelPath) {
      const verification = verifyModelAssets(modelPath);
      if (!verification.ok) throw Object.assign(new Error(verification.error), { code: verification.code });
    }
    const transformers = require("@huggingface/transformers");
    const env = transformers.env || {};
    // Never turn a missing/corrupt packaged asset into an implicit network
    // download.  Tier 3 must be reproducible while offline.
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    if (modelPath) env.localModelPath = modelPath;
    const pipeline = transformers.pipeline;
    if (typeof pipeline !== "function") return null;
    return pipeline("feature-extraction", location, {
      local_files_only: true,
      // The packaged release carries the 8-bit ONNX asset under the
      // Transformers.js `_quantized` naming convention.  Selecting q8 here
      // is what makes the offline loader resolve `onnx/model_quantized.onnx`
      // instead of looking for the much larger fp32 `model.onnx` file.
      dtype: "q8",
      revision: "main",
    });
  } catch {
    return null;
  }
}

const DIMENSION = 768;

function createInProcessEmbeddingService({ pipelineFactory = null, modelPath = "", model = "BAAI/bge-base-en-v1.5", idleMs = 5 * 60 * 1_000, now = () => Date.now() } = {}) {
  let pipeline = null;
  let loading = null;
  let lastUsed = 0;
  let idleTimer = null;
  let state = "unavailable";
  let lastError = "";
  let inferenceQueue = Promise.resolve();
  // A dispose can happen while a lazy model load is still awaiting the
  // Transformers.js pipeline.  Keep a generation so that the late result is
  // discarded (and, when possible, disposed) instead of resurrecting a model
  // after the service was explicitly shut down.
  let lifecycleGeneration = 0;
  const nowMillis = () => {
    const value = now();
    return value instanceof Date ? value.getTime() : Number(value) || Date.now();
  };

  function scheduleUnload() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (nowMillis() - lastUsed < idleMs) return;
      // Transformers.js pipelines can retain ONNX sessions/native buffers.
      // Dropping the JavaScript reference alone leaves those resources alive
      // until an eventual GC (and makes a later reload compete with the old
      // session).  Dispose the exact stale instance before marking it
      // unloaded, while keeping disposal failures non-fatal to retrieval.
      const stale = pipeline;
      pipeline = null;
      try { stale?.dispose?.(); } catch { /* best effort release */ }
      state = "unloaded";
    }, idleMs);
    idleTimer.unref?.();
  }
  async function load() {
    if (pipeline) { lastUsed = nowMillis(); scheduleUnload(); return pipeline; }
    if (loading) return loading;
    const generation = lifecycleGeneration;
    let pending;
    pending = (async () => {
      const factory = typeof pipelineFactory === "function" ? pipelineFactory : (location) => defaultPipelineFactory(location, model);
      try {
        const loaded = await factory(modelPath || model, { model, modelPath, localOnly: true });
        if (generation !== lifecycleGeneration) {
          // The caller disposed the service while the provider was loading.
          // Do not retain the late pipeline or change the disposed state.
          try { loaded?.dispose?.(); } catch { /* best effort release */ }
          return null;
        }
        pipeline = loaded;
        state = pipeline ? "ready" : "unavailable";
        lastError = pipeline ? "" : "PACKAGED_MODEL_UNAVAILABLE";
        if (pipeline) { lastUsed = nowMillis(); scheduleUnload(); }
        return pipeline;
      } catch (error) {
        state = "degraded";
        pipeline = null;
        lastError = String(error?.code || error?.message || "EMBEDDING_LOAD_FAILED").slice(0, 240);
        return null;
      } finally {
        // A new load may have started after dispose; never clear that newer
        // promise from the completion handler of this stale generation.
        if (loading === pending) loading = null;
      }
    })();
    loading = pending;
    return loading;
  }
  function fallback(text) {
    const vector = new Float32Array(DIMENSION);
    const digest = nodeCrypto.createHash("sha256").update(String(text || "")).digest();
    for (let index = 0; index < DIMENSION; index += 1) vector[index] = ((digest[index % digest.length] / 255) * 2) - 1;
    let norm = 0; for (const value of vector) norm += value * value; norm = Math.sqrt(norm) || 1; for (let index = 0; index < vector.length; index += 1) vector[index] /= norm;
    return vector;
  }
  async function embedNow(texts, { allowFallback = false } = {}) {
    const values = Array.isArray(texts) ? texts : [texts];
    const worker = await load();
    if (!worker) return allowFallback ? { ok: true, vectors: values.map(fallback), model, dimension: DIMENSION, degraded: true } : { ok: false, code: "MEMORY_EMBEDDING_UNAVAILABLE", state };
    try {
      const output = await worker(values.map((value) => String(value || "")), { pooling: "mean", normalize: true });
      const arrays = output?.tolist ? output.tolist() : Array.isArray(output) ? output : [];
      const vectors = arrays.map((row) => Float32Array.from((Array.isArray(row) ? row : row?.data || []).slice(0, DIMENSION)));
      if (vectors.some((vector) => vector.length !== DIMENSION)) throw new Error("embedding dimension mismatch");
      lastUsed = nowMillis(); scheduleUnload();
      return { ok: true, vectors, model, dimension: DIMENSION, degraded: false };
    } catch (error) {
      state = "degraded";
      lastError = String(error?.code || error?.message || "EMBEDDING_INFERENCE_FAILED").slice(0, 240);
      return allowFallback ? { ok: true, vectors: values.map(fallback), model, dimension: DIMENSION, degraded: true } : { ok: false, code: "MEMORY_EMBEDDING_FAILED", error: lastError, state };
    }
  }
  async function embed(texts, options = {}) {
    // ONNX inference is not assumed to be re-entrant.  Serializing requests
    // also bounds memory spikes when retrieval batches and index builds overlap.
    const task = inferenceQueue.catch(() => {}).then(() => embedNow(texts, options));
    inferenceQueue = task.catch(() => {});
    return task;
  }
  async function similarity(left, right) {
    // Similarity is a semantic signal.  A deterministic hash vector is useful
    // for fixtures, but must never masquerade as semantic retrieval in the
    // production KAG when the packaged model is unavailable.
    const result = await embed([left, right], { allowFallback: false });
    if (!result.ok) return 0;
    const a = result.vectors[0]; const b = result.vectors[1]; let score = 0; for (let index = 0; index < Math.min(a.length, b.length); index += 1) score += a[index] * b[index]; return score;
  }
  function health() { return { ok: true, state, model, modelPath: String(modelPath || ""), dimension: DIMENSION, loaded: Boolean(pipeline), lastUsedAt: lastUsed || null, lastError }; }
  function dispose() {
    lifecycleGeneration += 1;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    try { pipeline?.dispose?.(); } catch { /* best effort release */ }
    pipeline = null;
    // Leave an in-flight load promise observable to its caller; the
    // generation guard above will resolve it as null without reviving state.
    loading = null;
    state = "disposed";
    lastError = "";
  }
  return Object.freeze({ DIMENSION, model, load, embed, similarity, health, dispose, verifyModelAssets });
}

function createWorkerEmbeddingService({ modelPath = "", model = MODEL_ID, idleMs = 5 * 60 * 1_000, Worker = NodeWorker } = {}) {
  let worker = null;
  let sequence = 0;
  let lastHealth = { ok: true, state: "unloaded", model, modelPath: String(modelPath || ""), dimension: DIMENSION, loaded: false, lastUsedAt: null, lastError: "", worker: true };
  const pending = new Map();

  function failPending(code, message) {
    for (const { resolve } of pending.values()) resolve({ ok: false, code, error: message, state: "degraded" });
    pending.clear();
  }

  function ensureWorker() {
    if (worker) return worker;
    const instance = new Worker(nodePath.join(__dirname, "local-embedding-worker.js"), {
      workerData: { modelPath: String(modelPath || ""), model: String(model || MODEL_ID), idleMs: Math.max(1_000, Number(idleMs) || 5 * 60 * 1_000) },
    });
    worker = instance;
    instance.on("message", (message = {}) => {
      if (message.health) lastHealth = { ...message.health, worker: true };
      const request = pending.get(Number(message.id));
      if (!request) return;
      pending.delete(Number(message.id));
      request.resolve(message.result);
    });
    instance.on("error", (error) => {
      lastHealth = { ...lastHealth, state: "degraded", loaded: false, lastError: String(error?.message || "EMBEDDING_WORKER_FAILED").slice(0, 240), worker: true };
      failPending("MEMORY_EMBEDDING_WORKER_FAILED", "The local embedding worker failed.");
    });
    instance.on("exit", (code) => {
      if (worker === instance) worker = null;
      if (code !== 0) {
        lastHealth = { ...lastHealth, state: "degraded", loaded: false, lastError: `EMBEDDING_WORKER_EXIT_${code}`, worker: true };
        failPending("MEMORY_EMBEDDING_WORKER_EXITED", "The local embedding worker exited unexpectedly.");
      }
    });
    return instance;
  }

  function request(type, payload = {}) {
    const id = ++sequence;
    return new Promise((resolve) => {
      pending.set(id, { resolve });
      try { ensureWorker().postMessage({ id, type, payload }); } catch (error) {
        pending.delete(id);
        resolve({ ok: false, code: error?.code || "MEMORY_EMBEDDING_WORKER_FAILED", error: "The local embedding worker could not accept work.", state: "degraded" });
      }
    });
  }

  async function load() {
    const result = await request("load");
    return result?.ok ? result : null;
  }
  async function embed(texts, options = {}) {
    return request("embed", { texts: Array.isArray(texts) ? texts.map(String) : [String(texts || "")], options: { allowFallback: options.allowFallback === true } });
  }
  async function similarity(left, right) {
    const result = await embed([left, right], { allowFallback: false });
    if (!result?.ok) return 0;
    const a = result.vectors?.[0] || [];
    const b = result.vectors?.[1] || [];
    let score = 0;
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) score += a[index] * b[index];
    return score;
  }
  function health() { return { ...lastHealth, worker: true }; }
  function dispose() {
    const current = worker;
    worker = null;
    failPending("MEMORY_EMBEDDING_DISPOSED", "The local embedding worker was disposed.");
    current?.postMessage?.({ id: ++sequence, type: "dispose", payload: {} });
    current?.terminate?.();
    lastHealth = { ...lastHealth, state: "disposed", loaded: false, worker: true };
  }
  return Object.freeze({ DIMENSION, model, load, embed, similarity, health, dispose, verifyModelAssets });
}

function createLocalEmbeddingService(options = {}) {
  // Function-valued test adapters cannot cross a worker boundary. Production
  // composition supplies only serializable model options and therefore always
  // takes the dedicated worker path.
  return typeof options.pipelineFactory === "function" || options.useWorker === false
    ? createInProcessEmbeddingService(options)
    : createWorkerEmbeddingService(options);
}

module.exports = Object.freeze({ createLocalEmbeddingService, createInProcessEmbeddingService, createWorkerEmbeddingService, DIMENSION, verifyModelAssets, MODEL_ID, TRANSFORMERS_MODEL_ID, MODEL_DTYPE });
