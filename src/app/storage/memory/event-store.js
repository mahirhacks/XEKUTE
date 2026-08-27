"use strict";

const nodeFs = require("node:fs");
const nodePath = require("node:path");
const nodeCrypto = require("node:crypto");
const { assertMemoryId, canonicalJson, canonicalKeyHash, createOpaqueId } = require("../../../contracts/memory/index.js");
const { createMemoryManifestStore } = require("./memory-manifest-store.js");
const {
  appendCompleteLine,
  clone,
  fileSha256,
  operationFailure,
  readJsonLines,
  resolvedWorkspace,
  timestamp,
} = require("./memory-storage-utils.js");

const EVENT_SCHEMA_VERSION = 1;
const STREAMS = new Set(["execution", "semantic"]);
const MAX_EVENT_BYTES = 1_048_576;
const MAX_SEGMENT_BYTES = 16 * 1024 * 1024;
const MAX_SEGMENT_EVENTS = 10_000;
const SECRET_KEY = /^(?:raw[_-]?cookie|cookie[_-]?value|authorization(?:[_-]?header)?|access[_-]?token|refresh[_-]?token|csrf[_-]?token|bearer[_-]?token|private[_-]?key|client[_-]?private[_-]?key|passphrase|secret[_-]?value|raw[_-]?value|password)$/i;

