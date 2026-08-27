# Xekute Agent Memory Architecture v3

**Status:** Proposed V3 architecture baseline  
**Supersedes:** The five peer-memory model described by Context Memory v2  
**Primary objective:** Reduce context cost and implementation complexity by organizing memory according to access frequency, lifecycle, and responsibility.

---

## 1. Executive summary

Xekute V3 uses three physical memory tiers:

1. **Tier 1 — Active / Cache Memory**: live information already present in the LLM context.
2. **Tier 2 — Hot / Storage-Based Memory**: frequently accessed, project-scoped operational memory.
3. **Tier 3 — Cold / Knowledge and Artifact Memory**: large durable knowledge, history, and raw artifacts that are retrieved selectively.

Tier 2 contains three strictly separated operational memory domains:

- **Project Memory** answers: **How much do we know about the target?**
- **Investigation Memory** answers: **What systematic procedures should we follow, what did we test, and which techniques succeeded or failed?**
- **Evidence Memory** answers: **Which vulnerabilities are confirmed, and what evidence supports those claims?**

These domains must not be merged. Project Memory describes the target. Investigation Memory describes the security-testing process and its results. Evidence Memory contains only confirmed vulnerability claims and their proof.

The Retrieval Engine operates primarily between Tier 2 and Tier 3. It uses target knowledge from Project Memory and testing knowledge from Tier 3 to construct and maintain relevant Investigation Memory. It does **not** construct Tier 1 memory. Tier 1 is primarily the live execution environment of the agent.

---

## 2. Why V3 exists

The V2 architecture modeled Project Memory, Agent Session Memory, Investigation Memory, Evidence Memory, and Knowledge Base Memory as five peer memory types. Although their responsibilities were different, treating all five as equivalent top-level memories created unnecessary complexity:

- live LLM context was modeled like durable project state;
- frequently accessed project state was treated like a large reference corpus;
- retrieval, compression, storage, and semantic ownership became intertwined;
- information could be duplicated across session, project, investigation, and evidence records;
- every subsystem required separate synchronization, retrieval, and context-injection behavior;
- the architecture was harder to explain, implement, inspect, and maintain.

V3 separates memory first by **how it is used**:

```text
Cache  -> live, immediate, small, token-expensive
RAM    -> frequently accessed operational state
SSD    -> large, durable, infrequently accessed corpus
```

Within the hot operational tier, information is separated by its exact semantic owner. This produces a smaller architecture without sacrificing the boundaries required for reliable pentesting work.

---

## 3. High-level architecture

```text
                         XEKUTE AGENT MEMORY V3

+------------------------------------------------------------------+
| TIER 1 — ACTIVE / CACHE MEMORY                                   |
| Lives directly in the current LLM context                        |
| Fastest | Highest token cost | Small | Mostly live               |
|                                                                  |
|  System prompt                                                   |
|  Tool definitions                                                |
|  Core rules                                                      |
|  Active skill or procedure instructions                          |
|  Active subagent instructions                                    |
|  Compressed conversation                                         |
|  Active conversation                                             |
|  Current workflow                                                 |
|  Current user prompt                                             |
|  Small explicitly supplied working references                    |
+------------------------------------------------------------------+
                              |
                              | reads / writes operational state
                              v
+------------------------------------------------------------------+
| TIER 2 — HOT / STORAGE-BASED MEMORY                              |
| Frequently accessed project-scoped operational state             |
|                                                                  |
|  PROJECT MEMORY                                                  |
|    What do we know about the target?                             |
|                                                                  |
|  INVESTIGATION MEMORY                                            |
|    What should we test, what did we test, and what happened?     |
|                                                                  |
|  EVIDENCE MEMORY                                                 |
|    Which vulnerabilities are confirmed, and how do we prove it?  |
|                                                                  |
|  Derived indexes and Knowledge Graph relationships               |
+------------------------------------------------------------------+
                              ^
                              | retrieval / procedure selection
                              v
+------------------------------------------------------------------+
| TIER 3 — COLD / KNOWLEDGE AND ARTIFACT MEMORY                    |
| Large durable corpus, rarely injected or read in full            |
|                                                                  |
|  OWASP WSTG knowledge                                            |
|  General and specialized pentesting techniques                   |
|  Xekute techniques and methodology                               |
|  Advanced testing procedures                                     |
|  Historical investigation records                                |
|  Large and raw artifacts                                         |
+------------------------------------------------------------------+
```

The cache/RAM/SSD terminology is an architectural analogy. Tier 2 must still be durably persisted; it must not disappear when a process exits. “Hot” means frequently accessed and operational, not volatile.

---

## 4. The core distinction: physical presence versus logical ownership

An item can temporarily occupy LLM context tokens without becoming Tier 1-owned memory.

For example, when an agent requests the current investigation status, a slice of Investigation Memory may be serialized into the model request. Physically, those bytes are present in the context window. Logically, the information remains Tier 2 Investigation Memory because:

- Tier 2 is its authoritative source;
- Tier 2 controls its schema and lifecycle;
- the injected copy is temporary;
- changes must be written back through the Investigation Memory contract;
- removing it from the context window does not remove it from the project.

Tier classification is therefore determined by **ownership and lifecycle**, not only by temporary token location.

The canonical flow is:

```text
Tier 2 authoritative record
          |
          | bounded read when needed
          v
Temporary representation in an agent turn
          |
          | validated result/write
          v
Tier 2 authoritative record
```

The Retrieval Engine does not create the system prompt, tools, conversation, or other live Tier 1 material. Those are supplied by the agent runtime. Retrieval creates or selects operational and knowledge records, especially Investigation Memory.

---

## 5. Tier 1 — Active / Cache Memory

### 5.1 Purpose

