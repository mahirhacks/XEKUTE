# Security Policy

XEKUTE is a local-first workbench for authorized security assessment. It runs
commands, edits files, drives a browser, and sends traffic on the operator's
behalf, so a flaw that weakens its controls can harm both the operator and the
systems they test. Reports that help keep those controls sound are welcome.

## Supported Versions

XEKUTE is in alpha. Only the latest release receives security fixes; fixes ship
in the next release rather than as patches to older versions.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Older releases | No        |

If you find an issue in an older version, check whether it still reproduces on
the latest release before reporting.

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub:

**[Report a vulnerability](https://github.com/mahirhacks/XEKUTE/security/advisories/new)**
(the repository's **Security** tab, then **Report a vulnerability**).

Do not open a public issue, pull request, or discussion for a suspected
vulnerability.

A useful report includes:

- The XEKUTE version and Windows version.
- The affected component, such as the main process, preload bridge, IPC
  handler, agent tools, proxy, or updater.
- Steps to reproduce, with a minimal proof of concept.
- The impact: what an attacker gains and under what conditions.
- Any logs or screenshots, with secrets and personal data removed.

## What to Expect

- **Acknowledgement** within 7 days of your report.
- **Assessment** of severity and scope, with follow-up questions if needed.
- **Fix** in a release, on a best-effort timeline that depends on severity and
  complexity. You will be told when a fix is planned and when it ships.
- **Credit** in the advisory and release notes, if you want it.

Please give us a reasonable chance to release a fix before disclosing details
publicly. We will coordinate the disclosure date with you.

## Scope

In scope are flaws in XEKUTE itself, for example:

- Escaping the renderer sandbox or bypassing the preload bridge and IPC
  contract validation.
- Bypassing scope, authority, or approval checks, including through prompt
  injection that makes the agent take an action those controls should block.
- Exposing stored secrets, credentials, chat history, or traffic outside the
  operator's machine, or reading encrypted local data without the operator's
  Windows account.
- Remote code execution through project files, web content, proxied traffic,
  model output, or the update mechanism.
- Workspace path checks that let the agent read or write outside the open
  workspace.

Out of scope:

- Vulnerabilities in systems you assessed using XEKUTE. Report those to their
  owners.
- Model output that is wrong or unhelpful but does not bypass an enforced
  control.
- Issues that require an attacker who already controls the operator's Windows
  account or machine.
- Vulnerabilities in third-party dependencies with no demonstrated impact on
  XEKUTE. Report those upstream.
- Reports from automated scanners without a working proof of concept.
- Denial of service that a local user causes against their own installation.

## Safe Harbor

We will not pursue action against good-faith research that follows this
policy: test only against your own installation and data, avoid privacy
violations and service disruption, and report privately as described above.
This does not authorize testing of any third-party system.

For how XEKUTE is designed to stay safe, see the
[Security Model](README.md#security-model) in the README.
