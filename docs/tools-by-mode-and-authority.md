# XEKUTE Agent Tools by Mode and Authority

Generated from `src/adapters/tools/core/tool-catalog.js` and `src/application/policies/policy-engine.js`.

Chat modes are flat: **Agent**, **Hypothesis**, **Plan**, and **Ask**. Authority is a separate dimension: **Unrestricted**, **Full Authority**, **Ask for Approval**, and **Approve for me**.

**Note:** Mode exposure is what the model can *call*. Authority and assessment policy still decide whether a call is allowed, requires approval, or is blocked. Request wording does **not** shrink grants.

In **Agent** mode a two-layer catalog always lists every granted tool; only a hot schema set is attached until `load_tool_schemas` expands packs/names (`workspace`, `map`, `evidence`, `active`).

## Summary

| Metric | Count |
| --- | ---: |
| Total registered tools | 40 |
| Hypothesis (`hypothesis`) | 11 |
| Plan (`planner`) | 17 |
| Agent (`agent`) | 40 |
| Ask (`ask`) | 11 |
| Agent hot schemas | 16 |

### Agent hot schemas

- `load_tool_schemas`
- `find_files`
- `list_files`
- `inspect_workspace`
- `read_file`
- `read_files`
- `search_code`
- `get_file_outline`
- `request_operator_questions`
- `search_web`
- `fetch_url`
- `write_file`
- `create_file`
- `patch_file`
- `delete_file`
- `run_command`

### Loadable packs

- `workspace`: `index_workspace`, `create_guidance`, `replace_in_file`, `insert_in_file`, `append_file`, `start_process`, `read_process`, `stop_process`
- `map`: `get_map_overview`, `get_map_node`, `get_map_neighbors`, `find_map_paths`, `search_map_routes`, `get_map_shared_objects`, `get_map_evidence`, `get_map_hypotheses`
- `evidence`: `list_datasets`, `record_hypothesis`, `ingest_assessment_records`, `record_finding_candidate`, `verify_finding_candidate`, `annotate_map_finding`
- `active`: `run_security_tool`, `run_traffsucker`

## Authority × Agent matrix

| Authority | Agent tool access | Scope | Approval |
| --- | --- | --- | --- |
| `unrestricted` | All OS + all cyber tools | May leave scope | Auto |
| `full` | All OS + all cyber tools | In scope | Auto |
| `ask` | All OS + all cyber tools | In scope | Prompt before sensitive actions |
| `approve` | All OS + all cyber tools | In scope + policy | Recon and ordinary workspace auto-approved; other sensitive cyber needs approval |

Hypothesis, Plan, and Ask tool lists do **not** change with Authority.

### Authority permission groups

Permission defaults below match new-project **XEKUTE Authority** settings (`src/presentation/ui/bootstrap.js`). Super modes `unrestricted`, `full`, and `ask` force every permission on.

**Workspace**

- `workspaceRead` — default: enabled
- `workspaceWrite` — default: enabled
- `workspaceDelete` — default: enabled
- `commandExecution` — default: enabled
- `backgroundProcesses` — default: enabled
- `terminalAccess` — default: enabled
- `customScripts` — default: disabled

**Network and traffic**

- `webResearch` — default: enabled
- `outboundHttp` — default: enabled
- `proxyInterception` — default: enabled
- `trafficCapture` — default: enabled
- `sensitiveDataAccess` — default: disabled

**Assessment**

- `mapBuild` — default: enabled
- `evidenceManagement` — default: enabled
- `passiveRecon` — default: enabled

**Sensitive testing**

- `activeRecon` — default: disabled
- `automatedScanning` — default: disabled
- `exploitValidation` — default: disabled

## Tools by Chat Mode

### Hypothesis (`hypothesis`)

_Read context and form grounded hypotheses only._ · capability: `assess`

