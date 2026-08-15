---
title: Metasploit Framework
phase: exploitation
aliases:
  - metasploit
  - msf
  - msfconsole
related_skills:
  - vulnerability_analysis
  - exploitation
  - verification
  - post_exploitation
mcp:
  - server: metasploit
    tools:
      - name: list_exploits
        modes: [ask, hypothesis, plan, agent]
        access: read
        target_types: [knowledge]
        target_arguments: [search_term]
      - name: list_payloads
        modes: [ask, hypothesis, plan, agent]
        access: read
        target_types: [knowledge]
        target_arguments: [platform, arch]
      - name: run_exploit
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [options.RHOSTS, options.RHOST]
      - name: run_auxiliary_module
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [options.RHOSTS, options.RHOST]
      - name: run_post_module
        modes: [agent]
        access: mutate
        target_types: [session]
        target_arguments: [session_id]
      - name: send_session_command
        modes: [agent]
        access: mutate
        target_types: [session]
        target_arguments: [session_id]
      - name: start_listener
        modes: [agent]
        access: mutate
        target_types: [network]
        target_arguments: [lhost]
      - name: stop_job
        modes: [agent]
        access: mutate
        target_types: [assessment]
        target_arguments: [job_id]
      - name: terminate_session
        modes: [agent]
        access: mutate
        target_types: [session]
        target_arguments: [session_id]
---

# Metasploit Framework

## Purpose
Use Metasploit as a controlled module research, validation, and evidence source for an explicitly authorized assessment. Selecting this skill makes its methodology available and may lease the allowlisted tools from the configured `metasploit` MCP server. It does not expand target scope, approve a plan, or enable dangerous actions in the MCP server.

## When to use
Use this skill after reconnaissance has identified a concrete service, version, configuration, or vulnerability hypothesis that maps to a Metasploit module. Prefer module search and information queries during hypothesis and planning. Use check or execution operations only in Agent mode when the target and action are authorized and, for plan-bound work, declared by the approved plan.

## Prerequisites

- The `metasploit` MCP server is declared in `mcp.json`; when it runs in Kali, Local Kali access is enabled and its SSH test succeeds.
- The server is launched with `MetasploitMCP.py --transport stdio` through XEKUTE's Kali SSH bridge. The repository's HTTP/SSE mode is not used by this integration.
- The server must expose the exact mapped names: `list_exploits`, `list_payloads`, `run_exploit`, `run_auxiliary_module`, `run_post_module`, `send_session_command`, `start_listener`, `stop_job`, and `terminate_session`.
- The target is explicitly included in assessment scope and not excluded by host, path, IP range, DNS result, or reserved-address policy.
- Service and version evidence is current enough to justify module selection.
- Required payload behavior, callback addresses, concurrency, and stop conditions are understood before execution.
- Any execution-relevant action is present in the approved plan when operating plan-bound.

## Workflow

1. Query project evidence for the target service, version, operating system, route, and relevant controls.
2. Search available exploit and payload names using `list_exploits` or `list_payloads` and the smallest discriminating product, protocol, and vulnerability terms.
3. Select a candidate module only after checking its local Metasploit metadata and matching required options, supported targets, reliability notes, and side effects.
4. Reject modules that do not match the observed service or violate the rules of engagement.
5. Prefer the server's `check_vulnerability` or `check_target` option before execution when the selected tool supports it and the check is authorized.
6. Set every target and callback option explicitly; never infer a broader target range from a single host.
7. Execute only the approved action, monitor the result UUID or session, and stop on an unexpected impact or scope transition.
8. Capture sanitized evidence, compare expected and observed signals, and verify any security conclusion independently.

## Evidence to collect
Record the module fullname and version, source references, selected target, non-secret options, originating evidence references, start and completion times, result UUID, check code, sanitized output, session identifier where applicable, affected service, observed side effects, and cleanup status. Do not copy credentials, tokens, payload secrets, or complete session output into prompts or project LTM.

## Analysis guidance
Treat module availability as methodology, not proof of vulnerability. Match preconditions against observed evidence and distinguish `appears`, `detected`, and `vulnerable` check outcomes. A successful session may demonstrate impact but still requires evidence that ties the behavior to the intended target and approved action. A failed exploit can result from environmental controls, module mismatch, unstable timing, or an invalid hypothesis; preserve the negative result and retry conditions.

## Verification rules
Correlate the module result with direct target evidence and a deterministic before/after signal. Confirm that the result belongs to the expected host, service, account, and plan step. Remove test artifacts where authorized and document anything that cannot be cleaned up. Never promote a module banner, search match, or uncorrelated session to a verified finding.

## Stop conditions
Stop immediately when the resolved target leaves scope, an exclusion matches, an operation would affect additional hosts, authentication or payload behavior differs from the plan, the target becomes unstable, sensitive data exceeds the minimum evidence need, or the rules of engagement prohibit the module's effects. A materially different module, payload, target, or parallelism level requires plan revision and reapproval.

## Common failure patterns

- Running the first search result without matching module preconditions.
- Treating Metasploit module availability as evidence of vulnerability.
- Leaving `RHOSTS`, `LHOST`, payload, or target defaults implicit.
- Enabling dangerous actions globally when only read-only module research is needed.
- Allowing a session or callback to cross an origin or network boundary not declared in scope.
- Repeating a failed module without changing an evidence-backed condition.
- Storing credentials, tokens, or raw session contents in chat, evidence summaries, or LTM.

## Windows and Kali tool table

| Tool | Runs on | Use |
|---|---|---|
| XEKUTE `query_knowledge` | Windows | Select this skill and lease only its allowlisted Metasploit MCP schemas. |
| Windows OpenSSH `ssh.exe` | Windows | Carries MCP stdio when the generic MCP entry selects XEKUTE's Kali transport; key authentication is recommended. |
| `/home/<user>/MetasploitMCP/run-xekute.sh` | Kali VM | Starts the repository's MCP server in stdio mode with the RPC environment. |
| `MetasploitMCP.py --transport stdio` | Kali VM | Exposes the mapped Metasploit MCP tools over the SSH stdio channel. |
| `msfrpcd` | Kali VM | Provides the local Metasploit RPC runtime used by `MetasploitMCP.py`; it is not exposed directly to XEKUTE. |
| Metasploit Framework | Kali VM | Supplies module metadata, checks, execution, sessions, and database records. |

## Related skills
See `vulnerability_analysis` before selecting a module, `exploitation` for controlled execution methodology, `verification` for evidence standards, and `post_exploitation` for explicitly authorized session handling and cleanup.