Tier 1 is the agent's immediate execution environment. It contains the information the LLM currently needs to understand its role, follow rules, communicate, and execute the present task.

Tier 1 is intentionally small because every item consumes context-window capacity and may be repeatedly processed by the model.

Tier 1 compression is a **structured checkpoint rotation**. It does not summarize the whole context window. It reads only the mutable conversation and workflow blocks, produces a new continuity checkpoint, and rotates the completed mutable buffers. Pinned runtime instructions and the current user prompt remain concrete.

### 5.2 Tier 1 block structure

Tier 1 is divided into three blocks with different compression rules:

```text
BLOCK A — PINNED RUNTIME CONTEXT
  System prompt
  Tool definitions
  Skills, rules, and subagent instructions

BLOCK B — MUTABLE CONTINUITY CONTEXT
  Summarized Conversation Memory
  Active Conversation Memory
  Current Workflow

BLOCK C — PROTECTED CURRENT INPUT
  Current user prompt
  Small explicitly supplied working references
```

#### Block A — Pinned runtime context

Block A contains exact runtime instructions:

- system prompt;
- tool definitions;
- core behavioral and security rules;
- active skill or procedure instructions;
- active subagent instructions.

Block A is not summarized. The agent runtime reconstructs it from its current authoritative sources whenever it assembles a model request. If a rule, tool, skill, or subagent instruction changes, the runtime supplies the new exact version instead of asking the summarizer to reconcile old and new versions.

#### Block B — Mutable continuity context

Block B is the only Tier 1 block owned by the checkpoint/compression process. It contains:

- **Summarized Conversation Memory** — the previous structured continuity checkpoint;
- **Active Conversation Memory** — the recent exact conversation not yet folded into the checkpoint;
- **Current Workflow** — the current agent/tool execution sequence, outcomes, objective, and continuation state.

#### Block C — Protected current input

Block C contains:

- the current user prompt;
- small explicitly supplied working references required by the current request.

The current user prompt remains exact while its agent turn is active. A working reference remains exact while it is required for the current operation. Neither is rewritten merely to make the conversation summary shorter.

### 5.3 Current-state layout

Before a checkpoint rotation, the active context has the following logical shape:

```text
CURRENT TIER 1 STATE

+------------------------------------------------------------+
| BLOCK A — exact and pinned                                 |
|  System prompt                                             |
|  Tool definitions                                          |
|  Skills, rules, and subagent instructions                  |
+------------------------------------------------------------+
| BLOCK B — checkpoint-owned                                 |
|  Existing Summarized Conversation Memory                   |
|  Active Conversation Memory                                |
|  Current Workflow                                          |
+------------------------------------------------------------+
| BLOCK C — exact and protected                              |
|  Current user prompt                                       |
|  Small explicitly supplied working references              |
+------------------------------------------------------------+
```

### 5.4 Properties

- **Live:** it exists for the current agent execution or conversation continuation.
- **Small:** it is governed by a strict context budget.
- **Expensive:** its contents consume LLM input tokens.
- **Non-authoritative for project truth:** conversation text and summaries cannot directly become target facts, completed tests, or confirmed vulnerabilities.
- **Replaceable:** it can be rebuilt from runtime configuration, durable transcripts, and authoritative memory references.
- **Agent-specific:** different agents may have different Tier 1 contexts while sharing the same Tier 2 project state.
- **Block-governed:** each block has an explicit owner and compression policy.
- **Checkpoint-based:** completed mutable context is rotated at a defined safe boundary rather than rewritten continuously.

### 5.5 What does not belong in Tier 1 by default

- the complete target model;
- the full investigation history;
- every successful and failed technique;
- the complete evidence catalogue;
- the entire OWASP WSTG corpus;
- all Xekute skills and procedures;
- large HTTP responses, screenshots, scans, or logs;
- whole Knowledge Graph snapshots.

These may be referenced or read in bounded form when required, but they remain owned by Tier 2 or Tier 3.

### 5.6 Compression boundary

Only Block B is compressed:

```text
                    READ BY CHECKPOINT PROCESS
                                |
          +---------------------+--------------------+
          |                     |                    |
          v                     v                    v
 Existing summary      Active conversation    Current workflow
          |                     |                    |
          +---------------------+--------------------+
                                |
                                v
                    Structured checkpoint
```

The checkpoint process must not summarize or rewrite:

- Block A system instructions, tools, skills, rules, or subagent instructions;
- the current active user prompt in Block C;
- a working reference that is still required in exact form;
- authoritative Tier 2 or Tier 3 records.

### 5.7 Structured checkpoint pipeline

Compression must be a staged reducer rather than an unrestricted request to “summarize the conversation.” Deterministic processing occurs first. Bounded semantic extraction occurs only after tool activity and workflow results have been normalized.

The canonical sequence is:

```text
BLOCK B INPUTS
  Existing Summarized Conversation Memory
  Active Conversation Memory
  Current Workflow and exact tool-event references
                         |
                         v
+-----------------------------------------------------------+
| DETERMINISTIC STAGE                                       |
|                                                           |
|  1. Extract Tool Output                                   |
|             |                                             |
|             v                                             |
|  2. Normalize Tool Output                                 |
|             |                                             |
|             v                                             |
|  3. Extract Workflow Results                              |
+-----------------------------------------------------------+
                         |
                         v
  4. Extract Grounded Continuation Facts
                         |
                         v
  5. Extract Key Information and Decisions
                         |
                         v
  6. Extract Significant Events
                         |
                         v
          New Compressed Conversation Checkpoint
```

The diagrammatic sequence may use different display numbers, but the architectural contract is the ordered six-operation pipeline above. No semantic extraction stage may run directly over uncontrolled raw tool output.

