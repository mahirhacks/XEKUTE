# Proposed: Bot Crew panel

> **Status:** Future vision, not scheduled. Parked until the 0.6.x hardening
> line reaches 1.0.0. This document records the architecture so the decisions
> are not lost; it is not a commitment to build in any particular release.

## Summary

Add a dedicated, Messenger-style **Bot Crew** panel to the XEKUTE side panel
that lets an operator run a managed team of XEKUTE bots against the authorized
target scope. The panel sits **alongside** the existing conventional chat; it
does not replace it. Chat remains the "I am driving, help me with this one
thing" surface. The Crew panel is the "I am the lead, go work the scope and
report back" surface.

The operator talks to a single **manager bot**. The manager coordinates a set
of **worker bots**, each with its own isolated context window and a role the
operator defines and assigns. The operator can peek into any worker thread but
is not required to manage workers individually.

## Why

Security work already fans out: recon, auth/session, API, input handling,
configuration. Doing that serially in one chat context is slow and pollutes a
single context window. XEKUTE already has the primitives to fan out — the
orchestrator can spawn a batch of sub-agents and wait on them, subagent
profiles exist via `/create-subagent`, and the authority pipeline gates every
tool call against scope and Rules of Engagement. The Crew panel is a new
**surface and orchestration layer** over those existing primitives, framed so
the operator feels like they own a team rather than babysit a swarm.

## Principles

1. **Two modes, not a replacement.** Conventional chat and the Crew panel
   coexist. Neither forces its overhead on the other.
2. **Managed crew, not an unleashed swarm.** The operator is the lead. The
   manager bot is accountable to the operator. Nothing acts outside the
   operator's authority.
3. **Reuse the safety-critical core.** The per-bot runtime, the authority /
   scope / RoE gates, and the tool catalog are **shared** with the chat path.
   They are never forked. Only the orchestration layer on top is new.
4. **Model-agnostic.** Everything expresses model choice as a role that maps to
   whatever is configured (Ollama or OpenRouter), never a hard-coded model ID.

## Topology

```text
operator
   |
   v
manager bot            (main pinned thread; coordinates, batches, reports up)
   |         shared coordination board (scope, finding list, task claims)
   +--> worker bot: Recon        (isolated context)
   +--> worker bot: Auth/Session (isolated context)
   +--> worker bot: API          (isolated context)
   +--> worker bot: ...          (isolated context)
```

- **You -> manager -> workers.** The operator primarily converses with the
  manager. Workers report up to the manager, not down to the operator.
- **Per-bot context isolation.** Each worker has its own context window so
  bots stay focused and do not pollute each other, and the overall token
  footprint stays bounded. This mirrors how the orchestrator already spawns
  bounded sub-agents.
- **Shared coordination layer.** Bots share *coordination state* — scope, the
  finding list, a "what has been touched" map, and a task-claim board — while
  keeping their *reasoning* context private. This is the hardest design line to
  hold: share the board, not the brain.

## Roles and bots

- A **role** is a reusable profile: a scope slice + the relevant tool
  authorities + a system prompt. Built on the existing subagent-profile system.
- A **bot** is a running instance of a role with its own context.
- The operator can create, edit, clone, assign, and disable roles. Cloning a
  role lets several bots of the same type run on different targets (three API
  bots on three subdomains, for example).

Suggested starting roles: Recon, Auth/Session, API, Input/Injection,
Config/Headers, and a non-testing Evidence Clerk that collects what the others
find and drafts findings linked to traffic.

## Coordination

Coordination is **dynamic**: the manager assigns, rebalances, and dedupes at
runtime rather than following a fixed script. Workers claim tasks off the
shared board so two bots do not redo the same recon or raise duplicate
findings. The manager is the dynamic coordinator; workers do not negotiate
peer-to-peer.

## Safety and control

- Every bot inherits the project **scope + RoE + safety mode**. A bot cannot
  act outside scope or outside Test mode. Same authority gates already enforced
  in the chat path, applied per bot.
- **Safe mode:** the whole crew only reads and analyzes.
- **Test mode:** active checks, still gated by approval.
- **Batched approval inbox.** When workers hit anything active, the manager
  batches the requests into one inbox (approve all / per item) instead of
  spamming the operator with per-bot prompts. This is required, not optional,
  the moment the crew leaves Safe mode.
- **Concurrency cap** and a global **Stop the crew** control, since several
  agents run at once.

## Cost and model tiering (phase 2)

The crew is where a tiered **decision-model** router pays off. Most agent loops
waste expensive-model tokens on cheap judgments (route this / ignore that / is
this a dup). Three tiers:

1. **Decision / router tier (cheap, fast).** The manager's front end. Does the
   routing and triage: does this matter, which worker owns it, is this a
   duplicate, should this escalate. Most idle/routine crew cost collapses to
   near zero here.
2. **Worker tier (mid).** Per-domain work once the router has narrowed the job.
3. **Manager / hard-reasoning tier (expensive).** Only for synthesizing the
   debrief, resolving genuine worker conflicts, or scope-boundary judgment.
   Rare, so the cost is rare.

Design constraints:

- **Fail toward escalation.** The cheap router may be cheap on route/ignore
  decisions but must escalate when unsure on anything scope- or
  finding-related. A silently dropped finding is worse than wasted tokens in a
  security tool.
- **Tiers are roles, not model IDs.** "decision / worker / reasoning" map to
  whatever models are configured. A local user maps all three to Ollama models;
  an OpenRouter user maps them to a cheap/mid/frontier ladder.
- **Tiering lives in the shared runtime**, not the orchestrator, so chat agents
  benefit too. The orchestrator says *what* to do; the runtime decides *how
  cheaply* to do it.

## Build boundary: reuse vs. new

**Reuse (do not fork):**

- The per-bot agent runtime (one bot's loop == one chat agent's loop, pointed
  at a different context and profile).
- The authority / scope / RoE enforcement pipeline.
- The tool catalog.
- Model-tiering, once built, so both surfaces share it.

**New:**

- The orchestration layer: manager logic, shared task board, dynamic
  coordination, roster lifecycle, cost / concurrency capping.
- The Crew panel UI: Messenger-style roster, manager thread pinned, expandable
  worker threads, batched approval inbox, live standup board, debrief.

The risk to avoid is a second agent engine. Duplicating the loop means
duplicating every authority and scope fix — exactly the drift that causes an
out-of-scope action in a security tool. Separate the orchestrator; share the
runtime and the safety gates.

## UI shape

- **Roster.** Each bot is a card: name + role, status (idle / working / needs
  approval / done), current one-line activity, findings raised. Seeing the crew
  work for you is what delivers the "I own a team" feeling.
- **Manager thread** pinned as the main conversation; worker threads expandable
  but rarely needed.
- **Dispatch** ("send the crew at app.target.com"), **live standup** board,
  **batched approvals**, and a consolidated **debrief** that flows into
  `/report`.

## Suggested phasing

1. **Phase 1 — crew over existing machinery.** Roster panel, manager + two or
   three worker roles (Recon, Auth, Evidence Clerk) in Safe mode, batched
   approval inbox for Test mode. Single configured model throughout. Prove the
   orchestration.
2. **Phase 2 — decision-model tiering** in the shared runtime, once the
   orchestration is stable. Do not debug routing and orchestration at the same
   time.

## Open questions

- Exact contents of the shared coordination board vs. per-bot private context.
- How worker threads surface in the UI without re-introducing the per-bot
  management burden the manager model removes.
- Token / cost metering granularity (per bot, per tier, per crew run).
