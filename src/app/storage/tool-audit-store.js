"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { redactStructuredValue } = require("../../shared/secret-redaction.js");

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }

function createToolAuditStore({ fsImpl = fs, pathImpl = path } = {}) {
  const tails = new Map();
  function fileFor(workspace) { return pathImpl.join(pathImpl.resolve(workspace), ".xekute", "audit", "tool-invocations.jsonl"); }
  function previousHash(file) {
    if (tails.has(file)) return tails.get(file);
    try {
      const content = fsImpl.readFileSync(file, "utf8").trim();
      const last = content ? JSON.parse(content.split(/\r?\n/).at(-1)) : null;
      const value = String(last?.integrityHash || "");
      tails.set(file, value);
      return value;
    } catch { tails.set(file, ""); return ""; }
  }
  function append(workspace, event) {
    if (!workspace) return { reference: "", integrityHash: "" };
    const file = fileFor(workspace);
    fsImpl.mkdirSync(pathImpl.dirname(file), { recursive: true, mode: 0o700 });
    const safe = redactStructuredValue(event);
    const prior = previousHash(file);
    const body = { ...safe, previousHash: prior };
    const integrityHash = hash(JSON.stringify(body));
    const record = { ...body, integrityHash };
    fsImpl.appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    try { fsImpl.chmodSync(file, 0o600); } catch { /* Windows ACLs protect user/workspace data. */ }
    tails.set(file, integrityHash);
    return { reference: `${pathImpl.relative(workspace, file).replace(/\\/g, "/")}#${integrityHash.slice(0, 16)}`, integrityHash };
  }
  function verify(workspace) {
    const file = fileFor(workspace);
    let lines;
    try { lines = fsImpl.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean); }
    catch (error) {
      if (error?.code === "ENOENT") return { ok: true, records: 0, tailHash: "" };
      return { ok: false, code: "AUDIT_READ_FAILED", reason: error.message, records: 0, tailHash: "" };
    }
    let prior = "";
    for (let index = 0; index < lines.length; index += 1) {
      let record;
      try { record = JSON.parse(lines[index]); }
      catch { return { ok: false, code: "AUDIT_RECORD_INVALID", record: index + 1, records: lines.length, tailHash: prior }; }
      const { integrityHash, ...body } = record;
      const calculated = hash(JSON.stringify(body));
      if (body.previousHash !== prior || integrityHash !== calculated) {
        return { ok: false, code: "AUDIT_INTEGRITY_FAILED", record: index + 1, records: lines.length, tailHash: prior };
      }
      prior = integrityHash;
    }
    return { ok: true, records: lines.length, tailHash: prior };
  }
  return { append, fileFor, verify };
}

module.exports = { createToolAuditStore };
