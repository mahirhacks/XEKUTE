"use strict";

/**
 * ScopePort
 *
 * Dependency-free contract for scope/authorization rules. The domain scope
 * engine implements the pure matching rules; concrete DNS/address resolution is
 * injected through the resolver seam so domain logic stays unit-testable and
 * never depends on a specific network implementation.
 *
 * All functions return plain objects. Error results use `{ ok:false, code,
 * reason }`; success uses `{ ok:true, ... }`.
 */

/**
 * @typedef {Object} CanonicalTarget
 * @property {string} raw
 * @property {string} scheme
 * @property {string} hostname
 * @property {number} port
 * @property {string} path
 * @property {boolean} isIp
 */

/**
 * @typedef {Object} ResolverSeam
 * @property {(hostname: string, options?: {all?: boolean, verbatim?: boolean}) => Promise<Array<{address:string}>>} lookup
 *   DNS/address lookup. Implementers may substitute a deterministic fake for tests.
 */

const ScopePort = Object.freeze({
  normalizeHostname(value) { return value; },
  canonicalTarget(raw) { return null; },
  isPrivateOrReservedIp(ip) { return true; },
  resolveTargetAddresses(rawTarget, resolverSeam) { return Promise.resolve({ ok: false, code: "UNIMPLEMENTED", reason: "ScopePort.resolveTargetAddresses must be injected" }); },
  compareResolution(expected, actual) { return { ok: false, code: "UNIMPLEMENTED", reason: "ScopePort.compareResolution must be injected" }; },
  evaluateTarget(rawTarget, options) { return { known: false, allowed: false, code: "UNIMPLEMENTED", reason: "ScopePort.evaluateTarget must be injected" }; },
  extractCommandTargets(command) { return []; },
  testingWindowAllows(windows, options) { return { allowed: false, code: "UNIMPLEMENTED", reason: "ScopePort.testingWindowAllows must be injected" }; },
  /** @returns {ResolverSeam} default resolver seam backed by node:dns */
  defaultResolver() { throw new Error("ScopePort.defaultResolver must be injected"); },
});

module.exports = ScopePort;
