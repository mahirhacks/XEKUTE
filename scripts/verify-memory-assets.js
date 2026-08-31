"use strict";

const path = require("node:path");
const { verifyModelAssets, MODEL_ID, MODEL_DTYPE } = require("../src/app/services/memory/local-embedding-service.js");

const root = path.resolve(__dirname, "..");
const modelPath = path.join(root, "resources", "memory-v3", "models", "bge-base-en-v1.5");
const result = verifyModelAssets(modelPath);
if (!result.ok) {
  console.error(`${result.code}: ${result.error}`);
  process.exitCode = 1;
} else {
  const files = Object.keys(result.manifest.files || {});
  console.log(`BGE asset bundle verified: ${MODEL_ID} (${MODEL_DTYPE}), ${files.length} files.`);
}