#### Stage 1 — Extract Tool Output

This deterministic operation reads the exact tool-event ledger for the checkpoint range and selects tool results that may affect conversational continuity.

It preserves:

- tool call and result identity;
- execution order;
- success, failure, cancellation, timeout, and partial-result status;
- exit status or structured error code;
- security-relevant output variations;
- stable references to large Tier 3 artifacts;
- links to the workflow step that initiated the tool call.

It excludes irrelevant transport noise, repeated streaming fragments, and raw protected credential values.

#### Stage 2 — Normalize Tool Output

This deterministic operation converts extracted tool events into a bounded canonical representation. It may:

- merge streaming fragments belonging to the same result;
- deduplicate identical retries while retaining their attempt count;
- separate stdout, stderr, structured results, and failures;
- replace large bodies with Tier 3 artifact identifiers and safe excerpts;
- retain timestamps, ordering, tool identity, and workflow correlation;
- redact or handle protected values according to the security policy;
- preserve conflicting or materially different results instead of merging them incorrectly.

Normalization must not reinterpret an unsuccessful result as success, discard a failure because a later retry succeeded, or transform a tool observation into an authoritative Tier 2 fact.

#### Stage 3 — Extract Workflow Results

This deterministic operation combines normalized tool events with the Current Workflow record. It produces a structured workflow reduction containing:

- objective and workflow identifier;
- completed steps;
- incomplete and pending steps;
- tool-backed results for each step;
- failures, retries, blockers, and cancellations;
- artifact and authoritative memory references;
- terminal status or exact continuation point.

Workflow extraction records what the agent and tools actually did. It does not use free-form model synthesis to invent missing steps or claim that a procedure succeeded without a supporting execution event.

#### Stage 4 — Extract Grounded Continuation Facts

This bounded semantic operation derives only the facts needed to continue the conversation. A grounded continuation fact must be supported by at least one of:

- a normalized tool result;
- a deterministic workflow result;
- an authoritative Project, Investigation, or Evidence Memory reference;
- an explicit user statement, labeled as user-provided context rather than independently verified target truth.

Unsupported assistant statements and speculative reasoning are not grounded facts. Potentially useful but unverified statements may be retained only in the explicitly labeled `unverified_conversation_claims` field.

The phrase **grounded continuation facts** is deliberate. This stage does not independently extract “ground truth” about the target. Target truth is owned by Project Memory, procedure truth by Investigation Memory, and confirmed vulnerability truth by Evidence Memory. The checkpoint preserves references to those truths but cannot create them.

#### Stage 5 — Extract Key Information and Decisions

This bounded semantic operation combines the previous checkpoint, active conversation, workflow reduction, and grounded continuation facts. It retains only information required for coherent continuation:

- the current objective;
- explicit user decisions and corrections;
- constraints, preferences, definitions, and approvals;
- important conclusions;
- unresolved questions;
- pending work and the next required action;
- references needed to understand those decisions.

A later decision superseding an earlier decision must be represented explicitly. The compressor must not keep both as simultaneously active instructions.

#### Stage 6 — Extract Significant Events

This final bounded semantic operation produces the compact chronological event set needed to explain how the current state was reached. Significant events include:

- material user direction changes;
- important tool and workflow outcomes;
- meaningful failures or blocked work;
- corrections of previous assumptions;
- checkpoint-worthy state transitions;
- creation or update of authoritative memory and artifact references.

Routine narration, duplicate progress messages, and low-value intermediate chatter are omitted. Failures, reversals, and unresolved work must not be omitted merely to make the summary cleaner.

The new Compressed Conversation checkpoint is created from the cumulative structured outputs of Stages 3 through 6, combined with the still-valid portion of the previous checkpoint. It is schema-validated before the old mutable buffers can be rotated.

#### Stage execution policy

Stages 1 through 3 are deterministic and must be reproducible from the same tool-event and workflow inputs. Stages 4 through 6 may use schema-constrained model synthesis, but their output must remain bounded by the deterministic reductions, authoritative references, explicit user statements, and the exact active conversation.

```text
Deterministic stage
  Tool events -> normalized outputs -> workflow results

Semantic stage
  Workflow results + active conversation + previous checkpoint
      -> grounded continuation facts
      -> key information and decisions
      -> significant events
      -> compressed conversation
```

### 5.8 Summarized Conversation Memory contract

The new checkpoint should use a stable structure equivalent to:

```yaml
checkpoint:
  objective: "The active conversational objective"

  grounded_references:
    project_memory: []
    investigation_memory: []
    evidence_memory: []
    artifacts: []

  unverified_conversation_claims: []

  key_information:
    user_decisions: []
    constraints: []
    definitions: []
    conclusions: []

  key_events: []

  workflow:
    status: "completed | active | blocked | failed"
    completed_steps: []
    important_results: []
    failed_attempts: []
    blockers: []
    continuation_point: null

  unresolved:
    questions: []
    pending_work: []
    next_action: null
```

This checkpoint is conversation continuity, not a copy of Project, Investigation, or Evidence Memory. Stable references should be retained instead of reproducing large authoritative records.

### 5.9 Future-state rotation

At a safe completed-workflow boundary, the future Tier 1 state becomes:

```text
FUTURE TIER 1 STATE

+------------------------------------------------------------+
| BLOCK A — reconstructed exactly                            |
|  Current system prompt                                     |
|  Current tool definitions                                  |
|  Current skills, rules, and subagent instructions          |
+------------------------------------------------------------+
| BLOCK B — rotated                                          |
|  New Summarized Conversation Memory                        |
|  New empty Active Conversation Memory block                |
|  New empty Current Workflow block                          |
+------------------------------------------------------------+
| BLOCK C — protected                                        |
|  Current or next user prompt, exact                         |
|  Required working references, exact and bounded            |
+------------------------------------------------------------+
```

