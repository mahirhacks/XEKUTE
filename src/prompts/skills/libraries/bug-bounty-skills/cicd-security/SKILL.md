---
id: cicd-security
title: "CI/CD Security Assessment"
description: "Assessment playbook for CI/CD and supply-chain exposure when the target runs GitHub Actions, GitLab CI, Jenkins, CircleCI, or similar pipelines in or adjacent to program scope."
version: 1.0.0
entrypoint: SKILL.md
visibility: internal
instruction_role: skill-context
modes: ["agent", "ask"]
required_tools: ["read_file", "search_workspace"]
parameter_policy: context-only
menu: bug-bounty
---
# CI/CD Security Assessment

## What the skill is

A judgment framework for reviewing continuous integration and delivery configurations as a trust boundary: where untrusted input meets privileged runners, how secrets and cloud identity are granted, and when a pipeline weakness can realistically affect production or org-wide assets. It emphasizes static workflow review, policy alignment, and impact chaining—not ad hoc job triggering.

## When to use

Load when recon surfaces public or in-scope repositories, workflow definitions, reusable actions, package registries tied to builds, or cloud roles federated from pipeline OIDC. Use when an API or settings flaw might expose pipeline configuration, or when supply-chain hygiene (unpinned dependencies, internal package names) is part of the engagement. Confirm program scope for repository access, fork/PR behavior, and whether running or modifying workflows is permitted before deep testing.

## How to use

**Phase 0 — Scope and permission**

- Map which repos, runners, and environments are in scope; note policies on forks, pull requests, and self-hosted infrastructure.
- Treat production deploy keys, release pipelines, and org-level secrets as highest sensitivity; stop if policy forbids interaction that could queue jobs or alter artifacts.

**Phase 1 — Inventory**

- Collect workflow files, reusable workflows, action references, and permission blocks for default and job-level tokens.
- Note triggers: pull request, pull request target, issue/comment events, manual dispatch, schedule, and release events.
- Identify runner types (hosted vs self-hosted), secret references (names only via platform APIs where allowed), and cloud login steps.

**Phase 2 — Untrusted input vs shell execution**

- Trace whether externally influenced fields (titles, bodies, branch names, review text, dispatch inputs) are passed into shell steps via expression interpolation rather than isolated environment variables.
- Flag jobs that combine elevated secret access with checkout or execution of contributor-supplied revision content.

**Phase 3 — Event-context hazards**

- Review `pull_request_target` and similar base-context triggers: secrets available in the base repo while steps may consume fork head content.
- Check whether comment, issue, or discussion handlers run arbitrary commands with repository credentials.

**Phase 4 — Secret and token exposure**

- Look for logging, echoing, or artifact steps that could surface secret material; review broad `permissions` grants on the automatic repository token.
- Assess whether a compromised workflow could push code, publish packages, or approve changes.

**Phase 5 — Runner and network placement**

- If self-hosted runners serve public or fork-open repos, evaluate whether untrusted jobs could reach internal networks or instance metadata.
- Stop when scope does not allow demonstrating job execution or when the only path requires affecting production runners without written approval.

**Phase 6 — Cloud OIDC and federation**

- Find workflows that request OIDC tokens and assume cloud roles; compare trust policy subjects (repo, ref, environment) against who can trigger the workflow.
- Judge whether a feature branch, fork, or unintended audience could assume an over-privileged role.

**Phase 7 — Supply chain**

- Record unpinned third-party actions and dependencies; note internal package names that might resolve from public registries.
- Assess artifact download and deploy steps for integrity expectations (signing, provenance, fixed versions).

**Phase 8 — Chain and report**

- Link pipeline issues to adjacent findings (misconfigured repo settings, XSS on admin UI, leaked secret names) only when each hop is provable in scope.
- Document remediation at the pattern level (expression handling, trigger design, pinning, trust policy scoping).

## Mental model

- **Pipelines are miniature production:** A workflow often holds keys to code, packages, and cloud roles.
- **Context variables are user input:** Anything derived from issues, PRs, or dispatch forms must not become shell syntax.
- **`pull_request_target` is a deliberate trust inversion:** Base-repo secrets plus foreign code is the classic fatal combination.
- **Runners inherit network position:** Self-hosted labels imply datacenter adjacency, not just faster builds.
- **OIDC is IAM:** Federation trust is as critical as storing long-lived cloud keys in secrets.
- **Supply chain is cumulative:** One mutable action reference can invalidate every downstream gate.

## Tools

| Tool | Job |
|------|-----|
| Workflow linter (e.g. actionlint, policy-oriented GitHub Actions scanners) | Flag dangerous expression patterns, permissions, and trigger misuse |
| Repository secret scanners (gitleaks, trufflehog) | Find hardcoded credentials in history and config—triage whether values are live and in scope |
| Platform CLI (gh and equivalents) | List workflows, runs, and secret names where policy allows read-only inspection |
| Template scanner with CI/CD tags (nuclei) | Prioritize known misconfigurations on exposed CI surfaces |
| Dependency and registry checks | Compare declared internal package names against public registry presence |
| Custom org/repo workflow scanners | Batch review many repositories for recurring anti-patterns |

## Expected output if success

- A short list of workflow files and job names tied to concrete trust failures (untrusted input in execution context, dangerous trigger plus checkout pairing, excessive token permissions, broad OIDC trust, unpinned critical actions).
- Evidence that stays within scope: configuration excerpts, linter output, or permitted log redactions showing impact class (secret access, code write, cloud role assumption, internal network reach) without destructive follow-through.
- Clear stop line for what was not executed (e.g. no malicious PR merged, no production deploy triggered).
- Remediation themes the program can act on immediately.

## Expected output if not success

- Workflows follow expression-safe patterns, separate untrusted checkout from secret-bearing jobs, pin sensitive actions, and scope OIDC to intended refs and environments.
- Findings reduce to informational hygiene (unpinned low-risk actions) with no plausible path to org impact under program rules.
- Scope blocks meaningful review (private repos out of scope, no permission to inspect workflows).
- Only theoretical issues where triggers cannot be reached by an actor allowed under policy.

## Verification method

- Re-read the exact job graph: confirm which event fires the job, which commit is checked out, and which credentials attach to that job—not an adjacent safe job.
- Cross-check platform documentation for expression and permission semantics; avoid conflating “secret referenced” with “secret exfiltrated” without an allowed, minimal proof path.
- For OIDC, trace from workflow trigger through `id-token` permission to cloud trust policy conditions; verify whether disallowed refs can still satisfy the condition.
- Validate scope in writing (program rules, SECURITY.md) before any action that queues builds or opens pull requests.
- Have a second reviewer sanity-check that the reported impact does not require out-of-scope assets or disallowed user interaction.
