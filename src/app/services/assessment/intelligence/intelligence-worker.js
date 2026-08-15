"use strict";

const { parentPort, workerData } = require("node:worker_threads");
const { indexWorkspaceSync } = require("./intelligence-indexer.js");

if (parentPort) {
  let paused = false;
  parentPort.on("message", (message) => {
    if (message?.type === "pause") paused = true;
  });
  indexWorkspaceSync({
    workspace: workerData.workspace,
    indexPath: workerData.indexPath,
    runId: workerData.runId || "",
    planId: workerData.planId || "",
    shouldPause: () => paused,
    onProgress: (progress) => parentPort.postMessage({ type: "progress", progress }),
  }).then((result) => parentPort.postMessage({ type: "complete", result }))
    .catch((error) => parentPort.postMessage({ type: "complete", result: { ok: false, error: error.message, code: "INTELLIGENCE_BUILD_FAILED" } }));
}
