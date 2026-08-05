"use strict";

const path = require("node:path");
const { PROTECTED_ASSESSMENT_PATH_RE } = require("../../policies/command-guardrails");

function safeRelativePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) return "";
  return normalized;
}

function createWorkspacePort({ fs, path: pathModule = path, workspaceSearch, resolveWorkspaceTarget, editWorkspaceFile } = {}) {
  function resolve(context, relativePath, { mutate = false } = {}) {
    const file = safeRelativePath(relativePath);
    if (!file) return { error: "Workspace-relative path is required." };
    const resolved = resolveWorkspaceTarget(context.workspace, file);
    if (resolved.error) return resolved;
    if (mutate && PROTECTED_ASSESSMENT_PATH_RE.test(file)) return { error: "Protected assessment resources require typed assessment operations.", code: "TYPED_ASSESSMENT_MUTATION_REQUIRED" };
    return { ...resolved, file };
  }

  async function execute(input = {}, context = {}) {
    if (input.action === "read") {
      const resolved = resolve(context, input.path, { mutate: false });
      if (resolved.error) return { ok: false, error: resolved.error, code: resolved.code || "INVALID_PATH" };
      if (!fs.existsSync(resolved.target)) return { ok: false, error: `File not found: ${resolved.file}`, code: "FILE_NOT_FOUND" };
      if (!fs.statSync(resolved.target).isFile()) return { ok: false, error: `Not a file: ${resolved.file}`, code: "NOT_A_FILE" };
      const maxBytes = Math.min(Number(input.max_bytes) || 50000, 1000000);
      const content = fs.readFileSync(resolved.target, "utf8");
      return { ok: true, summary: `Read ${resolved.file}`, content: content.slice(0, maxBytes), truncated: content.length > maxBytes, file: resolved.file };
    }
    if (["find_files", "search_text", "list_directory", "inspect_workspace", "get_outline", "ensure_index"].includes(input.action)) {
      if (!workspaceSearch) return { ok: false, unavailable: true, code: "ADAPTER_UNAVAILABLE", error: "Workspace search is unavailable." };
      if (input.action === "find_files") return workspaceSearch.findWorkspaceFiles(context.workspace, input.query || "", { limit: input.limit });
      if (input.action === "search_text") return workspaceSearch.searchWorkspaceIndex(context.workspace, input.query || "", { limit: input.limit });
      if (input.action === "list_directory") return workspaceSearch.listProjectFiles(context.workspace);
      if (input.action === "inspect_workspace") {
        const listed = workspaceSearch.listProjectFiles(context.workspace);
        return listed.error ? listed : { ok: true, fileCount: listed.files.length, files: listed.files.slice(0, input.limit || 100) };
      }
      if (input.action === "ensure_index") return workspaceSearch.buildWorkspaceIndex(context.workspace);
      return { ok: true, summary: `Outline action requires a file path.` };
    }
    if (input.action === "apply") {
      const resolved = resolve(context, input.path, { mutate: true });
      if (resolved.error) return { ok: false, error: resolved.error, code: resolved.code || "INVALID_PATH" };
      const patches = Array.isArray(input.patches) ? input.patches.slice(0, 20) : [];
      if (!patches.length || patches.some((patch) => !String(patch?.search || ""))) return { ok: false, error: "At least one exact patch is required.", code: "PATCH_REQUIRED" };
      const result = await editWorkspaceFile(context.workspace, resolved.file, { patches });
      return result.error ? { ok: false, error: result.error, code: "PATCH_FAILED" } : { ...result, file: resolved.file };
    }
    return { ok: false, error: `Unsupported workspace action: ${input.action}`, code: "UNKNOWN_ACTION" };
  }

  return Object.freeze({ execute, safeRelativePath });
}

module.exports = { safeRelativePath, createWorkspacePort };