The rotation is logically atomic: the new checkpoint must be validated and durably available before the completed Active Conversation and Current Workflow buffers are cleared.

### 5.10 Safe checkpoint boundaries

The normal checkpoint boundary is after the current workflow or agent chat block has completed and its trustworthy outputs have been persisted. At that boundary:

- the previous summary, completed active conversation, and completed workflow are merged into the new summary;
- Active Conversation Memory becomes a new empty block;
- Current Workflow becomes a new empty block;
- Block A is reconstructed exactly;
- the current or next user prompt occupies Block C exactly.

If context pressure forces compression while a workflow is still active, the workflow must not be erased. Instead, the new checkpoint carries a continuation capsule:

```yaml
workflow:
  status: active
  objective: "Verify cross-account access"
  completed_steps:
    - "Captured the account A baseline"
    - "Replayed the request using account B"
  continuation_point: "Confirm ownership of the returned object"
  pending_steps:
    - "Repeat the result to exclude caching"
  artifact_refs:
    - "artifact_101"
    - "artifact_102"
```

Therefore:

```text
Completed workflow  -> summarize, validate, and clear the workflow block
Unfinished workflow -> checkpoint its continuation state and keep it active
```

### 5.11 Current user prompt lifecycle

The treatment of the user prompt depends on checkpoint timing:

```text
Compression during the current turn
  -> preserve the current user prompt exactly in Block C

Compression after the turn completes
  -> the completed prompt/response becomes Block B history
  -> the next user prompt becomes the new exact Block C prompt
```

An unfinished current user request must never be reduced to a lossy summary while the agent is still executing it.

### 5.12 Large tool-output handling

Large tool results should not be carried indefinitely inside Active Conversation Memory or Current Workflow. The runtime should:

1. persist the complete result as a Tier 3 artifact;
2. retain a bounded excerpt or structured outcome in the current workflow;
3. preserve the stable artifact identifier;
4. retrieve the full artifact only if later work requires it.

```text
Large raw scan result
        |
        +-> Tier 3: complete artifact body
        |
        +-> Tier 1 workflow: result summary + artifact reference
```

Failures and security-relevant result variations must not disappear merely because their full raw output is moved out of Tier 1.

### 5.13 Checkpoint write authority

The Tier 1 checkpoint process may write only:

- the new Summarized Conversation Memory checkpoint;
- rotation state for Active Conversation Memory;
- rotation or continuation state for Current Workflow.

It has no authority to:

- modify Block A;
- rewrite an active Block C user prompt;
- create or modify Project Memory facts;
- mark Investigation procedures complete;
- record canonical technique success or failure;
- create, verify, or change Evidence Memory findings;
- modify Tier 3 knowledge or raw artifacts.

Tier 2 updates occur through their own validated write paths. The checkpoint may reference committed Tier 2 records but cannot substitute for those writes.

### 5.14 Prompt caching versus compression

Provider-side prompt caching and Tier 1 checkpoint compression are separate optimizations:

- **Prompt caching** reduces repeated processing cost for an unchanged Block A prefix.
- **Checkpoint compression** reduces the size of accumulated Block B conversation and workflow state.

A prompt-cache hit does not summarize anything. A checkpoint rotation does not alter the exact Block A prefix in order to improve cache behavior.

---

## 6. Tier 2 — Hot / Storage-Based Memory

### 6.1 Purpose

Tier 2 is the frequently accessed operational memory of an active Xekute project. It is stored outside the LLM context and supplied to an agent only when relevant.

Tier 2 contains three authoritative domains. Each domain answers a different question and has a separate write contract.

| Domain | Authoritative question | Owns |
|---|---|---|
| Project Memory | How much do we know about the target? | Target model and target facts |
| Investigation Memory | What systematic procedure do we follow, what happened, and which techniques worked or failed? | Testing plan, execution, results, and coverage |
| Evidence Memory | Which vulnerabilities are confirmed, and what evidence supports the claims? | Verified findings and proof |

No record should be stored in a domain merely because it is convenient. Its owner is determined by the question it answers.

---

## 7. Project Memory — knowledge about the target

### 7.1 Authoritative question

> **How much do we know about the target?**

Project Memory is the structured model of the target being assessed. It contains target details only.

### 7.2 Project Memory contains

- project and target identifiers;
- authorized scope and target boundaries, with the Rules of Engagement remaining the authority for permission;
- domains, subdomains, IP addresses, hosts, and ports;
- exposed services and protocols;
- frontend, backend, server, database, WAF, CDN, and third-party technologies;
- application architecture and components;
- pages, routes, APIs, endpoints, methods, and parameters;
- forms, inputs, upload surfaces, and download surfaces;
- authentication mechanisms and flows;
- roles, identities, and privilege relationships;
- session, cookie, and token behavior as observed target characteristics;
- business functions such as payments, credits, coupons, and account recovery;
- target relationships such as host-to-service, endpoint-to-role, and component-to-technology;
- verified target facts, confidence, freshness, and provenance;
- known and unknown areas of the target model.

### 7.3 Project Memory does not contain

- test procedures or methodology;
- lists of payloads attempted;
- investigation assignments or TODOs;
- technique success or failure history;
- coverage status;
- hypotheses about possible vulnerabilities;
- confirmed vulnerability records;
- vulnerability severity or report prose;
- generic OWASP or pentesting knowledge;
- conversation summaries;
- agent reasoning;
- large raw tool output.

### 7.4 Example ownership decisions

