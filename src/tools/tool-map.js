/* Canonical Ollama tool schemas and UI metadata for Pointer. */

const ToolMap = (() => {
  const TOOL_DEFS = [
    {
      name: "list_files",
      description: "List current project files. Use this as the first inventory step when unsure what exists.",
      parameters: { type: "object", properties: {} },
      meta: { label: "Listing", badge: "files", target: "workspace", mutates: false },
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
      name: "write_file",
      description:
        "Create a new file, or replace a whole file only when explicitly requested. Never paste file contents in chat.",
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
        "Create a new project file that does not already exist. Use this for new files instead of patch_file.",
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
        "Edit an existing file with exact search/replace hunks. Copy search text exactly from the file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path from project root" },
          search: { type: "string", description: "Exact text in the file for single-patch mode" },
          replace: { type: "string", description: "Replacement text for single-patch mode" },
          patches: {
            type: "array",
            description: "Multiple search/replace hunks",
            items: {
              type: "object",
              properties: {
                search: { type: "string" },
                replace: { type: "string" },
              },
              required: ["search", "replace"],
            },
          },
        },
        required: ["path"],
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
    const path = args.path == null ? undefined : String(args.path).trim();
    const command = args.command == null ? undefined : String(args.command).trim();
    const query = args.query == null ? undefined : String(args.query).trim();
    const id = args.id == null ? undefined : String(args.id).trim();

    const tool = {
      action: name,
      toolName: name,
      callId: call.id,
      args,
      raw: call,
    };

    if (path) tool.file = path;
    if (query) {
      tool.query = query;
      tool.limit = Number(args.limit) || 8;
    }
    if (command) {
      tool.command = command;
      tool.timeoutMs = Number(args.timeout_ms) || Number(args.timeoutMs) || 20000;
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
    return tool.file || tool.query || tool.command || tool.processId || "workspace";
  }

  function isMutating(actionOrTool) {
    const name = typeof actionOrTool === "string" ? actionOrTool : actionOrTool?.action || actionOrTool?.toolName;
    return Boolean(TOOL_META[name]?.mutates);
  }

  return {
    TOOLS,
    TOOL_META,
    TOOL_NAMES,
    normalizeToolCall,
    parseArguments,
    targetForTool,
    isMutating,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ToolMap;
}

globalThis.ToolMap = ToolMap;
