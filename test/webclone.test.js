const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWebCloneService, extractReferences, safeRelativePath } = require("../src/app/services/research/webclone.js");

test("WebClone extracts unique same-document references and bounds paths", () => {
  const refs = extractReferences('<link href="/app.css"><script src="/app.js"></script><img src="/app.css">', "https://example.test/");
  assert.deepEqual(refs, ["https://example.test/app.css", "https://example.test/app.js"]);
  assert.equal(safeRelativePath("../../secret\\file.js"), "secret/file.js");
});

test("WebClone workspace keeps the central view separate from the right file drawer", () => {
  const html = fs.readFileSync(require.resolve("../src/ui/index.html"), "utf8");
  assert.match(html, /id="webclone-files-toggle"/);
  assert.match(html, /class="webclone-preview-pane" hidden/);
  assert.match(html, /id="webclone-preview-frame" class="webclone-preview-surface"/);
  assert.match(html, /id="webclone-file-content"/);
});

test("WebClone preview uses a dedicated no-preload view and a loopback-only document server", () => {
  const main = fs.readFileSync(require.resolve("../src/app/electron/main.js"), "utf8");
  const renderer = fs.readFileSync(require.resolve("../src/ui/bootstrap.js"), "utf8");
  assert.match(main, /new WebContentsView/);
  assert.match(main, /server\.listen\(0, "127\.0\.0\.1"/);
  assert.match(main, /connect-src 'none'/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /devTools: false/);
  assert.match(renderer, /script\[src\], link\[rel~='stylesheet'\]\[href\]/);
  assert.doesNotMatch(renderer, /querySelectorAll\("\[src\], \[href\]"\)/);
});

test("WebClone reads bundled assets above the editor limit without allowing path escape", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-webclone-"));
  try {
    fs.mkdirSync(path.join(root, "WebClone", "assets"), { recursive: true });
    const content = "x".repeat(1_200_000);
    fs.writeFileSync(path.join(root, "WebClone", "assets", "bundle.js"), content);
    const service = createWebCloneService({ fs, path, webResearch: {} });
    assert.equal(service.readFile(root, "WebClone/assets/bundle.js").content.length, content.length);
    assert.match(service.readFile(root, "../secret.txt").error, /invalid/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