| Information | Project Memory? | Reason |
|---|---:|---|
| `api.example.com` resolves to an observed address | Yes | It describes the target |
| `GET /api/users/{id}` exists | Yes | It describes an attack surface |
| The endpoint requires a bearer token | Yes | It describes target behavior |
| IDOR testing is applicable to the endpoint | No | Applicability belongs to Investigation Memory |
| Three cross-account identifiers were attempted | No | Execution belongs to Investigation Memory |
| Cross-account access is a confirmed IDOR | No | The vulnerability claim belongs to Evidence Memory |

### 7.5 Project Memory update rule

A Project Memory write must describe a target property and include provenance. Duplicate observations should strengthen or refresh an existing fact rather than create parallel target entities.

Observing no new target information must not create a Project Memory revision merely because a testing procedure ran.

---

## 8. Investigation Memory — systematic testing and results

### 8.1 Authoritative questions

> **What systematic procedure should we follow to test the target?**  
> **What is the result of each procedure?**  
> **Which techniques were successful, unsuccessful, blocked, or not applicable?**

Investigation Memory is the operational testing state of the project. It connects what is known about the target to relevant security-testing procedures and records what actually happened when those procedures were executed.

### 8.2 How Investigation Memory is constructed

The Retrieval Engine constructs relevant Investigation Memory from two primary sources:

1. **Project Memory**, which describes the target and its exposed surfaces.
2. **Tier 3 knowledge**, which contains applicable security-testing procedures and techniques.

```text
Project Memory                    Tier 3 Knowledge
“What is the target?”             “What techniques exist?”
        |                                  |
        +--------------+-------------------+
                       |
                       v
             Retrieval / Selection
                       |
                       v
              Investigation Memory
       “What should be tested on this target?”
```

This process does not build Tier 1. It creates and updates durable Tier 2 investigation records. An agent may later receive a bounded view of those records when it needs to perform work.

### 8.3 Investigation Memory contains

- investigation objectives;
- procedure and technique identifiers;
- the knowledge release or methodology version used;
- applicability reasons tied to target facts;
- ordered test steps;
- prerequisites and required access;
- current status and progress;
- assigned agent or subagent;
- attempts and execution timestamps;
- inputs, variants, and configurations used where operationally relevant;
- successful techniques;
- failed or rejected techniques;
- negative results with sufficient scope to avoid incorrect generalization;
- blocked and inconclusive procedures;
- observations and vulnerability hypotheses awaiting confirmation;
- coverage by asset, endpoint, role, parameter, vulnerability class, and procedure;
- next steps, retries, and alternative paths;
- links to large execution artifacts in Tier 3;
- links to Evidence Memory when an investigation produces a confirmed vulnerability.

### 8.4 Investigation Memory does not contain

- the canonical target inventory;
- duplicated copies of Project Memory entities;
- generic technique bodies copied permanently from Tier 3;
- vulnerabilities represented as confirmed before verification;
- the canonical proof package for confirmed vulnerability claims;
- conversation summaries or general agent chat state.

Investigation records reference target entities and knowledge procedures by stable identifiers instead of copying their full contents.

### 8.5 Procedure lifecycle

A procedure should use an explicit lifecycle such as:

```text
selected
   |
   v
pending -> in_progress -> completed
                 |          |
                 |          +-> successful
                 |          +-> unsuccessful
                 |          +-> inconclusive
                 |          +-> not_applicable
                 |
                 +-> blocked
```

“Completed” indicates that the defined procedure reached a terminal result. It does not mean a vulnerability was discovered.

### 8.6 Technique results

Technique outcomes must preserve context. A technique that failed for one endpoint, role, payload family, or application state must not be generalized into “this technique never works on the target.”

A useful result records:

- what was tested;
- against which target surface;
- under which identity or role;
- with which important preconditions;
- which technique or variant was used;
- what response or behavior occurred;
- whether the outcome was successful, unsuccessful, blocked, or inconclusive;
- references to supporting execution artifacts.

### 8.7 Successful observations and promotion

A successful technique remains in Investigation Memory while its vulnerability hypothesis is being verified. It moves into Evidence Memory only after the verification gate is satisfied.

```text
Technique attempted
       |
       v
Investigation result
       |
       +-> unsuccessful / blocked / inconclusive
       |       Remains in Investigation Memory
       |
       +-> promising security behavior
               |
               v
          verification procedure
               |
               +-> rejected/inconclusive: Investigation Memory
               |
               +-> confirmed: Evidence Memory
```

---

## 9. Evidence Memory — confirmed vulnerabilities and proof

### 9.1 Authoritative questions

> **What confirmed vulnerabilities did we find?**  
> **What evidence supports each vulnerability claim?**

Evidence Memory is the verification-controlled record of proven vulnerabilities. It is not a store for interesting observations, incomplete hypotheses, or general recon evidence.

### 9.2 Evidence Memory contains

- stable finding identity;
- vulnerability title and type;
- affected target references;
- affected endpoint, method, parameter, component, identity, or role;
- concise vulnerability claim;
- reproducible steps;
- verification method and status;
- baseline and exploit comparisons where applicable;
- proof references such as requests, responses, screenshots, logs, or files;
- security impact;
- severity and confidence;
- CWE, OWASP, or other classifications;
- verifier identity and timestamps;
- source Investigation Memory references;
- affected entities and known scope of impact.

### 9.3 Evidence Memory does not contain

- unverified suspicions;
- “possible” vulnerabilities without confirmation;
- every abnormal response;
- failed payload attempts;
- general investigation TODOs;
- routine reconnaissance results;
- complete target inventories;
- generic remediation or methodology copied from the knowledge base;
- raw artifacts embedded directly when a stable artifact reference is sufficient.

### 9.4 Verification gate

