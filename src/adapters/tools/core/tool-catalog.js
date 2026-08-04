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
      name: "create_guidance",
      description:
        "Create one AI-authored XEKUTE Rule, Skill, or Subagent file. Use only for a /create-skill, /create-rule, or /create-subagent request. Infer a short kebab-case filename, keep the content detailed Markdown, and write it to the requested Project or Global scope.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["project", "global"], description: "Where the guidance should be stored" },
          kind: { type: "string", enum: ["rules", "skills", "subagents"], description: "Guidance category" },
          name: { type: "string", description: "Short kebab-case filename, with or without .md" },
          content: { type: "string", description: "Complete detailed Markdown guidance" },
        },
        required: ["scope", "kind", "name", "content"],
      },
      meta: { label: "Creating", badge: "guidance", target: "name", mutates: true },
    },
    {
      name: "request_operator_questions",
      description:
        "Pause only when a missing decision materially blocks the next step. Ask 1–3 short questions with 2–3 plain-language choices each, mark one suggested choice, and avoid tool, retry, schema, or implementation jargon. A free-write choice is appended automatically. The run resumes after the operator answers.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Brief operator-safe reason input is needed; never include tool or retry diagnostics" },
          topic: { type: "string", description: "Short topic slug for the questions file name" },
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            description: "Only the decisions that block progress, written for a non-technical operator.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Short stable question id" },
                prompt: { type: "string", description: "One concise plain-language question" },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 3,
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", description: "Short stable option id" },
                      label: { type: "string", description: "Concise answer choice without implementation detail" },
                      recommended: { type: "boolean", description: "True for exactly one suggested choice" },
                    },
                    required: ["id", "label"],
                  },
                },
              },
              required: ["id", "prompt", "options"],
            },
          },
        },
        required: ["reason", "questions"],
      },
      meta: { label: "Asking", badge: "questions", target: "topic", mutates: false, requiresApproval: false },
    },
    {
      name: "load_tool_schemas",
      description:
        "Load full JSON schemas for catalog tools that are not in the hot schema set yet. Use packs (workspace, map, evidence, active) and/or explicit tool names. Call this before using a catalog-only tool. Does not grant new permissions; Mode and Authority still control access.",
      parameters: {
        type: "object",
        properties: {
          packs: {
            type: "array",
            description: "Tool packs to load in full: workspace, map, evidence, active",
            items: { type: "string", enum: ["workspace", "map", "evidence", "active"] },
          },
          names: {
            type: "array",
            description: "Specific allowed tool names to load schemas for",
            items: { type: "string" },
          },
        },
      },
      meta: { label: "Loading", badge: "schemas", target: "packs", mutates: false, capability: "observe", risk: "read", requiresApproval: false },
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
      name: "list_datasets",
      description: "List the canonical assessment datasets available for ingest_assessment_records, whether each is currently provisioned (exists) in this workspace, and a short schema hint. Use this BEFORE ingesting so you never call with an unprovisioned or invalid dataset name.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      meta: { label: "Listing", badge: "datasets · read-only", target: "resource", mutates: false, capability: "evidence", risk: "read" },
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
      name: "run_traffsucker",
      description: "Launch traffsucker as a long-lived browser-mapping subagent. A config.yaml is authored into runtime/traffsucker/ for scope, goal, model, and budget, and traffsucker runs in the background. Returns immediately with subagent_wait; the agent turn ends. Harness shows live waiting time, feeds a checkpoint transcript after wait_ms if still running so you can judge health, then resumes again when the subagent exits. Supply a canonical in-scope target and optionally context, goal, browser engine, wait budget, and max_runtime.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Canonical in-scope HTTP/HTTPS target to map." },
          hypothesis_id: { type: "string" },
          technique_ids: { type: "array", items: { type: "string" } },
          context: { type: "string", description: "Persona / credentials guidance written into traffsucker config.yaml (kept local, never in command args)." },
          goal: { type: "string", description: "Mission/goal description for the subagent." },
          model: { type: "string", description: "Subagent model (from the subagent model picker)." },
          browser_engine: { type: "string", enum: ["chromium", "lightpanda"] },
          scope_analysis: { type: "string" },
          cdp_url: { type: "string" },
          max_pages: { type: "integer" },
          max_actions: { type: "integer" },
          max_depth: { type: "integer" },
          max_runtime: { type: "integer", description: "Wall-clock seconds budget for the run (also used as the monitor checkpoint when wait_ms is omitted)." },
          wait_ms: { type: "number", description: "Optional monitor checkpoint in milliseconds. After this budget, harness feeds the current terminal log while the process may still run. 0 skips checkpoints and waits until exit. Defaults from max_runtime when provided." },
          run_dir: { type: "string", description: "Relative run directory under the project (default runtime/traffsucker; must stay outside the source tree)." },
        },
        required: ["target"],
      },
      meta: { label: "Running", badge: "traffsucker subagent", target: "target", mutates: false, capability: "execute", risk: "active", requiresApproval: true },
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
      description: "Run a workspace command in an agent terminal. The agent turn stops immediately. Harness shows live waiting time, feeds a checkpoint transcript after wait_ms if still running, and re-invokes the agent with the final transcript when the command exits.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run from the workspace root" },
          wait_ms: { type: "number", description: "Monitor checkpoint in milliseconds. After this budget, harness feeds the current terminal log while the command may still run. Use 0 to skip checkpoints and wait until exit. Default 60000." },
          timeout_ms: { type: "number", description: "Deprecated alias for wait_ms" },
        },
        required: ["command"],
      },
      meta: { label: "Running", badge: "terminal", target: "command", mutates: false, capability: "execute", risk: "contextual", requiresApproval: true },
    },
    {
      name: "start_process",
      description: "Start a long-running workspace process in an agent terminal. Set wait_ms to end the agent turn; harness shows live waiting time, can feed a checkpoint transcript after wait_ms, and resumes with the final transcript on exit. Omit wait_ms to leave it running and poll with read_process.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to start from the workspace root" },
          wait_ms: { type: "number", description: "Optional monitor checkpoint in milliseconds. After this budget, harness feeds the current terminal log while the process may still run. 0 waits until exit. When set, returns terminal_wait." },
        },
        required: ["command"],
      },
      meta: { label: "Starting", badge: "process", target: "command", mutates: false, capability: "execute", risk: "contextual", requiresApproval: true },
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
    const mutation = ["write_file", "create_file", "create_guidance", "patch_file", "replace_in_file", "insert_in_file", "append_file", "delete_file"].includes(name);
    const process = ["run_command", "start_process", "read_process", "stop_process"].includes(name);
    const evidence = ["ingest_assessment_records", "record_hypothesis", "record_finding_candidate", "verify_finding_candidate", "annotate_map_finding"].includes(name);
    const category = OS_TOOL_NAMES.has(name) ? "os" : CYBER_TOOL_NAMES.has(name) ? "cyber" : "uncategorized";
    return [name, { ...tool.meta, category, typed: true, capability: tool.meta.capability || (evidence ? "evidence" : mutation ? "workspace" : process ? "execute" : "observe"), risk: tool.meta.risk || (evidence ? "evidence" : mutation ? "workspace" : process ? "contextual" : "read"), requiresApproval: tool.meta.requiresApproval ?? (mutation || process) }];
  }));
  const TOOL_NAMES = TOOL_DEFS.map((tool) => tool.name);
  // Ask and Hypothesis share the same read-oriented surface. Authority does not
  // expand these lists — only Agent × Authority changes cyber/OS exposure.
  const ASK_HYPOTHESIS_TOOLS = Object.freeze([
    "find_files",
    "list_files",
    "inspect_workspace",
    "read_file",
    "read_files",
    "request_operator_questions",
    "search_code",
    "search_web",
    "fetch_url",
    "get_file_outline",
    "read_process",
  ]);

  const PLAN_TOOLS = Object.freeze([
    ...ASK_HYPOTHESIS_TOOLS,
    "write_file",
    "create_file",
    "patch_file",
    "replace_in_file",
    "insert_in_file",
    "append_file",
  ]);

  const AGENT_TOOLS = Object.freeze([
    ...XekuteOsToolRegistry.ALL,
    ...XekuteCyberToolRegistry.ALL,
  ]);

  const MODE_TOOL_GROUPS = Object.freeze({
    agent: AGENT_TOOLS,
    ask: ASK_HYPOTHESIS_TOOLS,
    planner: PLAN_TOOLS,
    hypothesis: ASK_HYPOTHESIS_TOOLS,
  });

  // Two-layer catalog: Agent always sees every allowed name in a text catalog,
  // but only a hot set ships full JSON schemas until load_tool_schemas expands it.
  const AGENT_HOT_TOOLS = Object.freeze([
    "load_tool_schemas",
    ...XekuteOsToolRegistry.DEFAULT_READ_ONLY,
    ...XekuteOsToolRegistry.OPERATOR_INTERACTION,
    ...XekuteCyberToolRegistry.RESEARCH,
    "write_file",
    "create_file",
    "patch_file",
    "delete_file",
    "run_command",
  ]);

  const TOOL_PACKS = Object.freeze({
    workspace: Object.freeze([
      "index_workspace",
      "create_guidance",
      "replace_in_file",
      "insert_in_file",
      "append_file",
      "start_process",
      "read_process",
      "stop_process",
    ]),
    map: XekuteCyberToolRegistry.MAP_READ,
    evidence: XekuteCyberToolRegistry.EVIDENCE,
    active: XekuteCyberToolRegistry.ACTIVE,
  });

  const LOADABLE_PACK_NAMES = Object.freeze(Object.keys(TOOL_PACKS));

  const TOOL_GROUPS = Object.freeze({
    os: XekuteOsToolRegistry,
    cyber: XekuteCyberToolRegistry,
    modes: MODE_TOOL_GROUPS,
    packs: TOOL_PACKS,
  });

  const uncategorized = TOOL_NAMES.filter((name) => TOOL_META[name].category === "uncategorized");
  if (uncategorized.length) {
    throw new Error(`Tool registry is missing categories for: ${uncategorized.join(", ")}`);
  }

  const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((tool) => [tool.function.name, tool]));

  function resolveModeKey(familyOrProfile = "agent", mode = "agent") {
    if (familyOrProfile && typeof familyOrProfile === "object") {
      const rawKey = String(familyOrProfile.key || familyOrProfile.mode || familyOrProfile.id || mode || "agent").toLowerCase();
      return rawKey.includes(":") ? rawKey.split(":").pop() : rawKey;
    }
    const first = String(familyOrProfile || "agent").toLowerCase();
    const second = String(mode || "agent").toLowerCase();
    if (first.includes(":")) return first.split(":")[1] || "agent";
    if (["assist", "testing", "xekute"].includes(first)) return second;
    return first;
  }

  function normalizedProfile(familyOrProfile = "agent", mode = "agent") {
    const rawKey = resolveModeKey(familyOrProfile, mode);
    const key = ["plan", "planner"].includes(rawKey)
      ? "planner"
      : rawKey === "hypothesis"
        ? "hypothesis"
        : ["agent", "executor", "execution", "exploit"].includes(rawKey)
          ? "agent"
          : "ask";
    return { family: "xekute", key };
  }

  function toolNamesForProfile(familyOrProfile = "agent", mode = "agent") {
    const profile = normalizedProfile(familyOrProfile, mode);
    const role = profile.key;
    return Object.freeze([...new Set(MODE_TOOL_GROUPS[role] || MODE_TOOL_GROUPS.ask)]);
  }

  function toolsForProfile(familyOrProfile = "agent", mode = "agent", tools = TOOLS) {
    const allowed = new Set(toolNamesForProfile(familyOrProfile, mode));
    return (Array.isArray(tools) ? tools : []).filter((tool) => allowed.has(tool?.function?.name));
  }

  function toolsForRoute(tools = TOOLS, _route = {}) {
    // Progressive request classification no longer filters tools.
    // Callers must pass mode-filtered tools; Authority gates at policy time.
    return Array.isArray(tools) ? tools : [];
  }

  function packForTool(name) {
    const toolName = String(name || "");
    if (AGENT_HOT_TOOLS.includes(toolName) || toolName === "load_tool_schemas") return "core";
    for (const [pack, names] of Object.entries(TOOL_PACKS)) {
      if (names.includes(toolName)) return pack;
    }
    return "other";
  }

  function hotToolNamesForProfile(familyOrProfile = "agent", mode = "agent") {
    const allowed = toolNamesForProfile(familyOrProfile, mode);
    const profile = normalizedProfile(familyOrProfile, mode);
    if (profile.key !== "agent") return Object.freeze([...allowed]);
    return Object.freeze(AGENT_HOT_TOOLS.filter((name) => allowed.includes(name)));
  }

  function purposeForTool(name, maxChars = 100) {
    const tool = TOOL_BY_NAME[name];
    return compactDescription(tool?.function?.description || TOOL_META[name]?.label || name, maxChars);
  }

  function buildToolCatalog(familyOrProfile = "agent", mode = "agent", loadedNames = null) {
    const allowed = toolNamesForProfile(familyOrProfile, mode);
    const loaded = new Set(
      loadedNames == null
        ? hotToolNamesForProfile(familyOrProfile, mode)
        : [...loadedNames],
    );
    return Object.freeze(allowed.map((name) => Object.freeze({
      name,
      purpose: purposeForTool(name),
      pack: packForTool(name),
      schema: loaded.has(name) ? "hot" : "catalog",
    })));
  }

  function schemasForNames(names = [], tools = TOOLS) {
    const wanted = new Set((Array.isArray(names) ? names : []).map((name) => String(name || "").trim()).filter(Boolean));
    return (Array.isArray(tools) ? tools : []).filter((tool) => wanted.has(tool?.function?.name));
  }

  function resolveSchemaLoad({ allowedNames = [], packs = [], names = [] } = {}) {
    const allowed = new Set((Array.isArray(allowedNames) ? allowedNames : []).map((name) => String(name || "").trim()).filter(Boolean));
    const requested = new Set();
    const unknownPacks = [];
    const denied = [];
    const missing = [];

    for (const pack of Array.isArray(packs) ? packs : []) {
      const key = String(pack || "").trim().toLowerCase();
      if (!TOOL_PACKS[key]) {
        unknownPacks.push(key);
        continue;
      }
      for (const name of TOOL_PACKS[key]) requested.add(name);
    }

    for (const raw of Array.isArray(names) ? names : []) {
      const name = String(raw || "").trim();
      if (!name) continue;
      if (!TOOL_META[name]) {
        missing.push(name);
        continue;
      }
      requested.add(name);
    }

    if (!requested.size && !unknownPacks.length && !missing.length) {
      return {
        ok: false,
        error: "Provide packs and/or names to load.",
        code: "MISSING_SCHEMA_TARGET",
        loaded: [],
        denied: [],
        missing: [],
        unknownPacks: [],
      };
    }

    const loaded = [];
    for (const name of requested) {
      if (!allowed.has(name)) {
        denied.push(name);
        continue;
      }
      loaded.push(name);
    }

    const schemas = compactTools(schemasForNames(loaded));
    return {
      ok: loaded.length > 0,
      loaded: Object.freeze(loaded),
      denied: Object.freeze(denied),
      missing: Object.freeze(missing),
      unknownPacks: Object.freeze(unknownPacks.filter(Boolean)),
      schemas,
      error: loaded.length
        ? ""
        : "No schemas loaded. Requested tools were denied by mode or unknown.",
      code: loaded.length ? "OK" : "SCHEMA_LOAD_EMPTY",
    };
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

  function clampWaitMs(raw, fallback = 60000) {
    if (raw === 0 || raw === "0") return 0;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    if (value <= 0) return 0;
    return Math.max(1000, Math.min(Math.round(value), 24 * 60 * 60 * 1000));
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
    const guidanceScope = args.scope == null ? undefined : sanitizeText(args.scope).toLowerCase();
    const guidanceKind = args.kind == null ? undefined : sanitizeText(args.kind).toLowerCase();
    const guidanceName = args.name == null ? undefined : sanitizeText(args.name);

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

    if (name === "create_guidance") {
      tool.target = guidanceName || "guidance";
      tool.scope = guidanceScope || "project";
      tool.guidanceKind = guidanceKind || "skills";
      tool.code = String(args.content ?? "");
    }

    return tool;
  }

  function targetForTool(tool) {
    if (tool.file) return tool.file;
    if (tool.files?.length) return `${tool.files.length} files`;
    if (tool.action === "create_guidance" || tool.toolName === "create_guidance") return tool.args?.name || tool.target || "guidance";
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
    if (args.scope != null) args.scope = sanitizeText(args.scope).toLowerCase();
    if (args.kind != null) args.kind = sanitizeText(args.kind).toLowerCase();
    if (args.name != null) args.name = sanitizeText(args.name);
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
    if (args.wait_ms != null || args.waitMs != null) {
      args.wait_ms = clampWaitMs(args.wait_ms ?? args.waitMs, 60000);
    }

    if (toolName === "run_command") {
      if (args.wait_ms == null && (args.timeout_ms != null || args.timeoutMs != null)) {
        args.wait_ms = clampWaitMs(args.timeout_ms ?? args.timeoutMs, 60000);
      }
      if (args.wait_ms == null) args.wait_ms = 60000;
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

    if (toolName === "create_guidance") {
      if (!["project", "global"].includes(args.scope)) return validationError("Guidance scope must be project or global", "INVALID_GUIDANCE_SCOPE", false);
      if (!["rules", "skills", "subagents"].includes(args.kind)) return validationError("Guidance kind must be rules, skills, or subagents", "INVALID_GUIDANCE_KIND", false);
      if (!args.name) return validationError("A guidance filename is required", "MISSING_GUIDANCE_NAME");
      if (!args.content) return validationError("Guidance content is required", "MISSING_CONTENT");
      if (String(args.content).length > 100000) return validationError("Guidance content exceeds 100 KB", "GUIDANCE_TOO_LARGE", false);
    }

    if (toolName === "request_operator_questions") {
      args.reason = sanitizeText(args.reason).slice(0, 2000);
      if (!args.reason) return validationError("A reason is required for operator questions", "MISSING_REASON");
      if (args.topic != null) args.topic = sanitizeText(args.topic).slice(0, 120);
      if (!Array.isArray(args.questions) || !args.questions.length) return validationError("At least one question is required", "MISSING_QUESTIONS");
      args.questions = args.questions.slice(0, 3).map((question) => ({
        id: sanitizeText(question?.id).slice(0, 64),
        prompt: sanitizeText(question?.prompt || question?.question).slice(0, 500),
        options: Array.isArray(question?.options)
          ? question.options.slice(0, 3).map((option) => ({
            id: sanitizeText(option?.id).slice(0, 64),
            label: sanitizeText(option?.label).slice(0, 160),
            recommended: Boolean(option?.recommended),
          }))
          : [],
      }));
    }

    if (toolName === "load_tool_schemas") {
      const packs = Array.isArray(args.packs)
        ? args.packs.map((value) => sanitizeText(value).toLowerCase()).filter(Boolean).slice(0, 8)
        : [];
      const names = Array.isArray(args.names)
        ? args.names.map((value) => sanitizeText(value)).filter(Boolean).slice(0, 40)
        : [];
      if (!packs.length && !names.length) {
        return validationError("Provide packs and/or names to load", "MISSING_SCHEMA_TARGET");
      }
      args.packs = packs;
      args.names = names;
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
    TOOL_PACKS,
    LOADABLE_PACK_NAMES,
    AGENT_HOT_TOOLS,
    normalizeToolCall,
    parseArguments,
    targetForTool,
    isMutating,
    sanitizePath,
    toolNamesForProfile,
    toolsForProfile,
    toolsForRoute,
    hotToolNamesForProfile,
    packForTool,
    purposeForTool,
    buildToolCatalog,
    schemasForNames,
    resolveSchemaLoad,
    compactTools,
    validateToolCall,
    clampWaitMs,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = ToolMap;
}

globalThis.ToolMap = ToolMap;
