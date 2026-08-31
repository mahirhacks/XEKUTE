"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
let nodeSqlite = null;
try { nodeSqlite = require("node:sqlite"); } catch { /* Electron builds without node:sqlite use the in-memory projection. */ }
const { assertMemoryId, canonicalKeyHash, isMemoryId } = require("../../../contracts/memory/index.js");
const { getDefaultMemorySchemaRegistry } = require("../../../contracts/memory/schema-registry.js");
const { assertNoSecretValues, clone, ensureDirectory, operationFailure, timestamp } = require("../../storage/memory/memory-storage-utils.js");

const SCORING_VERSION = "v3.0";
const KNOWLEDGE_CHUNK_MAX_TOKENS = 384;
const KNOWLEDGE_CHUNK_OVERLAP_TOKENS = 48;
const KNOWLEDGE_TOKEN_BYTES = 4;
const SHA256 = /^[a-f0-9]{64}$/i;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const MEMORY_SOURCE_PREFIXES = ["entity", "claim", "rel", "procedure", "attempt", "finding", "verification", "artifact", "kb", "event", "block", "op"];

function normalizeKnowledgeChunkText(value) { return String(value == null ? "" : value).replace(/[\u0000\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 20_000); }
function estimateKnowledgeChunkTokens(value) { return Math.max(1, Math.ceil(Buffer.byteLength(String(value || ""), "utf8") / KNOWLEDGE_TOKEN_BYTES)); }
function splitKnowledgeChunkText(value) {
  const text = normalizeKnowledgeChunkText(value);
  if (!text) return [];
  if (estimateKnowledgeChunkTokens(text) <= KNOWLEDGE_CHUNK_MAX_TOKENS) return [{ text, token_count: estimateKnowledgeChunkTokens(text), part: 0 }];
  const words = text.split(" ");
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    let end = start;
    let candidate = "";
    while (end < words.length) {
      const next = candidate ? candidate + " " + words[end] : words[end];
      if (candidate && estimateKnowledgeChunkTokens(next) > KNOWLEDGE_CHUNK_MAX_TOKENS) break;
      candidate = next;
      end += 1;
      if (end === start + 1 && estimateKnowledgeChunkTokens(candidate) > KNOWLEDGE_CHUNK_MAX_TOKENS) { candidate = ""; end = start; break; }
    }
    if (!candidate) {
      const maxBytes = KNOWLEDGE_CHUNK_MAX_TOKENS * KNOWLEDGE_TOKEN_BYTES;
      const raw = words[start] || "";
      candidate = raw.slice(0, maxBytes);
      words[start] = raw.slice(candidate.length);
      if (!words[start]) start += 1;
      chunks.push({ text: candidate, token_count: estimateKnowledgeChunkTokens(candidate), part: chunks.length });
      continue;
    }
    chunks.push({ text: candidate, token_count: estimateKnowledgeChunkTokens(candidate), part: chunks.length });
    if (end >= words.length) break;
    let overlap = "";
    for (let index = end - 1; index >= start; index -= 1) {
      const next = overlap ? words[index] + " " + overlap : words[index];
      if (estimateKnowledgeChunkTokens(next) > KNOWLEDGE_CHUNK_OVERLAP_TOKENS) break;
      overlap = next;
    }
    const overlapWords = overlap ? overlap.split(" ").length : 0;
    start = Math.max(start + 1, end - overlapWords);
  }
  return chunks;
}
// Chunk identities belong to the source content, not to the procedure that
// happens to reference it.  Keeping the procedure out of this hash makes the
// IDs produced by the KAG projection identical to the IDs persisted by the
// knowledge-package validator, so every Investigation source link resolves
// back to an indexed chunk (and shared source text can be de-duplicated).
function knowledgeChunkId(text, sourceRef, part = 0) { return "kb_" + canonicalKeyHash({ text, source_ref: sourceRef, part, policy: "bge384-overlap48-v1" }).slice(0, 48); }
function isMemorySourceRef(value) {
  const text = String(value || "");
  return MEMORY_SOURCE_PREFIXES.some((prefix) => isMemoryId(text, prefix));
}

