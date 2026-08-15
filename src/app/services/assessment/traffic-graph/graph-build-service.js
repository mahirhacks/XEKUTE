"use strict";

const path = require("node:path");
const { Worker } = require("node:worker_threads");

function createGraphBuildService({ assessmentMap, javascriptArtifacts = null, workerFactory = (filename, options) => new Worker(filename, options), onEvent = () => {}, enableWorker = true } = {}) {
  if (!assessmentMap?.build || !assessmentMap?.read) throw new TypeError("Assessment Map is required");
  const jobs = new Map();
  const rootOf = (workspace) => path.resolve(String(workspace || ""));

  async function build(workspace, options = {}) {
    const root = rootOf(workspace);
    if (jobs.has(root)) return jobs.get(root);
    const promise = (async () => {
      await javascriptArtifacts?.flush?.(root);
      onEvent({ workspace: root, type: "status", status: "building" });
      let result;
      if (!enableWorker) result = assessmentMap.build(root, options);
      else {
        result = await new Promise((resolve) => {
          const worker = workerFactory(path.join(__dirname, "graph-build-worker.js"), { workerData: { workspace: root, options } });
          let settled = false;
          const finish = (value) => { if (settled) return; settled = true; resolve(value); };
          worker.once("message", finish);
          worker.once("error", (error) => finish({ ok: false, error: error.message, code: "TRAFFIC_GRAPH_WORKER_FAILED" }));
          worker.once("exit", (code) => { if (code !== 0) finish({ ok: false, error: `Traffic graph worker exited with code ${code}.`, code: "TRAFFIC_GRAPH_WORKER_EXITED" }); });
        });
      }
      if (result?.error || result?.ok === false) {
        onEvent({ workspace: root, type: "status", status: "error", result });
        return result;
      }
      const loaded = assessmentMap.read(root);
      onEvent({ workspace: root, type: "status", status: "ready", result: { path: loaded.path, htmlPath: loaded.htmlPath, unchanged: Boolean(result.unchanged) } });
      return { ...loaded, unchanged: Boolean(result.unchanged) };
    })().finally(() => jobs.delete(root));
    jobs.set(root, promise);
    return promise;
  }

  function status(workspace) {
    return { ok: true, status: jobs.has(rootOf(workspace)) ? "building" : "idle" };
  }

  async function flush() {
    await Promise.all([...jobs.values()].map((job) => job.catch(() => {})));
    return { ok: true };
  }

  return Object.freeze({ build, status, flush });
}

module.exports = { createGraphBuildService };
