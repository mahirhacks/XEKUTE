# Current XEKUTE Agent Orchestration Flow

This document describes the current implementation flow for an LLM task in XEKUTE. It focuses on the runtime behavior represented by `src/application/agent/controller.js`, the Electron entry point, the Ollama/OpenRouter stream adapters, the tool catalog/handlers, the policy engine, and the assessment runtime state.

> This is an implementation flowchart, not a product roadmap. A tool may be granted by mode but still be blocked by Authority, scope, RoE, approval, schema, command, or failure-memory guards.

## 1. Complete turn flow

```mermaid
flowchart TD
    U[User request in XEKUTE UI] --> IPC[Electron IPC: agent:run]
    IPC --> RUN_INIT{Workspace supplied?}
    RUN_INIT -->|Yes| CREATE_RUN[Create assessment run record]
    RUN_INIT -->|No| PROFILE
    CREATE_RUN --> PROFILE[Normalize mode/profile and select model]

    PROFILE --> TURN
    AGENT_MODEL -->|No| TURN[runAgentTurn]

    TURN --> ROUTE[Route request: conversation, workspace, plan, cyber, memory]
    ROUTE --> GRANT[Filter tools by mode; build granted names]
    GRANT --> SCHEMAS[Select hot schemas and catalog-only tools]
    SCHEMAS --> POLICY[Load workspace/project Authority, scope, RoE, rate and stop policy]
    POLICY --> STATE[Create run state at preflight]
    STATE --> INTENT[Infer mutation, plan document, target and discovery needs]
    INTENT --> PROMPT[Compile system prompt, mode skill, VAPT/cyber guidance, memory and workspace context]
    PROMPT --> ROUND

    ROUND[Agent round, maximum 10] --> BUDGET{Wall clock, prompt tokens and context fit?}
    BUDGET -->|No| TERMINAL[finishRun]
    BUDGET -->|Yes| MODEL[Call Ollama or OpenRouter stream]
    MODEL --> STREAM[Stream thinking, content and tool-call deltas]
    STREAM --> RESPONSE{Provider result?}
    RESPONSE -->|Provider error/abort| TERMINAL
    RESPONSE -->|Text/tool calls| PARSE[Normalize and resolve calls]
    PARSE --> CALLS{Usable tool calls?}
    CALLS -->|No| NO_TOOL[No-tool branch]
    CALLS -->|Yes| TOOL_LOOP[Tool-call gate and execution pipeline]
    NO_TOOL --> NO_TOOL_DECISION{What was requested?}
    NO_TOOL_DECISION -->|Read/conversation| COMPLETE_TEXT[Use model text or tool summary]
    NO_TOOL_DECISION -->|Mutation/plan| RETRY_TEXT[Retry tool instructions, plan save, verification or missing-file work]
    RETRY_TEXT --> ROUND
    NO_TOOL_DECISION -->|Retries exhausted| COMPLETE_TEXT
    COMPLETE_TEXT --> TERMINAL
    TOOL_LOOP --> WAIT_OR_NEXT{Wait state, stop condition or continue?}
    WAIT_OR_NEXT -->|Continue| ROUND
    WAIT_OR_NEXT -->|Terminal wait/subagent wait| WAITING[Return waiting status; harness resumes later]
    WAIT_OR_NEXT -->|Stop condition| STOPPED[Stop run]
    WAITING --> TERMINAL
    STOPPED --> TERMINAL
    TERMINAL --> CLAIMS[Evidence, completion gates and final claim validation]
    CLAIMS --> RECORD[Write run terminal/action/claim records]
    RECORD --> UI[Return result and stream events to UI]
```

## 2. Model request and outgoing tool-call path

