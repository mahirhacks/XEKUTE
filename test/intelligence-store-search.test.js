"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../src/app/services/assessment/intelligence/intelligence-store.js");

function record(index, label) {
  return {
    entities: [{ id: `ent-${index % 5}`, type: "host", key: `k${index % 5}`, label, summary: `host ${label}`, data: { index } }],
    observations: [{ id: `obs-${index % 3}`, key: `o${index % 3}`, summary: `seen ${label}`, data: {} }],
    evidence: { id: `ev-${index}`, type: "traffic", sourcePath: "traffic/raw.jsonl", sourceOffset: index, sourceLength: 1, sourceHash: "h", summary: `evidence ${label}`, sanitized: { index } },
    relationships: [],
  };
}

test("re-indexed records keep exactly one current search row each", () => {
  const db = Store.openDatabase(":memory:");
  try {
    Store.transaction(db, () => { for (let i = 0; i < 50; i += 1) Store.insertNormalized(db, record(i, `alpha${i}`)); });
    Store.transaction(db, () => { for (let i = 0; i < 50; i += 1) Store.insertNormalized(db, record(i, `beta${i}`)); });
    const count = (sql, ...args) => db.prepare(sql).get(...args).n;
    const records = 5 + 3 + 50;
    assert.equal(count("SELECT COUNT(*) AS n FROM search_index"), records);
    assert.equal(count("SELECT COUNT(DISTINCT record_id) AS n FROM search_index"), records);
    assert.equal(count("SELECT COUNT(*) AS n FROM search_index WHERE search_index MATCH ?", "alpha0"), 0);
    assert.ok(count("SELECT COUNT(*) AS n FROM search_index WHERE search_index MATCH ?", "beta49") > 0);
  } finally {
    db.close();
  }
});
