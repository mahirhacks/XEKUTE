#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Browser workspace check exited ${code}.`)));
  });
}
await run(["--test", "test/browser-contracts.test.js", "test/browser-cdp-transport.test.js", "test/browser-ipc.test.js", "test/browser-workspace.test.js", "test/browser-tab-store.test.js", "test/native-browser-network.test.js", "test/browser-dev-host.test.js"]);
await run(["scripts/browser-dev/verify-control.cjs"]);
await run(["scripts/browser-dev/verify-workspace.cjs"]);