```mermaid
sequenceDiagram
    participant UI as Renderer UI
    participant MAIN as Electron main
    participant C as runAgentTurn
    participant P as Ollama/OpenRouter
    participant G as Grants/Policy
    participant X as Tool executor
    participant H as run_security_tool handler

    UI->>MAIN: agent:run(payload)
    MAIN->>C: runAgentTurn(payload, callbacks)
    C->>C: Normalize profile, route context, grant tools
    C->>C: Build bounded messages and tool schemas
    C->>P: Stream model request with messages + available tools
    P-->>C: thinking/content/tool-call deltas
    C->>C: Merge tool-call fragments and parse arguments
    C->>C: Resolve paths and normalize tool calls
    C->>G: Check mode grant, schema loaded, command and policy
    alt Not granted or policy blocked
        G-->>C: Rejection result; no handler execution
        C-->>P: role=tool error message on next round
    else Approval required
        G-->>UI: action_policy + approval request
        UI-->>G: approved/denied/expired
        G->>G: Re-evaluate action-bound approval token
    else Allowed
        G-->>C: allowed
        C->>X: executeToolCall(toolCall)
        X->>X: Validate schema and normalize arguments
        X->>H: Dispatch run_security_tool(args)
        H->>H: Build typed adapter action
        H->>H: Resolve target and compare DNS resolution
        H->>H: Apply per-target rate lease
        H-->>X: Execute typed executable, persist redacted evidence
        X-->>C: Normalized result
        C-->>P: role=tool result message on next round
    end
    C-->>UI: tool_call/tool_result/run_state/activity events
```

## 3. Preflight and context assembly

```mermaid
flowchart TD
    START[runAgentTurn inputs] --> PROFILE[normalizeProfile(modeFamily, mode)]
    PROFILE --> ROUTE[ContextRouter.routeRequest]
    ROUTE --> TOOLS[filterToolsForMode]
    TOOLS --> NAMES[allowedToolNames]
    NAMES --> HOT[hotToolNamesForProfile]
    HOT --> CATALOG[Agent sees catalog names; full schemas only for hot set]
    ROUTE --> POLICY[loadPolicy]
    POLICY --> FILES[Read project scope/configurations.json, in-scope.json, engagement.json, settings.config]
    POLICY --> FLAGS[Authority permissions, active/scan/exploit gates, target scope, RoE, windows, rate limits]
    ROUTE --> INTENT[Detect edit, plan, target, mutation and discovery requirements]
    INTENT --> BRIEF[Build task brief]
    ROUTE --> DISCOVERY[Optional workspace discovery hints]
    PROFILE --> GUIDANCE[Workspace guidance + cyber library + VAPT library + mode skill]
    GUIDANCE --> SYSTEM[PromptCompiler system context]
    SYSTEM --> CONTEXT[System/project/memory/context messages]
    DISCOVERY --> CONTEXT
    FLAGS --> CONTEXT
    CATALOG --> CONTEXT
    BRIEF --> ROUND[Begin model round]
    CONTEXT --> ROUND
```

## 4. Tool-call parsing, normalization and validation

```mermaid
flowchart TD
    PROVIDER[Ollama NDJSON or OpenRouter SSE] --> DELTA[Incoming message/delta]
    DELTA --> MERGE[Merge tool call fragments by index/id/name]
    MERGE --> TOOL_CALLS[result.toolCalls]
    TOOL_CALLS --> NATIVE{Native calls present?}
    NATIVE -->|No and mutation required| FALLBACK[Parse structured JSON fallback]
    NATIVE -->|Yes| NORMALIZE[ToolMap.normalizeToolCall]
    FALLBACK --> NORMALIZE
    NORMALIZE --> NAME{Known TOOL_META name?}
    NAME -->|No| DROP[Controller filters unknown call]
    NAME -->|Yes| ARG[parseArguments]
    ARG --> ARG_OK{Arguments object?}
    ARG_OK -->|Malformed string| EMPTY[JSON.parse catch returns {}]
    ARG_OK -->|Valid/object| SANITIZE[Sanitize paths, text, command and URLs]
    EMPTY --> SANITIZE
    SANITIZE --> RESOLVE[Resolve target file/path aliases]
    RESOLVE --> GRANTED{Tool name in allowedToolNames?}
    GRANTED -->|No| NOT_GRANTED[NOT_GRANTED/MODE_GUARD; never execute]
    GRANTED -->|Yes| LOADED{Full schema loaded?}
    LOADED -->|No| LOAD_SCHEMA[Return SCHEMA_NOT_LOADED; load for next round]
    LOADED -->|Yes| EXEC_PIPE[Continue to preflight and execution gates]
    EXEC_PIPE --> DISPATCH[createToolHandlers.executeToolCall]
    DISPATCH --> VALIDATE[normalizeIncomingToolCall + validateToolCall]
    VALIDATE --> VALID{Required fields and typed constraints valid?}
    VALID -->|No| VALIDATION_ERROR[Return structured validation error]
    VALID -->|Yes| HANDLER[Dispatch by category and tool name]
```

