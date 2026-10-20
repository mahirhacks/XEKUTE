"use strict";
// Preload for scripts/refactor/tests-to-named-definitions.mjs. Records every
// String.prototype.slice a test takes of the joined renderer source, with the
// test file position of the call and the text it produced.
// Usage: node --require ./scripts/refactor/record-renderer-slices.cjs test/x.test.js
const fs = require("node:fs");
const path = require("node:path");
const { rendererSource } = require("../../test/helpers/renderer-source.js");

const source = rendererSource();
const variants = new Set([source, source.replace(/\r\n/g, "\n")]);
const out = process.env.RENDERER_SLICE_LOG;
const testRoot = path.resolve(__dirname, "../../test");
const records = [];
const slice = String.prototype.slice;

String.prototype.slice = function recordedSlice(start, end) {
  "use strict";
  const result = slice.call(this, start, end);
  if (typeof this === "string" && this.length > 100000 && variants.has(this)) {
    const frames = new Error().stack.split("\n").slice(2)
      .filter(line => line.includes(testRoot))
      .map(line => line.match(/\(?([A-Za-z]:[^:]+|\/[^:]+):(\d+):(\d+)\)?$/))
      .filter(Boolean)
      .map(match => ({ file: path.relative(process.cwd(), match[1]).replace(/\\/g, "/"), line: Number(match[2]), column: Number(match[3]) }));
    if (frames.length) records.push({ ...frames[0], caller: frames[1] || null, text: result });
  }
  return result;
};

process.on("exit", () => {
  if (!out || !records.length) return;
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(out, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  fs.writeFileSync(out, JSON.stringify(previous.concat(records)));
});
