/* Tool definitions + agent parsers (Cursor-style tool loop) */

const ToolParser = (() => {
  const MAX_AGENT_ROUNDS = 8;
  const OperatingModes = globalThis.XekuteOperatingModes;
  if (!OperatingModes) throw new Error("XEKUTE operating modes must load before the toolbox controller.");
  const MODE_PROFILES = OperatingModes.MODE_PROFILES;

  function normalizeProfile(familyOrMode = "assist", mode = "agent") {
    return globalThis.XekutePromptCompiler
      ? globalThis.XekutePromptCompiler.normalizeProfile(familyOrMode, mode)
      : OperatingModes.normalizeProfile(familyOrMode, mode);
  }

  const OLLAMA_TOOLS = Array.isArray(globalThis.ToolMap?.TOOLS) ? globalThis.ToolMap.TOOLS : [];

  // Prompt text is compiled from src/prompts/instructions/system-prompt.js.
  if (!globalThis.XekutePromptCompiler) throw new Error("XEKUTE prompt compiler must load before tools.js");
  const SHARED_SYSTEM_PROMPT = globalThis.XekutePromptCompiler.compile({ family: "assist", mode: "ask" });
  const SHARED_MODE_PROMPTS = Object.fromEntries(Object.entries(globalThis.XekutePromptCompiler.MODE_OVERLAYS).map(([key, value]) => [key, value]));

  const FENCE_PATTERNS = [
    /```(?:[\w-]+(?:\s+)?)?(?:file:|path:)([^\n`]+)\s*\n([\s\S]*?)```/gi,
    /```[\w-]*\s*\n(?:file:|path:)([^\n`]+)\s*\n([\s\S]*?)```/gi,
  ];

  const LOOSE_FILE_RE = /(?:^|\n)(?:file:|path:)([^\n\s]+\.\w+)\s*\n([\s\S]*?)(?=\n(?:file:|path:)[^\n]+\.\w+|\n```|$)/gi;
  const MARKDOWN_CODE_RE = /```(?:[\w-]+)?\s*\n([\s\S]*?)```/gi;

  const PATCH_FENCE_RE = /```patch:([^\n`]+)\s*\n<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE\s*\n```/gi;

  const LOOSE_PATCH_RE = /(?:^|\n)patch:[^\n]+\n<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/g;
  const TOOL_NAME_PATTERN = "exec_command|read_file|search_workspace|apply_patch|inspect_environment|manage_plan|manage_state|ingest_traffic|manage_identity|replay_request|run_test_case|browser_action|compare_responses|verify_finding|store_finding|attack_graph|delegate_agent|query_assessment|expand_evidence";
  const PSEUDO_TOOL_RE = new RegExp(`(?:"[^"\\n{}]*"\\s*}?\\s*)?(?:${TOOL_NAME_PATTERN})\\s*\\{[^}\\n]*(?:\\}|\\n|$)`, "gi");
  const PSEUDO_TOOL_CALL_RE = /(?:^|[\s"'`}>])([a-z_][a-z0-9_]*)\s*\{\s*([^}\n]*)/gi;

  const BOILERPLATE_RES = [
    /^oops!?[^\n]*\n?/gim,
    /^first step:?\s*\n?/gim,
    /^but wait[^\n]*\n?/gim,
    /^but in my[^\n]*\n?/gim,
    /^in my (?:last|previous) response[^\n]*\n?/gim,
    /^the tool output[^\n]*\n?/gim,
    /^after rethinking[^\n]*\n?/gim,
    /^rule \d+[^\n]*\n?/gim,
    /^final version of [^\n]+:?\s*\n?/gim,
    /^here'?s how i would (?:modify|update|change|edit)[^\n]*\n?/gim,
    /^here'?s the updated code(?: for[^\n]*)?\:?\s*\n?/gim,
    /^text\s*\n\s*copy\s*\n?/gim,
    /^\s*copy\s*$/gim,
  ];

  function parseJsonArgs(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  const isEditRequest = (text) => globalThis.XekuteRequestIntentRules.isEditRequest(text);

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

  function basename(path) {
    return (path || "").replace(/\\/g, "/").split("/").pop() || "";
  }

  function resolveToolPath(requested, context = {}) {
    let path = String(requested || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
    if (!path) return path;

    if (/^relative\//i.test(path)) {
      path = path.replace(/^relative\//i, "");
    }

    const projectFiles = parseProjectFiles(context.dirMap || "");
    const activePath = context.activeFile?.path?.replace(/\\/g, "/") || null;
    const intentPath = context.targetFile?.replace(/\\/g, "/") || null;
    const userMessage = context.userMessage || "";

    const userNamedIntent = intentPath && (
      userMessage.includes(intentPath) || userMessage.includes(basename(intentPath))
    );

    // User explicitly named a file â€” override a wrong model path (e.g. model says main.py, user said calculator.py)
    if (intentPath && projectFiles.includes(intentPath) && userNamedIntent && path !== intentPath) {
      return intentPath;
    }

    if (projectFiles.includes(path)) return path;

    const name = basename(path);
    const matches = projectFiles.filter((file) => basename(file) === name);

    if (matches.length === 1) return matches[0];

    if (matches.length > 1) {
      if (intentPath && matches.includes(intentPath)) return intentPath;
      if (activePath && matches.includes(activePath)) return activePath;
      matches.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
      return matches[0];
    }

    // Requested path not in project â€” fall back to what the user asked for
    if (intentPath && projectFiles.includes(intentPath)) return intentPath;

    if (intentPath && basename(intentPath) === name) return intentPath;
    if (activePath && basename(activePath) === name) return activePath;

    return path;
  }

  function resolveTools(tools, context = {}) {
    return tools.map((tool) => {
      if (!tool.file) return tool;
      if (tool.action === "apply_patch") {
        const projectFiles = parseProjectFiles(context.dirMap || "");
        const requested = String(tool.file || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
        const intentPath = context.targetFile?.replace(/\\/g, "/") || null;
        const isCreateIntent = /\b(create|add|make|write)\b/i.test(context.userMessage || "");
        if (
          isCreateIntent
          && intentPath
          && requested
          && requested !== intentPath
          && !projectFiles.includes(intentPath)
          && projectFiles.includes(requested)
        ) {
          return { ...tool, file: intentPath, requestedFile: tool.file };
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

    if (/\b(create|add|make|write)\b/i.test(userMessage) && /\bmain\s+(?:file|script|py)\b/i.test(userMessage)) {
      return "main.py";
    }

    const patterns = [
      /(?:update|edit|modify|change|fix|patch|rewrite|in)\s+(?:the\s+)?(?:file\s+)?[`"']?([\w./\\-]+\.\w+)/i,
      /[`"']?([\w./\\-]+\.\w+)[`"']?(?:\s+file)?(?:\s+(?:to|with|that|has|contains))/i,
      /(?:for|to|into)\s+[`"']?([\w./\\-]+\.\w+)/i,
      /\b([\w./\\-]+\.\w+)\b/,
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

  function hasCodeBlocks(text) {
    if (!text) return false;
    MARKDOWN_CODE_RE.lastIndex = 0;
    return MARKDOWN_CODE_RE.test(text);
  }

  function normalizeNativeToolCall(call) {
    return globalThis.ToolMap?.normalizeToolCall(call) || null;
  }

  function parseNativeToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.map(normalizeNativeToolCall).filter(Boolean);
  }

  function pushFenceMatch(tools, file, code) {
    const path = (file || "").trim().replace(/^["'`]|["'`]$/g, "");
    const content = (code ?? "").replace(/\s+$/, "");
    if (path && content) {
      tools.push({
        action: "apply_patch",
        toolName: "apply_patch",
        args: { operations: [{ kind: "create", path, content }] },
        source: "fence",
      });
    }
  }

  function fileExistsInProject(path, dirMap) {
    if (!path || !dirMap) return false;
    return parseProjectFiles(dirMap).includes(path.replace(/\\/g, "/"));
  }

  function parsePatchFences(text) {
    const byFile = new Map();
    if (!text) return [];

    PATCH_FENCE_RE.lastIndex = 0;
    let match;
    while ((match = PATCH_FENCE_RE.exec(text)) !== null) {
      const file = (match[1] || "").trim().replace(/^["'`]|["'`]$/g, "");
      if (!file) continue;
      if (!byFile.has(file)) {
        byFile.set(file, {
          action: "apply_patch",
          toolName: "apply_patch",
          file,
          args: { operations: [] },
          source: "patch_fence",
        });
      }
      byFile.get(file).args.operations.push({
        kind: "modify",
        path: file,
        search: match[2] ?? "",
        replaceWith: match[3] ?? "",
      });
    }

    return [...byFile.values()];
  }

  function parseFenceEdits(text) {
    const tools = [];
    if (!text) return tools;

    for (const re of FENCE_PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null) {
        pushFenceMatch(tools, match[1], match[2]);
      }
    }

    if (!tools.length) {
      LOOSE_FILE_RE.lastIndex = 0;
      let match;
      while ((match = LOOSE_FILE_RE.exec(text)) !== null) {
        pushFenceMatch(tools, match[1], match[2]);
      }
    }

    return dedupeTools(tools);
  }

  function parseLooseArgs(raw) {
    const args = {};
    if (!raw) return args;
    const re = /([a-zA-Z_][\w-]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^,\s}]+))/g;
    let match;
    while ((match = re.exec(raw)) !== null) {
      args[match[1]] = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
    }
    return args;
  }

  function parsePseudoToolCalls(text, context = {}) {
    const tools = [];
    if (!text) return tools;

    PSEUDO_TOOL_CALL_RE.lastIndex = 0;
    let match;
    while ((match = PSEUDO_TOOL_CALL_RE.exec(text)) !== null) {
      const rawName = (match[1] || "").toLowerCase();
      const args = parseLooseArgs(match[2] || "");
      const path = String(args.path || args.file || context.targetFile || "").trim();

      if (rawName === "read_file" && path) {
        tools.push({ action: "read_file", toolName: "read_file", file: path, source: "pseudo_tool" });
      } else if (rawName === "search_workspace" && args.query) {
        tools.push({ action: "search_workspace", toolName: "search_workspace", query: args.query, mode: args.mode || "text", source: "pseudo_tool" });
      } else if (rawName === "inspect_environment") {
        tools.push({ action: "inspect_environment", toolName: "inspect_environment", source: "pseudo_tool" });
      } else if (rawName === "exec_command" && args.command) {
        tools.push({ action: "exec_command", toolName: "exec_command", command: args.command, timeoutMs: Number(args.timeout_ms) || 20000, source: "pseudo_tool" });
      }
    }

    return dedupeTools(tools);
  }

  function parseMarkdownCodeEdits(text, context = {}) {
    const target = context.targetFile || inferEditTarget(context.userMessage, context.activeFile, context.dirMap);
    if (!target || !text) return [];

    MARKDOWN_CODE_RE.lastIndex = 0;
    const blocks = [...text.matchAll(MARKDOWN_CODE_RE)];
    if (!blocks.length) return [];

    let best = "";
    for (const match of blocks) {
      const code = (match[1] ?? "").replace(/\s+$/, "");
      if (code.length > best.length) best = code;
    }

    if (best.length < 8) return [];

    const exists = fileExistsInProject(target, context.dirMap || "");
    if (exists) {
      // Existing file: Python diff engine applies minimal hunks from full proposed content.
      return [{
        action: "apply_patch",
        toolName: "apply_patch",
        file: target,
        args: { operations: [{ kind: "modify", path: target, content: best }] },
        source: "markdown_diff",
      }];
    }

    return [{
      action: "apply_patch",
      toolName: "apply_patch",
      file: target,
      args: { operations: [{ kind: "create", path: target, content: best }] },
      source: "markdown",
    }];
  }

  function dedupeTools(tools) {
    const seen = new Set();
    return tools.filter((t) => {
      const ops = Array.isArray(t?.args?.operations) ? JSON.stringify(t.args.operations) : (t.code || t.patches?.[0]?.search || "").slice(0, 80);
      const key = `${t.action}\0${t.file}\0${ops}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function collectToolsFromResponse(rawContent, nativeToolCalls, context = {}) {
    const native = parseNativeToolCalls(nativeToolCalls);
    return resolveTools(dedupeTools(native), context);
  }

  function stripAllFileBlocks(text) {
    if (!text) return "";
    let result = text;
    for (const re of FENCE_PATTERNS) {
      result = result.replace(re, "");
    }
    result = result.replace(LOOSE_FILE_RE, "");
    result = result.replace(PATCH_FENCE_RE, "");
    result = result.replace(LOOSE_PATCH_RE, "");
    result = result.replace(PSEUDO_TOOL_RE, "");
    return result;
  }

  function stripBoilerplate(text) {
    let result = text;
    for (const re of BOILERPLATE_RES) {
      result = result.replace(re, "");
    }
    result = result.replace(/(?:^|\n)(?:file:|path:)[^\n]+/g, "");

    const brokenTrace = /tool output|previous patch|my previous response|search text wasn't found/i.test(text);
    if (brokenTrace) {
      const summary = result.match(/(?:^|\n)(This change[^\n]*(?:\n(?!Final version of)[^\n]*){0,2})/i);
      if (summary?.[1]) result = summary[1];
    }

    return result.trim();
  }

  function stripGenericCodeBlocks(text) {
    return text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (block, info = "") => {
      return String(info).trim().toLowerCase() === "mermaid" ? block : "";
    }).trim();
  }

  function stripFenceEdits(text, { streaming = false, stripCodeBlocks = true, stripBoilerplateText = true } = {}) {
    if (!text) return "";

    let result = stripAllFileBlocks(text);
    if (stripBoilerplateText) result = stripBoilerplate(result);
    if (stripCodeBlocks) {
      result = stripGenericCodeBlocks(result);
    }
    result = result.trim();

    if (streaming) {
      // Only trim incomplete trailing fence/tool syntax. Do not wipe unfinished
      // prose — that froze the live reply on the first few characters.
      result = result
        .replace(/```(?:[\w-]+\s+)?(?:file:|path:)[^\n`]*$/i, "")
        .replace(/```[\w-]*\s*\n(?:file:|path:)[^\n`]*$/i, "")
        .replace(/```patch:[^\n`]*$/i, "")
        .replace(/```[^\n`]*$/i, "")
        .replace(/(?:^|\n)(?:file:|path:)[^\n]+$/i, "")
        .replace(/(?:^|\n)patch:[^\n]+$/i, "")
        .replace(/<<<<<<< SEARCH[\s\S]*$/i, "")
        .replace(new RegExp(`(\\s)(?:${TOOL_NAME_PATTERN})\\s*\\{[\\s\\S]*$`, "i"), "$1")
        .trim();
    }

    return result;
  }

  function cleanReplyForDisplay(text, { streaming = false, stripCodeBlocks = false } = {}) {
    if (!text) return "";
    const cleaned = stripFenceEdits(text, {
      streaming,
      stripCodeBlocks,
      // Boilerplate stripping during live streaming removes normal agent lines
      // ("I will…", "Then I…") and freezes the UI on the first few characters.
      stripBoilerplateText: !streaming,
    });
    const raw = String(text || "").trim();
    if (!cleaned && raw && !isOnlyToolSyntax(raw)) return raw;
    if (streaming && cleaned && raw && cleaned.length < Math.min(24, Math.floor(raw.length * 0.35))) {
      return raw;
    }
    return cleaned;
  }

  function isRepetitiveLoop(text) {
    if (!text) return false;
    const raw = String(text);
    if (raw.length < 260) return false;

    if (/(?:\b[a-z_][a-z0-9_]*\b\s*,\s*){18,}/i.test(raw)) return true;

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 8);
    let sameLineRun = 1;
    for (let i = 1; i < lines.length; i += 1) {
      sameLineRun = lines[i] === lines[i - 1] ? sameLineRun + 1 : 1;
      if (sameLineRun >= 5) return true;
    }

    const words = raw
      .toLowerCase()
      .match(/[a-z_][a-z0-9_]*|\d+/g) || [];
    if (words.length < 50) return false;

    const tail = words.slice(-180);
    const uniqueRatio = new Set(tail).size / tail.length;
    if (tail.length >= 80 && uniqueRatio < 0.16) return true;

    for (let size = 2; size <= 8; size += 1) {
      let run = 1;
      for (let i = size; i + size <= tail.length; i += size) {
        const prev = tail.slice(i - size, i).join("\0");
        const next = tail.slice(i, i + size).join("\0");
        run = prev === next ? run + 1 : 1;
        if (run >= 7) return true;
      }
    }

    return false;
  }

  function isOnlyToolSyntax(text) {
    if (!text) return false;
    const stripped = stripAllFileBlocks(text)
      .replace(/[{}\[\]":,._\-\sA-Za-z0-9/\\]+/g, "")
      .trim();
    const hasToolWord = new RegExp(TOOL_NAME_PATTERN, "i").test(text);
    return hasToolWord && stripped.length === 0;
  }

  function compactDirMap(map, { maxLines = 48 } = {}) {
    if (!map) return "";
    const lines = map.split("\n");
    if (lines.length <= maxLines) return map;
    const kept = lines.slice(0, maxLines);
    kept.push(`â€¦ ${lines.length - maxLines} more entries`);
    return kept.join("\n");
  }

  function buildSystemContext({
    mode = "agent",
    modeFamily = "assist",
    contextBudget = 4096,
    dirMap = "",
    activeFile = null,
    extraFiles = [],
  } = {}) {
    const profile = normalizeProfile(modeFamily, mode);
    const selectedMode = profile.key;
    const fileLimit = contextBudget <= 4096 ? 32 : contextBudget <= 8192 ? 56 : contextBudget <= 16384 ? 100 : 180;
    const embeddedLimit = contextBudget <= 4096 ? 4200 : contextBudget <= 8192 ? 8000 : contextBudget <= 16384 ? 16000 : 28000;
    const parts = [
      globalThis.XekutePromptCompiler
        ? globalThis.XekutePromptCompiler.compile({ family: profile.family, mode: profile.key })
        : SHARED_SYSTEM_PROMPT,
    ];

    if (dirMap) {
      const files = parseProjectFiles(dirMap);
      const boundedFiles = files.length > fileLimit
        ? [...files.slice(0, fileLimit), `... ${files.length - fileLimit} more files omitted; use find_files for exact paths`]
        : files;
      if (files.length) {
        parts.push(`Project files (use these exact paths):\n${boundedFiles.map((f) => `- ${f}`).join("\n")}`);
      } else {
        parts.push(`Project files:\n${compactDirMap(dirMap)}`);
      }
    } else {
      parts.push("No project folder is open. Ask the user to open a folder before editing files.");
    }

    const shown = new Set();
    let remainingChars = embeddedLimit;
    for (const file of [activeFile, ...extraFiles]) {
      if (!file?.path || file.content == null) continue;
      const norm = file.path.replace(/\\/g, "/");
      if (shown.has(norm)) continue;
      if (remainingChars < 600) break;
      shown.add(norm);
      const content = String(file.content);
      const allowance = Math.min(remainingChars, contextBudget <= 4096 ? 3200 : 6000);
      const snippet = content.length > allowance
        ? `${content.slice(0, Math.floor(allowance * 0.7))}\n...(truncated)...\n${content.slice(-Math.ceil(allowance * 0.3))}`
        : content;
      remainingChars -= snippet.length;
      const label = file === activeFile ? "Currently open" : "File contents";
      parts.push(`${label} - ${file.path}:\n\`\`\`\n${snippet}\n\`\`\``);
    }

    return parts.join("\n\n");
  }

  function normalizeToolCallsForApi(toolCalls) {
    if (!Array.isArray(toolCalls)) return [];

    return toolCalls
      .map((call) => {
        const fn = call?.function;
        if (!fn?.name) return null;

        let args = fn.arguments;
        if (typeof args === "string") {
          const parsed = parseJsonArgs(args);
          if (!parsed) return null;
          args = parsed;
        }
        if (!args || typeof args !== "object") return null;

        return {
          id: call.id,
          type: call.type || "function",
          function: {
            ...(Number.isInteger(fn.index) ? { index: fn.index } : {}),
            name: fn.name,
            arguments: args,
          },
        };
      })
      .filter(Boolean);
  }

  function toolResultMessage(result) {
    if (result?.content != null) return String(result.content);
    if (result.error) return `Error: ${result.error}`;
    if (result.mode === "list") {
      return `Project files:\n${(result.files || []).map((f) => `- ${f}`).join("\n")}`;
    }
    if (result.mode === "inspect") return result.content || result.summary || "Workspace inspected.";
    if (result.mode === "read") {
      return `Contents of ${result.file}:\n${result.content ?? ""}`;
    }
    if (result.mode === "read_many") return result.content || result.summary || "Files read.";
    if (result.mode === "index") {
      const graph = (result.graph || [])
        .slice(0, 20)
        .map((g) => `${g.file}: symbols=${(g.symbols || []).join(", ") || "-"} imports=${(g.imports || []).join(", ") || "-"}`)
        .join("\n");
      return `Indexed ${result.files} files.\n${graph}`;
    }
    if (result.mode === "search") {
      const rows = (result.results || [])
        .map((r) => `File: ${r.path}\nScore: ${r.score}\nSnippet:\n${r.snippet}`)
        .join("\n\n");
      return rows || `No results for ${result.query}`;
    }
    if (result.mode === "web_search" || result.mode === "web_page") return result.content || result.summary || "Web research completed.";
    if (result.mode === "outline") return result.content || result.summary || `Outlined ${result.file}.`;
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
    if (result.mode === "questions") return result.summary || `Saved questions to ${result.file}`;
    if (result.mode === "delete") return `OK: ${result.file} deleted`;
    if (result.mode === "noop") return `OK: ${result.file} unchanged (content was identical)`;
    return `OK: ${result.file} saved`;
  }

  function toolStatusLabel(tool, phase = "active") {
    const target = globalThis.ToolMap?.targetForTool(tool) || tool.file || tool.query || tool.command || tool.processId || "workspace";
    const verb = globalThis.ToolMap?.TOOL_META?.[tool.action]?.label || "Using";
    if (phase === "pending") return `Will ${verb.toLowerCase()} ${target}`;
    return `${verb} ${target}`;
  }

  function toolCardDetail(tool) {
    const badge = globalThis.ToolMap?.TOOL_META?.[tool.action]?.badge;
    if (badge) return badge;
    if (tool.source === "markdown_diff") return "diff";
    return "write";
  }

  function formatToolSuccess(result) {
    if (result?.summary) return result.summary;
    if (result.error) return result.error;
    if (result.mode === "list") return `${result.files?.length || 0} files`;
    if (result.mode === "inspect") return result.summary || "Workspace overview";
    if (result.mode === "read") {
      const n = (result.content || "").split("\n").length;
      return `Read (${n} lines)`;
    }
    if (result.mode === "read_many") return result.summary || `Read ${result.files?.length || 0} files`;
    if (result.mode === "index") return `Indexed ${result.files} files`;
    if (result.mode === "search") return `${result.count} result${result.count === 1 ? "" : "s"}`;
    if (result.mode === "web_search") return `${result.count || 0} web result${result.count === 1 ? "" : "s"}`;
    if (result.mode === "web_page") return `Read ${result.title || "web page"}`;
    if (result.mode === "outline") return result.summary || `Outlined ${result.file}`;
    if (result.mode === "command") {
      if (result.timedOut) return "Timed out";
      return result.exitCode === 0 ? "Passed" : `Exited ${result.exitCode}`;
    }
    if (result.mode === "process_start") return `Started ${result.id}`;
    if (result.mode === "process_read") return result.running ? "Running" : `Exited ${result.exitCode ?? ""}`;
    if (result.mode === "process_stop") return "Stopped";
    if (result.mode === "delete") return "Deleted";
    if (result.mode === "noop") return "No changes";

    const add = result.lines_added ?? 0;
    const rem = result.lines_removed ?? 0;

    if (["patch", "replace", "insert", "append"].includes(result.mode)) {
      const n = result.patches_applied ?? 1;
      return `Patched (+${add} -${rem}, ${n} hunk${n > 1 ? "s" : ""})`;
    }
    if (result.mode === "create") return `Created (+${add} -${rem})`;
    if (result.fallback) return `Rewrote (+${add} -${rem})`;
    return `Done (+${add} -${rem})`;

    if (result.mode === "patch") {
      const n = result.patches_applied ?? 1;
      return `Patched (+${add} âˆ’${rem}, ${n} hunk${n > 1 ? "s" : ""})`;
    }
    if (result.fallback) return `Rewrote (+${add} âˆ’${rem})`;
    return `Done (+${add} âˆ’${rem})`;
  }

  function buildEditSummary(tools, results) {
    const parts = [];
    for (let i = 0; i < tools.length; i += 1) {
      const tool = tools[i];
      const result = results[i];
      if (["read_file", "search_workspace", "inspect_environment", "run_test_case", "browser_action", "compare_responses", "verify_finding", "delegate_agent", "ingest_traffic", "replay_request"].includes(tool.action)) continue;
      if (result?.error) {
        parts.push(`Failed ${tool.action}: ${result.error}`);
      } else if (result?.mode === "command") {
        parts.push(`Ran ${tool.command || result.command} (${result.exitCode === 0 ? "passed" : `exit ${result.exitCode}`}).`);
      } else if (result?.mode === "delete") {
        parts.push(`Deleted ${tool.file}.`);
      } else if (result?.mode === "process_start") {
        parts.push(`Started ${result.id}.`);
      } else if (result?.mode === "process_stop") {
        parts.push(`Stopped ${result.id}.`);
      } else if (["patch", "replace", "insert", "append"].includes(result?.mode)) {
        parts.push(`Updated ${tool.file}.`);
      } else if (result?.mode === "create") {
        parts.push(`Created ${tool.file}.`);
      } else {
        parts.push(`Wrote ${tool.file}.`);
      }
    }
    return parts.join(" ") || results.filter((result) => result?.summary && !result.error).map((result) => result.summary).join(" ");
  }

  return {
    MAX_AGENT_ROUNDS,
    MODE_PROFILES,
    MODE_PROMPTS: SHARED_MODE_PROMPTS,
    OLLAMA_TOOLS,
    SYSTEM_PROMPT: SHARED_SYSTEM_PROMPT,
    isEditRequest,
    inferEditTarget,
    hasCodeBlocks,
    parseNativeToolCalls,
    parseFenceEdits,
    parseMarkdownCodeEdits,
    stripFenceEdits,
    cleanReplyForDisplay,
    isRepetitiveLoop,
    isOnlyToolSyntax,
    buildSystemContext,
    toolResultMessage,
    toolStatusLabel,
    toolCardDetail,
    formatToolSuccess,
    buildEditSummary,
    collectToolsFromResponse,
    parseProjectFiles,
    resolveToolPath,
    resolveTools,
    parseJsonArgs,
    normalizeToolCallsForApi,
    normalizeProfile,
  };
})();

globalThis.ToolParser = ToolParser;

