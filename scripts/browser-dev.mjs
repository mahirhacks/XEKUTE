#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { createDevLaunch, removeDevUserData } = require("./browser-dev/runtime.cjs");

if (process.argv.includes("--native") && process.argv.includes("--smoke")) {
  const { verifyNativeBrowserHost } = require("./browser-dev/verify-native.cjs");
  const result = await verifyNativeBrowserHost();
  console.log(`Verified ${result.passed.length} native-browser scenarios.`);
} else if (process.argv.includes("--smoke")) {
  const { verifyBrowserDevHost } = require("./browser-dev/verify.cjs");
  const result = await verifyBrowserDevHost();
  console.log(`Verified ${result.passed.length} real-browser scenarios.`);
  for (const limitation of result.limitations) console.log(`LIMITATION ${limitation}`);
  console.log(`Screenshot: ${result.screenshot}`);
} else {
  const launch = createDevLaunch({ native: process.argv.includes("--native") });
  const child = spawn(launch.executablePath, launch.args, { env: launch.env, stdio: "inherit", windowsHide: true });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const [code] = await once(child, "exit");
    process.exitCode = code ?? 1;
  } finally {
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    removeDevUserData(launch.userData);
  }
}
