const READ_ONLY_REQUEST_RE = /\b(explain|describe|summari[sz]e|walk\s+me\s+through|teach|understand|what\s+does|how\s+does|why\s+does|review|read|analy[sz]e)\b/i;
const EDIT_REQUEST_RE = /\b(create|add|update|edit|modify|change|fix|write|implement|build|make|remove|delete|refactor|append|insert|rename|move|revamp|replace)\b/i;
const CHAT_MARKDOWN_REQUEST_RE = /\b(flow\s*chart|flowchart|diagram|mermaid|markdown|\.md|draw|show\s+me|explain|understand|walk\s+me\s+through)\b/i;
const EXPLICIT_FILE_MUTATION_RE = /\b(create|add|update|edit|modify|change|fix|implement|build|remove|delete|refactor|append|insert|rename|move|save|revamp|replace)\b/i;

function parseProjectFiles(dirMap) {
  if (!dirMap) return [];
  const lines = dirMap.split("\n");
  const files = [];
  const stack = [];

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;

    const depth = line.search(/\S/);
    const level = depth <= 0 ? 0 : Math.floor(depth / 2);
    const name = line.trim();

    while (stack.length > level) stack.pop();

    if (name.endsWith("/")) {
      stack.push(name.slice(0, -1));
    } else {
      files.push([...stack, name].join("/").replace(/\\/g, "/"));
    }
  }

  return files;
}

function basename(filePath) {
  return (filePath || "").replace(/\\/g, "/").split("/").pop() || "";
}

function compactDirMap(map, { maxLines = 64 } = {}) {
  if (!map) return "";
  const lines = map.split("\n");
  if (lines.length <= maxLines) return map;
  const kept = lines.slice(0, maxLines);
  kept.push(`... ${lines.length - maxLines} more entries`);
  return kept.join("\n");
}

function isEditRequest(text) {
  if (!text) return false;
  if (CHAT_MARKDOWN_REQUEST_RE.test(text) && !EXPLICIT_FILE_MUTATION_RE.test(text)) return false;
  if (READ_ONLY_REQUEST_RE.test(text) && !EDIT_REQUEST_RE.test(text)) return false;
  return EDIT_REQUEST_RE.test(text);
}

function resolveToolPath(requested, context = {}) {
  let filePath = String(requested || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!filePath) return filePath;

  if (/^relative\//i.test(filePath)) {
    filePath = filePath.replace(/^relative\//i, "");
  }

  const projectFiles = parseProjectFiles(context.dirMap || "");
  const activePath = context.activeFile?.path?.replace(/\\/g, "/") || null;
  const intentPath = context.targetFile?.replace(/\\/g, "/") || null;
  const userMessage = context.userMessage || "";

  const userNamedIntent = intentPath && (
    userMessage.includes(intentPath) || userMessage.includes(basename(intentPath))
  );

  if (intentPath && projectFiles.includes(intentPath) && userNamedIntent && filePath !== intentPath) {
    return intentPath;
  }

  if (projectFiles.includes(filePath)) return filePath;

  const name = basename(filePath);
  const matches = projectFiles.filter((file) => basename(file) === name);

  if (matches.length === 1) return matches[0];

  if (matches.length > 1) {
    if (intentPath && matches.includes(intentPath)) return intentPath;
    if (activePath && matches.includes(activePath)) return activePath;
    matches.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    return matches[0];
  }

  if (intentPath && projectFiles.includes(intentPath)) return intentPath;
  if (intentPath && basename(intentPath) === name) return intentPath;
  if (activePath && basename(activePath) === name) return activePath;

  return filePath;
}

function resolveTools(tools, context = {}) {
  return tools.map((tool) => {
    if (!tool.file) {
      if (
        ["read_file", "write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"].includes(tool.action)
        && context.targetFile
      ) {
        return { ...tool, file: context.targetFile };
      }
      return tool;
    }

    const resolved = resolveToolPath(tool.file, context);
    if (resolved === tool.file) return tool;
    return { ...tool, file: resolved, requestedFile: tool.file };
  });
}

function inferEditTarget(userMessage, activeFile, dirMap = "") {
  if (!userMessage) return activeFile?.path || null;

  const patterns = [
    /(?:update|edit|modify|change|fix|patch|rewrite|replace|revamp|in)\s+(?:the\s+)?(?:file\s+)?[`"']?([\w./\\-]+\.\w+)/i,
    /[`"']?([\w./\\-]+\.\w+)[`"']?(?:\s+file)?(?:\s+(?:to|with|that|has|contains))/i,
    /(?:for|to|into)\s+[`"']?([\w./\\-]+\.\w+)/i,
  ];

  for (const re of patterns) {
    const match = userMessage.match(re);
    if (match) {
      const raw = match[1].replace(/\\/g, "/");
      return resolveToolPath(raw, { activeFile, targetFile: raw, dirMap });
    }
  }

  return activeFile?.path || null;
}

function buildSystemContext({ dirMap = "", activeFile = null, extraFiles = [], discovery = null } = {}) {
  const parts = [
    "You are Pointer's workspace coding agent.",
    "Use native function calls for workspace actions. Never write tool syntax or fake patches in chat text.",
    "",
    "Tool strategy:",
    "1. Use find_files when the target path is unclear.",
    "2. Use search_code for symbols, features, error text, and broader code discovery.",
    "3. Use read_file before editing an existing file unless the current contents are already shown.",
    "4. Use patch_file for existing files, create_file for new files, and write_file only for explicit full rewrites.",
    "5. After code changes, run the smallest useful verification command when one exists.",
    "",
    "Behavior rules:",
    "- Never invent file paths or tool names.",
    "- Keep tool use deliberate and bounded.",
    "- If a tool fails, use the error and retry with corrected arguments instead of repeating the same call.",
    "- When the work is complete, answer the user naturally in 1-3 concise sentences.",
  ];

  if (dirMap) {
    const files = parseProjectFiles(dirMap);
    if (files.length) {
      parts.push("", "Project files (use these exact paths):", ...files.map((file) => `- ${file}`));
    } else {
      parts.push("", "Project files:", compactDirMap(dirMap));
    }
  } else {
    parts.push("", "No project folder is open. Ask the user to open a folder before editing files.");
  }

  if (discovery?.files?.length) {
    parts.push("", "Likely relevant files:", ...discovery.files.map((file) => `- ${file}`));
  }

  if (discovery?.snippets?.length) {
    parts.push("", "Likely relevant search hits:");
    for (const hit of discovery.snippets) {
      parts.push(`File: ${hit.path}`);
      parts.push(hit.snippet);
    }
  }

  const shown = new Set();

  if (activeFile?.path && activeFile.content != null) {
    const snippet = activeFile.content.length > 6000
      ? `${activeFile.content.slice(0, 6000)}\n...(truncated)`
      : activeFile.content;
    parts.push("", `Currently open - ${activeFile.path}:`, "```", snippet, "```");
    shown.add(activeFile.path.replace(/\\/g, "/"));
  }

  for (const file of extraFiles) {
    if (!file?.path || file.content == null) continue;
    const norm = file.path.replace(/\\/g, "/");
    if (shown.has(norm)) continue;
    shown.add(norm);
    const snippet = file.content.length > 6000
      ? `${file.content.slice(0, 6000)}\n...(truncated)`
      : file.content;
    parts.push("", `File contents - ${file.path}:`, "```", snippet, "```");
  }

  return parts.join("\n");
}

module.exports = {
  buildSystemContext,
  inferEditTarget,
  isEditRequest,
  parseProjectFiles,
  resolveToolPath,
  resolveTools,
};
