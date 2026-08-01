# Tool architecture

XEKUTE divides agent tools by responsibility while keeping one canonical schema
and validation facade in `tool-map.js`.

## Workspace & OS tools

Implementation lives in `os/`.

- Discovery: `find_files`, `list_files`, `inspect_workspace`, `search_code`
- Reading: `read_file`, `read_files`, `get_file_outline`
- File changes: `create_file`, `patch_file`, `delete_file`
- Execution: `run_command`, `start_process`, `read_process`, `stop_process`

Compatibility tools such as `write_file`, `replace_in_file`, `insert_in_file`,
`append_file`, and `index_workspace` remain registered for older parsed
responses. They are not offered to the model by default because the smaller
canonical set covers the same workflow with fewer ambiguous choices.

## Cybersecurity tools

Implementation lives in `cyber/`.

- Research: `search_web`, `fetch_url`
- Assessment Map: bounded Map queries and evidence lookup
- Evidence: hypotheses, typed ingestion, finding candidates, and verification
- Active testing: `run_security_tool`, backed by typed adapters such as
  `httpx`, `nmap`, `katana`, `ffuf`, `gobuster`, `nuclei`, and `sqlmap`
- Operator surfaces: Toolbox catalog, web research, and WebClone

Active adapters receive structured arguments rather than free-form shell
commands and remain subject to scope, authority, policy, rate, and approval
checks.

## Model-facing routing

| Profile | Workspace & OS | Cybersecurity |
| --- | --- | --- |
| Ask | Read-only canonical set | Research and read-only Map queries |
| Planner | `create_file` for plan documents only | No tools |
| Safe Agent | Read-only, file changes, commands, processes | Read-only queries and evidence operations |
| Testing Agent | Read-only, file changes, commands, processes | Read-only queries, evidence operations, and active adapters |

`tool-map.js` is the only place callers use to obtain model-facing tool lists.
Both the Electron main process and renderer call `toolsForProfile`, preventing
their allowlists from drifting apart.

The role allowlists are explicit in `ToolMap.MODE_TOOL_GROUPS`:

- `agent`: workspace changes, processes, research, Map, and evidence tools;
  Testing Agent adds the active security adapter through policy-aware routing.
- `ask`: workspace reads, web research, and read-only Map queries.
- `planner`: `create_file`, with the policy engine restricting it to plan files.
