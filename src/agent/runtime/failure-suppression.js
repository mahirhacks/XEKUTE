"use strict";

function createFailureSuppressor({ repeatLimit = 1 } = {}) {
  const seen = new Set();
  const failures = new Map();
  return {
    seen,
    failures,
    duplicate(signature) { return seen.has(String(signature || "")); },
    mark(signature) { seen.add(String(signature || "")); },
    repeated(signature) { return (failures.get(String(signature || "")) || 0) >= Math.max(1, Number(repeatLimit) || 1); },
    recordFailure(signature) {
      const key = String(signature || "");
      const count = (failures.get(key) || 0) + 1;
      failures.set(key, count);
      return count;
    },
  };
}

module.exports = { createFailureSuppressor };
