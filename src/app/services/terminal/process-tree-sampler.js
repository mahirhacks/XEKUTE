"use strict";

const fs = require("node:fs");
const { execFile } = require("node:child_process");

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uniqueNumbers(values) {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function sampleLinuxTree(rootPid, fsImpl = fs) {
  const processes = new Map();
  let entries = [];
  try { entries = fsImpl.readdirSync("/proc"); } catch { entries = []; }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = fsImpl.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).trim().split(/\s+/);
      const ppid = Number(fields[1]);
      const utime = Number(fields[11]);
      const stime = Number(fields[12]);
      const status = fsImpl.readFileSync(`/proc/${pid}/status`, "utf8");
      const rssMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
      processes.set(pid, { pid, ppid, cpuTimeMs: ((utime + stime) * 1000) / Math.max(1, Number(process.env.SC_CLK_TCK) || 100), rssBytes: (Number(rssMatch?.[1]) || 0) * 1024 });
    } catch { /* The process can disappear between /proc reads. */ }
  }
  const pids = [];
  const queue = [Number(rootPid)];
  const seen = new Set();
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const record = processes.get(pid);
    if (!record && pid !== Number(rootPid)) continue;
    // Keep traversing through a root that exited while a descendant is still
    // present, but never report a missing root PID as alive by itself.
    if (record) pids.push(pid);
    for (const child of processes.values()) if (child.ppid === pid) queue.push(child.pid);
  }
  const selected = pids.map((pid) => processes.get(pid)).filter(Boolean);
  return {
    rootPid: Number(rootPid),
    pids,
    processes: selected,
    alive: pids.length > 0,
    cpuTimeMs: selected.reduce((sum, item) => sum + asNumber(item.cpuTimeMs), 0),
    rssBytes: selected.reduce((sum, item) => sum + asNumber(item.rssBytes), 0),
    source: "procfs",
  };
}

function execFileAsync(execFileImpl, executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(executable, args, options, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function sampleWindowsTree(rootPid, {
  execFileImpl = execFile,
  platform = process.platform,
} = {}) {
  const numericPid = Number(rootPid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return { rootPid: numericPid, pids: [], processes: [], alive: false, source: "powershell" };
  const script = [
    `$root = ${numericPid}`,
    "$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)",
    "$allIds = New-Object 'System.Collections.Generic.HashSet[int]'",
    "foreach ($item in $all) { [void]$allIds.Add([int]$item.ProcessId) }",
    "$ids = New-Object 'System.Collections.Generic.HashSet[int]'",
    "$queue = New-Object 'System.Collections.Generic.Queue[int]'",
    "$queue.Enqueue($root)",
    "while ($queue.Count -gt 0) { $current = $queue.Dequeue(); if ($ids.Add($current)) { foreach ($item in $all) { if ([int]$item.ParentProcessId -eq $current) { $queue.Enqueue([int]$item.ProcessId) } } } }",
    "$rows = foreach ($id in $ids) { try { $p = Get-Process -Id $id -ErrorAction Stop; [pscustomobject]@{ pid = $id; cpuTimeMs = if ($p.TotalProcessorTime) { $p.TotalProcessorTime.TotalMilliseconds } else { 0 }; rssBytes = [int64]$p.WorkingSet64 } } catch {} }",
    "[pscustomobject]@{ pids = @($ids | Where-Object { $allIds.Contains([int]$_) }); processes = @($rows) } | ConvertTo-Json -Compress -Depth 4",
  ].join("; ");
  try {
    const output = await execFileAsync(execFileImpl, "powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const parsed = JSON.parse(String(output || "{}"));
    const rawProcesses = parsed.processes == null ? [] : (Array.isArray(parsed.processes) ? parsed.processes : [parsed.processes]);
    const processes = rawProcesses.map((item) => ({
      pid: Number(item.pid),
      cpuTimeMs: asNumber(item.cpuTimeMs),
      rssBytes: asNumber(item.rssBytes),
    })).filter((item) => item.pid > 0);
    const rawPids = parsed.pids == null ? processes.map((item) => item.pid) : (Array.isArray(parsed.pids) ? parsed.pids : [parsed.pids]);
    const pids = uniqueNumbers(rawPids);
    return {
      rootPid: numericPid,
      pids,
      processes,
      // A shell can exit while a descendant keeps doing the actual work. The
      // supervisor therefore considers the tree alive while any PID remains.
      alive: pids.length > 0,
      cpuTimeMs: processes.reduce((sum, item) => sum + item.cpuTimeMs, 0),
      rssBytes: processes.reduce((sum, item) => sum + item.rssBytes, 0),
      source: "powershell",
      platform,
    };
  } catch {
    let alive = false;
    try { process.kill(numericPid, 0); alive = true; } catch { /* exited or inaccessible */ }
    return { rootPid: numericPid, pids: alive ? [numericPid] : [], processes: [], alive, cpuTimeMs: 0, rssBytes: 0, source: "fallback", platform };
  }
}

async function sampleProcessTree(rootPid, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== "win32") {
    try { return sampleLinuxTree(rootPid, options.fsImpl || fs); } catch { /* use the platform-neutral fallback */ }
  }
  return sampleWindowsTree(rootPid, options);
}

module.exports = { sampleProcessTree, sampleLinuxTree, sampleWindowsTree };
