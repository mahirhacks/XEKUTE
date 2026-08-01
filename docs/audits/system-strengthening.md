# XEKUTE system strengthening audit

## Executive assessment

XEKUTE already has the right product boundary for an alpha: one local-first
desktop workspace that connects authorization, scope, traffic, tools, evidence,
the application Map, findings, reporting, and a human-controlled AI agent.

The next stage should be consolidation, not expansion. The largest gains now
come from reducing duplicated control paths, making the existing workflow more
obvious, and breaking high-change files into maintainable controllers without
changing user-visible capability.

## How the current system works

```text
Operator
  -> Project folder (blank on creation; no scaffold)
  -> Electron renderer (Project explorer, Settings, chat, traffic, Map, Toolbox)
  -> context-isolated preload bridge
  -> Electron main process
       -> app-managed project profile (engagement, scope, ROE, context)
       -> assessment workspace and schema-managed records
       -> HTTP workbench, proxy, Traffic/Raw, and evidence
       -> Map construction and bounded Map queries
       -> command/process services and typed security adapters
       -> Ollama agent controller
            -> profile-specific tool routing
            -> scope, authority, policy, and approval checks
            -> tool execution
            -> evidence/action/run logs
  -> local assessment files remain reviewable outside XEKUTE
```

The security boundary is strongest where XEKUTE uses typed operations:
project policy, assessment ingestion, Map queries, finding verification, and security-tool
adapters. Generic file and command operations are prevented from mutating Core
assessment resources directly.

## What is already strong

- Local-first data and local Ollama execution.
- Explicit Safe and Testing families with Planner, Agent, and Ask roles.
- Scope, authorization, Rules of Engagement, rate, approval, and stop gates.
- Typed security adapters instead of model-constructed scanner shell commands.
- Evidence provenance, action logs, hypotheses, candidate finding gates, and an
  independent verifier.
- A useful assessment model spanning traffic, services, Map relationships,
  findings, reports, and coverage checklists.
- Electron hardening, context isolation, renderer sandboxing, restricted IPC,
  confined workspace paths, and bounded outputs.
- A coherent dark desktop visual language with familiar editor, activity bar,
  panel, status, palette, and keyboard patterns.

## Priority improvements

### P0 — protect reliability

1. **Keep the automated tests in version control.** Completed in the cleanup:
   the stale `test` ignore rule was removed, exposing the full Node suite for
   review and commit. Keep production verification and behavior tests visible
   in future changes.

2. **Split the renderer by existing workspace.** `renderer.js` is roughly
   9,100 lines and currently owns navigation, assessment forms, traffic,
   Inspector, Map, WebClone, Toolbox, settings, chat, model selection, command
   palette, and tool cards. Extract controllers for those existing areas while
   keeping one small application shell and shared state module.

3. **Split privileged main-process registration by service.** `main.js` is
   roughly 2,180 lines with about 90 IPC handlers. Move existing handlers into
   workspace, assessment, security, agent, model, terminal, and window
   registration modules. Keep the main file responsible for lifecycle and
   composition only.

4. **Finish the typed preload migration.** `preload.js` already exposes the
   grouped `window.xekute` result-envelope API, but the renderer still makes
   more than 100 calls through the legacy `window.api` facade and none through
   `window.xekute`. Migrate one existing workspace at a time, then remove the
   duplicate surface after compatibility has been proven.

### P1 — make the existing workflow feel obvious

5. **Keep one project journey visually dominant.** The project revamp now
   establishes the practical sequence as:

   ```text
   Create blank project / open existing project
     -> complete Project Settings
     -> confirm authorization, scope, ROE, and exclusions
     -> verify tool health
     -> capture or run bounded reconnaissance
     -> review Traffic and Map
     -> attach evidence
     -> verify finding
     -> generate report
   ```

   Reuse current status, empty-state, and action components to point to the next
   valid step. Do not add another dashboard.

6. **Clarify “Security Tools” versus “Toolbox.”** The current distinction is
   valid but the labels are close: one is the HTTP workbench and the other is a
   CLI tool catalog/configurator. Rename the navigation labels to
   **HTTP Workbench** and **Tool Catalog**, while retaining the same views and
   capabilities.

7. **Unify settings hierarchy.** Project Settings now owns engagement,
   authorization, contacts, scope, ROE, application context, and data handling
   in an app-managed profile that does not touch the project folder.
   Continue separating that project profile from application-wide commands,
   prompts, certificates, and authority defaults, and converge their save,
   dirty, validation, and error presentation.

