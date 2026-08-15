"use strict";

const { isRestrictedToolContext } = require("../../../contracts/tool/execution-context");

const INSPECT_ENVIRONMENT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    sections: {
      type: "array",
      items: {
        type: "string",
        enum: ["os", "workspace", "dependencies", "processes", "services"],
      },
      uniqueItems: true,
    },
    includeUnavailable: { type: "boolean" },
  },
});

const INSPECT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INSPECT_ENVIRONMENT_INPUT",
  INVALID_CONTEXT: "INVALID_EXECUTION_CONTEXT",
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message) {
  return { ok: false, error: { code: INSPECT_ERROR_CODES.INVALID_INPUT, message, retryable: false } };
}

function structuredFailure(code, message, extra = {}) {
  return { ok: false, error: { code, message, retryable: false, ...extra } };
}

function validateInput(input) {
  if (input === undefined || input === null) return { ok: true };
  if (!isRecord(input)) return invalidInput("Input must be an object");
  if (input.sections !== undefined) {
    if (!Array.isArray(input.sections)) return invalidInput("sections must be an array");
    const valid = new Set(["os", "workspace", "dependencies", "processes", "services"]);
    for (const section of input.sections) {
      if (!valid.has(section)) return invalidInput(`sections entry must be one of os, workspace, dependencies, processes, services (got ${section})`);
    }
    if (new Set(input.sections).size !== input.sections.length) {
      return invalidInput("sections must not contain duplicates");
    }
  }
  if (input.includeUnavailable !== undefined && typeof input.includeUnavailable !== "boolean") {
    return invalidInput("includeUnavailable must be a boolean");
  }
  return { ok: true };
}

function createInspectEnvironmentTool({
  os = null,
  fs = null,
  path = null,
  processManager = null,
  serviceChecker = null,
  workspaceSearch = null,
  config = null,
} = {}) {
  const realOs = os || require("node:os");
  const realFs = fs || require("node:fs");
  const realPath = path || require("node:path");

  function inspectOs() {
    return {
      platform: realOs.platform(),
      arch: realOs.arch(),
      release: realOs.release(),
      hostname: realOs.hostname(),
      cpus: realOs.cpus()?.length ?? 0,
      totalMemory: realOs.totalmem(),
      freeMemory: realOs.freemem(),
      uptime: realOs.uptime(),
    };
  }

  function inspectWorkspace(workspaceRoot) {
    const root = workspaceRoot || process.cwd();
    let entries = [];
    try {
      entries = realFs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
      return { root, error: error.message, entries: [] };
    }
    const folders = [];
    const files = [];
    let fileCount = 0;
    let dirCount = 0;
    for (const entry of entries) {
      if (entry.isDirectory()) {
        folders.push(entry.name);
        dirCount += 1;
      } else if (entry.isFile()) {
        files.push(entry.name);
        fileCount += 1;
      }
    }
    return {
      root,
      fileCount,
      dirCount,
      folders: folders.sort((a, b) => a.localeCompare(b)),
      files: files.sort((a, b) => a.localeCompare(b)),
    };
  }

  function inspectDependencies(workspaceRoot) {
    const root = workspaceRoot || process.cwd();
    const packagePath = realPath.join(root, "package.json");
    let raw;
    try {
      raw = realFs.readFileSync(packagePath, "utf8");
    } catch {
      return { available: false, reason: "No package.json in workspace root", packagePath };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return { available: false, reason: `package.json parse error: ${error.message}`, packagePath };
    }
    return {
      available: true,
      packagePath,
      name: parsed.name ?? null,
      version: parsed.version ?? null,
      dependencies: Object.keys(parsed.dependencies || {}).sort((a, b) => a.localeCompare(b)),
      devDependencies: Object.keys(parsed.devDependencies || {}).sort((a, b) => a.localeCompare(b)),
    };
  }

  function inspectProcesses() {
    if (processManager && typeof processManager.list === "function") {
      return processManager.list();
    }
    if (processManager === null) {
      // Default: report the current process snapshot; real process enumeration
      // is provided by the DI container when a process provider is wired.
      return {
        available: false,
        reason: "No process provider configured for raw inspection; using current process snapshot",
        processes: [
          { pid: process.pid, name: "node", status: "running", startedAt: null },
        ],
      };
    }
    return { available: false, reason: "Process provider unavailable", processes: [] };
  }

  function inspectServices() {
    if (serviceChecker && typeof serviceChecker.list === "function") {
      return serviceChecker.list();
    }
    if (serviceChecker === null) {
      return {
        available: false,
        reason: "No service provider configured for raw inspection",
        services: [],
      };
    }
    return { available: false, reason: "Service provider unavailable", services: [] };
  }

  const adapter = {
    name: "inspect_environment",
    inputSchema: INSPECT_ENVIRONMENT_INPUT_SCHEMA,
    async execute(input = {}, executionContext) {
      const inputObj = input ?? {};
      const validation = validateInput(inputObj);
      if (!validation.ok) return validation;
      if (!isRestrictedToolContext(executionContext)) {
        return structuredFailure(INSPECT_ERROR_CODES.INVALID_CONTEXT, "inspect_environment requires a restricted tool execution context projection");
      }

      const sections = inputObj.sections || ["os", "workspace", "dependencies", "processes", "services"];
      const includeUnavailable = Boolean(inputObj.includeUnavailable);
      const workspaceRoot = executionContext.workspace?.root || process.cwd();

      const result = {
        workspaceRoot,
        capturedAt: new Date().toISOString(),
        sections: {},
      };

      if (sections.includes("os")) {
        try {
          result.sections.os = { available: true, data: inspectOs() };
        } catch (error) {
          result.sections.os = { available: false, error: error.message };
        }
      }
      if (sections.includes("workspace")) {
        try {
          const data = inspectWorkspace(workspaceRoot);
          result.sections.workspace = data.error
            ? { available: false, error: data.error, data }
            : { available: true, data };
        } catch (error) {
          result.sections.workspace = { available: false, error: error.message };
        }
      }
      if (sections.includes("dependencies")) {
        try {
          const data = inspectDependencies(workspaceRoot);
          result.sections.dependencies = data.available
            ? { available: true, data }
            : { available: false, error: data.reason, data };
        } catch (error) {
          result.sections.dependencies = { available: false, error: error.message };
        }
      }
      if (sections.includes("processes")) {
        try {
          const data = inspectProcesses();
          if (data.available === true && data.processes?.length) {
            result.sections.processes = { available: true, data };
          } else {
            result.sections.processes = { available: false, error: data.reason ?? "No process provider", data };
          }
        } catch (error) {
          result.sections.processes = { available: false, error: error.message };
        }
      }
      if (sections.includes("services")) {
        try {
          const data = inspectServices();
          result.sections.services = data.services?.length
            ? { available: true, data }
            : { available: false, error: data.reason ?? "No services", data };
          if (includeUnavailable && result.sections.services.available === false) {
            // keep unavailable entry visible when includeUnavailable is set
          }
        } catch (error) {
          result.sections.services = { available: false, error: error.message };
        }
      }

      return { ok: true, value: result };
    },
  };

  return adapter;
}

module.exports = {
  INSPECT_ENVIRONMENT_INPUT_SCHEMA,
  INSPECT_ERROR_CODES,
  createInspectEnvironmentTool,
  validateInput,
};