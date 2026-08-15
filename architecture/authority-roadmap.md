# Authority architecture

Every agent tool invocation uses one immutable execution context and the
canonical authority pipeline. The bootstrap resolver selects exactly one of
Ask for Approval, Approve for Me, or Full Authorization, then runs:

```text
role access -> request validation -> scope -> allow rules -> deny rules
-> identity -> risk classification -> authority policy -> approval (if enabled)
-> environment -> resources -> concurrency -> timeout policy
-> monitored raw execution
-> output control -> verification -> recovery -> rollback -> audit
```

The authority selector changes approval interaction, not capability. Mode
surfaces, hard workspace/network scope, identity isolation, and immutable
approved-plan constraints are independent upper bounds. An explicit deny or
hard scope violation is terminal under every profile.

Full Authorization omits `approval_gate` and emits
`approval_stage_skipped`. It does not disable risk classification, resource
controls, monitoring, verification, recovery, rollback, or audit.

Timeout policy is granular. Start, idle, and soft thresholds are observations,
not automatic proof of a stall, and each can be explicitly disabled. There is
no default hard, task, workflow, or agent-round deadline for long-horizon work;
an explicit per-operation hard deadline remains enforceable by the monitor.

The remaining roadmap is operational hardening rather than a new policy
architecture: Windows Job Object resource enforcement, signed remote-worker
leases, operator-authenticated audit export, and multi-host recovery are future
extensions behind the existing provider ports.