8. **Standardize empty, loading, denied, failed, and completed states.** The
   current workspaces implement these independently. A small shared state
   pattern would make proxy capture, Map building, WebClone, tool health,
   assessment repair, and agent execution more predictable.

9. **Keep context visible during risky actions.** Reuse existing scope, mode,
   authority, target, and approval data in a consistent action summary. The
   operator should not need to move between settings and execution views to
   confirm what is about to run.

### P1 — improve agent practicality

10. **Keep the model-facing tool list minimal.** Use the canonical
    `create_file`, `patch_file`, and `delete_file` flow instead of exposing
    several overlapping edit verbs. Build the search index lazily through
    `search_code` instead of asking the model to call `index_workspace`.

11. **Route tools by profile and domain.** Ask and Planner should receive only
    read-only workspace/research/Map tools. Safe Agent should receive workspace
    actions plus evidence operations. Only Testing Agent should receive active
    adapters. This is now centralized in `src/harness/core/tool-map.js`.

12. **Keep raw scanner output out of model context.** Continue the pattern in
    the architecture flowchart: persist bounded raw artifacts, normalize them
    into typed records, and retrieve only the evidence required for the current
    hypothesis.

13. **Show the reason for every unavailable tool.** Existing policy codes
    already distinguish mode, scope, authority, approval, and configuration
    failures. Present those reasons consistently instead of allowing a disabled
    action to look broken.

### P2 — performance and visual refinement

14. **Virtualize long traffic, evidence, run-history, and file lists.** Preserve
    selection and scroll position while bounding DOM work. This strengthens
    existing high-volume workflows without adding capability.

15. **Reduce visual competition in dense workspaces.** Keep one primary action
    color, one selected-row treatment, and one warning treatment. Secondary
    controls should be quieter than target, scope, Run, Forward/Drop, Verify,
    and Save actions.

16. **Normalize panel resizing and restoration.** Explorer, chat, terminal,
    HTTP details, Map details, and WebClone drawers should share minimum sizes,
    collapse behavior, and persisted layout rules.

17. **Complete keyboard and focus behavior.** Verify predictable focus return
    after dialogs, Escape handling, visible focus rings, accessible names, and
    keyboard selection for palettes, history rows, Map nodes, and tool cards.

18. **Modularize the stylesheet around existing surfaces.** `style.css` is
    roughly 4,470 lines. Split tokens/base layout from assessment, security,
    Map, chat, Toolbox, WebClone, and dialog styles without changing the visual
    system.

## Tool organization completed in this pass

```text
src/harness/
|-- os/
|   |-- tool-registry.js
|   `-- workspace-search.js
|-- cyber/
|   |-- tool-registry.js
|   |-- security-tool-adapters.js
|   |-- web-research.js
|   |-- webclone.js
|   `-- toolbox.js
|-- tool-map.js
|-- tool-handlers.js
`-- README.md
```

- Every registered agent tool now has an `os` or `cyber` category.
- The renderer and main agent controller use the same profile router.
- Safe Agent no longer receives `run_security_tool`, which its policy would
  always reject.
- Testing Agent retains typed active adapters.
- Obsolete root-level tool facades were removed; runtime and tests now import
  the canonical `tools/os/` and `tools/cyber/` modules directly.
- Redundant edit and explicit-index tools remain compatible but are omitted
  from the default model-facing set.

## Instruction architecture completed in this pass

```text
src/
`-- prompts/
    |-- instructs/   # System, initial-context, memory, retry, and verifier prompts
    |-- skills/      # Bug-bounty vocabulary, triage, assessment loop, decision helpers
    |-- rules/       # Operating modes, runtime policy defaults, evidence states
    `-- guardrail/   # Protected paths, command blocking, and secret redaction