An Investigation result can be promoted into Evidence Memory only when Xekute can support the vulnerability claim with reproducible, attributable proof.

At minimum, the gate should require:

- a precise claim;
- an identified affected target surface;
- a repeatable or independently verified security-relevant behavior;
- proof references;
- a stated impact;
- a verifier and verification time;
- no unresolved contradiction that invalidates the claim.

The exact gate may vary by vulnerability class. For example, an authorization vulnerability may require cross-identity comparison, while an information disclosure may require proof that the exposed material is sensitive and reachable within scope.

### 9.5 Evidence immutability and correction

Evidence should be auditable. Corrections should supersede, retract, or amend earlier finding states rather than silently overwrite their history. Raw proof artifacts should retain stable identifiers and integrity metadata.

---

## 10. Tier 3 — Cold / Knowledge and Artifact Memory

### 10.1 Purpose

Tier 3 is Xekute's large, durable corpus. It is optimized for storage capacity, versioning, and selective retrieval rather than repeated context injection.

### 10.2 Tier 3 contains

#### Security knowledge

- OWASP WSTG procedures;
- general web, API, network, cloud, mobile, and infrastructure testing knowledge;
- specialized pentesting techniques;
- Xekute-authored techniques and methodologies;
- advanced attack and verification procedures;
- payload-generation guidance;
- remediation and classification references;
- versioned external standards and references.

#### Historical knowledge

- completed or archived investigation records retained for long-term history;
- reusable lessons and technique performance history;
- previous project archives where authorized;
- versioned methodology releases.

Historical records must not be allowed to leak target information across projects without an explicit authorized policy.

#### Large and raw artifacts

- HTTP requests and responses;
- scan output;
- command and tool output;
- browser captures;
- screenshots and recordings;
- files downloaded or generated during testing;
- packet captures;
- logs;
- report attachments;
- other large proof or execution material.

Tier 2 stores structured references to these artifacts. It does not duplicate their full bodies.

### 10.3 Retrieval behavior

Tier 3 content is retrieved selectively. The system should prefer:

- metadata before full bodies;
- precise sections before complete documents;
- procedure identifiers and versions;
- bounded artifact excerpts;
- stable source references;
- deterministic filters based on target characteristics and investigation objectives.

Whole-corpus injection is prohibited in ordinary agent operation.

### 10.4 Knowledge versioning

Knowledge releases should be immutable and versioned. Investigation Memory must record which procedure version was selected so that completed tests remain reproducible after the global knowledge base is updated.

---

## 11. Retrieval Engine

### 11.1 Primary responsibility

The Retrieval Engine's primary architectural responsibility is to connect target knowledge to appropriate testing knowledge and materialize the result as Investigation Memory.

```text
Project Memory query
        +
Tier 3 technique/procedure query
        |
        v
Applicability and selection
        |
        v
Investigation Memory create/update
```

### 11.2 What the Retrieval Engine does

- reads target characteristics from Project Memory;
- identifies relevant Tier 3 procedures and techniques;
- evaluates applicability using explicit reasons;
- constructs new Investigation records;
- refreshes affected Investigation records after material target changes;
- preserves pinned procedure versions;
- avoids duplicate investigations;
- returns bounded Tier 2 or Tier 3 records when an agent explicitly needs them;
- includes source identifiers, revisions, and provenance in retrieval results.

### 11.3 What the Retrieval Engine does not do

- construct the system prompt;
- define tool schemas;
- create the conversation;
- own compressed conversation;
- transform arbitrary model prose into target facts;
- mark procedures successful without trusted execution results;
- promote findings into Evidence Memory without verification;
- treat the Knowledge Graph as an independent source of truth;
- inject entire memories or knowledge corpora into every agent turn.

### 11.4 Investigation refresh rule

Not every Project Memory write requires rebuilding every investigation. Refresh should be bounded to material changes that can affect procedure applicability, such as:

- a new endpoint class;
- a newly discovered authentication mechanism;
- a new role or privilege boundary;
- a new upload, payment, GraphQL, WebSocket, or administrative surface;
- a material technology or architecture discovery;
- a scope change.

The engine should record why each procedure was selected and which Project Memory revision supported the decision.

---

## 12. Knowledge Graph and indexes

The Knowledge Graph is a derived relationship and retrieval structure. It is not allowed to blur the ownership boundaries of Project, Investigation, and Evidence Memory.

Example relationships include:

```text
target -> has_host -> host
host -> exposes -> service
application -> contains -> endpoint
endpoint -> accepts -> parameter
endpoint -> requires -> role

target_entity -> tested_by -> investigation
investigation -> uses -> knowledge_procedure
investigation -> produced -> technique_result
technique_result -> promoted_to -> finding
finding -> supported_by -> artifact
finding -> affects -> target_entity
```

The graph may span Tier 2 records and reference Tier 3 knowledge or artifacts, but canonical truth remains in the owning record:

- target truth remains in Project Memory;
- procedure execution truth remains in Investigation Memory;
- vulnerability truth remains in Evidence Memory;
- knowledge and raw artifact bodies remain in Tier 3.

The graph and search indexes must be rebuildable from canonical records. A derived graph write cannot independently create a target fact, completed investigation, or confirmed finding.

---

## 13. End-to-end information flow

### 13.1 Target discovery

```text
Agent/tool observes target behavior
              |
              v
Validate provenance and normalize entity
              |
              v
Project Memory
```

Only target details are written to Project Memory.

### 13.2 Investigation construction

```text
Material Project Memory state
              +
Relevant Tier 3 procedures
              |
              v
Retrieval and applicability evaluation
              |
              v
Investigation Memory
```

Investigation Memory records what should be tested and why.

### 13.3 Procedure execution

