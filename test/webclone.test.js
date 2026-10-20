const { rendererSource } = require("./helpers/renderer-source.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWebCloneService, extractReferences, safeRelativePath } = require("../src/app/services/research/webclone.js");
const { readUiShell } = require("./helpers/ui-shell.js");

test("WebClone extracts unique same-document references and bounds paths", () => {
  const refs = extractReferences('<link href="/app.css"><script src="/app.js"></script><img src="/app.css">', "https://example.test/");
  assert.deepEqual(refs, ["https://example.test/app.css", "https://example.test/app.js"]);
  assert.equal(safeRelativePath("../../secret\\file.js"), "secret/file.js");
});

test("WebClone workspace keeps the central view separate from the right file drawer", () => {
  const html = readUiShell();
  assert.match(html, /id="webclone-files-toggle"/);
  assert.match(html, /class="webclone-preview-pane" hidden/);
  assert.match(html, /id="webclone-preview-frame" class="webclone-preview-surface"/);
  assert.match(html, /id="webclone-file-content"/);
});

test("WebClone preview uses a dedicated no-preload view and a loopback-only document server", () => {
  const main = fs.readFileSync(require.resolve("../src/app/electron/main.js"), "utf8");
  const renderer = rendererSource();
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

test("WebClone file reads reject symlinks that resolve outside the clone", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-webclone-symlink-"));
  try {
    const cloneRoot = path.join(root, "WebClone");
    const external = path.join(root, "external");
    fs.mkdirSync(cloneRoot);
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "protected.txt"), "outside content", "utf8");
    fs.symlinkSync(external, path.join(cloneRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
    const service = createWebCloneService({ fs, path, webResearch: {} });

    const result = service.readFile(root, "linked/protected.txt");

    assert.match(result.error, /invalid|outside/i);
    assert.equal(result.content, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("WebClone asset builds skip paths redirected outside the clone", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-webclone-build-symlink-"));
  try {
    const baseFolder = path.join(root, "WebClone");
    const assets = path.join(baseFolder, "assets");
    const external = path.join(root, "external");
    fs.mkdirSync(assets, { recursive: true });
    fs.mkdirSync(external);
    fs.symlinkSync(external, path.join(assets, "linked"), process.platform === "win32" ? "junction" : "dir");
    const service = createWebCloneService({
      fs,
      path,
      projectProfileProvider: () => ({ scope: { inScopeTargets: ["https://example.test"] } }),
      webResearch: {
        async fetchRawUrl(url) {
          return url.endsWith("/app.js")
            ? { text: "window.fixture = true;", finalUrl: url, response: { headers: { get: () => "application/javascript" } } }
            : { text: '<script src="/linked/app.js"></script>', finalUrl: url, response: { headers: { get: () => "text/html" } } };
        },
      },
    });

    const result = await service.build({ root, target: "https://example.test/" });

    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(external, "app.js")), false);
    assert.deepEqual(result.files.map((file) => file.path), ["WebClone/index.html"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