| Tool | Authority permission | Risk / capability |
| --- | --- | --- |
| `fetch_url` | `webResearch` | external-read / observe |
| `find_files` | `workspaceRead` | read / observe |
| `get_file_outline` | `workspaceRead` | read / observe |
| `inspect_workspace` | `workspaceRead` | read / observe |
| `list_files` | `workspaceRead` | read / observe |
| `read_file` | `workspaceRead` | read / observe |
| `read_files` | `workspaceRead` | read / observe |
| `read_process` | `commandExecution` | workspace / workspace |
| `request_operator_questions` | `workspaceRead` | read / observe |
| `search_code` | `workspaceRead` | read / observe |
| `search_web` | `webResearch` | external-read / observe |

### Plan (`planner`)

_Create and revise plans; read and write workspace files._ · capability: `plan`

| Tool | Authority permission | Risk / capability |
| --- | --- | --- |
| `append_file` | `workspaceWrite` | workspace / workspace |
| `create_file` | `workspaceWrite` | workspace / workspace |
| `fetch_url` | `webResearch` | external-read / observe |
| `find_files` | `workspaceRead` | read / observe |
| `get_file_outline` | `workspaceRead` | read / observe |
| `insert_in_file` | `workspaceWrite` | workspace / workspace |
| `inspect_workspace` | `workspaceRead` | read / observe |
| `list_files` | `workspaceRead` | read / observe |
| `patch_file` | `workspaceWrite` | workspace / workspace |
| `read_file` | `workspaceRead` | read / observe |
| `read_files` | `workspaceRead` | read / observe |
| `read_process` | `commandExecution` | workspace / workspace |
| `replace_in_file` | `workspaceWrite` | workspace / workspace |
| `request_operator_questions` | `workspaceRead` | read / observe |
| `search_code` | `workspaceRead` | read / observe |
| `search_web` | `webResearch` | external-read / observe |
| `write_file` | `workspaceWrite` | workspace / workspace |

### Agent (`agent`)

_Execute, observe, verify, and report within Authority and policy._ · capability: `active`

| Tool | Authority permission | Risk / capability |
| --- | --- | --- |
| `annotate_map_finding` | `evidenceManagement` | evidence / evidence |
| `append_file` | `workspaceWrite` | workspace / workspace |
| `create_file` | `workspaceWrite` | workspace / workspace |
| `create_guidance` | `workspaceWrite` | workspace / workspace |
| `delete_file` | `workspaceDelete` | workspace / workspace |
| `fetch_url` | `webResearch` | external-read / observe |
| `find_files` | `workspaceRead` | read / observe |
| `find_map_paths` | `mapBuild` | read / observe |
| `get_file_outline` | `workspaceRead` | read / observe |
| `get_map_evidence` | `mapBuild` | read / observe |
| `get_map_hypotheses` | `mapBuild` | read / observe |
| `get_map_neighbors` | `mapBuild` | read / observe |
| `get_map_node` | `mapBuild` | read / observe |
| `get_map_overview` | `mapBuild` | read / observe |
| `get_map_shared_objects` | `mapBuild` | read / observe |
| `index_workspace` | `workspaceRead` | read / observe |
| `ingest_assessment_records` | `workspaceRead` | read / observe |
| `insert_in_file` | `workspaceWrite` | workspace / workspace |
| `inspect_workspace` | `workspaceRead` | read / observe |
| `list_datasets` | `workspaceRead` | read / observe |
| `list_files` | `workspaceRead` | read / observe |
| `load_tool_schemas` | `workspaceRead` | read / observe |
| `patch_file` | `workspaceWrite` | workspace / workspace |
| `read_file` | `workspaceRead` | read / observe |
| `read_files` | `workspaceRead` | read / observe |
| `read_process` | `commandExecution` | workspace / workspace |
| `record_finding_candidate` | `evidenceManagement` | evidence / evidence |
| `record_hypothesis` | `evidenceManagement` | evidence / evidence |
| `replace_in_file` | `workspaceWrite` | workspace / workspace |
| `request_operator_questions` | `workspaceRead` | read / observe |
| `run_command` | `activeRecon` | unclassified-external / active |
| `run_security_tool` | `activeRecon` | active / active |
| `run_traffsucker` | `activeRecon` | active / active |
| `search_code` | `workspaceRead` | read / observe |
| `search_map_routes` | `mapBuild` | read / observe |
| `search_web` | `webResearch` | external-read / observe |
| `start_process` | `activeRecon` | unclassified-external / active |
| `stop_process` | `commandExecution` | workspace / workspace |
| `verify_finding_candidate` | `evidenceManagement` | evidence / evidence |
| `write_file` | `workspaceWrite` | workspace / workspace |

