# Authority lifecycle gates

This directory contains the active deterministic tool-invocation pipeline.
`authority_profile_resolver` runs once, then the resolved profile executes the
fixed stages in `pipeline-manifest.js`. Raw tool adapters remain policy-free.

No profile can add a tool to a mode, widen workspace or network scope, cross an
identity boundary, or alter an immutable approved-plan snapshot. Full
Authorization skips only interactive approval; validation, hard scope, explicit
deny rules, identity checks, resource controls, monitoring, output control,
verification, recovery, rollback, and audit stay active.

Long-running work has no default hard, task, or workflow deadline. The timeout
module assigns observation policies and honors explicit operation deadlines;
the monitor records progress, heartbeats, child processes, quiet periods,
adaptive observation extensions, cancellation, and completion.
