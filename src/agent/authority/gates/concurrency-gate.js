"use strict";

const { allow, gate } = require("./gate-utils.js");

function resourceClaims({ context, toolName, args = {}, state } = {}) {
  const workspace = String(context?.workspace?.root || "").toLowerCase();
  const operation = String(args.operation || args.action || "").toLowerCase();
  if (toolName === "exec_command" && ["status", "list"].includes(operation)) return [];
  const mutating = Boolean(state?.risk?.dimensions?.some((item) => item.id === "mutation"));
  const mode = mutating || ["stop", "delete", "close_page"].includes(operation) ? "write" : "read";
  const claims = [];
  for (const target of state?.normalizedTargets || []) {
    if (target.kind === "file") claims.push({ key: `file:${String(target.value).toLowerCase()}`, mode });
    else if (target.kind === "process") claims.push({ key: `process:${target.value}`, mode: operation === "stop" ? "write" : "read" });
    else if (target.kind === "identity") claims.push({ key: `identity:${workspace}:${String(target.value).toLowerCase()}`, mode });
    else if (target.kind === "browser-page") claims.push({ key: `browser:${workspace}:${String(args.identityId || "anonymous").toLowerCase()}:${String(target.value).toLowerCase()}`, mode: "write" });
  }
  if (!claims.length && toolName === "browser_action") claims.push({ key: `browser:${workspace}:${String(args.identityId || "anonymous").toLowerCase()}:${String(args.pageId || "main").toLowerCase()}`, mode: "write" });
  if (!claims.length && mutating) claims.push({ key: `workspace:${workspace}`, mode: "write" });
  const unique = new Map();
  for (const claim of claims) {
    const current = unique.get(claim.key);
    if (!current || claim.mode === "write") unique.set(claim.key, claim);
  }
  return [...unique.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function createConcurrencyCoordinator({ pollMs = 25 } = {}) {
  const resources = new Map();
  const stateFor = (key) => resources.get(key) || { writer: null, readers: new Map() };
  function canAcquire(claims, invocationId) {
    return claims.every((claim) => {
      const current = stateFor(claim.key);
      if (claim.mode === "read") return !current.writer || current.writer.invocationId === invocationId;
      return (!current.writer || current.writer.invocationId === invocationId)
        && [...current.readers.keys()].every((owner) => owner === invocationId);
    });
  }
  function commit(claims, invocationId) {
    const acquiredAt = Date.now();
    for (const claim of claims) {
      const current = stateFor(claim.key);
      if (claim.mode === "write") current.writer = { invocationId, acquiredAt };
      else current.readers.set(invocationId, { invocationId, acquiredAt });
      resources.set(claim.key, current);
    }
    return { claims, invocationId, acquiredAt };
  }
  async function acquireMany(claims = [], invocationId, signal, onQueued = null) {
    if (!claims.length) return { claims: [], invocationId, acquiredAt: Date.now() };
    let queued = false;
    while (!canAcquire(claims, invocationId)) {
      if (signal?.aborted) throw Object.assign(new Error("Invocation cancelled while waiting for a resource lease."), { code: "CONCURRENCY_WAIT_CANCELLED" });
      if (!queued) { queued = true; onQueued?.({ invocationId, claims }); }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return commit(claims, invocationId);
  }
  async function acquire(key, invocationId, signal) { return acquireMany([{ key, mode: "write" }], invocationId, signal); }
  function release(lease) {
    for (const claim of lease?.claims || []) {
      const current = resources.get(claim.key);
      if (!current) continue;
      if (current.writer?.invocationId === lease.invocationId) current.writer = null;
      current.readers.delete(lease.invocationId);
      if (!current.writer && current.readers.size === 0) resources.delete(claim.key);
      else resources.set(claim.key, current);
    }
  }
  function snapshot() {
    return [...resources.entries()].map(([key, value]) => ({ key, writer: value.writer, readers: [...value.readers.values()] }));
  }
  return { acquire, acquireMany, release, snapshot };
}

function createConcurrencyGate() {
  return gate("concurrency_gate", ({ context, toolName, args, state }) => {
    state.concurrencyClaims = resourceClaims({ context, toolName, args, state });
    return allow("concurrency_gate", state.concurrencyClaims.length ? "Reader/writer leases will serialize conflicting resources." : "This invocation does not require an exclusive resource lease.", { claims: state.concurrencyClaims });
  });
}

module.exports = { createConcurrencyCoordinator, createConcurrencyGate, resourceClaims, resourceKey: (input) => resourceClaims(input)[0]?.key || "" };
