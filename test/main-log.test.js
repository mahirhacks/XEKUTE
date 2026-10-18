"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createMainLog, MAX_LOG_BYTES } = require("../src/app/electron/main-log.js");

test("main log records ignored background failures and rotates past its size cap", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "xekute-main-log-"));
  const warn = console.warn;
  console.warn = () => {};
  try {
    const log = createMainLog({ directory: () => directory });
    log.ignored("run.checkpoint")(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    const [entry] = fs.readFileSync(log.file(), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entry.scope, "run.checkpoint");
    assert.equal(entry.code, "ENOSPC");
    assert.equal(entry.message, "disk full");

    fs.writeFileSync(log.file(), "x".repeat(MAX_LOG_BYTES + 1));
    log.write("run.finish", "later failure");
    assert.equal(fs.existsSync(`${log.file()}.1`), true);
    assert.match(fs.readFileSync(log.file(), "utf8"), /later failure/);
  } finally {
    console.warn = warn;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("main log never throws when its directory cannot be written", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const log = createMainLog({ directory: () => { throw new Error("no userData"); } });
    assert.doesNotThrow(() => log.write("scope", new Error("boom")));
  } finally {
    console.warn = warn;
  }
});