## 5. Grant, Authority, scope and approval gates

```mermaid
flowchart TD
    CALL[Normalized tool call] --> REGISTERED{Registered or leased tool?}
    REGISTERED -->|No| DENY_GRANT[TOOL_UNAVAILABLE]
    REGISTERED -->|Yes| SCHEMA{Schema loaded?}
    SCHEMA -->|No| DENY_SCHEMA[SCHEMA_NOT_LOADED; no execution]
    SCHEMA -->|Yes| CLASSIFY[classifyAction]
    CLASSIFY --> PERM{Authority permission enabled?}
    PERM -->|No| DENY_PERM[AUTHORITY_PERMISSION_DISABLED]
    PERM -->|Yes| EXPLOIT{Exploit action?}
    EXPLOIT -->|Yes| EXP_GATE{Exploit allowed and approved?}
    EXP_GATE -->|No| DENY_EXPLOIT[POLICY_EXPLOIT_DISABLED or EXPLOIT_APPROVAL_REQUIRED]
    EXP_GATE -->|Yes| ACTIVE
    EXPLOIT -->|No| ACTIVE{Active action?}
    ACTIVE -->|No| APPROVAL
    ACTIVE -->|Yes| ACTIVE_POLICY{Active testing enabled?}
    ACTIVE_POLICY -->|No| DENY_ACTIVE[POLICY_ACTIVE_DISABLED]
    ACTIVE_POLICY -->|Yes| AUTH{Authorization confirmed?}
    AUTH -->|No| DENY_AUTH[AUTHORIZATION_REQUIRED]
    AUTH -->|Yes| SCOPE_REVIEW{Scope reviewed?}
    SCOPE_REVIEW -->|No| DENY_REVIEW[SCOPE_REVIEW_REQUIRED]
    SCOPE_REVIEW -->|Yes| ROE{Rules accepted and technique allowed?}
    ROE -->|No| DENY_ROE[ROE/TECHNIQUE gate]
    ROE -->|Yes| WINDOW{Testing window and authorization expiry valid?}
    WINDOW -->|No| DENY_WINDOW[Window/expiry denial]
    WINDOW -->|Yes| TARGET{Canonical target in scope?}
    TARGET -->|No| DENY_TARGET[TARGET_REQUIRED or TARGET_OUT_OF_SCOPE]
    TARGET -->|Yes| AUTOMATION{Automated scanning allowed?}
    AUTOMATION -->|No| DENY_AUTOMATION[POLICY_AUTOMATION_DISABLED]
    AUTOMATION -->|Yes| APPROVAL{Approval required?}
    APPROVAL -->|Yes| ASK[requestApproval with timeout]
    ASK --> DECISION{Approved with matching action-bound token?}
    DECISION -->|No| DENY_APPROVAL[Approval denial/expiry]
    DECISION -->|Yes| ALLOW[Allowed]
    APPROVAL -->|No| ALLOW
```

## 6. `run_security_tool` execution path