```

- `agent/prompt-compiler.js` now compiles the canonical prompt source instead
  of owning a second copy of the prompt.
- The unreachable legacy prompt branches were removed from `agent-prompt.js`
  and the deprecated prompt archive was removed from the browser Toolbox.
- The runtime still enforces authority, scope, Rules of Engagement, mode,
  approvals, and evidence gates independently of editable prompt wording.
- Structural tests and production verification now assert the folder boundary
  and browser script load order so prompt and policy concerns cannot silently
  collapse back together.

## Project workflow revamp completed in this pass

- The visible workflow now has only **Create New Project** and
  **Open Existing Project**.
- Creating a project makes exactly one empty folder; it does not generate an
  assessment manifest, phase directories, `settings.config`, or
  `pen_context.md`.
- The old phase-heavy Target tree is no longer part of the visible project
  flow. The Project panel is a conventional folder explorer.
- Professional Engagement, Authorization, Scope and ROE, Context, Contacts,
  Review, and Data Handling fields live in **Settings > Project**.
- Project profiles are saved under protected XEKUTE application data and keyed
  to the absolute project path, keeping the selected folder untouched.
- The runtime policy and HTTP workbench consume the same project profile, so
  authorization, scope, review, technique, timing, rate, and stop fields are
  operational controls rather than documentation-only metadata.
- Existing structured assessment folders can still be opened as ordinary
  projects; their files remain visible and compatible.

## Dynamic agent context completed in this pass

The agent now performs a small, deterministic routing decision before it loads
workspace context, policy material, specialist instructions, or tool schemas:

```text
User message
  -> ordinary conversation: compact role only; no tools or assessment context
  -> workspace task: compact role + relevant OS tools only
  -> cyber task: operational role + relevant cyber tools/instruction overlays
  -> mixed task: only the two required tool groups
```

- A greeting such as `hi` receives zero tools, does not inspect the workspace,
  does not load prior assessment memory, and does not create project logs.
- Compact conversation responses no longer produce claim-state badges,
  preflight phases, evidence panels, or policy summaries.
- Tool definitions retain validation schemas but expose concise one-line
  descriptions to the model. File reads, file mutations, commands, research,
  Map access, evidence operations, and active testing are selected separately.
- Specialized cyber guidance is loaded only when the request needs it and is
  limited to the most relevant scope, recon, web/API, authorization,
  injection, evidence, or reporting overlays.
- The latest user message appears once in model context instead of being
  duplicated inside the workspace-context envelope.
- Regression tests now prove the greeting path is concise and inert, and prove
  that OS and cyber requests receive mutually separated tool sets.

### Context meter accuracy

- The meter no longer counts the full profile tool catalog or the obsolete
  renderer prompt path.
- Before a request it previews the same progressive route used by the agent,
  including only the tool definitions relevant to that request.
- After a request it replaces the preview with Ollama's actual
  `prompt_eval_count` and `eval_count` from the final stream record.
- Exact totals are retained per chat session. Category rows remain clearly
  marked proportional estimates because Ollama reports a total rather than a
  token count for each prompt section.
- Auto context capacity is refreshed from Ollama's loaded-model runtime state;
  a manual context selection remains the authoritative configured capacity.
- The UI explains that Ollama receives conversation context per request and
  does not maintain a separate hidden chat memory.

## Terminal consolidation completed in this pass

- Removed the Terminal and AI Chat shortcuts from the activity rail; both
  panels remain available through the existing View menu and shortcuts.
- The terminal panel now exposes only operational controls: new session,
  installed shell/profile selection, real split groups, clear, kill,
  maximize/restore, and close.
- Shell choices are enumerated and resolved in the main process. The renderer
  cannot supply an arbitrary executable path as a terminal profile.
- Split terminals use independent PTYs and xterm instances, resize each visible
  pane, retain session switching, and cleanly promote a remaining split when a
  sibling closes.

## Recommended sequence

1. Migrate the renderer to the typed preload API workspace by workspace.
2. Extract renderer controllers and main-process service registrars.
3. Remove the dormant legacy Target-tree renderer paths after a compatibility
   release proves the Project flow.
4. Finish list performance, layout consistency, accessibility, and stylesheet
   modularization.

## Repository cleanup completed in this pass

- Removed generated package output, Graphify snapshots, temporary runtime logs,
  Python bytecode, a stale nested sync clone, and an old local assessment
  fixture (about 581 MB of ignored, reproducible data in total).
- Removed obsolete tool import facades and unused Pointer-era browser globals.
- Consolidated request-intent rules shared by the Node and browser agent paths.
- Added `src/README.md` as the code-navigation guide and consolidated prompt
  documentation into `src/prompts/README.md`.
- Removed the stale test ignore rule so the verification suite is visible to
  version control.

## Explicitly defer

Do not add more scanners, specialized autonomous agents, cloud sync,
collaboration, plugin marketplaces, new databases, or additional dashboards
until the current workflow, reliability, and maintainability work above is
complete.
