/* Canonical Ollama tool schemas and UI metadata for XEKUTE. */

const XekuteOsToolRegistry = typeof module !== "undefined" && module.exports
  ? require("../os/tool-registry")
  : globalThis.XekuteOsTools;
const XekuteCyberToolRegistry = typeof module !== "undefined" && module.exports
  ? require("../cyber/tool-registry")
  : globalThis.XekuteCyberTools;

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
      name: "get_map_overview",
      description: "Return a compact, bounded overview of the current application behavior Map. Use this before querying a specific hypothesis instead of loading the full graph.",
      parameters: { type: "object", properties: {} },
      meta: { label: "Mapping", badge: "Map overview", target: "assessment Map", mutates: false },
    },
    {
      name: "get_map_node",
      description: "Return one Map node with its machine-readable fields, AI summary, variants, risk signals, evidence references, and scope status.",
      parameters: { type: "object", properties: { id: { type: "string", description: "Stable Map node ID" } }, required: ["id"] },
      meta: { label: "Inspecting", badge: "Map node", target: "id", mutates: false },
    },
    {
      name: "get_map_neighbors",
      description: "Return bounded neighboring nodes and relationship edges for a Map node. Out-of-scope relationships are explicitly flagged.",
      parameters: { type: "object", properties: { id: { type: "string" }, edge_types: { type: "array", items: { type: "string" } }, min_confidence: { type: "number" } }, required: ["id"] },
      meta: { label: "Tracing", badge: "Map neighbors", target: "id", mutates: false },
    },
    {
      name: "find_map_paths",
      description: "Find bounded directed paths between two Map nodes server-side. Use this for reachability and anonymous-to-sensitive route analysis instead of simulating paths from raw edges.",
      parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, max_hops: { type: "number" }, min_confidence: { type: "number" } }, required: ["from", "to"] },
      meta: { label: "Finding paths", badge: "Map paths", target: "from", mutates: false },
    },
    {
      name: "search_map_routes",
      description: "Search observed and discovered Map routes by host, method, path, tag, or AI summary.",
      parameters: { type: "object", properties: { pattern: { type: "string" }, tags: { type: "array", items: { type: "string" } } } },
      meta: { label: "Searching", badge: "Map routes", target: "pattern", mutates: false },
    },
    {
      name: "get_map_shared_objects",
      description: "Return HMAC-protected shared-object correlations linking routes, with confidence and evidence IDs but without exposing raw identifier values.",
      parameters: { type: "object", properties: { id: { type: "string", description: "Optional route node ID" } } },
      meta: { label: "Correlating", badge: "Shared objects", target: "id", mutates: false },
    },
    {
      name: "get_map_evidence",
      description: "Fetch redacted request/response evidence by Traffic/Raw request ID. Authorization, cookie, and API-key headers are redacted before returning data to the agent.",
      parameters: { type: "object", properties: { evidence_ids: { type: "array", items: { type: "string" } } }, required: ["evidence_ids"] },
      meta: { label: "Reading", badge: "Map evidence", target: "evidence_ids", mutates: false },
    },
    {
      name: "get_map_hypotheses",
      description: "Return precomputed, explicitly untested candidate hypotheses such as possible IDOR patterns derived from graph structure and asymmetric authentication evidence.",
      parameters: { type: "object", properties: { status: { type: "string" } } },
      meta: { label: "Reviewing", badge: "Map hypotheses", target: "status", mutates: false },
    },
    {
      name: "annotate_map_finding",
      description: "Write an agent-asserted hypothesis/test result back into Map/agent-annotations.json with provenance. Refuses routes that are out of scope.",
      parameters: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, hypothesis: { type: "string" }, routes: { type: "array", items: { type: "string" } }, basis: { type: "string" }, result: { type: "string" }, status: { type: "string" }, evidence_ids: { type: "array", items: { type: "string" } } }, required: ["hypothesis"] },
      meta: { label: "Annotating", badge: "Map finding", target: "routes", mutates: true },
    },
    {
      name: "record_hypothesis",
      description: "Record a bounded, explicitly unconfirmed security hypothesis and the evidence needed to test it.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Stable hypothesis id" },
          title: { type: "string", description: "Short hypothesis title" },
          question: { type: "string", description: "Security question to answer" },
          target: { type: "string", description: "In-scope asset or route under consideration" },
          expected_signal: { type: "string", description: "What evidence would support or reject the hypothesis" },
          rejecting_signal: { type: "string", description: "What evidence would reject the hypothesis" },
          proposed_technique: { type: "string", description: "Least-invasive proposed technique" },
          evidence_plan: { type: "array", items: { type: "string" } },
          stop_conditions: { type: "array", items: { type: "string" } },
          evidence_ids: { type: "array", items: { type: "string" } },
        },
        required: ["id", "question", "target", "expected_signal", "rejecting_signal", "proposed_technique", "evidence_plan", "stop_conditions"],
      },
      meta: { label: "Recording", badge: "hypothesis", target: "question", mutates: true, capability: "evidence", risk: "evidence" },
    },
    {
      name: "ingest_assessment_records",
      description: "Submit structured tool or AI observations to XEKUTE's schema-managed Python parser. The parser validates fields, deduplicates records, recomputes statistics, and atomically updates only an approved Core dataset. Never edit Core JSON/JSONL files directly.",
      parameters: {
        type: "object",
        properties: {
          resource: {
            type: "string",
            enum: ["active-recon", "passive-recon", "endpoints", "pages", "subdomains", "assets", "services"],
            description: "Approved canonical dataset. Scope, traffic, and vulnerability findings cannot be written through this tool.",
          },
          records: {
            type: "array",
            items: { type: "object" },
            description: "Structured records only. Unknown fields are discarded against the canonical template.",
          },
          source: { type: "string", description: "Tool, parser, or observation source used for provenance." },
        },
        required: ["resource", "records", "source"],
      },
      meta: { label: "Ingesting", badge: "validated records", target: "resource", mutates: true, capability: "evidence", risk: "evidence" },
    },
    {
      name: "run_security_tool",
      description: "Run one supported security tool through a typed, policy-controlled adapter. Supply a canonical in-scope target, hypothesis, expected signal, evidence plan, and conservative configuration; never construct the shell command yourself.",
      parameters: {
        type: "object",
        properties: {
          adapter_id: { type: "string", enum: ["subfinder", "amass", "theharvester", "httpx", "nmap", "naabu", "katana", "ffuf", "gobuster", "nuclei", "nikto", "testssl", "sqlmap", "wafw00f", "nmap-firewall", "hping3", "traceroute"] },
          target: { type: "string" },
          hypothesis_id: { type: "string" },
          expected_signal: { type: "string" },
          technique_ids: { type: "array", items: { type: "string" } },
          evidence_plan: { type: "array", items: { type: "string" } },
          output_path: { type: "string" },
          configuration: { type: "object" },
        },
        required: ["adapter_id", "target", "hypothesis_id", "expected_signal", "technique_ids", "evidence_plan"],
      },
      meta: { label: "Running", badge: "security adapter", target: "target", mutates: false, capability: "execute", risk: "contextual", requiresApproval: true },
    },
    {
      name: "record_finding_candidate",
      description: "Persist one structured finding candidate through XEKUTE's evidence, scope, reproduction, impact, false-positive, and hybrid-verifier promotion gate. Never edit findings JSON directly.",
      parameters: {
        type: "object",
        properties: { finding: { type: "object", description: "Structured finding candidate including target, status, severity, reproduction, impact, evidence IDs, and verification." } },
        required: ["finding"],
      },
      meta: { label: "Recording", badge: "finding candidate", target: "finding", mutates: true, capability: "evidence", risk: "evidence" },
    },
    {
      name: "verify_finding_candidate",
      description: "Submit one structured finding candidate and its referenced evidence to XEKUTE's separate temperature-zero no-tools verifier. An invalid response is inconclusive.",
      parameters: { type: "object", properties: { finding: { type: "object" } }, required: ["finding"] },
      meta: { label: "Verifying", badge: "hybrid verifier", target: "finding", mutates: true, capability: "evidence", risk: "evidence" },
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

  const OS_TOOL_NAMES = new Set(XekuteOsToolRegistry.ALL);
  const CYBER_TOOL_NAMES = new Set(XekuteCyberToolRegistry.ALL);
  const TOOL_META = Object.fromEntries(TOOL_DEFS.map((tool) => {
    const name = tool.name;
    const mutation = ["write_file", "create_file", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"].includes(name);
    const process = ["run_command", "start_process", "read_process", "stop_process"].includes(name);
    const evidence = ["ingest_assessment_records", "record_hypothesis", "record_finding_candidate", "verify_finding_candidate", "annotate_map_finding"].includes(name);
    const category = OS_TOOL_NAMES.has(name) ? "os" : CYBER_TOOL_NAMES.has(name) ? "cyber" : "uncategorized";
    return [name, { ...tool.meta, category, typed: true, capability: tool.meta.capability || (evidence ? "evidence" : mutation ? "workspace" : process ? "execute" : "observe"), risk: tool.meta.risk || (evidence ? "evidence" : mutation ? "workspace" : process ? "contextual" : "read"), requiresApproval: tool.meta.requiresApproval ?? (mutation || process) }];
  }));
  const TOOL_NAMES = TOOL_DEFS.map((tool) => tool.name);
  const MODE_TOOL_GROUPS = Object.freeze({
    // Agent gets the complete non-active workspace/evidence surface. Runtime
    // policy still decides whether a command or sensitive action may run;
    // Testing Agent adds the active adapter below.
    agent: Object.freeze([
      ...XekuteOsToolRegistry.DEFAULT_READ_ONLY,
      ...XekuteOsToolRegistry.DEFAULT_MUTATIONS,
      ...XekuteOsToolRegistry.EXECUTION,
      ...XekuteCyberToolRegistry.READ_ONLY,
      ...XekuteCyberToolRegistry.EVIDENCE,
    ]),
    // Ask is intentionally read-only: no file mutations, processes, evidence
    // writes, or security adapters are exposed to the model.
    ask: Object.freeze([
      ...XekuteOsToolRegistry.DEFAULT_READ_ONLY,
      ...XekuteCyberToolRegistry.READ_ONLY,
    ]),
    // Planner can only create a clearly named plan document. Policy validates
    // the destination after the model makes the call.
    planner: Object.freeze([...XekuteOsToolRegistry.PLAN_FILE_TOOLS]),
  });

  const TOOL_GROUPS = Object.freeze({
    os: XekuteOsToolRegistry,
    cyber: XekuteCyberToolRegistry,
    modes: MODE_TOOL_GROUPS,
  });

  const uncategorized = TOOL_NAMES.filter((name) => TOOL_META[name].category === "uncategorized");
  if (uncategorized.length) {
    throw new Error(`Tool registry is missing categories for: ${uncategorized.join(", ")}`);
  }

  function normalizedProfile(familyOrProfile = "assist", mode = "ask") {
    if (familyOrProfile && typeof familyOrProfile === "object") {
      return {
        family: String(familyOrProfile.family || "assist").toLowerCase(),
        key: String(familyOrProfile.key || familyOrProfile.mode || mode || "ask").toLowerCase(),
      };
    }
    const first = String(familyOrProfile || "assist").toLowerCase();
    const second = String(mode || "ask").toLowerCase();
    if (first.includes(":")) {
      const [family, key] = first.split(":", 2);
      return { family, key };
    }
    if (["assist", "testing"].includes(first)) return { family: first, key: second };
    return { family: "assist", key: first };
  }

  function toolNamesForProfile(familyOrProfile = "assist", mode = "ask") {
    const profile = normalizedProfile(familyOrProfile, mode);
    const role = ["plan", "planner"].includes(profile.key)
      ? "planner"
      : ["agent", "executor", "execution", "exploit"].includes(profile.key)
        ? "agent"
        : "ask";
    const names = [...MODE_TOOL_GROUPS[role]];
    if (role === "agent" && profile.family === "testing") names.push(...XekuteCyberToolRegistry.ACTIVE);
    return Object.freeze([...new Set(names)]);
  }

  function toolsForProfile(familyOrProfile = "assist", mode = "ask", tools = TOOLS) {
    const allowed = new Set(toolNamesForProfile(familyOrProfile, mode));
    return (Array.isArray(tools) ? tools : []).filter((tool) => allowed.has(tool?.function?.name));
  }

  function toolsForRoute(tools = TOOLS, route = {}) {
    const allowed = new Set();
    const os = TOOL_GROUPS.os;
    const cyber = TOOL_GROUPS.cyber;

    if (route.toolCategories?.includes("os")) {
      const readTools = route.explicitFile
        ? ["find_files", "read_file", "read_files", "get_file_outline"]
        : os.DEFAULT_READ_ONLY;
      readTools.forEach((name) => allowed.add(name));
      if (route.osMutates || route.osMode === "write") {
        os.DEFAULT_MUTATIONS.forEach((name) => allowed.add(name));
        allowed.add("run_command");
      }
      if (route.osMode === "execute") {
        allowed.add("run_command");
        if (route.longRunning) ["start_process", "read_process", "stop_process"].forEach((name) => allowed.add(name));
      }
    }

    if (route.toolCategories?.includes("cyber")) {
      const capabilities = new Set(route.cyberCapabilities || []);
      if (capabilities.has("research")) cyber.RESEARCH.forEach((name) => allowed.add(name));
      if (capabilities.has("map")) cyber.MAP_READ.forEach((name) => allowed.add(name));
      if (capabilities.has("evidence")) cyber.EVIDENCE.forEach((name) => allowed.add(name));
      if (capabilities.has("active")) {
        cyber.ACTIVE.forEach((name) => allowed.add(name));
        cyber.EVIDENCE.forEach((name) => allowed.add(name));
      }
    }

    return (Array.isArray(tools) ? tools : []).filter((tool) => allowed.has(tool?.function?.name));
  }

  function compactDescription(value, maxChars = 150) {
    const oneLine = String(value || "").replace(/\s+/g, " ").trim();
    const sentence = oneLine.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || oneLine;
    return sentence.length <= maxChars ? sentence : `${sentence.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  }

  function compactSchema(value) {
    if (Array.isArray(value)) return value.map(compactSchema);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === "description" ? compactDescription(item, 100) : compactSchema(item),
    ]));
  }

  function compactTools(tools = TOOLS) {
    return (Array.isArray(tools) ? tools : []).map((tool) => ({
      ...tool,
      function: {
        ...tool.function,
        description: compactDescription(tool.function?.description),
        parameters: compactSchema(tool.function?.parameters || { type: "object", properties: {} }),
      },
    }));
  }

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
      meta: TOOL_META[name],
      risk: TOOL_META[name].risk,
      capability: TOOL_META[name].capability,
      requiresApproval: Boolean(TOOL_META[name].requiresApproval),
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
    if (args.from != null) args.from = sanitizeText(args.from);
    if (args.to != null) args.to = sanitizeText(args.to);
    if (args.pattern != null) args.pattern = sanitizeText(args.pattern);
    for (const key of ["edge_types", "tags", "evidence_ids"]) {
      if (args[key] != null) args[key] = Array.isArray(args[key]) ? args[key].map((value) => sanitizeText(value)).filter(Boolean).slice(0, 100) : [];
    }
    if (args.hypothesis != null) args.hypothesis = sanitizeText(args.hypothesis);
    if (args.title != null) args.title = sanitizeText(args.title);
    if (args.basis != null) args.basis = sanitizeText(args.basis);
    if (args.result != null) args.result = sanitizeText(args.result);
    if (args.status != null) args.status = sanitizeText(args.status);
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

    if (["get_map_node", "get_map_neighbors"].includes(toolName) && !args.id) return validationError("Missing required Map node id", "MISSING_MAP_NODE_ID");
    if (toolName === "find_map_paths" && (!args.from || !args.to)) return validationError("Both from and to Map node IDs are required", "MISSING_MAP_PATH_ENDPOINTS");
    if (toolName === "get_map_evidence" && (!Array.isArray(args.evidence_ids) || !args.evidence_ids.length)) return validationError("Missing required evidence_ids", "MISSING_EVIDENCE_IDS");
    if (toolName === "run_security_tool") {
      if (!args.adapter_id || !args.target || !args.hypothesis_id || !args.expected_signal || !Array.isArray(args.technique_ids) || !args.technique_ids.length || !Array.isArray(args.evidence_plan) || !args.evidence_plan.length) return validationError("Typed security actions require adapter_id, target, hypothesis_id, expected_signal, technique_ids, and evidence_plan", "SECURITY_ACTION_INCOMPLETE");
      args.adapter_id = sanitizeText(args.adapter_id).toLowerCase();
      args.target = sanitizeText(args.target);
      args.hypothesis_id = sanitizeText(args.hypothesis_id);
      args.expected_signal = sanitizeText(args.expected_signal);
      args.output_path = sanitizePath(args.output_path || "");
    }
    if (toolName === "ingest_assessment_records") {
      const allowedResources = new Set(["active-recon", "passive-recon", "endpoints", "pages", "subdomains", "assets", "services"]);
      args.resource = sanitizeText(args.resource).toLowerCase();
      args.source = sanitizeText(args.source).slice(0, 160);
      if (!allowedResources.has(args.resource)) return validationError("Only approved Recon, Enumeration, and Services datasets accept typed ingestion", "RESOURCE_NOT_ALLOWED", false);
      if (!Array.isArray(args.records) || !args.records.length) return validationError("At least one structured record is required", "RECORDS_REQUIRED");
      if (args.records.length > 250) return validationError("At most 250 records may be ingested at once", "RECORD_LIMIT", false);
      if (!args.records.every((record) => record && typeof record === "object" && !Array.isArray(record))) return validationError("Every ingestion record must be an object", "RECORD_INVALID");
      if (JSON.stringify(args.records).length > 750000) return validationError("Ingestion records exceed 750,000 characters", "PAYLOAD_TOO_LARGE", false);
      if (!args.source) return validationError("A provenance source is required", "SOURCE_REQUIRED");
    }
    if (toolName === "record_hypothesis") {
      if (!args.id || !args.question || !args.target || !args.expected_signal || !args.rejecting_signal || !args.proposed_technique || !Array.isArray(args.evidence_plan) || !args.evidence_plan.length || !Array.isArray(args.stop_conditions) || !args.stop_conditions.length) return validationError("A ready hypothesis requires a stable id, target, question, supporting and rejecting signals, least-invasive technique, evidence plan, and stop conditions", "HYPOTHESIS_INCOMPLETE");
    }
    if (toolName === "record_finding_candidate") {
      if (!args.finding || typeof args.finding !== "object" || Array.isArray(args.finding)) return validationError("A structured finding object is required", "FINDING_REQUIRED");
      const findingSize = JSON.stringify(args.finding).length;
      if (findingSize > 50000) return validationError("Finding candidate exceeds 50,000 characters", "FINDING_TOO_LARGE", false);
      if (!args.finding.title || !args.finding.asset || !Array.isArray(args.finding.evidence)) return validationError("Finding candidates require title, affected asset, and an evidence ID array", "FINDING_INCOMPLETE");
    }
    if (toolName === "verify_finding_candidate") {
      if (!args.finding || typeof args.finding !== "object" || Array.isArray(args.finding)) return validationError("A structured finding object is required", "FINDING_REQUIRED");
      if (!Array.isArray(args.finding.evidence) || !args.finding.evidence.length) return validationError("The verifier requires evidence IDs", "VERIFIER_EVIDENCE_REQUIRED");
      if (JSON.stringify(args.finding).length > 50000) return validationError("Finding candidate exceeds 50,000 characters", "FINDING_TOO_LARGE", false);
    }
    if (toolName === "annotate_map_finding" && !args.hypothesis) return validationError("Missing required hypothesis", "MISSING_HYPOTHESIS");
    if (args.min_confidence != null) args.min_confidence = Math.max(0, Math.min(1, Number(args.min_confidence) || 0));
    if (args.max_hops != null) args.max_hops = Math.max(1, Math.min(8, Math.round(Number(args.max_hops) || 5)));

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
    TOOL_GROUPS,
    MODE_TOOL_GROUPS,
    normalizeToolCall,
    parseArguments,
    targetForTool,
    isMutating,
    sanitizePath,
    toolNamesForProfile,
    toolsForProfile,
    toolsForRoute,
    compactTools,
    validateToolCall,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ToolMap;
}

globalThis.ToolMap = ToolMap;
