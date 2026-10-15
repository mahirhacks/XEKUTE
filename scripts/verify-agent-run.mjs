import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const core = [
  "test/agent-controller.test.js",
  "test/agent-hardening.test.js",
  "test/end-turn.test.js",
  "test/long-horizon-runtime.test.js",
  "test/delegation-provider.test.js",
  "test/subagent-coordinator.test.js",
  "test/delegation-orchestration.test.js",
  "test/memory-v3-tier1-coordinator.test.js",
];
const suites = {
  baseline: core,
  phase1: [...core, "test/agent-round-accounting.test.js", "test/agent-run-lifecycle.test.js", "test/boot-smoke.test.js"],
  phase2: ["test/agent-session-input.test.js", "test/agent-session-supervisor.test.js", "test/agent-session-storage.test.js", "test/agent-round-accounting.test.js", "test/agent-run-lifecycle.test.js", ...core],
  phase3: ["test/ipc-contracts.test.js"],
  phase4: ["test/agent-task-runtime.test.js", "test/agent-live-input.test.js", "test/agent-session-supervisor.test.js", "test/agent-session-storage.test.js", "test/agent-run-lifecycle.test.js", "test/ipc-contracts.test.js", ...core],
  phase5: ["test/delegated-child-store.test.js", "test/agent-delegated-lifecycle.test.js", "test/agent-live-input.test.js", "test/agent-process-ownership.test.js", "test/durable-process-manager.test.js", "test/terminate-process-tree.test.js", "test/agent-session-supervisor.test.js", "test/agent-run-lifecycle.test.js", ...core],
  phase6: ["test/chat-live-input.test.js", "test/ipc-contracts.test.js", "test/agent-live-input.test.js"],
  regression: null,
};
const phaseIndex = process.argv.indexOf("--phase");
const phase = phaseIndex < 0 ? "regression" : process.argv[phaseIndex + 1];
if (!Object.hasOwn(suites, phase)) {
  console.error(`Choose a phase: ${Object.keys(suites).join(", ")}`);
  process.exit(2);
}
const files = suites[phase];
for (const file of files || []) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`Phase ${phase} is not ready: missing ${file}`);
    process.exit(2);
  }
}
const directory = path.join(root, "tmp", "agent-run-implementation", "verification");
fs.mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const logPath = path.join(directory, `${phase}-${stamp}.tap`);
const log = fs.createWriteStream(logPath, { flags: "wx" });
const args = ["--test", "--test-reporter=tap", "--test-concurrency=1", ...(files || [])];
console.log(`[agent-run verification] ${phase}`);
console.log(`[agent-run verification] Log: ${logPath}`);
const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let tail = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    log.write(chunk);
    tail = (tail + chunk.toString()).slice(-12_000);
  });
}
child.on("error", (error) => {
  log.end(`${error.stack}\n`);
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  log.end(() => {
    const summary = tail.split(/\r?\n/).filter((line) => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(line));
    console.log(summary.join("\n") || tail);
    console.log(`[agent-run verification] ${code === 0 ? "PASSED" : "FAILED"}${signal ? ` (${signal})` : ""}`);
    process.exitCode = code === 0 ? 0 : 1;
  });
});
