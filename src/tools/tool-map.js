/* Canonical Ollama tool schemas and UI metadata for Pointer. */

const ToolMap = (() => {
  const TOOL_DEFS = [
    {
      name: "find_files",
      description: "Find files in the workspace by path, basename, extension, or partial name before reading them.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Filename, partial path, extension, or folder hint" },
          limit: { type: "number", description: "Maximum results, usually 5-10" },
        },
        required: ["query"],
      },
      meta: { label: "Finding", badge: "files", target: "query", mutates: false },
    },
    {
      name: "list_files",
      description: "List current project files. Use this as the first inventory step when unsure what exists.",
      parameters: { type: "object", properties: {} },
      meta: { label: "Listing", badge: "files", target: "workspace", mutates: false },
    },
    {
      name: "inspect_workspace",
      description:
        "Return a compact project overview: file count, top folders, important config files, detected package scripts, and likely verification commands. Use this before broad refactors, revamps, debugging, or unfamiliar projects.",
      parameters: { type: "object", properties: {} },
      meta: { label: "Inspecting", badge: "overview", target: "workspace", mutates: false },
    },
    {
      name: "read_file",
      description:
        "Read the current contents of a project file. Use this before editing any existing file whose contents are not shown.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root, e.g. calculator.py" },
        },
        required: ["path"],
      },
      meta: { label: "Reading", badge: "read", target: "path", mutates: false },
    },
    {
      name: "read_files",
      description:
        "Read several project files in one call. Use when a change spans multiple known files, when comparing related files, or after find_files/search_code identifies multiple targets.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            description: "Relative paths from project root. Keep this focused, usually 2-6 files.",
            items: { type: "string" },
          },
        },
        required: ["paths"],
      },
      meta: { label: "Reading", badge: "batch", target: "paths", mutates: false },
    },
    {
      name: "write_file",
      description:
        "Create a new file, or replace a whole file only when explicitly requested. This call writes exactly one file. Never paste file contents in chat.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root, e.g. main.py" },
          content: { type: "string", description: "Complete file contents" },
        },
        required: ["path", "content"],
      },
      meta: { label: "Writing", badge: "write", target: "path", mutates: true },
    },
    {
      name: "create_file",
      description:
        "Create a new project file that does not already exist. Use this for new files instead of patch_file. This call creates exactly one file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root, e.g. main.py" },
          content: { type: "string", description: "Complete file contents" },
        },
        required: ["path", "content"],
      },
      meta: { label: "Creating", badge: "create", target: "path", mutates: true },
    },
    {
      name: "patch_file",
      description:
        "Edit one existing file by replacing one exact block. Read the current file first, copy search text exactly, and call patch_file again for another separate block.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          search: { type: "string", description: "Exact current text that should match once" },
          replace: { type: "string", description: "Complete replacement for the matched text" },
        },
        required: ["path", "search", "replace"],
      },
      meta: { label: "Patching", badge: "patch", target: "path", mutates: true },
    },
    {
      name: "replace_in_file",
      description:
        "Replace exact text inside an existing file. Use after read_file when you know the exact old text.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          old_text: { type: "string", description: "Exact text currently in the file" },
          new_text: { type: "string", description: "Replacement text" },
        },
        required: ["path", "old_text", "new_text"],
      },
      meta: { label: "Replacing", badge: "replace", target: "path", mutates: true },
    },
    {
      name: "insert_in_file",
      description:
        "Insert text before or after an exact anchor in an existing file. Use this for adding functions/imports.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          anchor: { type: "string", description: "Exact anchor text currently in the file" },
          content: { type: "string", description: "Text to insert" },
          position: { type: "string", enum: ["before", "after"], description: "Insert before or after the anchor" },
        },
        required: ["path", "anchor", "content"],
      },
      meta: { label: "Inserting", badge: "insert", target: "path", mutates: true },
    },
    {
      name: "append_file",
      description:
        "Append text to the end of an existing file. Use this for simple additions when no exact patch anchor is needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          content: { type: "string", description: "Text to append" },
        },
        required: ["path", "content"],
      },
      meta: { label: "Appending", badge: "append", target: "path", mutates: true },
    },
    {
      name: "delete_file",
      description: "Delete an existing project file only when the user explicitly asks to delete/remove it.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
        },
        required: ["path"],
      },
      meta: { label: "Deleting", badge: "delete", target: "path", mutates: true },
    },
    {
      name: "index_workspace",
      description: "Build a local code index and dependency/symbol graph for broad codebase work.",
      parameters: { type: "object", properties: {} },
      meta: { label: "Indexing", badge: "index", target: "workspace", mutates: false },
    },
    {
      name: "search_code",
      description: "Search the local workspace index for relevant files and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms, symbol name, error text, or feature name" },
          limit: { type: "number", description: "Maximum results, usually 5-8" },
        },
        required: ["query"],
      },
      meta: { label: "Searching", badge: "search", target: "query", mutates: false },
    },
    {
      name: "search_web",
      description:
        "Search the public web for current facts, official documentation, APIs, releases, or external references. Search first, then read only the most relevant result pages with fetch_url.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Focused search query, including product/version when relevant" },
          limit: { type: "number", description: "Maximum results, usually 3-6" },
        },
        required: ["query"],
      },
      meta: { label: "Searching", badge: "web", target: "query", mutates: false },
    },
    {
      name: "fetch_url",
      description:
        "Read one public HTTP/HTTPS page selected from web search. Returns compact readable text and the final source URL. Private networks, binary content, large responses, and unsafe redirects are blocked.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Exact public page URL from a search result" },
          max_chars: { type: "number", description: "Maximum readable characters, usually 8000-18000" },
        },
        required: ["url"],
      },
      meta: { label: "Reading", badge: "web page", target: "url", mutates: false },
    },
    {
      name: "get_file_outline",
      description:
        "Return imports and symbol/function/class outline for one file without reading the full contents. Use this to navigate large files before choosing exact sections to read or patch.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
        },
        required: ["path"],
      },
      meta: { label: "Outlining", badge: "outline", target: "path", mutates: false },
    },
    {
      name: "run_command",
      description: "Run a workspace command and wait for it to finish. Use for tests, lint, build, or diagnostics.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run from the workspace root" },
          timeout_ms: { type: "number", description: "Timeout in milliseconds, default 20000" },
        },
        required: ["command"],
      },
      meta: { label: "Running", badge: "run", target: "command", mutates: false },
    },
    {
      name: "start_process",
      description: "Start a long-running workspace process such as a dev server.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to start from the workspace root" },
        },
        required: ["command"],
      },
      meta: { label: "Starting", badge: "start", target: "command", mutates: false },
    },
    {
      name: "read_process",
      description: "Read stdout/stderr and running status for a process started with start_process.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Process id returned by start_process, e.g. proc-1" },
        },
        required: ["id"],
      },
      meta: { label: "Monitoring", badge: "watch", target: "id", mutates: false },
    },
    {
      name: "stop_process",
      description: "Stop a process started with start_process after testing or when it is no longer needed.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Process id returned by start_process, e.g. proc-1" },
        },
        required: ["id"],
      },
      meta: { label: "Stopping", badge: "stop", target: "id", mutates: false },
    },
  ];

  const TOOLS = TOOL_DEFS.map(({ name, description, parameters }) => ({
    type: "function",
    function: { name, description, parameters },
  }));

  const TOOL_META = Object.fromEntries(TOOL_DEFS.map((tool) => [tool.name, tool.meta]));
  const TOOL_NAMES = TOOL_DEFS.map((tool) => tool.name);

  function sanitizePath(raw) {
    return String(raw == null ? "" : raw)
      .replace(/\\/g, "/")
      .trim()
      .replace(/^\/+/, "");
  }

  function sanitizeText(raw) {
    return String(raw == null ? "" : raw).trim();
  }

  function clampLimit(raw, fallback = 8) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(Math.round(value), 20));
  }

  function clampTimeout(raw, fallback = 20000) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1000, Math.min(Math.round(value), 120000));
  }

  function parseArguments(raw) {
    if (!raw) return {};
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function normalizeToolCall(call) {
    const fn = call?.function || {};
    const name = String(fn.name || "").trim();
    if (!TOOL_META[name]) return null;

    const args = parseArguments(fn.arguments);
    const path = args.path == null ? undefined : sanitizePath(args.path);
    const paths = Array.isArray(args.paths)
      ? args.paths.map(sanitizePath).filter(Boolean)
      : undefined;
    const command = args.command == null ? undefined : sanitizeText(args.command);
    const query = args.query == null ? undefined : sanitizeText(args.query);
    const url = args.url == null ? undefined : sanitizeText(args.url);
    const id = args.id == null ? undefined : sanitizeText(args.id);

    const tool = {
      action: name,
      toolName: name,
      callId: call.id,
      args,
      raw: call,
    };

    if (path) tool.file = path;
    if (paths?.length) tool.files = paths;
    if (query) {
      tool.query = query;
      tool.limit = clampLimit(args.limit, 8);
    }
    if (url) tool.url = url;
    if (command) {
      tool.command = command;
      tool.timeoutMs = clampTimeout(args.timeout_ms ?? args.timeoutMs, 20000);
    }
    if (id) tool.processId = id;
    if (["write_file", "create_file", "append_file"].includes(name)) tool.code = String(args.content ?? args.code ?? "");
    if (["patch_file", "replace_in_file", "insert_in_file"].includes(name)) {
      if (Array.isArray(args.patches)) {
        tool.patches = args.patches.map((patch) => ({
          search: String(patch?.search ?? ""),
          replace: String(patch?.replace ?? ""),
        }));
      } else if (name === "replace_in_file") {
        tool.patches = [{
          search: String(args.old_text ?? args.search ?? ""),
          replace: String(args.new_text ?? args.replace ?? ""),
        }];
      } else if (name === "insert_in_file") {
        const anchor = String(args.anchor ?? "");
        const insert = String(args.content ?? args.text ?? "");
        const position = String(args.position || "after").toLowerCase() === "before" ? "before" : "after";
        tool.patches = [{
          search: anchor,
          replace: position === "before" ? `${insert}${anchor}` : `${anchor}${insert}`,
        }];
      } else {
        tool.patches = [{
          search: String(args.search ?? ""),
          replace: String(args.replace ?? ""),
        }];
      }
    }

    return tool;
  }

  function targetForTool(tool) {
    if (tool.file) return tool.file;
    if (tool.files?.length) return `${tool.files.length} files`;
    return tool.query || tool.url || tool.command || tool.processId || "workspace";
  }

  function isMutating(actionOrTool) {
    const name = typeof actionOrTool === "string" ? actionOrTool : actionOrTool?.action || actionOrTool?.toolName;
    return Boolean(TOOL_META[name]?.mutates);
  }

  function validationError(error, code, retryable = true) {
    return { ok: false, error, code, retryable };
  }

  function validateToolCall(toolName, rawArgs = {}) {
    if (!TOOL_META[toolName]) {
      return validationError(`Unknown tool: ${toolName || "missing name"}`, "UNKNOWN_TOOL", false);
    }

    const args = { ...rawArgs };

    if (args.path != null) args.path = sanitizePath(args.path);
    if (args.query != null) args.query = sanitizeText(args.query);
    if (args.url != null) args.url = sanitizeText(args.url);
    if (args.command != null) args.command = sanitizeText(args.command);
    if (args.id != null) args.id = sanitizeText(args.id);
    if (args.anchor != null) args.anchor = String(args.anchor);
    if (args.content != null) args.content = String(args.content);
    if (args.code != null) args.code = String(args.code);
    if (args.search != null) args.search = String(args.search);
    if (args.replace != null) args.replace = String(args.replace);
    if (args.old_text != null) args.old_text = String(args.old_text);
    if (args.new_text != null) args.new_text = String(args.new_text);
    if (args.limit != null) args.limit = clampLimit(args.limit, 8);
    if (args.max_chars != null) {
      const maxChars = Number(args.max_chars);
      args.max_chars = Number.isFinite(maxChars) ? Math.max(1000, Math.min(Math.round(maxChars), 30000)) : 18000;
    }
    if (args.timeout_ms != null || args.timeoutMs != null) {
      args.timeout_ms = clampTimeout(args.timeout_ms ?? args.timeoutMs, 20000);
    }

    if (["read_file", "write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file", "get_file_outline"].includes(toolName)) {
      if (!args.path) return validationError("Missing required path", "MISSING_PATH");
    }

    if (toolName === "read_files") {
      const paths = Array.isArray(args.paths)
        ? args.paths.map(sanitizePath).filter(Boolean)
        : [];
      if (!paths.length) return validationError("Missing required paths", "MISSING_PATHS");
      args.paths = paths.slice(0, 12);
    }

    if (["find_files", "search_code", "search_web"].includes(toolName)) {
      if (!args.query) return validationError("Missing required query", "MISSING_QUERY");
      args.limit = clampLimit(args.limit, toolName === "search_web" ? 6 : 8);
      if (toolName === "search_web") args.query = args.query.slice(0, 300);
    }

    if (toolName === "fetch_url") {
      if (!args.url) return validationError("Missing required URL", "MISSING_URL");
      if (args.url.length > 2048) return validationError("URL is too long", "INVALID_URL", false);
      args.max_chars = Number.isFinite(Number(args.max_chars))
        ? Math.max(1000, Math.min(Math.round(Number(args.max_chars)), 30000))
        : 18000;
    }

    if (["run_command", "start_process"].includes(toolName)) {
      if (!args.command) return validationError("Missing required command", "MISSING_COMMAND");
    }

    if (["read_process", "stop_process"].includes(toolName)) {
      if (!args.id) return validationError("Missing required id", "MISSING_ID");
    }

    if (["write_file", "create_file", "append_file"].includes(toolName)) {
      const content = args.content ?? args.code;
      if (content == null) return validationError("Missing required content", "MISSING_CONTENT");
      args.content = String(content);
    }

    if (toolName === "patch_file") {
      if (Array.isArray(args.patches) && args.patches.length) {
        args.patches = args.patches.map((patch) => ({
          search: String(patch?.search ?? ""),
          replace: String(patch?.replace ?? ""),
        }));
      } else {
        args.patches = [{ search: String(args.search ?? ""), replace: String(args.replace ?? "") }];
      }

      if (!args.patches.length || args.patches.some((patch) => !patch.search)) {
        return validationError("Missing required search text", "MISSING_SEARCH");
      }
    }

    if (toolName === "replace_in_file") {
      const oldText = String(args.old_text ?? args.search ?? "");
      if (!oldText) return validationError("Missing required old_text", "MISSING_SEARCH");
      args.old_text = oldText;
      args.new_text = String(args.new_text ?? args.replace ?? "");
    }

    if (toolName === "insert_in_file") {
      if (!String(args.anchor ?? "")) return validationError("Missing required anchor", "MISSING_ANCHOR");
      const content = String(args.content ?? args.text ?? "");
      if (!content) return validationError("Missing required content", "MISSING_CONTENT");
      args.content = content;
      args.position = String(args.position || "after").toLowerCase() === "before" ? "before" : "after";
    }

    return { ok: true, args };
  }

  return {
    TOOLS,
    TOOL_META,
    TOOL_NAMES,
    normalizeToolCall,
    parseArguments,
    targetForTool,
    isMutating,
    sanitizePath,
    validateToolCall,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ToolMap;
}

globalThis.ToolMap = ToolMap;