```text
Agent receives an applicable investigation
              |
              v
Executes procedure and techniques
              |
              v
Investigation Memory records attempts, results, and coverage
```

A procedure can update Investigation Memory even when it produces no new Project Memory fact and no vulnerability.

### 13.4 Evidence promotion

```text
Promising Investigation result
              |
              v
Verification procedure
              |
              +-> failed or inconclusive -> Investigation Memory
              |
              +-> confirmed ------------> Evidence Memory
```

### 13.5 Continued agent work

```text
Live Tier 1 agent context
          |
          | requests current operational state
          v
Bounded Tier 2 read
          |
          | performs work
          v
Validated Tier 2 write
```

The read may appear temporarily in the model context, but the authoritative memory remains in Tier 2.

---

## 14. Information ownership matrix

| Information | Project | Investigation | Evidence | Tier 3 |
|---|:---:|:---:|:---:|:---:|
| Host, service, technology, endpoint | Owner | Reference | Reference | Raw source artifact |
| Authentication and role model | Owner | Reference | Reference if affected | Raw source artifact |
| Applicable test procedure | No | Owner | No | Procedure definition |
| Test steps and assignment | No | Owner | No | Reusable methodology only |
| Payload or technique attempted | No | Owner | Only if needed for proof | Full raw execution artifact |
| Failed or blocked technique | No | Owner | No | Raw execution artifact |
| Vulnerability hypothesis | No | Owner | No | Supporting artifact |
| Confirmed vulnerability claim | No | Source link | Owner | Raw proof artifact |
| Severity and impact of confirmed finding | No | No | Owner | Reference knowledge |
| OWASP WSTG procedure body | No | Versioned reference | No | Owner |
| Screenshot, scan, or full HTTP exchange | No | Reference | Proof reference | Owner |
| Conversation summary | No | No | No | Not semantic project memory; active in Tier 1 |

---

## 15. Canonical examples

### Example A — endpoint discovery

1. Xekute observes `GET /api/users/{id}`.
2. The endpoint and parameter are added to Project Memory.
3. The Retrieval Engine identifies authorization and input-handling procedures from Tier 3.
4. Corresponding Investigation Memory records are created with applicability reasons.
5. No Evidence Memory record exists yet.

### Example B — failed IDOR technique

1. The authorization investigation tests cross-account identifiers.
2. The target rejects each tested access attempt.
3. The attempts, tested identities, scope, and unsuccessful result are recorded in Investigation Memory.
4. Project Memory is unchanged unless the execution revealed a new target characteristic.
5. Evidence Memory is unchanged because no vulnerability was confirmed.

### Example C — confirmed IDOR

1. A cross-account request returns another user's protected object.
2. The successful technique and initial observation are recorded in Investigation Memory.
3. A verification procedure repeats the behavior with controlled identities and captures baseline and exploit exchanges.
4. The verified IDOR is promoted to Evidence Memory with proof references.
5. Investigation Memory links to the confirmed finding and records the successful technique.
6. Project Memory continues to describe the endpoint and role relationships; it does not own the vulnerability claim.

### Example D — new technology discovery

1. Xekute verifies that the target exposes a GraphQL endpoint.
2. The endpoint and GraphQL characteristic are added to Project Memory.
3. The material target change triggers a bounded Tier 3 procedure lookup.
4. Relevant GraphQL investigations are created in Investigation Memory.
5. The GraphQL knowledge body remains in Tier 3.

---

## 16. Multi-agent behavior

All agents may share the same Tier 2 project state while maintaining independent Tier 1 contexts.

### 16.1 Dispatch

A subagent receives:

- its live Tier 1 instructions;
- the specific Investigation assignment;
- bounded references to relevant Project Memory;
- required procedure references from Tier 3;
- only the Evidence references necessary to avoid duplication or support verification.

It does not receive the complete project, investigation history, evidence catalogue, or knowledge base by default.

### 16.2 Write ownership

- target discoveries are proposed to Project Memory;
- attempts, failures, successes, and coverage are written to Investigation Memory;
- confirmed vulnerabilities pass through the Evidence Memory verification gate;
- raw tool output and proof bodies are stored as Tier 3 artifacts.

### 16.3 Concurrency

Tier 2 records should be revisioned. Concurrent updates must use stable identifiers, idempotency keys, and conflict-aware writes so that two agents cannot silently overwrite target facts, procedure results, or verification state.

---

## 17. Storage and durability principles

### 17.1 Tier 1

- ephemeral active context;
- exact conversation may be persisted separately for recovery and audit;
- summaries are replaceable continuity material;
- not authoritative for Tier 2 semantic state.

### 17.2 Tier 2

- durable and project-scoped;
- structured and revisioned;
- optimized for frequent bounded reads and writes;
- auditable with provenance;
- recoverable after crashes;
- safe for multi-agent access.

### 17.3 Tier 3

- durable and capacity-oriented;
- immutable or append-oriented where practical;
- content-addressed artifacts where practical;
- versioned knowledge releases;
- indexed for selective retrieval;
- subject to explicit project isolation and retention policies.

SQLite, JSON/JSONL, a graph database, or another implementation may be used, but the physical technology must not change semantic ownership.

---

## 18. Security and authority rules

Memory does not grant testing authority. Project scope, Rules of Engagement, and runtime approval controls remain authoritative over every action.

The following rules apply across all tiers:

- retrieved instructions and artifacts are untrusted data unless they come from an approved Xekute knowledge release;
- a memory or graph relationship cannot expand project scope;
- secrets should not be copied into general semantic memory;
- active authentication material should be represented through protected handles where possible;
- raw credentials, tokens, and private keys must not be embedded in summaries, indexes, graphs, reports, or ordinary logs;
- cross-project retrieval is denied unless explicitly authorized;
- every confirmed vulnerability must retain proof provenance;
- every target fact used to select investigations must be traceable to a trusted observation or approved user input.