function createNativeKagService({ knowledgeStore = null, cacheDirectory = "", embeddingProvider = null, solver = null, schemaRegistry = null, fs = nodeFs, path = nodePath, crypto = nodeCrypto, now = () => new Date() } = {}) {
  if (!fs || !path) throw new TypeError("Native KAG requires filesystem dependencies.");
  const releases = new Map();
  const projectIndexes = new Map();
  const schemas = schemaRegistry || getDefaultMemorySchemaRegistry();
  let knowledgeSyncAt = 0;
  let knowledgeSyncFingerprint = "";
  const sqliteAvailable = typeof nodeSqlite?.DatabaseSync === "function";

  function validateKagInputs(projectId, states = {}, query = "") {
    const entries = [
      ["Project", states.projectState || {}],
      ["Investigation", states.investigationState || {}],
      ["Evidence", states.evidenceState || {}],
      ["query", query],
    ];
    for (const [label, value] of entries) {
      try { assertNoSecretValues(value); } catch (error) {
        return operationFailure(error.code || "MEMORY_KAG_SECRET", `The KAG ${label} input contains a protected value and cannot be processed.`);
      }
    }
    for (const [label, value] of entries.slice(0, 3)) {
      if (value?.project_id && value.project_id !== projectId) return operationFailure("MEMORY_PROJECT_ID_CONFLICT", `The KAG ${label} state does not belong to the requested project.`);
    }
    return null;
  }

  function normalizeText(value) { return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9_:.\-/ ]/g, " ").replace(/\s+/g, " ").trim(); }
  function projectCacheDirectory(projectId) {
    const id = assertMemoryId(projectId, "proj");
    return path.join(path.resolve(String(cacheDirectory || path.join(process.cwd(), ".xekute", "memory", "v3-cache"))), "projects", id);
  }
  function cacheRoot() {
    // Expose only the validated derived-cache root for diagnostics/reset
    // plumbing.  Callers still derive a project directory through the typed
    // project ID above; no arbitrary filesystem path is accepted.
    return path.resolve(String(cacheDirectory || path.join(process.cwd(), ".xekute", "memory", "v3-cache")));
  }
  function cacheFile(projectId) { return path.join(projectCacheDirectory(projectId), "index.sqlite"); }
  function vectorBlob(vector) {
    if (!vector || typeof vector.length !== "number" || !vector.length) return null;
    try {
      const values = Float32Array.from(Array.from(vector, (value) => Number(value) || 0));
      return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    } catch { return null; }
  }
  function vectorFromBlob(value) {
    if (!value) return null;
    try {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (!buffer.byteLength || buffer.byteLength % 4 !== 0) return null;
      return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4));
    } catch { return null; }
  }
  function sourceRefsFor(value) {
    return Array.isArray(value?.provenance?.source_refs)
      ? value.provenance.source_refs.filter((ref) => isMemoryId(ref, "entity") || isMemoryId(ref, "claim") || isMemoryId(ref, "rel") || isMemoryId(ref, "procedure") || isMemoryId(ref, "attempt") || isMemoryId(ref, "finding") || isMemoryId(ref, "verification") || isMemoryId(ref, "artifact") || isMemoryId(ref, "kb") || isMemoryId(ref, "event") || isMemoryId(ref, "block") || isMemoryId(ref, "op")).slice(0, 100)
      : [];
  }
  function projectionRecords(projectState = {}, investigationState = {}, evidenceState = {}) {
    const records = [];
    const add = (domain, revision, recordId, payload) => {
      const id = String(recordId || "").trim();
      if (!id || !payload || typeof payload !== "object") return;
      try {
        assertNoSecretValues(payload);
        const safePayload = clone(payload);
        records.push({ record_id: id, domain, revision: Number.isInteger(Number(revision)) ? Number(revision) : 0, source_hash: canonicalKeyHash(safePayload), payload: safePayload });
      } catch { /* an invalid/secret row cannot enter the derived cache */ }
    };
    for (const entity of Array.isArray(projectState.entities) ? projectState.entities : []) add("project", projectState.revision, entity.record_id, entity);
    for (const claim of Array.isArray(projectState.claims) ? projectState.claims : []) add("project", projectState.revision, claim.record_id, claim);
    for (const relationship of Array.isArray(projectState.relationships) ? projectState.relationships : []) add("project", projectState.revision, relationship.record_id, relationship);
    for (const conflict of Array.isArray(projectState.conflicts) ? projectState.conflicts : []) add("project", projectState.revision, conflict.conflict_id, conflict);
    for (const procedure of Array.isArray(investigationState.procedures) ? investigationState.procedures : []) add("investigation", investigationState.revision, procedure.procedure_id, procedure);
    for (const coverage of Array.isArray(investigationState.coverage) ? investigationState.coverage : []) add("investigation", investigationState.revision, `coverage_${canonicalKeyHash(coverage).slice(0, 32)}`, coverage);
    for (const attempt of Array.isArray(investigationState.attempts) ? investigationState.attempts : []) add("investigation", investigationState.revision, attempt.record_id, attempt);
    for (const assignment of Array.isArray(investigationState.assignments) ? investigationState.assignments : []) add("investigation", investigationState.revision, assignment.assignment_id, assignment);
    for (const candidate of Array.isArray(investigationState.candidates) ? investigationState.candidates : []) add("investigation", investigationState.revision, candidate.record_id, candidate);
    for (const blocker of Array.isArray(investigationState.blockers) ? investigationState.blockers : []) add("investigation", investigationState.revision, blocker.record_id, blocker);
    for (const finding of Array.isArray(evidenceState.findings) ? evidenceState.findings : []) add("evidence", evidenceState.revision, finding.version_id, finding);
    for (const event of Array.isArray(evidenceState.events) ? evidenceState.events : []) add("evidence", evidenceState.revision, event.event_id, event);
    return records;
  }
  function projectionGraph(projectState = {}, investigationState = {}) {
    const nodes = [];
    const edges = [];
    const aliases = [];
    const entityIds = new Set((Array.isArray(projectState.entities) ? projectState.entities : [])
      .map((entity) => String(entity?.record_id || "").trim())
      .filter(Boolean));
    for (const entity of Array.isArray(projectState.entities) ? projectState.entities : []) {
      const nodeId = String(entity.record_id || "").trim();
      if (!nodeId) continue;
      nodes.push({ node_id: nodeId, node_type: String(entity.entity_type || "entity").slice(0, 120), label: String(entity.label || entity.canonical_key || nodeId).slice(0, 500), source_refs: sourceRefsFor(entity) });
      for (const alias of Array.isArray(entity.aliases) ? entity.aliases : []) {
        const normalized = normalizeText(alias);
        if (normalized) aliases.push({ alias: normalized.slice(0, 500), node_id: nodeId });
      }
    }
    for (const relationship of Array.isArray(projectState.relationships) ? projectState.relationships : []) {
      const edgeId = String(relationship.record_id || "").trim();
      const subjectId = String(relationship.subject_ref || "").trim();
      const objectId = String(relationship.object_ref || "").trim();
      // Canonical Project reducers reject dangling relationships, but the
      // projection is also directly usable by tests/recovery tooling.  Do
      // not let malformed input create an edge that cannot be traversed from
      // the projected entity graph or inflate SQLite edge counts.
      if (!edgeId || !subjectId || !objectId || !entityIds.has(subjectId) || !entityIds.has(objectId)) continue;
      edges.push({ edge_id: edgeId, subject_id: subjectId, predicate: String(relationship.predicate || "").slice(0, 240), object_id: objectId, source_refs: sourceRefsFor(relationship) });
    }
    for (const procedure of Array.isArray(investigationState.procedures) ? investigationState.procedures : []) {
      const nodeId = String(procedure.procedure_id || "").trim();
      if (!nodeId) continue;
      nodes.push({ node_id: nodeId, node_type: "procedure", label: nodeId, source_refs: Array.isArray(procedure.chunk_refs) ? procedure.chunk_refs.filter((ref) => isMemoryId(ref, "kb")).slice(0, 100) : [] });
    }
    return { nodes, edges, aliases };
  }
  function persistSqliteProjection(file, index) {
    if (!sqliteAvailable || typeof fs.renameSync !== "function") return false;
    const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
    let database = null;
    try {
      ensureDirectory(fs, path, path.dirname(file));
      database = new nodeSqlite.DatabaseSync(temporary);
      database.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
      database.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE chunks (
          chunk_id TEXT PRIMARY KEY,
          procedure_id TEXT NOT NULL,
          release_id TEXT NOT NULL,
          procedure_hash TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          text TEXT NOT NULL,
          source_refs TEXT NOT NULL
        );
        CREATE INDEX chunks_procedure_idx ON chunks(procedure_id);
        CREATE INDEX chunks_release_idx ON chunks(release_id);
        CREATE TABLE records (
          record_id TEXT PRIMARY KEY,
          domain TEXT NOT NULL,
          revision INTEGER NOT NULL,
          source_hash TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        CREATE TABLE vectors (
          chunk_id TEXT PRIMARY KEY,
          model TEXT NOT NULL,
          dimension INTEGER NOT NULL,
          vector BLOB NOT NULL
        );
        CREATE TABLE nodes (
          node_id TEXT PRIMARY KEY,
          node_type TEXT NOT NULL,
          label TEXT NOT NULL,
          source_refs TEXT NOT NULL
        );
        CREATE TABLE edges (
          edge_id TEXT PRIMARY KEY,
          subject_id TEXT NOT NULL,
          predicate TEXT NOT NULL,
          object_id TEXT NOT NULL,
          source_refs TEXT NOT NULL
        );
        CREATE TABLE aliases (
          alias TEXT NOT NULL,
          node_id TEXT NOT NULL,
          PRIMARY KEY(alias, node_id)
        );
      `);
      try { database.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(chunk_id UNINDEXED, text, procedure_id, release_id);"); } catch { /* FTS5 is optional; exact in-memory retrieval remains authoritative. */ }
      const metadata = database.prepare("INSERT INTO metadata(key,value) VALUES(?,?)");
      const metadataValues = {
        schema_version: 3,
        project_id: index.project_id,
        scoring_version: index.scoring_version,
        model: index.model,
        embedding_dimension: String(Number(index.embedding_dimension || 0)),
        knowledge_fingerprint: String(index.knowledge_fingerprint || ""),
        source_revisions: JSON.stringify(index.source_revisions || {}),
        chunk_count: String(index.chunks?.length || 0),
        record_count: String(index.records?.length || 0),
        node_count: String(index.nodes?.length || 0),
        edge_count: String(index.edges?.length || 0),
        alias_count: String(index.aliases?.length || 0),
        vector_count: String(index.semantic_vectors?.size || 0),
        built_at: index.built_at,
      };
      database.exec("BEGIN IMMEDIATE");
      for (const [key, value] of Object.entries(metadataValues)) metadata.run(key, String(value));
      const insert = database.prepare("INSERT INTO chunks(chunk_id,procedure_id,release_id,procedure_hash,content_hash,text,source_refs) VALUES(?,?,?,?,?,?,?)");
      const insertRecord = database.prepare("INSERT INTO records(record_id,domain,revision,source_hash,payload) VALUES(?,?,?,?,?)");
      const insertNode = database.prepare("INSERT INTO nodes(node_id,node_type,label,source_refs) VALUES(?,?,?,?)");
      const insertEdge = database.prepare("INSERT INTO edges(edge_id,subject_id,predicate,object_id,source_refs) VALUES(?,?,?,?,?)");
      const insertAlias = database.prepare("INSERT OR IGNORE INTO aliases(alias,node_id) VALUES(?,?)");
      const insertVector = database.prepare("INSERT OR REPLACE INTO vectors(chunk_id,model,dimension,vector) VALUES(?,?,?,?)");
      let ftsInsert = null;
      try { ftsInsert = database.prepare("INSERT INTO chunks_fts(chunk_id,text,procedure_id,release_id) VALUES(?,?,?,?)"); } catch { /* optional */ }
      let recordsFtsInsert = null;
      try { database.exec("CREATE VIRTUAL TABLE records_fts USING fts5(record_id UNINDEXED, domain, text);"); recordsFtsInsert = database.prepare("INSERT INTO records_fts(record_id,domain,text) VALUES(?,?,?)"); } catch { /* optional */ }
      for (const chunk of index.chunks || []) {
        insert.run(String(chunk.chunk_id), String(chunk.procedure_id), String(chunk.release_id), String(chunk.procedure_hash), String(chunk.content_hash), String(chunk.text || ""), JSON.stringify(chunk.source_refs || []));
        ftsInsert?.run(String(chunk.chunk_id), String(chunk.text || ""), String(chunk.procedure_id), String(chunk.release_id));
      }
      for (const record of index.records || []) {
        insertRecord.run(String(record.record_id), String(record.domain || "project"), Number(record.revision || 0), String(record.source_hash || canonicalKeyHash(record.payload || {})), JSON.stringify(record.payload || {}));
        recordsFtsInsert?.run(String(record.record_id), String(record.domain || "project"), JSON.stringify(record.payload || {}));
      }
      for (const node of index.nodes || []) insertNode.run(String(node.node_id), String(node.node_type || "entity"), String(node.label || node.node_id), JSON.stringify(node.source_refs || []));
      for (const edge of index.edges || []) insertEdge.run(String(edge.edge_id), String(edge.subject_id), String(edge.predicate || ""), String(edge.object_id), JSON.stringify(edge.source_refs || []));
      for (const alias of index.aliases || []) insertAlias.run(String(alias.alias), String(alias.node_id));
      if (index.semantic_vectors && typeof index.semantic_vectors.entries === "function") {
        for (const [chunkId, vector] of index.semantic_vectors.entries()) {
          const blob = vectorBlob(vector);
          if (blob) insertVector.run(String(chunkId), String(index.model || ""), Number(vector.length || index.embedding_dimension || 0), blob);
        }
      }
      database.exec("COMMIT");
      database.close(); database = null;
      // The projection is disposable and rebuilt from canonical state, so a
      // prior cache may be replaced safely on platforms where rename refuses
      // to overwrite an existing destination (notably Windows).
      try { fs.rmSync(file, { force: true }); } catch { /* destination may not exist */ }
      fs.renameSync(temporary, file);
      return true;
    } catch {
      try { database?.exec("ROLLBACK"); } catch { /* best effort */ }
      try { database?.close(); } catch { /* best effort */ }
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
      return false;
    }
  }
  function persistSqliteVectors(file, index) {
    if (!sqliteAvailable || !file || !index?.semantic_vectors || typeof index.semantic_vectors.entries !== "function") return false;
    let database = null;
    try {
      database = new nodeSqlite.DatabaseSync(file);
      database.exec("BEGIN IMMEDIATE");
      const insert = database.prepare("INSERT OR REPLACE INTO vectors(chunk_id,model,dimension,vector) VALUES(?,?,?,?)");
      let count = 0;
      for (const [chunkId, vector] of index.semantic_vectors.entries()) {
        const blob = vectorBlob(vector);
        if (!blob || !isMemoryId(chunkId, "kb")) continue;
        insert.run(String(chunkId), String(index.model || ""), Number(vector.length || index.embedding_dimension || 0), blob);
        count += 1;
      }
      try { database.prepare("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)").run("vector_count", String(count)); } catch { /* projection may be an older disposable cache */ }
      database.exec("COMMIT");
      database.close();
      return true;
    } catch {
      try { database?.exec("ROLLBACK"); } catch { /* best effort */ }
      try { database?.close(); } catch { /* best effort */ }
      return false;
    }
  }
  function readSqliteProjection(file, projectId, sourceRevisions, knowledgeFingerprint) {
    if (!sqliteAvailable || !file || typeof fs.existsSync !== "function" || !fs.existsSync(file)) return null;
    let database = null;
    const close = () => {
      try { database?.close(); } catch { /* best effort */ }
      database = null;
    };
    const invalid = () => { close(); return null; };
    try {
      database = new nodeSqlite.DatabaseSync(file, { readOnly: true });
      const metadataRows = database.prepare("SELECT key,value FROM metadata").all();
      const metadata = Object.fromEntries(metadataRows.map((row) => [String(row.key), String(row.value)]));
      if (Number(metadata.schema_version) !== 3 || metadata.project_id !== projectId || metadata.scoring_version !== SCORING_VERSION) { close(); return null; }
      if (metadata.model !== String(embeddingProvider?.model || "none")) { close(); return null; }
      const cachedRevisions = JSON.parse(metadata.source_revisions || "{}");
      for (const domain of ["project", "investigation", "evidence"]) if (Number(cachedRevisions?.[domain] || 0) !== Number(sourceRevisions?.[domain] || 0)) { close(); return null; }
      if (knowledgeFingerprint && metadata.knowledge_fingerprint !== knowledgeFingerprint) { close(); return null; }
      const chunks = database.prepare("SELECT chunk_id,procedure_id,release_id,procedure_hash,content_hash,text,source_refs FROM chunks ORDER BY chunk_id").all().map((row) => ({
        chunk_id: String(row.chunk_id), procedure_id: String(row.procedure_id), release_id: String(row.release_id), procedure_hash: String(row.procedure_hash), content_hash: String(row.content_hash), text: String(row.text || ""), source_refs: JSON.parse(String(row.source_refs || "[]")), token_count: estimateKnowledgeChunkTokens(row.text), searchable: normalizeText(`${row.text} ${row.procedure_id} ${row.release_id}`),
      }));
      const records = database.prepare("SELECT record_id,domain,revision,source_hash,payload FROM records ORDER BY record_id").all().map((row) => ({ record_id: String(row.record_id), domain: String(row.domain), revision: Number(row.revision || 0), source_hash: String(row.source_hash), payload: JSON.parse(String(row.payload || "{}")) }));
      const nodes = database.prepare("SELECT node_id,node_type,label,source_refs FROM nodes ORDER BY node_id").all().map((row) => ({ node_id: String(row.node_id), node_type: String(row.node_type), label: String(row.label), source_refs: JSON.parse(String(row.source_refs || "[]")) }));
      const edges = database.prepare("SELECT edge_id,subject_id,predicate,object_id,source_refs FROM edges ORDER BY edge_id").all().map((row) => ({ edge_id: String(row.edge_id), subject_id: String(row.subject_id), predicate: String(row.predicate), object_id: String(row.object_id), source_refs: JSON.parse(String(row.source_refs || "[]")) }));
      const aliases = database.prepare("SELECT alias,node_id FROM aliases ORDER BY alias,node_id").all().map((row) => ({ alias: String(row.alias), node_id: String(row.node_id) }));
      const semanticVectors = new Map();
      for (const row of database.prepare("SELECT chunk_id,vector FROM vectors ORDER BY chunk_id").all()) {
        const vector = vectorFromBlob(row.vector);
        if (vector?.length) semanticVectors.set(String(row.chunk_id), vector);
      }
      // The SQLite file is disposable, but it is still an input to retrieval
      // until it is rebuilt.  Treat it as untrusted: a hand-edited/tampered
      // cache must never inject credentials, dangling graph edges, or records
      // from another schema into the active model context.
      const dimension = Number(metadata.embedding_dimension || 0);
      const expectedCounts = {
        chunks: Number(metadata.chunk_count),
        records: Number(metadata.record_count),
        nodes: Number(metadata.node_count),
        edges: Number(metadata.edge_count),
        aliases: Number(metadata.alias_count),
        vectors: Number(metadata.vector_count),
      };
      if (!Number.isInteger(dimension) || dimension < 0 || Object.values(expectedCounts).some((count) => !Number.isInteger(count) || count < 0)) return invalid();
      if (expectedCounts.chunks !== chunks.length || expectedCounts.records !== records.length || expectedCounts.nodes !== nodes.length || expectedCounts.edges !== edges.length || expectedCounts.aliases !== aliases.length || expectedCounts.vectors !== semanticVectors.size) return invalid();
      const chunkIds = new Set();
      for (const chunk of chunks) {
        if (!isMemoryId(chunk.chunk_id, "kb") || chunkIds.has(chunk.chunk_id) || !isMemoryId(chunk.procedure_id, "procedure") || !RELEASE_ID.test(chunk.release_id) || !SHA256.test(chunk.procedure_hash) || !SHA256.test(chunk.content_hash) || !Number.isInteger(chunk.token_count) || chunk.token_count < 1 || chunk.token_count > KNOWLEDGE_CHUNK_MAX_TOKENS || !Array.isArray(chunk.source_refs) || chunk.source_refs.length > 100 || chunk.source_refs.some((ref) => !isMemoryId(ref, "kb"))) return invalid();
        chunkIds.add(chunk.chunk_id);
      }
      const validDomains = new Set(["project", "investigation", "evidence"]);
      for (const record of records) {
        if (!record.record_id || !validDomains.has(record.domain) || !Number.isInteger(record.revision) || record.revision < 0 || !SHA256.test(record.source_hash) || !record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return invalid();
      }
      const nodeIds = new Set();
      for (const node of nodes) {
        if (!isMemorySourceRef(node.node_id) || nodeIds.has(node.node_id) || !node.node_type || !Array.isArray(node.source_refs) || node.source_refs.length > 100 || node.source_refs.some((ref) => !isMemorySourceRef(ref))) return invalid();
        nodeIds.add(node.node_id);
      }
      for (const edge of edges) {
        if (!isMemorySourceRef(edge.edge_id) || !nodeIds.has(edge.subject_id) || !nodeIds.has(edge.object_id) || !edge.predicate || !Array.isArray(edge.source_refs) || edge.source_refs.length > 100 || edge.source_refs.some((ref) => !isMemorySourceRef(ref))) return invalid();
      }
      for (const alias of aliases) if (!alias.alias || alias.alias.length > 500 || !nodeIds.has(alias.node_id)) return invalid();
      for (const [chunkId, vector] of semanticVectors.entries()) {
        if (!chunkIds.has(chunkId) || !isMemoryId(chunkId, "kb") || !Array.isArray(vector) || (dimension > 0 && vector.length !== dimension) || vector.some((value) => !Number.isFinite(Number(value)))) return invalid();
      }
      try { assertNoSecretValues({ chunks, records, nodes, edges, aliases }); } catch { return invalid(); }
      close();
      return { schema_version: 3, project_id: projectId, scoring_version: SCORING_VERSION, source_revisions: sourceRevisions, knowledge_fingerprint: knowledgeFingerprint, model: String(metadata.model), embedding_dimension: dimension, chunks, records, nodes, edges, aliases, semantic_vectors: semanticVectors, built_at: String(metadata.built_at || "") };
    } catch {
      try { database?.close(); } catch { /* best effort */ }
      return null;
    }
  }
 function chunksForPackage(pkg) {
    const chunks = [];
    const byId = new Map();
    const declaredChunks = new Map((Array.isArray(pkg.chunks) ? pkg.chunks : []).map((chunk) => [String(chunk?.chunk_id || ""), chunk]).filter(([id, chunk]) => isMemoryId(id, "kb") && chunk && String(chunk.text || "").trim()));
    const add = (procedure, raw, sourceRefs, seed = 0) => {
      const sourceRef = String(raw?.source_ref || pkg.source_refs?.[0] || procedure.procedure_id || "knowledge").slice(0, 2_000);
      const pieces = splitKnowledgeChunkText(raw?.text || "");
      pieces.forEach((piece) => {
        const part = Number(seed) + Number(piece.part || 0);
        // KnowledgeProcedureStore has already validated and normalized
        // declared chunk IDs. Preserve those IDs when a package supplies a
        // chunk; generated step chunks use the same content-derived policy.
        const declaredId = piece.part === 0 && isMemoryId(raw?.chunk_id, "kb")
          ? String(raw.chunk_id)
          : knowledgeChunkId(piece.text, sourceRef, part);
        const chunkId = declaredId;
        if (byId.has(chunkId)) return;
        const record = {
          chunk_id: chunkId,
          procedure_id: procedure.procedure_id,
          release_id: pkg.release_id,
          procedure_hash: String(procedure.procedure_hash || canonicalKeyHash(procedure)).toLowerCase(),
          text: piece.text,
          token_count: piece.token_count,
          source_refs: [...new Set([...(raw?.chunk_id ? [String(raw.chunk_id)] : []), ...sourceRefs])].slice(0, 50),
          content_hash: canonicalKeyHash({ text: piece.text, source_ref: sourceRef }),
        };
        byId.set(chunkId, record);
        chunks.push(record);
      });
    };
    for (const procedure of pkg.procedures || []) {
      const sourceRefs = Array.isArray(procedure.source_chunk_refs) ? procedure.source_chunk_refs.filter((ref) => isMemoryId(ref, "kb")) : [];
      const provided = sourceRefs.map((ref) => declaredChunks.get(String(ref))).filter(Boolean);
      provided.forEach((chunk, index) => add(procedure, chunk, sourceRefs, index * 10_000));
      // A validated package normally has generated source chunks for every
      // procedure.  Only synthesize step/title chunks for direct callers that
      // provide an unnormalized package without declared source chunks; this
      // avoids adding duplicate, unlinked projection rows for the normal path.
      const steps = Array.isArray(procedure.steps) ? procedure.steps : [];
      if (!provided.length) {
        steps.forEach((step, index) => {
          const text = typeof step === "string" ? step : step?.instruction || step?.description || JSON.stringify(step);
          add(procedure, { text }, sourceRefs, index * 10_000);
        });
        if (!steps.length) add(procedure, { text: String(procedure.title || "") + " " + String(procedure.objective || "") }, sourceRefs);
      }
    }
    return chunks;
 }
  function installRelease(pkg) {
    if (!pkg || typeof pkg !== "object") return operationFailure("MEMORY_KAG_RELEASE_INVALID", "A KAG release must be an object.");
    try {
      assertNoSecretValues(pkg);
    } catch (error) {
      return operationFailure(error.code || "MEMORY_KAG_SECRET", "The KAG release contains a protected value and cannot be installed.");
    }
    const validation = schemas.validate("KnowledgeProcedurePackageV3", pkg);
    if (!validation.ok) return operationFailure("MEMORY_KAG_RELEASE_INVALID", "The KAG release failed the KnowledgeProcedurePackageV3 contract.", { details: validation.error.details });
    const key = String(pkg.release_id || "");
    if (!RELEASE_ID.test(key) || key === "." || key === "..") return operationFailure("MEMORY_KAG_RELEASE_INVALID", "A bounded knowledge release ID is required.");
    const procedureIds = new Set();
    const incomingHashes = new Map();
    for (const procedure of Array.isArray(pkg.procedures) ? pkg.procedures : []) {
      const procedureId = String(procedure?.procedure_id || "");
      if (!isMemoryId(procedureId, "procedure") || procedureIds.has(procedureId)) return operationFailure("MEMORY_KAG_DUPLICATE_PROCEDURE", "A knowledge release contains a duplicate procedure ID.", { procedureId: procedureId.slice(0, 120) });
      procedureIds.add(procedureId);
      incomingHashes.set(procedureId, canonicalKeyHash(procedure).toLowerCase());
    }
    // Procedure IDs are global in the projection.  Silently letting two
    // releases assign different content to one ID makes source links and
    // solver selections nondeterministic, so reject that collision before
    // replacing the in-memory release map.
    for (const [releaseId, entry] of releases.entries()) {
      if (releaseId === key) continue;
      for (const procedure of entry.package?.procedures || []) {
        const incomingHash = incomingHashes.get(String(procedure?.procedure_id || ""));
        if (incomingHash && incomingHash !== canonicalKeyHash(procedure).toLowerCase()) return operationFailure("MEMORY_KAG_PROCEDURE_ID_COLLISION", "A procedure ID is already installed with different content.", { procedureId: String(procedure.procedure_id).slice(0, 120) });
      }
    }
    const chunks = chunksForPackage(pkg);
    releases.set(key, { package: clone(pkg), chunks });
    return { ok: true, release_id: key, chunk_count: chunks.length, content_hash: pkg.content_hash || canonicalKeyHash(pkg) };
  }
  function syncKnowledge() {
    if (!knowledgeStore?.list || !knowledgeStore?.get) return { ok: true, changed: false, releases: releases.size, source: "memory" };
    try {
      const listed = knowledgeStore.list();
      if (!listed?.ok) return listed;
      const fingerprint = canonicalKeyHash((listed.releases || []).map((entry) => ({ release_id: entry.release_id, content_hash: entry.content_hash, version: entry.version })).sort((a, b) => String(a.release_id).localeCompare(String(b.release_id))));
      const nowMs = new Date(now()).getTime();
      if (fingerprint === knowledgeSyncFingerprint && nowMs - knowledgeSyncAt < 2_000) return { ok: true, changed: false, releases: releases.size, source: "store" };
      const fingerprintChanged = fingerprint !== knowledgeSyncFingerprint;
      let releasesChanged = false;
      const installed = new Set();
      for (const entry of listed.releases || []) {
        const releaseId = String(entry.release_id || "").trim();
        if (!releaseId) continue;
        const loaded = knowledgeStore.get(releaseId);
        if (!loaded?.ok) continue;
        installed.add(releaseId);
        const existing = releases.get(releaseId);
        if (!existing || existing.package?.content_hash !== loaded.package?.content_hash) {
          const installedResult = installRelease(loaded.package);
          if (!installedResult?.ok) return installedResult;
          releasesChanged = true;
        }
      }
      // Deletions/revocations in the local package store must invalidate the
      // disposable projection too; canonical Tier 2 state remains untouched.
      for (const releaseId of releases.keys()) {
        if (!installed.has(releaseId)) {
          releases.delete(releaseId);
          releasesChanged = true;
        }
      }
      // A stable knowledge catalogue must not throw away every project's
      // warm projection merely because the short sync TTL elapsed.  Clear
      // disposable indexes only when the catalogue actually changed.
      if (fingerprintChanged || releasesChanged) projectIndexes.clear();
      knowledgeSyncFingerprint = fingerprint;
      knowledgeSyncAt = nowMs;
      return { ok: true, changed: fingerprintChanged || releasesChanged, releases: releases.size, source: "store" };
    } catch (error) {
      return operationFailure("MEMORY_KAG_KNOWLEDGE_SYNC_FAILED", error.message, {}, true);
    }
  }
  function knowledgeFingerprint() {
    return canonicalKeyHash([...releases.entries()]
      .map(([releaseId, entry]) => ({ release_id: releaseId, content_hash: entry.package?.content_hash || canonicalKeyHash(entry.package || {}) }))
      .sort((left, right) => left.release_id.localeCompare(right.release_id)));
  }
  function rebuildProjectIndex(projectId, projectState = {}, investigationState = {}, evidenceState = {}) {
    let safeProjectId;
    try { safeProjectId = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message); }
    try {
      assertNoSecretValues(projectState);
      assertNoSecretValues(investigationState);
      assertNoSecretValues(evidenceState);
    } catch (error) {
      return operationFailure(error.code || "MEMORY_KAG_SECRET", "The KAG source state contains a protected value and cannot be indexed.");
    }
    const records = [];
    for (const entry of releases.values()) records.push(...entry.chunks.map((chunk) => ({ ...chunk, searchable: normalizeText(`${chunk.text} ${chunk.procedure_id} ${chunk.release_id}`) })));
    const graph = projectionGraph(projectState, investigationState);
    const projectedRecords = projectionRecords(projectState, investigationState, evidenceState);
    const index = {
      schema_version: 3,
      project_id: safeProjectId,
      scoring_version: SCORING_VERSION,
      knowledge_fingerprint: knowledgeFingerprint(),
      source_revisions: {
        project: Number(projectState.revision || 0),
        investigation: Number(investigationState.revision || 0),
        evidence: Number(evidenceState.revision || 0),
      },
      model: embeddingProvider?.model || "none",
      embedding_dimension: Number(embeddingProvider?.dimension || embeddingProvider?.embeddingDimension || 0),
      chunks: records,
      records: projectedRecords,
      nodes: graph.nodes,
      edges: graph.edges,
      aliases: graph.aliases,
      semantic_vectors: new Map(),
      built_at: timestamp(now),
    };
    projectIndexes.set(safeProjectId, index);
    if (cacheDirectory) {
      try {
        const file = cacheFile(safeProjectId);
        if (!persistSqliteProjection(file, index)) {
          // A supported Electron runtime may not expose node:sqlite.  Keep a
          // disposable JSON projection as a compatibility cache, but never
          // make it authoritative; it is rebuilt from canonical V3 state.
          ensureDirectory(fs, path, path.dirname(file));
          fs.writeFileSync(file, JSON.stringify(index), { encoding: "utf8", mode: 0o600 });
        }
      } catch { /* disposable cache; canonical snapshots remain authoritative */ }
    }
    return { ok: true, projectId: safeProjectId, index, path: cacheDirectory ? cacheFile(safeProjectId) : "" };
  }
  function indexProject(projectId, projectState = {}, investigationState = {}, evidenceState = {}) { return rebuildProjectIndex(projectId, projectState, investigationState, evidenceState); }
  function ensureIndex(projectId, projectState = {}, investigationState = {}, evidenceState = {}) {
    let safeProjectId;
    try { safeProjectId = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message); }
    const existing = projectIndexes.get(safeProjectId);
    const requestedRevisions = {
      project: Number(projectState.revision || 0),
      investigation: Number(investigationState.revision || 0),
      evidence: Number(evidenceState.revision || 0),
    };
    const requestedKnowledgeFingerprint = knowledgeFingerprint();
    const sameRevisions = existing?.source_revisions
      && Object.entries(requestedRevisions).every(([domain, revision]) => Number(existing.source_revisions[domain] || 0) === revision);
    if (existing?.chunks && sameRevisions && existing.knowledge_fingerprint === requestedKnowledgeFingerprint) return existing;
    if (!existing && cacheDirectory) {
      const cached = readSqliteProjection(cacheFile(safeProjectId), safeProjectId, requestedRevisions, requestedKnowledgeFingerprint);
      if (cached?.chunks) {
        projectIndexes.set(safeProjectId, cached);
        return cached;
      }
    }
    const rebuilt = rebuildProjectIndex(safeProjectId, projectState, investigationState, evidenceState);
    return rebuilt?.index || rebuilt || { schema_version: 3, project_id: safeProjectId, scoring_version: SCORING_VERSION, source_revisions: requestedRevisions, knowledge_fingerprint: requestedKnowledgeFingerprint, chunks: [], records: [], nodes: [], edges: [], aliases: [], semantic_vectors: new Map() };
  }
  function targetTerms(projectState = {}) {
    const terms = [];
    for (const entity of projectState.entities || []) terms.push(entity.entity_type, entity.canonical_key, entity.label, ...(entity.aliases || []));
    for (const claim of projectState.claims || []) terms.push(claim.predicate, typeof claim.value === "string" ? claim.value : "");
    return [...new Set(terms.map(normalizeText).filter(Boolean))];
  }
  function lexicalSimilarity(query, text) {
    const q = new Set(normalizeText(query).split(" ").filter(Boolean));
    const t = new Set(normalizeText(text).split(" ").filter(Boolean));
    if (!q.size || !t.size) return 0;
    let overlap = 0; for (const word of q) if (t.has(word)) overlap += 1;
    return overlap / Math.sqrt(q.size * t.size);
  }
  async function semanticSimilarity(query, text) {
    if (embeddingProvider?.embed) {
      try {
        const result = await embeddingProvider.embed([query, text], { allowFallback: false });
        if (result?.ok && !result.degraded && result.vectors?.length >= 2) {
          const left = result.vectors[0]; const right = result.vectors[1];
          let score = 0;
          for (let index = 0; index < Math.min(left.length, right.length); index += 1) score += Number(left[index] || 0) * Number(right[index] || 0);
          return Math.max(0, Math.min(1, score));
        }
      } catch { /* lexical/applicability signals remain available */ }
    }
    if (embeddingProvider?.similarity) {
      try { return Math.max(0, Math.min(1, Number(await embeddingProvider.similarity(query, text)) || 0)); } catch { /* lexical fallback */ }
    }
    return 0;
  }
  async function semanticScores(query, chunks, index) {
    const scores = new Array(chunks.length).fill(0);
    if (!chunks.length || !embeddingProvider) return scores;
    // Embed the query once and process procedure chunks in bounded batches.
    // The previous per-chunk [query,text] call multiplied model startup and
    // IPC overhead by the entire corpus, making the 50K-chunk SLA impossible.
    if (typeof embeddingProvider.embed === "function") {
      let queryResult;
      try { queryResult = await embeddingProvider.embed([query], { allowFallback: false }); } catch { queryResult = null; }
      const queryVector = queryResult?.ok && !queryResult.degraded ? queryResult.vectors?.[0] : null;
      if (queryVector?.length) {
        if (!Number(index.embedding_dimension || 0)) index.embedding_dimension = Number(queryVector.length);
        if (!index.semantic_vectors || typeof index.semantic_vectors.get !== "function") index.semantic_vectors = new Map();
        const batchSize = 32;
        for (let start = 0; start < chunks.length; start += batchSize) {
          const pending = [];
          const texts = [];
          for (let offset = start; offset < Math.min(chunks.length, start + batchSize); offset += 1) {
            const cached = index.semantic_vectors.get(chunks[offset].chunk_id);
            if (cached?.length) scores[offset] = cosine(queryVector, cached);
            else { pending.push(offset); texts.push(chunks[offset].searchable || chunks[offset].text || ""); }
          }
          if (!pending.length) continue;
          let result;
          try { result = await embeddingProvider.embed(texts, { allowFallback: false }); } catch { result = null; }
          if (!result?.ok || result.degraded || !Array.isArray(result.vectors)) continue;
          result.vectors.forEach((vector, indexInBatch) => {
            const chunkIndex = pending[indexInBatch];
            if (chunkIndex == null || !vector?.length) return;
            index.semantic_vectors.set(chunks[chunkIndex].chunk_id, vector);
            scores[chunkIndex] = cosine(queryVector, vector);
          });
        }
        if (cacheDirectory) persistSqliteVectors(cacheFile(index.project_id), index);
        return scores;
      }
    }
    // Test doubles and alternate runtimes may expose only pairwise
    // similarity.  Keep that compatibility path bounded and concurrent.
    if (typeof embeddingProvider.similarity === "function") {
      const width = 16;
      for (let start = 0; start < chunks.length; start += width) {
        const batch = chunks.slice(start, start + width);
        const values = await Promise.all(batch.map((chunk) => semanticSimilarity(query, chunk.searchable || chunk.text || "")));
        values.forEach((value, indexInBatch) => { scores[start + indexInBatch] = value; });
      }
    }
    return scores;
  }
  function cosine(left, right) {
    if (!left?.length || !right?.length) return 0;
    let score = 0;
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) score += Number(left[index] || 0) * Number(right[index] || 0);
    return Math.max(0, Math.min(1, score));
  }
  function applicabilityScore(_query, chunk, projectState, targetClass) {
    // Applicability is a target/procedure compatibility signal, not another
    // lexical copy of the user query.  The old implementation checked each
    // target term against the query itself, which made every procedure appear
    // applicable whenever the query mentioned the target.  Keep the query in
    // the lexical/semantic components and derive this component only from the
    // candidate Project facts plus the normalized target class.
    const terms = [...new Set([
      ...targetTerms(projectState).filter(Boolean),
      ...normalizeText(targetClass || "").split(" ").filter(Boolean),
    ])];
    if (!terms.length) return 0;
    const chunkText = normalizeText(`${chunk.text} ${chunk.procedure_id}`);
    const chunkTerms = new Set(chunkText.split(" ").filter(Boolean));
    const matches = terms.reduce((count, term) => count + (chunkTerms.has(term) || chunkText.includes(term) ? 1 : 0), 0);
    return Math.min(1, matches / terms.length);
  }
  function graphRelevance(chunk, projectState) {
    const text = normalizeText(chunk.text);
    const graphTerms = [];
    for (const entity of projectState.entities || []) graphTerms.push(entity.canonical_key, entity.label, ...(entity.aliases || []));
    for (const claim of projectState.claims || []) graphTerms.push(claim.predicate, typeof claim.value === "string" ? claim.value : "");
    const normalized = graphTerms.map(normalizeText).filter(Boolean);
    if (!normalized.length) return 0;
    return normalized.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) / normalized.length;
  }
  function historyRelevance(chunk, investigationState) {
    const procedures = investigationState?.procedures || [];
    const prior = procedures.find((procedure) => procedure.procedure_id === chunk.procedure_id);
    if (!prior) return 0;
    if (prior.state === "completed") return 0.35;
    if (prior.state === "in_progress" || prior.state === "ready") return 0.2;
    if (prior.state === "blocked") return 0.1;
    return 0;
  }
  async function retrieve(projectId, query = "", { limit = 50, projectState = {}, investigationState = {}, evidenceState = {}, mandatoryProcedureIds = [], targetClass = "" } = {}) {
    try { projectId = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message); }
    const invalidInputs = validateKagInputs(projectId, { projectState, investigationState, evidenceState }, query);
    if (invalidInputs) return invalidInputs;
    const synced = syncKnowledge();
    if (!synced.ok) return synced;
    const index = ensureIndex(projectId, projectState, investigationState, evidenceState);
    if (!index?.chunks) return index?.ok === false ? index : operationFailure("MEMORY_KAG_INDEX_INVALID", "The KAG projection could not be built.", {}, true);
    const terms = targetTerms(projectState);
    const candidates = [];
    const semanticScoresByChunk = await semanticScores(query, index.chunks, index);
    for (const [chunkIndex, chunk] of index.chunks.entries()) {
      const lexical = lexicalSimilarity(query, chunk.searchable);
      const semantic = semanticScoresByChunk[chunkIndex] || 0;
      const applicability = applicabilityScore(query, chunk, projectState, targetClass);
      const graph = graphRelevance(chunk, projectState);
      const history = historyRelevance(chunk, investigationState);
      const target = terms.length ? Math.max(...terms.map((term) => normalizeText(chunk.searchable).includes(term) ? 1 : 0), 0) : 0;
      const mandatory = mandatoryProcedureIds.includes(chunk.procedure_id) ? 1 : 0;
      const score = mandatory
        ? 1
        : applicability * 0.30 + semantic * 0.30 + lexical * 0.20 + graph * 0.15 + history * 0.05;
      candidates.push({ ...clone(chunk), scores: { applicability, semantic, lexical, graph, history, target, mandatory }, score });
    }
    candidates.sort((a, b) => b.score - a.score || a.procedure_id.localeCompare(b.procedure_id) || a.chunk_id.localeCompare(b.chunk_id));
    return { ok: true, projectId, query: String(query), records: candidates.slice(0, Math.max(1, Math.min(200, Number(limit) || 50))), source_revision: Number(projectState.revision || 0), scoring_version: SCORING_VERSION, stale: false, projection: { format: sqliteAvailable ? "sqlite" : "fallback", path: cacheDirectory ? cacheFile(projectId) : "" } };
  }
  function health(projectId) {
    const index = projectIndexes.get(projectId);
    return {
      ok: true,
      status: index ? "ready" : "not_built",
      model: embeddingProvider?.model || "none",
      chunkCount: index?.chunks?.length || 0,
      vectorCount: index?.semantic_vectors?.size || 0,
      recordCount: index?.records?.length || 0,
      nodeCount: index?.nodes?.length || 0,
      edgeCount: index?.edges?.length || 0,
      aliasCount: index?.aliases?.length || 0,
      sourceRevisions: index?.source_revisions || {},
      knowledgeFingerprint: index?.knowledge_fingerprint || knowledgeFingerprint(),
      releaseCount: releases.size,
      scoringVersion: SCORING_VERSION,
      projection: cacheDirectory ? { format: sqliteAvailable ? "sqlite" : "fallback", path: projectId && isMemoryId(projectId, "proj") ? cacheFile(projectId) : "" } : { format: sqliteAvailable ? "sqlite" : "memory", path: "" },
      knowledgeSyncAt,
    };
  }
  function resetProject(projectId) {
    let id;
    try { id = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message, {}, false); }
    projectIndexes.delete(id);
    const directory = projectCacheDirectory(id);
    try {
      // The index is a disposable projection.  Only the directory derived
      // from this validated project ID is removed; canonical snapshots and
      // other projects remain untouched.
      fs.rmSync(directory, { recursive: true, force: true });
      return { ok: true, changed: true, project_id: id, path: directory };
    } catch (error) {
      return operationFailure("MEMORY_KAG_RESET_FAILED", `The V3 KAG projection could not be reset: ${error.message}.`, { project_id: id, path: directory }, true);
    }
  }
  function closeProject(projectId) {
    let id;
    try { id = assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_PROJECT_ID_INVALID", error.message, {}, false); }
    projectIndexes.delete(id);
    return { ok: true, project_id: id, closed: true };
  }
  return Object.freeze({ SCORING_VERSION, installRelease, syncKnowledge, rebuildProjectIndex, indexProject, retrieve, health, cacheRoot, projectCacheDirectory, closeProject, resetProject });
}

module.exports = Object.freeze({ createNativeKagService, SCORING_VERSION });
