"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/ui/bootstrap.js"), "utf8");
const webcloneStart = source.indexOf("let webcloneFileRequestGeneration = 0;");
const webcloneEnd = source.indexOf("\nasync function buildWebClone", webcloneStart);
const webcloneFunctions = source.slice(webcloneStart, webcloneEnd);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture(api) {
  const visible = { title: "", meta: "", content: "", status: "", target: "", empty: false, hidden: true, previewDisabled: true };
  const context = {
    assessmentPath: "G:/A",
    webcloneManifest: null,
    webcloneSelectedFile: "",
    webcloneFileRequestGeneration: 0,
    webcloneManifestRequestGeneration: 0,
    webcloneEmpty: { set hidden(value) { visible.empty = value; } },
    webcloneContent: { set hidden(value) { visible.hidden = value; } },
    webcloneStatus: { set textContent(value) { visible.status = value; } },
    webcloneTarget: { set value(value) { visible.target = value; } },
    webcloneFileTitle: { set textContent(value) { visible.title = value; } },
    webcloneFileMeta: { set textContent(value) { visible.meta = value; } },
    webcloneFileContent: { set textContent(value) { visible.content = value; } },
    webclonePreviewAction: { set disabled(value) { visible.previewDisabled = value; } },
    window: { api },
    renderWebCloneFiles() {},
    addErrorMessage(message) { visible.error = message; },
  };
  vm.createContext(context);
  vm.runInContext(webcloneFunctions, context);
  return { context, visible };
}

test("a delayed WebClone manifest cannot replace the active project's clone", async () => {
  const manifestA = deferred();
  let startedA;
  const startedARead = new Promise(resolve => { startedA = resolve; });
  const { context, visible } = fixture({
    webCloneManifest({ path: workspace }) {
      if (workspace === "G:/A") {
        startedA();
        return manifestA.promise;
      }
      return Promise.resolve({ files: [{ path: "WebClone/index.html", bytes: 12 }], target: "https://b.example" });
    },
    webCloneReadFile: async ({ path: workspace }) => ({ content: `${workspace} file` }),
  });

  const previousLoad = context.loadWebCloneManifest();
  await startedARead;
  context.assessmentPath = "G:/B";
  await context.loadWebCloneManifest();
  manifestA.resolve({ files: [{ path: "WebClone/index.html", bytes: 10 }], target: "https://a.example" });
  await previousLoad;

  assert.equal(context.webcloneManifest.target, "https://b.example");
  assert.equal(visible.status, "1 files · ready");
  assert.equal(visible.target, "https://b.example");
  assert.equal(visible.content, "G:/B file");
});

test("a slower earlier WebClone file selection cannot replace the latest selected file", async () => {
  const firstFile = deferred();
  let startedFirstFile;
  const firstReadStarted = new Promise(resolve => { startedFirstFile = resolve; });
  const { context, visible } = fixture({
    webCloneReadFile({ relativePath }) {
      if (relativePath === "WebClone/first.html") {
        startedFirstFile();
        return firstFile.promise;
      }
      return Promise.resolve({ content: "second file" });
    },
  });

  const earlierRead = context.openWebCloneFile("WebClone/first.html");
  await firstReadStarted;
  await context.openWebCloneFile("WebClone/second.html");
  firstFile.resolve({ content: "first file" });
  await earlierRead;

  assert.equal(context.webcloneSelectedFile, "WebClone/second.html");
  assert.equal(visible.title, "second.html");
  assert.equal(visible.content, "second file");
});
