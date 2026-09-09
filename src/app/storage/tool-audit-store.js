"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { redactStructuredValue } = require("../../shared/secret-redaction.js");

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }

function createToolAuditStore({ pathImpl = path } = {}) {
  const tails = new Map();
  const memory = new Map();
  function fileFor(workspace) { return pathImpl.join(pathImpl.resolve(workspace), ".xekute", "audit", "tool-invocations.jsonl"); }
  function previousHash(file) {
    if (tails.has(file)) return tails.get(file);
    const records = memory.get(file) || [];
    const value = String(records.at(-1)?.integrityHash || "");
    tails.set(file, value);
    return value;
  }
  function append(workspace, event) {
    if (!workspace) return { reference: "", integrityHash: "" };
    const file = fileFor(workspace);
    const safe = redactStructuredValue(event);
    const prior = previousHash(file);
    const body = { ...safe, previousHash: prior };
    const integrityHash = hash(JSON.stringify(body));
    const record = { ...body, integrityHash };
    const records = memory.get(file) || [];
    records.push(record);
    memory.set(file, records);
    tails.set(file, integrityHash);
    return { reference: `${pathImpl.relative(workspace, file).replace(/\\/g, "/")}#${integrityHash.slice(0, 16)}`, integrityHash };
  }
  function verify(workspace) {
    const file = fileFor(workspace);
    const records = memory.get(file) || [];
    let prior = "";
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || typeof record !== "object") return { ok: false, code: "AUDIT_RECORD_INVALID", record: index + 1, records: records.length, tailHash: prior };
      const { integrityHash, ...body } = record;
      const calculated = hash(JSON.stringify(body));
      if (body.previousHash !== prior || integrityHash !== calculated) {
        return { ok: false, code: "AUDIT_INTEGRITY_FAILED", record: index + 1, records: records.length, tailHash: prior };
      }
      prior = integrityHash;
    }
    return { ok: true, records: records.length, tailHash: prior };
  }
  return { append, fileFor, verify };
}

module.exports = { createToolAuditStore };
