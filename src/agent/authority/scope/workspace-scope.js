"use strict";

const path = require("node:path");

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function pathCandidates(toolName, args = {}) {
  const values = [];
  if (toolName === "exec_command" && args.cwd) values.push(args.cwd);
  for (const key of ["path", "file", "cwd", "directory", "workspacePath"]) {
    if (args[key]) values.push(args[key]);
  }
  for (const key of ["files", "paths"]) {
    if (Array.isArray(args[key])) values.push(...args[key]);
  }
  if (Array.isArray(args.operations)) {
    for (const operation of args.operations) if (operation?.path) values.push(operation.path);
  }
  return values.filter((value) => typeof value === "string" && value.trim());
}

function validateWorkspacePaths(toolName, args = {}, workspaceRoot = ".") {
  for (const candidate of pathCandidates(toolName, args)) {
    const resolved = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(workspaceRoot, candidate);
    if (!isInside(workspaceRoot, resolved)) {
      return {
        ok: false,
        code: "WORKSPACE_OUT_OF_SCOPE",
        reason: "The requested filesystem path is outside the active workspace.",
        remediation: "Use a path inside the open workspace.",
        path: candidate,
      };
    }
  }
  return { ok: true, code: "WORKSPACE_IN_SCOPE" };
}

module.exports = { isInside, pathCandidates, validateWorkspacePaths };
