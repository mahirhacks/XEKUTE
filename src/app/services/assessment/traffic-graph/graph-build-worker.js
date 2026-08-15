"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parentPort, workerData } = require("node:worker_threads");
const { createAssessmentWorkspace } = require("../../../../domain/assessment/assessment-workspace.js");
const { createJavascriptArtifactStore } = require("../../../../domain/assessment/javascript-artifact-store.js");
const { createAssessmentMap } = require("../../../../domain/assessment/assessment-map.js");

try {
  const assessmentWorkspace = createAssessmentWorkspace({ fs, path });
  const javascriptArtifacts = createJavascriptArtifactStore({ fs, path, crypto });
  const assessmentMap = createAssessmentMap({ fs, path, crypto, assessmentWorkspace, javascriptArtifacts });
  const result = assessmentMap.build(workerData.workspace, workerData.options || {});
  parentPort.postMessage(result?.error
    ? result
    : { ok: true, exists: true, path: result.path, htmlPath: result.htmlPath, unchanged: Boolean(result.unchanged), stats: result.graph?.stats || {}, builtAt: result.graph?.builtAt || "" });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message, code: "TRAFFIC_GRAPH_BUILD_FAILED" });
}
