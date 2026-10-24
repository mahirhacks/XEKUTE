#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Browser agent verification exited ${code}.`)));
  });
}
await run(["--test", "test/native-browser-provider.test.js", "test/browser-agent-integration.test.js", "test/browser-artifact-store.test.js", "test/browser-images.test.js", "test/browser-action.test.js", "test/agent-controller.test.js"]);
await run(["scripts/browser-dev/verify-agent.cjs"]);
await run(["scripts/browser-dev/verify-dialog.cjs"]);
await run(["scripts/browser-dev/verify-observe.cjs"]);
await run(["scripts/browser-dev/verify-hybrid.cjs"]);
await run(["scripts/browser-dev/verify-browser-deadlines.cjs"]);