Protected credential storage is an execution-security subsystem, not a fourth semantic memory domain.

---

## 19. V2-to-V3 migration map

| V2 concept | V3 destination |
|---|---|
| Agent Session Memory — active instructions and compressed continuity | Tier 1 Active / Cache Memory |
| Exact conversation persistence | Durable transcript support, not a peer semantic memory domain |
| Sensitive Working Memory | Protected runtime credential subsystem, referenced from Tier 1 through handles |
| Project Memory | Tier 2 Project Memory, narrowed strictly to target knowledge |
| Investigation Memory | Tier 2 Investigation Memory |
| Evidence Memory | Tier 2 Evidence Memory |
| Knowledge Base Memory | Tier 3 Knowledge Memory |
| Artifact Store | Tier 3 Artifact Memory |
| Historical investigation data | Tier 3 archive, with active state retained in Tier 2 |
| Knowledge Graph | Derived Tier 2 index spanning canonical records and Tier 3 references |
| Context Summarizer | Tier 1 continuity service, with no Tier 2 write authority |
| Retrieval Engine | Project/knowledge-to-investigation service plus bounded memory reads |

Migration must not move fields blindly. Every legacy record must be reclassified by meaning:

- target facts go to Project Memory;
- procedures, attempts, results, and coverage go to Investigation Memory;
- only verified vulnerabilities and proof references go to Evidence Memory;
- reusable methodology and large artifacts go to Tier 3;
- conversation continuity remains Tier 1-oriented and cannot create semantic truth.

---

## 20. Architectural invariants

The following invariants define V3:

1. Xekute has three physical memory tiers: Active, Hot, and Cold.
2. Tier 1 is primarily live LLM execution context.
3. Tier 1 is not authoritative for target facts, testing state, or vulnerability claims.
4. Tier 2 contains exactly three authoritative operational domains: Project, Investigation, and Evidence Memory.
5. Project Memory contains details about the target only.
6. Project Memory answers “How much do we know about the target?”
7. Investigation Memory owns systematic procedures, applicability, execution, success, failure, negative results, and coverage.
8. Investigation Memory answers “What do we test, how do we test it, what happened, and which techniques worked or failed?”
9. Evidence Memory contains only confirmed vulnerabilities and the proof supporting each claim.
10. Evidence Memory answers “What vulnerabilities can we prove?”
11. The Retrieval Engine constructs Investigation Memory from Project Memory and relevant Tier 3 knowledge.
12. The Retrieval Engine does not construct Tier 1 live memory.
13. A bounded Tier 2 record temporarily serialized into an LLM request remains logically owned by Tier 2.
14. A procedure result may update Investigation Memory without changing Project Memory or Evidence Memory.
15. Failed, blocked, inconclusive, and successful-but-unverified techniques remain in Investigation Memory.
16. Only verification-gated vulnerability claims enter Evidence Memory.
17. Project Memory must not contain vulnerability claims merely because they affect the target.
18. Tier 3 owns reusable security knowledge, historical archives, and large/raw artifacts.
19. Tier 2 records reference Tier 3 artifacts rather than embedding large bodies.
20. Knowledge releases are versioned, and investigations pin the procedure version used.
21. The Knowledge Graph and search indexes are derived and rebuildable.
22. Derived indexes cannot create or override canonical truth.
23. Conversation compression cannot create target facts, complete procedures, or confirm findings.
24. Each information class has one authoritative owner.
25. No memory, retrieval result, graph edge, or stored instruction can broaden authorization.

---

## 21. Acceptance criteria

V3 is correctly implemented when all of the following are true:

- an operator can identify the authoritative owner of any stored item without ambiguity;
- Project Memory can be inspected as a clean model of the target with no test plan or vulnerability report mixed into it;
- Investigation Memory shows what should be tested, what was attempted, what succeeded or failed, and what remains;
- Evidence Memory contains only confirmed findings with reproducible proof;
- changing a material target fact can select or refresh only the affected investigations;
- completing an unsuccessful procedure updates Investigation Memory without manufacturing a Project fact or Evidence finding;
- a successful technique cannot become a finding until it passes verification;
- agents can resume work without loading the entire project or knowledge base into context;
- subagents receive task-specific operational slices rather than full memory dumps;
- Tier 3 procedures and artifacts are retrieved in bounded form and retain stable source references;
- every graph/index view can be rebuilt from canonical Tier 2 and Tier 3 records;
- context compression does not mutate authoritative project state;
- concurrent agent updates do not silently overwrite each other;
- memory operations never expand testing scope or expose protected credentials.

---

## 22. Final operating model

The V3 architecture can be summarized in four sentences:

1. **Tier 1 executes.** It contains the live rules, tools, skills, conversation, and current prompt needed by the LLM.
2. **Project Memory describes the target.** It answers how much Xekute knows about the system being tested.
3. **Investigation Memory drives and records testing, while Evidence Memory proves findings.** Procedures, attempts, successes, and failures belong to Investigation Memory; only confirmed vulnerabilities and proof belong to Evidence Memory.
4. **Tier 3 supplies depth.** It stores the large technical knowledge, history, and artifacts that are retrieved only when required.

The central V3 flow is:

```text
Project Memory + Tier 3 Knowledge
                |
                v
        Investigation Memory
                |
        systematic execution
                |
                v
       success / failure records
                |
        confirmation gate
                |
                v
          Evidence Memory
```

This design reduces token usage and subsystem complexity while preserving the three distinctions Xekute must never lose:

```text
What is the target?
What did we systematically test?
What vulnerability can we prove?
```