```mermaid
flowchart TD
    ALLOW[Policy allowed] --> CALL_HANDLER[executeToolCall]
    CALL_HANDLER --> VALIDATE[Validate adapter_id, target, hypothesis_id, expected_signal, technique_ids, evidence_plan]
    VALIDATE --> READY{Valid typed request?}
    READY -->|No| ERROR[Return SECURITY_ACTION_INCOMPLETE or validation error]
    READY -->|Yes| HYP[Read ready hypothesis ledger]
    HYP --> HYP_EXISTS{Ready hypothesis exists?}
    HYP_EXISTS -->|No| CREATE_HYP[Create ready hypothesis from call fields]
    HYP_EXISTS -->|Yes| BUILD
    CREATE_HYP --> BUILD[SecurityToolAdapters.buildAction]
    BUILD --> BUILT{Supported adapter and safe action?}
    BUILT -->|No| ERROR
    BUILT -->|Yes| DNS[Resolve current target addresses]
    DNS --> STABLE{Resolution stable vs preflight resolution?}
    STABLE -->|No| STOP_SCOPE[Return scope/resolution error]
    STABLE -->|Yes| LEASE[Acquire per-host rate/concurrency lease]
    LEASE --> PROCESS[Run typed executable; never model-built shell command]
    PROCESS --> OUTPUT[Capture stdout/stderr/exit/timeout]
    OUTPUT --> REDACT[Redact secrets and limit artifact size]
    REDACT --> ARTIFACT[Write output_path with restricted permissions]
    ARTIFACT --> EVIDENCE[Append evidence record with SHA-256]
    EVIDENCE --> RESULT[Return normalized result with status, adapter, outputPath and evidenceId]
    RESULT --> OBSERVE[Controller records action result and observation phase]
```

## 7. Retry, failure memory and repeated-call blocking

```mermaid
flowchart TD
    RESULT[Tool result] --> SUCCESS{Successful execution?}
    SUCCESS -->|Yes| CLEAR[Clear same signature failure state; mark read signature if read-only]
    SUCCESS -->|No| EXECUTED{Was tool actually executed or a repeated-call block?}
    EXECUTED -->|No| NO_COUNT[Policy/mode/schema denials do not increment failure memory]
    EXECUTED -->|Yes| SIGNATURE[Canonical tool name + canonical args]
    SIGNATURE --> COUNT[Increment failedToolCalls, failedToolClasses and global error class count]
    COUNT --> LIMIT{Same error class count >= REPEAT_CLASS_LIMIT = 2?}
    LIMIT -->|No| NEXT_ROUND[Model receives error tool message; may adapt]
    LIMIT -->|Yes| PERSIST[Persist failure record for 24 hours, max 24 records]
    PERSIST --> BLOCK[Block identical call or repeated error class]
    BLOCK --> ADAPT[Model must change arguments, use safer alternative, ask operator, mark inconclusive or stop]
    NEXT_ROUND --> ROUND[Next bounded round]
    CLEAR --> ROUND
    NO_COUNT --> ROUND
    ADAPT --> ROUND
    ROUND --> BUDGET{MAX_AGENT_ROUNDS = 10 / wall clock 600s / token ceiling}
    BUDGET -->|Exceeded| INCONCLUSIVE[finishRun failed/inconclusive]
```

## 8. Waiting and human-interaction branches

```mermaid
flowchart TD
    TOOL[Tool executes] --> KIND{Special result mode?}
    KIND -->|request_operator_questions| QUESTIONS[Write questions file and ask UI]
    QUESTIONS --> ANSWERS{Answered before 300s?}
    ANSWERS -->|Yes| FEED_ANSWERS[Append answers as user context]
    ANSWERS -->|No/skipped| FEED_SKIP[Append skipped/expired context]
    FEED_ANSWERS --> ROUND[Resume next model round]
    FEED_SKIP --> ROUND
    KIND -->|run_command/start_process| TERMINAL[Register terminal wait]
    TERMINAL --> TERMINAL_DONE{Process complete?}
    TERMINAL_DONE -->|No checkpoint| CHECKPOINT[Feed checkpoint transcript]
    TERMINAL_DONE -->|Yes| TRANSCRIPT[Feed final transcript]
    CHECKPOINT --> ROUND
    TRANSCRIPT --> ROUND
    KIND -->|run_traffsucker| SUBAGENT[Register background subagent wait]
    SUBAGENT --> SUB_DONE{Subagent complete?}
    SUB_DONE -->|No| SUB_CHECKPOINT[Feed checkpoint/status]
    SUB_DONE -->|Yes| SUB_RESULT[Feed final result]
    SUB_CHECKPOINT --> ROUND
    SUB_RESULT --> ROUND
    KIND -->|approval required| APPROVAL[Pause for approval, max 60s]
    APPROVAL --> ROUND
```

