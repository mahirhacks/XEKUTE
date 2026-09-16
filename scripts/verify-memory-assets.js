"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const modelPath = path.join(root, "resources", "memory-v3", "models", "bge-base-en-v1.5");
if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isDirectory()) {
  console.error("BGE asset bundle is missing from resources/memory-v3/models/bge-base-en-v1.5");
  process.exitCode = 1;
} else {
  console.log("BGE asset bundle is present (unused after Knowledge Library removal).");
}