### Ask (`ask`)

_Analyze evidence and answer with read-only tools._ · capability: `observe`

| Tool | Authority permission | Risk / capability |
| --- | --- | --- |
| `fetch_url` | `webResearch` | external-read / observe |
| `find_files` | `workspaceRead` | read / observe |
| `get_file_outline` | `workspaceRead` | read / observe |
| `inspect_workspace` | `workspaceRead` | read / observe |
| `list_files` | `workspaceRead` | read / observe |
| `read_file` | `workspaceRead` | read / observe |
| `read_files` | `workspaceRead` | read / observe |
| `read_process` | `commandExecution` | workspace / workspace |
| `request_operator_questions` | `workspaceRead` | read / observe |
| `search_code` | `workspaceRead` | read / observe |
| `search_web` | `webResearch` | external-read / observe |

## Full Tool Catalog

| Tool | Category | Description | Authority permission | Active | Exploit |
| --- | --- | --- | --- | --- | --- |
| `find_files` | os | Find files in the workspace by path, basename, extension, or partial name before reading them. | `workspaceRead` | no | no |
| `list_files` | os | List current project files. Use this as the first inventory step when unsure what exists. | `workspaceRead` | no | no |
| `inspect_workspace` | os | Return a compact project overview: file count, top folders, important config files, detected package scripts, and likely | `workspaceRead` | no | no |
| `read_file` | os | Read the current contents of a project file. Use this before editing any existing file whose contents are not shown. | `workspaceRead` | no | no |
| `read_files` | os | Read several project files in one call. Use when a change spans multiple known files, when comparing related files, or a | `workspaceRead` | no | no |
| `write_file` | os | Create a new file, or replace a whole file only when explicitly requested. This call writes exactly one file. Never past | `workspaceWrite` | no | no |
| `create_file` | os | Create a new project file that does not already exist. Use this for new files instead of patch_file. This call creates e | `workspaceWrite` | no | no |
| `create_guidance` | os | Create one AI-authored XEKUTE Rule, Skill, or Subagent file. Use only for a /create-skill, /create-rule, or /create-suba | `workspaceWrite` | no | no |
| `request_operator_questions` | os | Pause only when a missing decision materially blocks the next step. Ask 1–3 short questions with 2–3 plain-language choi | `workspaceRead` | no | no |
| `load_tool_schemas` | os | Load full JSON schemas for catalog tools that are not in the hot schema set yet. Use packs (workspace, map, evidence, ac | `workspaceRead` | no | no |
| `patch_file` | os | Edit one existing file by replacing one exact block. Read the current file first, copy search text exactly, and call pat | `workspaceWrite` | no | no |
| `replace_in_file` | os | Replace exact text inside an existing file. Use after read_file when you know the exact old text. | `workspaceWrite` | no | no |
| `insert_in_file` | os | Insert text before or after an exact anchor in an existing file. Use this for adding functions/imports. | `workspaceWrite` | no | no |
| `append_file` | os | Append text to the end of an existing file. Use this for simple additions when no exact patch anchor is needed. | `workspaceWrite` | no | no |
| `delete_file` | os | Delete an existing project file only when the user explicitly asks to delete/remove it. | `workspaceDelete` | no | no |
| `index_workspace` | os | Build a local code index and dependency/symbol graph for broad codebase work. | `workspaceRead` | no | no |
| `search_code` | os | Search the local workspace index for relevant files and snippets. | `workspaceRead` | no | no |
| `search_web` | cyber | Search the public web for current facts, official documentation, APIs, releases, or external references. Search first, t | `webResearch` | no | no |
| `fetch_url` | cyber | Read one public HTTP/HTTPS page selected from web search. Returns compact readable text and the final source URL. Privat | `webResearch` | no | no |
| `get_file_outline` | os | Return imports and symbol/function/class outline for one file without reading the full contents. Use this to navigate la | `workspaceRead` | no | no |
| `get_map_overview` | cyber | Return a compact, bounded overview of the current application behavior Map. Use this before querying a specific hypothes | `mapBuild` | no | no |
| `get_map_node` | cyber | Return one Map node with its machine-readable fields, AI summary, variants, risk signals, evidence references, and scope | `mapBuild` | no | no |
| `get_map_neighbors` | cyber | Return bounded neighboring nodes and relationship edges for a Map node. Out-of-scope relationships are explicitly flagge | `mapBuild` | no | no |
| `find_map_paths` | cyber | Find bounded directed paths between two Map nodes server-side. Use this for reachability and anonymous-to-sensitive rout | `mapBuild` | no | no |
| `search_map_routes` | cyber | Search observed and discovered Map routes by host, method, path, tag, or AI summary. | `mapBuild` | no | no |
| `get_map_shared_objects` | cyber | Return HMAC-protected shared-object correlations linking routes, with confidence and evidence IDs but without exposing r | `mapBuild` | no | no |
| `get_map_evidence` | cyber | Fetch redacted request/response evidence by Traffic/Raw request ID. Authorization, cookie, and API-key headers are redac | `mapBuild` | no | no |
| `get_map_hypotheses` | cyber | Return precomputed, explicitly untested candidate hypotheses such as possible IDOR patterns derived from graph structure | `mapBuild` | no | no |
| `annotate_map_finding` | cyber | Write an agent-asserted hypothesis/test result back into Map/agent-annotations.json with provenance. Refuses routes that | `evidenceManagement` | no | no |
| `record_hypothesis` | cyber | Record a bounded, explicitly unconfirmed security hypothesis and the evidence needed to test it. | `evidenceManagement` | no | no |
| `ingest_assessment_records` | cyber | Submit structured tool or AI observations to XEKUTE's schema-managed Python parser. The parser validates fields, dedupli | `workspaceRead` | no | no |
| `list_datasets` | cyber | List the canonical assessment datasets available for ingest_assessment_records, whether each is currently provisioned (e | `workspaceRead` | no | no |
| `run_security_tool` | cyber | Run one supported security tool through a typed, policy-controlled adapter. Supply a canonical in-scope target, hypothes | `activeRecon` | yes | no |
| `run_traffsucker` | cyber | Launch traffsucker as a long-lived browser-mapping subagent. A config.yaml is authored into runtime/traffsucker/ for sco | `activeRecon` | yes | no |
| `record_finding_candidate` | cyber | Persist one structured finding candidate through XEKUTE's evidence, scope, reproduction, impact, false-positive, and hyb | `evidenceManagement` | no | no |
| `verify_finding_candidate` | cyber | Submit one structured finding candidate and its referenced evidence to XEKUTE's separate temperature-zero no-tools verif | `evidenceManagement` | no | no |
| `run_command` | os | Run a workspace command in an agent terminal. The agent turn stops immediately. Harness shows live waiting time, feeds a | `activeRecon` | yes | no |
| `start_process` | os | Start a long-running workspace process in an agent terminal. Set wait_ms to end the agent turn; harness shows live waiti | `activeRecon` | yes | no |
| `read_process` | os | Read stdout/stderr and running status for a process started with start_process. | `commandExecution` | no | no |
| `stop_process` | os | Stop a process started with start_process after testing or when it is no longer needed. | `commandExecution` | no | no |

## Internal / non-model tools

- run_custom_script — used by slash-command routing in the main process; not exposed in the model tool schema.
