const ToolMap = require("./tool-map");

function createToolHandlers(deps) {
  const {
    fs,
    path,
    resolveWorkspaceTarget,
    editWorkspaceFile,
    deleteWorkspaceFile,
    buildWorkspaceIndex,
    searchWorkspaceIndex,
    findWorkspaceFiles,
    runWorkspaceCommand,
    startWorkspaceProcess,
    readToolProcess,
    stopToolProcess,
    listProjectFiles,
  } = deps;

  function ok(toolName, mode, fields = {}) {
    return normalizeResult({ ok: true, toolName, mode, ...fields });
  }

  function fail(toolName, error, fields = {}, errorCode = "TOOL_ERROR", retryable = false) {
    return normalizeResult({ ok: false, toolName, error, errorCode, retryable, ...fields });
  }

  function requireWorkspace(workspace, toolName) {
    if (!workspace) return fail(toolName, "No workspace open");
    return null;
  }

  function readFile(workspace, file) {
    const resolved = resolveWorkspaceTarget(workspace, file);
    if (resolved.error) return resolved;
    if (!fs.existsSync(resolved.target)) return { error: `File not found: ${file}` };
    const stat = fs.statSync(resolved.target);
    if (!stat.isFile()) return { error: `Not a file: ${file}` };
    return {
      file,
      path: resolved.target,
      content: fs.readFileSync(resolved.target, "utf8"),
    };
  }

  const TOOL_HANDLERS = {
    async find_files({ workspace, args }) {
      const missing = requireWorkspace(workspace, "find_files");
      if (missing) return missing;
      const query = String(args.query || "").trim();
      if (!query) return fail("find_files", "Missing required query", {}, "MISSING_QUERY", true);
      const result = findWorkspaceFiles(workspace, query, { limit: Number(args.limit) || 8 });
      if (result.error) return fail("find_files", result.error, {}, "SEARCH_FAILED", false);
      return ok("find_files", "find", {
        query,
        count: result.count,
        results: result.results,
        content: formatFindContent(result),
      });
    },

    async list_files({ workspace }) {
      const missing = requireWorkspace(workspace, "list_files");
      if (missing) return missing;
      const result = listProjectFiles(workspace);
      if (result.error) return fail("list_files", result.error, {}, "LIST_FAILED", false);
      return ok("list_files", "list", { files: result.files, content: `Project files:\n${result.files.map((f) => `- ${f}`).join("\n")}` });
    },

    async read_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "read_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      if (!file) return fail("read_file", "Missing required path", {}, "MISSING_PATH", true);
      const result = readFile(workspace, file);
      if (result.error) {
        const code = /not found/i.test(result.error) ? "FILE_NOT_FOUND" : "READ_FAILED";
        return fail("read_file", result.error, { file }, code, code === "FILE_NOT_FOUND");
      }
      return ok("read_file", "read", {
        file,
        content: result.content,
        summary: `Read ${file} (${result.content.split(/\r?\n/).length} lines)`,
      });
    },

    async write_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "write_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const content = args.content ?? args.code;
      if (!file) return fail("write_file", "Missing required path", {}, "MISSING_PATH", true);
      if (content == null) return fail("write_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const result = await editWorkspaceFile(workspace, file, { code: String(content) });
      if (result.error) return fail("write_file", result.error, { file }, "WRITE_FAILED", false);
      return ok("write_file", result.mode || "full", {
        file,
        path: result.path,
        content: result.content ?? String(content),
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        fallback: result.fallback,
        mutated: result.mode !== "noop",
      });
    },

    async create_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "create_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const content = args.content ?? args.code;
      if (!file) return fail("create_file", "Missing required path", {}, "MISSING_PATH", true);
      if (content == null) return fail("create_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const resolved = resolveWorkspaceTarget(workspace, file);
      if (resolved.error) return fail("create_file", resolved.error, { file }, "INVALID_PATH", false);
      if (fs.existsSync(resolved.target)) return fail("create_file", `File already exists: ${file}`, { file }, "FILE_EXISTS", true);
      const result = await editWorkspaceFile(workspace, file, { code: String(content) });
      if (result.error) return fail("create_file", result.error, { file }, "WRITE_FAILED", false);
      return ok("create_file", "create", {
        file,
        path: result.path,
        content: result.content ?? String(content),
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: true,
      });
    },

    async patch_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "patch_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      if (!file) return fail("patch_file", "Missing required path", {}, "MISSING_PATH", true);
      const patches = Array.isArray(args.patches)
        ? args.patches
        : [{ search: args.search, replace: args.replace }];
      const cleanPatches = patches.map((patch) => ({
        search: String(patch?.search ?? ""),
        replace: String(patch?.replace ?? ""),
      }));
      if (!cleanPatches.length || cleanPatches.some((patch) => !patch.search)) {
        return fail("patch_file", "Missing required search text", { file }, "MISSING_SEARCH", true);
      }
      const result = await editWorkspaceFile(workspace, file, { patches: cleanPatches });
      if (result.error) {
        const code = /not found/i.test(result.error)
          ? "PATCH_SEARCH_NOT_FOUND"
          : /matched .* times/i.test(result.error)
            ? "PATCH_NOT_UNIQUE"
            : "PATCH_FAILED";
        return fail("patch_file", result.error, { file }, code, true);
      }
      return ok("patch_file", result.mode || "patch", {
        file,
        path: result.path,
        content: result.content,
        patches_applied: result.patches_applied,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async replace_in_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "replace_in_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const search = String(args.old_text ?? args.search ?? "");
      const replace = String(args.new_text ?? args.replace ?? "");
      if (!file) return fail("replace_in_file", "Missing required path", {}, "MISSING_PATH", true);
      if (!search) return fail("replace_in_file", "Missing required old_text", { file }, "MISSING_SEARCH", true);
      const result = await editWorkspaceFile(workspace, file, { patches: [{ search, replace }] });
      if (result.error) return fail("replace_in_file", result.error, { file }, "REPLACE_FAILED", true);
      return ok("replace_in_file", result.mode || "replace", {
        file,
        path: result.path,
        content: result.content,
        patches_applied: result.patches_applied,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async insert_in_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "insert_in_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const anchor = String(args.anchor ?? "");
      const content = String(args.content ?? args.text ?? "");
      const position = String(args.position || "after").toLowerCase() === "before" ? "before" : "after";
      if (!file) return fail("insert_in_file", "Missing required path", {}, "MISSING_PATH", true);
      if (!anchor) return fail("insert_in_file", "Missing required anchor", { file }, "MISSING_ANCHOR", true);
      if (!content) return fail("insert_in_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const replace = position === "before" ? `${content}${anchor}` : `${anchor}${content}`;
      const result = await editWorkspaceFile(workspace, file, { patches: [{ search: anchor, replace }] });
      if (result.error) return fail("insert_in_file", result.error, { file }, "INSERT_FAILED", true);
      return ok("insert_in_file", "insert", {
        file,
        path: result.path,
        content: result.content,
        patches_applied: result.patches_applied,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async append_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "append_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      const content = String(args.content ?? args.code ?? "");
      if (!file) return fail("append_file", "Missing required path", {}, "MISSING_PATH", true);
      if (!content) return fail("append_file", "Missing required content", { file }, "MISSING_CONTENT", true);
      const current = readFile(workspace, file);
      if (current.error) return fail("append_file", current.error, { file }, "FILE_NOT_FOUND", true);
      const prefix = current.content && !current.content.endsWith("\n") ? "\n" : "";
      const result = await editWorkspaceFile(workspace, file, { code: `${current.content}${prefix}${content}` });
      if (result.error) return fail("append_file", result.error, { file }, "APPEND_FAILED", false);
      return ok("append_file", "append", {
        file,
        path: result.path,
        content: result.content,
        lines_added: result.lines_added,
        lines_removed: result.lines_removed,
        mutated: result.mode !== "noop",
      });
    },

    async delete_file({ workspace, args }) {
      const missing = requireWorkspace(workspace, "delete_file");
      if (missing) return missing;
      const file = String(args.path || "").trim();
      if (!file) return fail("delete_file", "Missing required path", {}, "MISSING_PATH", true);
      const result = deleteWorkspaceFile(workspace, file);
      if (result.error) return fail("delete_file", result.error, { file }, "DELETE_FAILED", false);
      return ok("delete_file", "delete", { file, mutated: true });
    },

    async index_workspace({ workspace }) {
      const missing = requireWorkspace(workspace, "index_workspace");
      if (missing) return missing;
      const index = buildWorkspaceIndex(workspace);
      if (index.error) return fail("index_workspace", index.error, {}, "INDEX_FAILED", false);
      const graph = index.graph.slice(0, 80);
      return ok("index_workspace", "index", {
        files: index.docs.length,
        builtAt: index.builtAt,
        graph,
        content: `Indexed ${index.docs.length} files.`,
      });
    },

    async search_code({ workspace, args }) {
      const missing = requireWorkspace(workspace, "search_code");
      if (missing) return missing;
      const query = String(args.query || "").trim();
      if (!query) return fail("search_code", "Missing required query", {}, "MISSING_QUERY", true);
      const result = searchWorkspaceIndex(workspace, query, { limit: Number(args.limit) || 8 });
      if (result.error) return fail("search_code", result.error, {}, "SEARCH_FAILED", false);
      return ok("search_code", "search", {
        query,
        count: result.count,
        results: result.results,
        content: formatSearchContent(result),
      });
    },

    async run_command({ workspace, args }) {
      const missing = requireWorkspace(workspace, "run_command");
      if (missing) return missing;
      const command = String(args.command || "").trim();
      if (!command) return fail("run_command", "Missing required command", {}, "MISSING_COMMAND", true);
      const result = await runWorkspaceCommand(workspace, command, {
        timeoutMs: Number(args.timeout_ms) || Number(args.timeoutMs) || 20000,
      });
      if (result.error) return fail("run_command", result.error, { command }, "COMMAND_FAILED", false);
      return ok("run_command", "command", { ...result, command });
    },

    async start_process({ workspace, args }) {
      const missing = requireWorkspace(workspace, "start_process");
      if (missing) return missing;
      const command = String(args.command || "").trim();
      if (!command) return fail("start_process", "Missing required command", {}, "MISSING_COMMAND", true);
      const result = startWorkspaceProcess(workspace, command);
      if (result.error) return fail("start_process", result.error, { command }, "PROCESS_START_FAILED", false);
      return ok("start_process", "process_start", result);
    },

    async read_process({ args }) {
      const id = String(args.id || "").trim();
      if (!id) return fail("read_process", "Missing required id", {}, "MISSING_ID", true);
      const result = readToolProcess(id);
      if (result.error) return fail("read_process", result.error, { id }, "PROCESS_UNKNOWN", true);
      return ok("read_process", "process_read", result);
    },

    async stop_process({ args }) {
      const id = String(args.id || "").trim();
      if (!id) return fail("stop_process", "Missing required id", {}, "MISSING_ID", true);
      const result = stopToolProcess(id);
      if (result.error) return fail("stop_process", result.error, { id }, "PROCESS_UNKNOWN", true);
      return ok("stop_process", "process_stop", { ...result, mutated: false });
    },
  };

  async function executeToolCall({ workspace, toolCall }) {
    const normalized = normalizeIncomingToolCall(toolCall);
    if (normalized.error) {
      return fail(
        normalized.toolName || "unknown",
        normalized.error,
        {},
        normalized.errorCode || "TOOL_ERROR",
        Boolean(normalized.retryable),
      );
    }
    const handler = TOOL_HANDLERS[normalized.toolName];
    if (!handler) return fail(normalized.toolName, `Unknown tool: ${normalized.toolName}`);
    try {
      return await handler({ workspace, args: normalized.args, toolCall: normalized.raw });
    } catch (err) {
      return fail(normalized.toolName, err?.message || String(err));
    }
  }

  return { TOOL_HANDLERS, executeToolCall };
}

function normalizeIncomingToolCall(toolCall) {
  const fn = toolCall?.function || {};
  const toolName = String(fn.name || toolCall?.toolName || toolCall?.action || "").trim();
  if (!ToolMap.TOOL_META[toolName]) return { error: `Unknown tool: ${toolName || "missing name"}`, toolName };
  const rawArgs = fn.arguments != null
    ? ToolMap.parseArguments(fn.arguments)
    : (toolCall.args || toolCall);
  const validated = ToolMap.validateToolCall(toolName, rawArgs || {});
  if (!validated.ok) {
    return {
      error: validated.error,
      errorCode: validated.code,
      retryable: validated.retryable,
      toolName,
    };
  }
  return { toolName, args: validated.args || {}, raw: toolCall };
}

function normalizeResult(result) {
  const toolName = result.toolName || "unknown";
  const out = {
    ok: Boolean(result.ok) && !result.error,
    toolName,
    mode: result.mode || toolName,
    summary: result.summary || summarizeResult(result),
    mutated: Boolean(result.mutated || ToolMap.isMutating(toolName)),
  };

  for (const key of [
    "file", "path", "content", "error", "files", "graph", "query", "count", "results", "command",
    "exitCode", "signal", "timedOut", "stdout", "stderr", "id", "running", "seconds",
    "lines_added", "lines_removed", "patches_applied", "fallback", "errorCode", "retryable",
  ]) {
    if (result[key] !== undefined) out[key] = result[key];
  }

  if (out.error) {
    out.ok = false;
    out.content = `Error${out.errorCode ? ` [${out.errorCode}]` : ""}: ${out.error}`;
    out.summary = out.error;
    out.mutated = false;
  } else if (out.content == null) {
    out.content = resultContent(out);
  }

  return out;
}

function summarizeResult(result) {
  if (result.error) return result.error;
  if (result.mode === "list") return `${result.files?.length || 0} files`;
  if (result.mode === "find") return `${result.count || 0} file match${result.count === 1 ? "" : "es"}`;
  if (result.mode === "read") return `Read ${result.file}`;
  if (result.mode === "index") return `Indexed ${result.files || 0} files`;
  if (result.mode === "search") return `${result.count || 0} result${result.count === 1 ? "" : "s"}`;
  if (result.mode === "command") {
    if (result.timedOut) return "Timed out";
    return result.exitCode === 0 ? "Passed" : `Exited ${result.exitCode}`;
  }
  if (result.mode === "process_start") return `Started ${result.id}`;
  if (result.mode === "process_read") return result.running ? "Running" : `Exited ${result.exitCode ?? ""}`;
  if (result.mode === "process_stop") return "Stopped";
  if (result.mode === "delete") return "Deleted";
  if (result.mode === "noop") return "No changes";
  if (result.mode === "create") return `Created ${result.file}`;
  if (result.mode === "replace") return `Replaced text in ${result.file}`;
  if (result.mode === "insert") return `Inserted text in ${result.file}`;
  if (result.mode === "append") return `Appended to ${result.file}`;
  if (result.mode === "patch") return `Patched ${result.file}`;
  return result.file ? `Wrote ${result.file}` : "Done";
}

function resultContent(result) {
  if (result.mode === "list") return `Project files:\n${(result.files || []).map((file) => `- ${file}`).join("\n")}`;
  if (result.mode === "find") return formatFindContent(result);
  if (result.mode === "index") return `Indexed ${result.files || 0} files.`;
  if (result.mode === "search") return formatSearchContent(result);
  if (result.mode === "command") {
    return [
      `Command: ${result.command}`,
      `Exit: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n");
  }
  if (result.mode === "process_start") return `Started process ${result.id}: ${result.command}`;
  if (result.mode === "process_read" || result.mode === "process_stop") {
    return [
      `Process ${result.id}: ${result.running ? "running" : `exited ${result.exitCode ?? ""}`}`,
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ].filter(Boolean).join("\n");
  }
  if (result.mode === "delete") return `OK: ${result.file} deleted`;
  if (result.mode === "noop") return `OK: ${result.file} unchanged`;
  if (result.file) return `OK: ${result.file} saved`;
  return result.summary || "OK";
}

function formatSearchContent(result) {
  const rows = (result.results || [])
    .map((row) => `File: ${row.path}\nScore: ${row.score}\nSnippet:\n${row.snippet}`)
    .join("\n\n");
  return rows || `No results for ${result.query}`;
}

function formatFindContent(result) {
  const rows = (result.results || [])
    .map((row) => `File: ${row.path}\nScore: ${row.score}`)
    .join("\n\n");
  return rows || `No files found for ${result.query}`;
}

module.exports = {
  createToolHandlers,
  normalizeIncomingToolCall,
  normalizeResult,
};
