"use strict";

const Tunables = require("./tunables.js");

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RECORDS = 24;

function normalizeRecord(raw = {}) {
  const toolName = String(raw.toolName || raw.tool || "").trim();
  const signature = String(raw.signature || "").trim();
  const errorClass = String(raw.errorClass || "").trim();
  if (!toolName || !signature || !errorClass) return null;
  const count = Math.max(1, Number(raw.count) || Tunables.REPEAT_CLASS_LIMIT);
  const recordedAt = String(raw.recordedAt || new Date().toISOString());
  const expiresAt = String(raw.expiresAt || new Date(Date.now() + DEFAULT_TTL_MS).toISOString());
  return { toolName, signature, errorClass, count, recordedAt, expiresAt };
}

function isExpired(record, now = Date.now()) {
  const expiry = Date.parse(record?.expiresAt || "");
  return Number.isFinite(expiry) && expiry <= now;
}

function pruneFailureRecords(records = [], now = Date.now()) {
  return (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter(Boolean)
    .filter((record) => !isExpired(record, now))
    .slice(-MAX_RECORDS);
}

function buildFailureRecord({ toolName, signature, errorClass, count = Tunables.REPEAT_CLASS_LIMIT, ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!toolName || !signature || !errorClass || count < Tunables.REPEAT_CLASS_LIMIT) return null;
  const now = Date.now();
  return normalizeRecord({
    toolName,
    signature,
    errorClass,
    count,
    recordedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  });
}

module.exports = Object.freeze({ DEFAULT_TTL_MS, MAX_RECORDS, buildFailureRecord, isExpired, normalizeRecord, pruneFailureRecords });
