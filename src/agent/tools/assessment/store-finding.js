"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const STORE_FINDING_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["operation", "finding"],
  properties: {
    operation: { type: "string", enum: ["create", "update", "read", "list", "delete"] },
    finding: {
      type: "object",
      required: ["id", "title", "severity"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
        status: { type: "string", enum: ["open", "confirmed", "in_progress", "resolved", "false_positive", "wontfix"] },
        description: { type: "string" },
        evidenceRefs: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        affectedResources: { type: "array", items: { type: "string" } },
        reproductionRefs: { type: "array", items: { type: "string" } },
        metadata: { type: "object" },
      },
    },
  },
});

const STORE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_STORE_FINDING_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
  NOT_FOUND: "STORE_FINDING_NOT_FOUND",
  ALREADY_EXISTS: "STORE_FINDING_ALREADY_EXISTS",
  WRITE_FAILED: "STORE_FINDING_WRITE_FAILED",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: STORE_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

const VALID_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const VALID_STATUSES = new Set(["open", "confirmed", "in_progress", "resolved", "false_positive", "wontfix"]);

function validateFinding(finding) {
  if (!isRecord(finding)) return invalidInput("finding must be an object");
  if (typeof finding.id !== "string" || finding.id.trim() === "") return invalidInput("finding.id must be a non-empty string");
  if (typeof finding.title !== "string" || finding.title.trim() === "") return invalidInput("finding.title must be a non-empty string");
  if (!VALID_SEVERITIES.has(finding.severity)) return invalidInput("finding.severity must be info, low, medium, high, or critical");
  if (finding.status !== undefined && !VALID_STATUSES.has(finding.status)) {
    return invalidInput("finding.status must be open, confirmed, in_progress, resolved, false_positive, or wontfix");
  }
  if (finding.confidence !== undefined && (typeof finding.confidence !== "number" || !Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1)) {
    return invalidInput("finding.confidence must be a number between 0 and 1");
  }
  for (const field of ["evidenceRefs", "affectedResources", "reproductionRefs"]) {
    if (finding[field] !== undefined && (!Array.isArray(finding[field]) || finding[field].some(v => typeof v !== "string" || v.trim() === ""))) {
      return invalidInput(`finding.${field} must be an array of non-empty strings`);
    }
  }
  return { ok: true };
}

function validateInput(input) {
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (!["create", "update", "read", "list", "delete"].includes(input.operation)) {
    return invalidInput("operation must be create, update, read, list, or delete");
  }
  if (input.operation === "list") {
    if (input.finding !== undefined) return invalidInput("list does not accept a finding");
    return { ok: true };
  }
  if (input.operation === "delete" || input.operation === "read") {
    if (typeof input.finding?.id !== "string" || input.finding.id.trim() === "") {
      return invalidInput(`${input.operation} requires finding.id`);
    }
    return { ok: true };
  }
  return validateFinding(input.finding);
}

