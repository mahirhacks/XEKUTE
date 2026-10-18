#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Browser Phase 1 check exited ${code}.`)));
  });
}
await run(["--test", "test/browser-action.test.js", "test/browser-session-manager.test.js", "test/proxy-browser.test.js", "test/browser-contracts.test.js", "test/browser-fixtures.test.js", "test/browser-dev-host.test.js"]);
await run(["scripts/browser-dev.mjs", "--smoke"]);
