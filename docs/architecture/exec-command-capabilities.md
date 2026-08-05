# `exec_command` Capability Boundary

The Windows boundary for unified `exec_command` is host-enforced and intentionally narrower than a general shell:

- **Process:** `shell: false`; executable basename must be in the injected development allowlist (`node`, package managers, `git`, Python, and project build tools). Security CLIs, wrappers, shell metacharacters, redirection, and command chains are denied before spawn.
- **Filesystem:** the working directory is resolved beneath the selected workspace root; path escape is rejected. The command receives no assessment-resource mutation capability.
- **Credentials:** environment is rebuilt from a small non-secret allowlist (`PATH`, system root, temp/home, and `NODE_PATH`); provider keys, cookies, tokens, and assessment identity records are not injected.
- **Network:** no assessment-target network capability is provided. Target-directed traffic, scanners, payload delivery, identity use, and evidence-producing actions must use typed VAPT operations.
- **Resources:** timeout, bounded stdout/stderr collection, process-tree termination, and redacted artifact persistence are host controls. Model results carry only opaque artifact references.
- **Cancellation:** the operation-owned `AbortSignal` kills the child/process tree, preserves collected artifact references and cleanup metadata, and returns `cancelled` or `partial`.

Executable-name classification remains defense in depth. The primary boundary is the host capability set: no shell, bounded executable allowlist, workspace-only cwd, sanitized environment, no assessment network, and bounded resources.

Rollback is the `legacy` catalog rollout; it does not change IPC contracts or assessment data.