function createStoreFindingTool({ fs = null, path = null } = {}) {
  const realFs = fs || require("node:fs");
  const realPath = path || require("node:path");
  const findings = new Map();

  function findingFile(root, id) {
    return realPath.join(root, ".xekute", "findings", `${id}.json`);
  }

  function loadFinding(root, id) {
    if (findings.has(id)) return findings.get(id);
    if (!root) return null;
    try {
      const raw = realFs.readFileSync(findingFile(root, id), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id === id) {
        findings.set(id, parsed);
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  }

  function persistFinding(root, finding) {
    if (!root) return;
    try {
      realFs.mkdirSync(realPath.join(root, ".xekute", "findings"), { recursive: true });
      realFs.writeFileSync(findingFile(root, finding.id), JSON.stringify(finding, null, 2), "utf8");
    } catch (error) {
      throw error;
    }
  }

  function normalizeFinding(input, now) {
    return {
      id: input.id,
      title: input.title,
      severity: input.severity,
      status: input.status || "open",
      description: input.description || "",
      evidenceRefs: input.evidenceRefs || [],
      confidence: input.confidence,
      affectedResources: input.affectedResources || [],
      reproductionRefs: input.reproductionRefs || [],
      metadata: input.metadata || {},
    };
  }

  function createFinding(input, root) {
    const finding = normalizeFinding(input.finding, null);
    if (loadFinding(root, finding.id)) {
      return structuredFailure(STORE_ERROR_CODES.ALREADY_EXISTS, `finding already exists: ${finding.id}`, { id: finding.id });
    }
    const now = new Date().toISOString();
    const stored = { ...finding, createdAt: now, updatedAt: now };
    findings.set(stored.id, stored);
    if (root) {
      try {
        persistFinding(root, stored);
      } catch (error) {
        findings.delete(stored.id);
        return structuredFailure(STORE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "create", finding: stored } };
  }

  function updateFinding(input, root) {
    const id = input.finding.id;
    const existing = loadFinding(root, id);
    if (!existing) return structuredFailure(STORE_ERROR_CODES.NOT_FOUND, `finding not found: ${id}`, { id });
    const now = new Date().toISOString();
    // Partial merge: only provided fields override existing values; createdAt
    // is preserved and array fields are replaced only when explicitly given.
    const patch = input.finding;
    const merged = { ...existing };
    for (const field of ["title", "severity", "status", "description", "confidence"]) {
      if (patch[field] !== undefined) merged[field] = patch[field];
    }
    for (const field of ["evidenceRefs", "affectedResources", "reproductionRefs"]) {
      if (patch[field] !== undefined) merged[field] = [...patch[field]];
    }
    if (patch.metadata !== undefined) merged.metadata = patch.metadata;
    merged.updatedAt = now;
    findings.set(id, merged);
    if (root) {
      try {
        persistFinding(root, merged);
      } catch (error) {
        findings.set(id, existing);
        return structuredFailure(STORE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "update", finding: merged } };
  }

  function readFinding(input, root) {
    const id = input.finding.id;
    const finding = loadFinding(root, id);
    if (!finding) return structuredFailure(STORE_ERROR_CODES.NOT_FOUND, `finding not found: ${id}`, { id });
    return { ok: true, value: { operation: "read", finding } };
  }

  function listFindings(root) {
    if (root) {
      try {
        const dir = realPath.join(root, ".xekute", "findings");
        const entries = realFs.existsSync(dir) ? realFs.readdirSync(dir) : [];
        for (const entry of entries) {
          if (entry.endsWith(".json")) {
            const id = entry.replace(/\.json$/, "");
            if (!findings.has(id)) loadFinding(root, id);
          }
        }
      } catch {
        // Ignore read errors in listing.
      }
    }
    return {
      ok: true,
      value: {
        operation: "list",
        count: findings.size,
        findings: [...findings.values()].map(f => ({ id: f.id, title: f.title, severity: f.severity, status: f.status, confidence: f.confidence ?? null })),
      },
    };
  }

  function deleteFinding(input, root) {
    const id = input.finding.id;
    const finding = loadFinding(root, id);
    if (!finding) return structuredFailure(STORE_ERROR_CODES.NOT_FOUND, `finding not found: ${id}`, { id });
    findings.delete(id);
    if (root) {
      try {
        realFs.rmSync(findingFile(root, id), { force: true });
      } catch (error) {
        findings.set(id, finding);
        return structuredFailure(STORE_ERROR_CODES.WRITE_FAILED, error.message);
      }
    }
    return { ok: true, value: { operation: "delete", id } };
  }

  const adapter = {
    name: "store_finding",
    inputSchema: STORE_FINDING_INPUT_SCHEMA,
    async execute(input, executionContext) {
      const validation = validateInput(input);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(STORE_ERROR_CODES.INVALID_CONTEXT, "store_finding requires a restricted tool execution context projection");
      }
      const root = executionContext.workspace?.root || null;

      switch (input.operation) {
        case "create": return createFinding(input, root);
        case "update": return updateFinding(input, root);
        case "read": return readFinding(input, root);
        case "list": return listFindings(root);
        case "delete": return deleteFinding(input, root);
        default: return invalidInput(`unknown operation: ${input.operation}`);
      }
    },
  };

  return adapter;
}

module.exports = {
  STORE_FINDING_INPUT_SCHEMA,
  STORE_ERROR_CODES,
  createStoreFindingTool,
  validateInput,
};