## 9. Assessment phase machine

```mermaid
stateDiagram-v2
    [*] --> preflight
    preflight --> inventory: cyber tool path passes preflight
    inventory --> hypothesis: hypothesis or typed security action
    hypothesis --> test_design: smallest test is defined
    test_design --> approval: policy evaluates proposed action
    approval --> execution: allowed/approved
    execution --> observation: result recorded
    observation --> verification: evidence and result available
    verification --> finding: candidate passes promotion gate
    verification --> report: inconclusive/coverage report
    finding --> report: finding recorded
    report --> retest: operator requests retest/fix comparison
    report --> complete: terminal report written
    retest --> complete: retest status recorded
    complete --> [*]

    note right of preflight
      Phase transitions are monotonic.
      Testing workflows cannot skip phases
      without operator approval and a reason.
    end note
```

## 10. Finalization and claim safety

```mermaid
flowchart TD
    END[Text answer, tool summary, wait, stop or budget end] --> EVIDENCE[Collect evidence IDs from action results]
    EVIDENCE --> GATES[Check completionIssues for requested assessment]
    GATES --> CLAIM_CHECK[validateFinalClaims]
    CLAIM_CHECK --> UNSUPPORTED{Warnings or missing gates?}
    UNSUPPORTED -->|Yes| INCONCLUSIVE[Terminal status inconclusive]
    UNSUPPORTED -->|No| STATUS[Completed/failed/stopped/waiting status]
    INCONCLUSIVE --> CLAIM[Claim state inconclusive]
    STATUS --> CLAIM_STATE{Evidence and verification?}
    CLAIM_STATE -->|Verified evidence + passed verification| VERIFIED[Claim state verified]
    CLAIM_STATE -->|Evidence only| OBSERVED[Claim state observed]
    CLAIM_STATE -->|No evidence| INFERRED[Claim state inferred]
    CLAIM --> RECORD
    VERIFIED --> RECORD
    OBSERVED --> RECORD
    INFERRED --> RECORD[Write run_terminal, action log, claim record and operator feedback]
    RECORD --> RETURN[Return finalText, runState, claims, warnings, evidence requirement and failure records]
```

## Main implementation files

- `src/presentation/electron/main.js` — IPC entry, model qualification, provider round wiring, tool executor wiring.
- `src/application/agent/controller.js` — context assembly, round loop, tool-call normalization, grants, policy/approval orchestration, retries, waits and finalization.
- `src/adapters/llm/ollama/ollama-stream.js` — Ollama NDJSON stream parsing and tool-call fragment merging.
- `src/adapters/llm/openrouter/openrouter-stream.js` — OpenRouter SSE parsing and tool-call fragment merging.
- `src/adapters/tools/core/tool-catalog.js` — tool schemas, mode tool groups, argument parsing and validation.
- `src/adapters/tools/core/tool-handlers.js` — category dispatch and concrete handlers, including `run_security_tool`.
- `src/application/policies/policy-engine.js` — action classification, Authority, scope, RoE, testing-window, automation and approval gates.
- `src/application/agent/runtime.js` — run state, phase transitions, evidence IDs, completion gates and claim validation.
- `src/application/agent/memory/failure-memory.js` — persisted repeated-failure records and expiry.
- `src/application/agent/tunables.js` — round, retry, timeout and failure thresholds.

## Runtime constants that materially affect the flow

- `MAX_AGENT_ROUNDS = 10`
- `TURN_WALL_CLOCK_MS = 600000` (10 minutes)
- `REPEAT_CLASS_LIMIT = 2`
- `FAILURE_MEMORY_TTL_MS = 86400000` (24 hours)
- `MAX_RECORDS = 24` failure records
- `APPROVAL_TIMEOUT_MS = 60000`
- `OPERATOR_QUESTIONS_TIMEOUT_MS = 300000`
- `MAX_EDIT_RETRIES_WITHOUT_TOOLS = 1`
- `MAX_PLAN_RETRIES_WITHOUT_FILE = 3`
- `MAX_VERIFICATION_REMINDERS = 1`
- `MAX_FAILED_VERIFICATION_REMINDERS = 1`