function createMemoryEventStore({
  fs = nodeFs,
  path = nodePath,
  crypto = nodeCrypto,
  manifestStore = null,
  now = () => new Date(),
  maxEventBytes = MAX_EVENT_BYTES,
  maxSegmentBytes = MAX_SEGMENT_BYTES,
  maxSegmentEvents = MAX_SEGMENT_EVENTS,
} = {}) {
  if (!fs || !path || !crypto) throw new TypeError("Memory event store dependencies are required.");
  const manifests = manifestStore || createMemoryManifestStore({ fs, path, crypto, now });
  const queues = new Map();

  function workspaceRoot(workspace) { return resolvedWorkspace(path, workspace); }
  function streamName(stream) {
    const value = String(stream || "").trim().toLowerCase();
    if (!STREAMS.has(value)) throw Object.assign(new Error("The memory event stream is unsupported."), { code: "MEMORY_EVENT_STREAM_INVALID" });
    return value;
  }
  function segmentFile(workspace, stream, segmentNumber) {
    return path.join(manifests.eventsDirectory(workspace), `${streamName(stream)}-${String(segmentNumber).padStart(6, "0")}.jsonl`);
  }
  function relativeSegmentFile(stream, segmentNumber) { return `events/${streamName(stream)}-${String(segmentNumber).padStart(6, "0")}.jsonl`; }
  function segmentNumberFromFile(file, stream) {
    const match = new RegExp(`^${streamName(stream)}-(\\d{6})\\.jsonl$`, "i").exec(path.basename(file));
    return match ? Number(match[1]) : 0;
  }

  function rejectSecretKeys(value, key = "", depth = 0) {
    if (depth > 12) throw Object.assign(new Error("The memory event payload is too deeply nested."), { code: "MEMORY_PAYLOAD_TOO_DEEP" });
    if (SECRET_KEY.test(String(key || ""))) throw Object.assign(new Error("Raw secret fields are not permitted in memory events."), { code: "MEMORY_SECRET_FIELD", details: { field: String(key) } });
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return;
    if (Array.isArray(value)) {
      if (value.length > 10_000) throw Object.assign(new Error("The memory event array is too large."), { code: "MEMORY_ARRAY_TOO_LARGE" });
      value.forEach((entry) => rejectSecretKeys(entry, "", depth + 1));
      return;
    }
    if (typeof value !== "object") throw Object.assign(new Error("Memory events must contain JSON-compatible values."), { code: "MEMORY_PAYLOAD_INVALID" });
    for (const [childKey, child] of Object.entries(value)) rejectSecretKeys(child, childKey, depth + 1);
  }

  function boundedClone(value) {
    rejectSecretKeys(value);
    return clone(value);
  }

  function eventIdOf(event) { return String(event?.event_id || event?.eventId || "").trim(); }
  function eventTypeOf(event) { return String(event?.event_type || event?.eventType || event?.type || "").trim().slice(0, 160); }

  function normalizeEvent(input, stream, projectId, sequence) {
    const source = input && typeof input === "object" && !Array.isArray(input) ? boundedClone(input) : null;
    if (!source) throw Object.assign(new Error("A memory event must be an object."), { code: "MEMORY_EVENT_INVALID" });
    const actualProjectId = String(source.project_id || source.projectId || projectId || "").trim();
    assertMemoryId(projectId, "proj");
    assertMemoryId(actualProjectId, "proj");
    if (actualProjectId !== projectId) throw Object.assign(new Error("The event belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId } });
    const actualStream = streamName(stream);
    const eventId = eventIdOf(source) || createOpaqueId("event", { uuid: () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : nodeCrypto.randomUUID() });
    assertMemoryId(eventId, "event");
    const eventType = eventTypeOf(source);
    if (!eventType) throw Object.assign(new Error("A memory event type is required."), { code: "MEMORY_EVENT_TYPE_REQUIRED" });
    const occurredAt = String(source.occurred_at || source.occurredAt || timestamp(now)).trim();
    if (Number.isNaN(Date.parse(occurredAt))) throw Object.assign(new Error("The memory event timestamp is invalid."), { code: "MEMORY_TIMESTAMP_INVALID" });
    const normalized = {
      ...source,
      schema_version: EVENT_SCHEMA_VERSION,
      event_id: eventId,
      project_id: projectId,
      stream: actualStream,
      sequence: Number(sequence),
      event_type: eventType,
      occurred_at: new Date(occurredAt).toISOString(),
    };
    delete normalized.eventId;
    delete normalized.projectId;
    delete normalized.eventType;
    delete normalized.occurredAt;
    delete normalized.type;
    if (source.block_id || source.blockId) normalized.block_id = String(source.block_id || source.blockId).trim().slice(0, 240);
    if (normalized.block_id) assertMemoryId(normalized.block_id, "block");
    delete normalized.blockId;
    if (source.operation_id || source.operationId) normalized.operation_id = String(source.operation_id || source.operationId).trim().slice(0, 240);
    if (normalized.operation_id) assertMemoryId(normalized.operation_id, "op");
    delete normalized.operationId;
    const serialized = JSON.stringify(normalized);
    if (Buffer.byteLength(serialized, "utf8") + 1 > maxEventBytes) throw Object.assign(new Error(`The memory event exceeds the ${maxEventBytes}-byte limit.`), { code: "MEMORY_EVENT_TOO_LARGE", details: { maximumBytes: maxEventBytes } });
    return normalized;
  }

  function hashEvent(event) { return canonicalKeyHash(event); }

  function validateStoredEvent(event, stream, projectId, expectedSequence = null) {
    const normalized = normalizeEvent(event, stream, projectId, Number(event?.sequence || expectedSequence || 0));
    if (!Number.isInteger(normalized.sequence) || normalized.sequence < 1) throw Object.assign(new Error("A stored event sequence is invalid."), { code: "MEMORY_EVENT_SEQUENCE_INVALID" });
    if (expectedSequence !== null && normalized.sequence !== expectedSequence) throw Object.assign(new Error("A stored event sequence is not monotonic."), { code: "MEMORY_EVENT_SEQUENCE_INVALID" });
    return normalized;
  }

  function listSegmentFiles(workspace, stream) {
    const directory = manifests.eventsDirectory(workspace);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
      .filter((entry) => new RegExp(`^${streamName(stream)}-\\d{6}\\.jsonl$`, "i").test(entry))
      .map((entry) => path.join(directory, entry))
      .sort((left, right) => segmentNumberFromFile(left, stream) - segmentNumberFromFile(right, stream));
  }

  function readSegment(workspace, stream, projectId, file) {
    const loaded = readJsonLines({ fs }, file, {
      maxBytes: maxEventBytes,
      validate: (record) => validateStoredEvent(record, stream, projectId),
    });
    if (!loaded.ok) return operationFailure("MEMORY_EVENT_SEGMENT_CORRUPT", `The ${stream} event segment is corrupt: ${loaded.error?.message || "invalid event"}.`, { path: file, line: loaded.line || 0 }, true);
    const records = loaded.records.map((record) => validateStoredEvent(record, stream, projectId));
    return {
      ok: true,
      records,
      warnings: loaded.warnings || [],
      bytes: loaded.validBytes,
      physicalBytes: loaded.bytes,
      complete: loaded.complete,
      sha256: fileSha256({ fs, crypto }, file),
    };
  }

  function segmentMeta(workspace, stream, records, file, closedAt = "") {
    const first = records[0]?.sequence || 0;
    const last = records.at(-1)?.sequence || 0;
    const loaded = fs.existsSync(file) ? readJsonLines({ fs }, file, { maxBytes: maxEventBytes }) : { bytes: 0, validBytes: 0 };
    return {
      segment_id: `${streamName(stream)}_${String(segmentNumberFromFile(file, stream)).padStart(6, "0")}`,
      file: relativeSegmentFile(stream, segmentNumberFromFile(file, stream)),
      first_sequence: first,
      last_sequence: last,
      event_count: records.length,
      bytes: Number(loaded.validBytes || 0),
      sha256: fs.existsSync(file) ? fileSha256({ fs, crypto }, file) : "",
      ...(closedAt ? { closed_at: closedAt } : {}),
    };
  }

  async function reconcileStream(workspace, projectId, stream, manifest) {
    const actualFiles = listSegmentFiles(workspace, stream);
    const existingByFile = new Map((manifest.event_streams[stream]?.segments || []).map((segment) => [segment.file, segment]));
    const segments = [];
    let totalEvents = 0;
    let totalBytes = 0;
    let nextSequence = 1;
    const warnings = [];
    for (const file of actualFiles) {
      const loaded = readSegment(workspace, stream, projectId, file);
      if (!loaded.ok) return loaded;
      const prior = existingByFile.get(segmentMeta(workspace, stream, loaded.records, file).file);
      const meta = segmentMeta(workspace, stream, loaded.records, file, prior?.closed_at || "");
      segments.push(meta);
      totalEvents += meta.event_count;
      totalBytes += meta.bytes;
      nextSequence = Math.max(nextSequence, meta.last_sequence + 1);
      warnings.push(...loaded.warnings);
    }
    segments.sort((left, right) => left.first_sequence - right.first_sequence || left.file.localeCompare(right.file));
    const current = manifest.event_streams[stream] || { next_sequence: 1, total_events: 0, total_bytes: 0, segments: [] };
    const changed = JSON.stringify({ next_sequence: current.next_sequence, total_events: current.total_events, total_bytes: current.total_bytes, segments: current.segments }) !== JSON.stringify({ next_sequence: nextSequence, total_events: totalEvents, total_bytes: totalBytes, segments });
    if (!changed) return { ok: true, manifest, changed: false, warnings };
    const updated = await manifests.update(workspace, projectId, (candidate) => {
      candidate.event_streams[stream] = { next_sequence: nextSequence, total_events: totalEvents, total_bytes: totalBytes, segments };
      return candidate;
    }, { reason: "event_recovery" });
    if (!updated.ok) return updated;
    return { ok: true, manifest: updated.manifest, changed: true, warnings };
  }

  function findEventInFiles(workspace, projectId, stream, eventId) {
    for (const file of listSegmentFiles(workspace, stream)) {
      const loaded = readSegment(workspace, stream, projectId, file);
      if (!loaded.ok) return loaded;
      const found = loaded.records.find((record) => record.event_id === eventId);
      if (found) return { ok: true, event: found, hash: hashEvent(found), path: file };
    }
    return { ok: true, event: null };
  }

  async function appendInternal(rawWorkspace, projectId, stream, input) {
    let workspace;
    try {
      workspace = workspaceRoot(rawWorkspace);
      assertMemoryId(projectId, "proj");
      stream = streamName(stream);
    } catch (error) {
      return operationFailure(error.code || "MEMORY_EVENT_INPUT_INVALID", error.message, error.details || {});
    }
    // Validate the caller-controlled portion before lazy initialization. A
    // rejected event must not scaffold a project memory directory.
    try {
      const preflight = boundedClone(input);
      const preflightBytes = Buffer.byteLength(JSON.stringify(preflight), "utf8") + 1;
      if (preflightBytes > maxEventBytes) throw Object.assign(new Error(`The memory event exceeds the ${maxEventBytes}-byte limit.`), { code: "MEMORY_EVENT_TOO_LARGE", details: { maximumBytes: maxEventBytes } });
      const inputProjectId = String(preflight?.project_id || preflight?.projectId || projectId).trim();
      assertMemoryId(inputProjectId, "proj");
      if (inputProjectId !== projectId) throw Object.assign(new Error("The event belongs to a different project."), { code: "MEMORY_PROJECT_MISMATCH", details: { expectedProjectId: projectId, actualProjectId: inputProjectId } });
      if (!eventTypeOf(preflight)) throw Object.assign(new Error("A memory event type is required."), { code: "MEMORY_EVENT_TYPE_REQUIRED" });
    } catch (error) {
      return operationFailure(error.code || "MEMORY_EVENT_INVALID", error.message, error.details || {});
    }
    const initialized = manifests.initialize(workspace, projectId, { reason: "execution_event" });
    if (!initialized.ok) return initialized;
    const loaded = manifests.read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const reconciled = await reconcileStream(workspace, projectId, stream, loaded.manifest);
    if (!reconciled.ok) return reconciled;
    const manifest = reconciled.manifest;
    const requestedEventId = eventIdOf(input);
    if (requestedEventId) {
      try { assertMemoryId(requestedEventId, "event"); } catch (error) { return operationFailure(error.code, error.message, error.details || {}); }
      const prior = findEventInFiles(workspace, projectId, stream, requestedEventId);
      if (!prior.ok) return prior;
      if (prior.event) {
        let candidate;
        try { candidate = normalizeEvent(input, stream, projectId, prior.event.sequence); } catch (error) { return operationFailure(error.code || "MEMORY_EVENT_INVALID", error.message, error.details || {}); }
        if (hashEvent(candidate) !== prior.hash) return operationFailure("MEMORY_EVENT_ID_CONFLICT", "The event ID already exists with different content.", { eventId: requestedEventId, path: prior.path });
        return { ok: true, changed: false, duplicate: true, event: clone(prior.event), eventId: requestedEventId, stream, sequence: prior.event.sequence, manifestRevision: manifest.manifest_revision, warnings: reconciled.warnings || [] };
      }
    }

    const streamState = manifest.event_streams[stream] || { next_sequence: 1, total_events: 0, total_bytes: 0, segments: [] };
    const sequence = Math.max(1, Number(streamState.next_sequence) || 1);
    let lastSegment = streamState.segments.at(-1) || null;
    let rotate = !lastSegment || Boolean(lastSegment.closed_at) || Number(lastSegment.event_count || 0) >= maxSegmentEvents || Number(lastSegment.bytes || 0) >= maxSegmentBytes;
    let targetFile = lastSegment ? path.join(manifests.memoryDirectory(workspace), lastSegment.file) : "";
    if (lastSegment && fs.existsSync(targetFile)) {
      const current = readJsonLines({ fs }, targetFile, { maxBytes: maxEventBytes });
      if (!current.ok) return operationFailure("MEMORY_EVENT_SEGMENT_CORRUPT", `The event segment cannot accept another record: ${current.error?.message || "invalid event"}.`, { path: targetFile }, true);
      if (!current.complete) {
        try { fs.truncateSync(targetFile, current.validBytes); } catch (error) { return operationFailure("MEMORY_EVENT_REPAIR_FAILED", `The partial event segment could not be repaired: ${error.message}.`, { path: targetFile }, true); }
        lastSegment = segmentMeta(workspace, stream, current.records, targetFile, lastSegment.closed_at || "");
        streamState.segments[streamState.segments.length - 1] = lastSegment;
      }
      rotate = rotate || Number(lastSegment.bytes || 0) >= maxSegmentBytes;
    }
    if (rotate) {
      if (lastSegment && !lastSegment.closed_at) lastSegment.closed_at = timestamp(now);
      const number = (lastSegment ? segmentNumberFromFile(path.join(manifests.memoryDirectory(workspace), lastSegment.file), stream) : 0) + 1;
      targetFile = segmentFile(workspace, stream, number);
    }
    let event;
    try { event = normalizeEvent(input, stream, projectId, sequence); } catch (error) {
      return operationFailure(error.code || "MEMORY_EVENT_INVALID", error.message, error.details || {});
    }
    const serialized = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > maxEventBytes) return operationFailure("MEMORY_EVENT_TOO_LARGE", "The memory event exceeds the configured size limit.", { maximumBytes: maxEventBytes });
    try { appendCompleteLine({ fs, path }, targetFile, serialized, { maxBytes: maxEventBytes }); } catch (error) {
      return operationFailure(error.code || "MEMORY_EVENT_APPEND_FAILED", error.message, { path: targetFile }, true);
    }
    const after = readJsonLines({ fs }, targetFile, { maxBytes: maxEventBytes, validate: (record) => validateStoredEvent(record, stream, projectId) });
    if (!after.ok) return operationFailure("MEMORY_EVENT_APPEND_VERIFY_FAILED", `The appended event could not be verified: ${after.error?.message || "invalid event"}.`, { path: targetFile }, true);
    const meta = segmentMeta(workspace, stream, after.records.map((record) => validateStoredEvent(record, stream, projectId)), targetFile, lastSegment?.closed_at || "");
    const updated = await manifests.update(workspace, projectId, (candidate) => {
      const state = candidate.event_streams[stream];
      const existingSegments = Array.isArray(state.segments) ? state.segments.filter((segment) => segment.file !== meta.file) : [];
      existingSegments.push(meta);
      existingSegments.sort((left, right) => left.first_sequence - right.first_sequence || left.file.localeCompare(right.file));
      state.segments = existingSegments;
      state.next_sequence = sequence + 1;
      state.total_events = existingSegments.reduce((sum, segment) => sum + Number(segment.event_count || 0), 0);
      state.total_bytes = existingSegments.reduce((sum, segment) => sum + Number(segment.bytes || 0), 0);
      return candidate;
    }, { reason: "event_append" });
    if (!updated.ok) return updated;
    return {
      ok: true,
      changed: true,
      duplicate: false,
      event: clone(event),
      eventId: event.event_id,
      stream,
      sequence,
      segment: clone(meta),
      manifestRevision: updated.manifest.manifest_revision,
      warnings: reconciled.warnings || [],
    };
  }

  function enqueue(workspace, stream, operation) {
    const key = `${path.resolve(String(workspace || ""))}|${streamName(stream)}`;
    const prior = queues.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(operation);
    const queued = next.finally(() => { if (queues.get(key) === queued) queues.delete(key); });
    queues.set(key, queued);
    return queued;
  }

  function append(workspace, projectId, stream, event) {
    return enqueue(workspace, stream, () => appendInternal(workspace, projectId, stream, event));
  }

  async function read(workspace, projectId, stream, { fromSequence = 1, toSequence = Number.MAX_SAFE_INTEGER, blockId = "", limit = 50 } = {}) {
    let root;
    try { root = workspaceRoot(workspace); assertMemoryId(projectId, "proj"); stream = streamName(stream); } catch (error) { return operationFailure(error.code || "MEMORY_EVENT_INPUT_INVALID", error.message, error.details || {}); }
    const boundedLimit = limit === Infinity ? Number.MAX_SAFE_INTEGER : Math.min(200, Math.max(1, Number(limit) || 50));
    const loaded = manifests.read(root, projectId);
    if (!loaded.ok) return loaded;
    if (!loaded.initialized) return { ok: true, initialized: false, events: [], warnings: [], nextCursor: "", sourceRevision: 0 };
    const records = [];
    const warnings = [];
    for (const segment of loaded.manifest.event_streams[stream]?.segments || []) {
      if (Number(segment.last_sequence || 0) < Number(fromSequence)) continue;
      if (Number(segment.first_sequence || 0) > Number(toSequence)) continue;
      const file = path.join(manifests.memoryDirectory(root), segment.file);
      if (!fs.existsSync(file)) {
        warnings.push({ code: "MEMORY_EVENT_SEGMENT_MISSING", path: file });
        continue;
      }
      const result = readSegment(root, stream, projectId, file);
      if (!result.ok) return result;
      warnings.push(...result.warnings);
      for (const event of result.records) {
        if (event.sequence < fromSequence || event.sequence > toSequence) continue;
        if (blockId && event.block_id !== String(blockId)) continue;
        records.push(event);
        if (records.length >= boundedLimit) break;
      }
      if (records.length >= boundedLimit) break;
    }
    const last = records.at(-1)?.sequence || 0;
    return { ok: true, initialized: true, events: records.map(clone), warnings, nextCursor: last && records.length >= boundedLimit ? String(last) : "", sourceRevision: loaded.manifest.manifest_revision, streamRevision: loaded.manifest.event_streams[stream]?.next_sequence - 1 || 0 };
  }

  function readAll(workspace, projectId, stream, options = {}) {
    return read(workspace, projectId, stream, { ...options, limit: Infinity });
  }

  function status(workspace, projectId, stream) {
    try { stream = streamName(stream); assertMemoryId(projectId, "proj"); } catch (error) { return operationFailure(error.code || "MEMORY_EVENT_INPUT_INVALID", error.message, error.details || {}); }
    const loaded = manifests.read(workspace, projectId);
    if (!loaded.ok) return loaded;
    const state = loaded.manifest.event_streams[stream];
    return { ok: true, initialized: loaded.initialized, stream, nextSequence: state.next_sequence, totalEvents: state.total_events, totalBytes: state.total_bytes, segments: clone(state.segments), sourceRevision: loaded.manifest.manifest_revision, warnings: loaded.warning ? [{ code: "MEMORY_MANIFEST_RECOVERED", message: loaded.warning }] : [] };
  }

  async function reconcile(workspace, projectId, stream = "execution") {
    try { assertMemoryId(projectId, "proj"); stream = streamName(stream); } catch (error) { return operationFailure(error.code || "MEMORY_EVENT_INPUT_INVALID", error.message, error.details || {}); }
    const loaded = manifests.read(workspace, projectId);
    if (!loaded.ok) return loaded;
    if (!loaded.initialized) return { ok: true, initialized: false, changed: false, warnings: [] };
    return reconcileStream(workspaceRoot(workspace), projectId, stream, loaded.manifest);
  }

  return Object.freeze({
    EVENT_SCHEMA_VERSION,
    MAX_EVENT_BYTES: maxEventBytes,
    MAX_SEGMENT_BYTES: maxSegmentBytes,
    MAX_SEGMENT_EVENTS: maxSegmentEvents,
    append,
    read,
    readAll,
    status,
    reconcile,
    segmentFile,
    relativeSegmentFile,
    normalizeEvent,
    hashEvent,
  });
}

module.exports = Object.freeze({ createMemoryEventStore, EVENT_SCHEMA_VERSION, MAX_EVENT_BYTES, MAX_SEGMENT_BYTES, MAX_SEGMENT_EVENTS });
