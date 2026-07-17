# XEKUTE

**A local-first, AI-assisted workspace for authorized penetration testing and vulnerability assessment.**

XEKUTE brings assessment scope, HTTP traffic, evidence, security tools, an application behavior map, a terminal, and a local AI assistant into one Windows desktop application. Its primary workflow is human-in-the-loop: the operator defines the authority and remains able to inspect, approve, interrupt, and review every action.

> **Project status:** Alpha. XEKUTE is under active development and should currently be used in controlled, authorized environments. Keep backups of important assessment data.

## Why XEKUTE?

Security work is often split across terminals, proxy tools, notes, JSON files, browser tabs, and AI chats. XEKUTE organizes those parts around a persistent assessment workspace so that traffic, tool output, hypotheses, findings, and reports remain connected to their evidence.

XEKUTE is designed to provide:

- A compact, VS Code-inspired interface for security assessments.
- Local AI through Ollama instead of a mandatory cloud service.
- Explicit scope, Rules of Engagement, safety modes, and granular authority controls.
- Transparent agent actions, approvals, hypotheses, run history, and tool output.
- Structured assessment files that remain accessible outside the application.

## Current Capabilities

### Assessment workspace

- Create or open a structured assessment folder.
- Define in-scope and out-of-scope assets, authorization, testing windows, rate limits, and restricted techniques.
- Edit assessment files through either a visual form or raw JSON view where supported.
- Create, edit, organize, and delete custom files and folders.
- Import context files and generate a combined `pen_context.md`.
- Track evidence, services, findings, reports, WSTG coverage, ASVS coverage, and MITRE ATT&CK coverage.

### Security Workbench

- Local HTTP interception proxy with centralized CA certificate management.
- Searchable and sortable HTTP history backed by `Traffic/Raw`.
- Request and response inspection with stable selection while new traffic arrives.
- Interceptor, Repeater, and Intruder-style workflows for authorized testing.
- URL, Base64, Base64URL, HTML, hexadecimal, JWT, and cookie inspection utilities.
- Configurable capture redaction for credentials, cookies, tokens, and secret fields.

### Application Behavior Map

- Build a deterministic graph from captured HTTP evidence.
- Correlate hosts, subdomains, routes, methods, redirects, workflows, shared objects, and supporting evidence.
- Browse route, workflow, and risk views.
- Select a node to inspect its variants and highlight connected nodes.
- Pan, zoom, arrange nodes, query paths, and preserve graph provenance.

### WebClone

- Download bounded public HTML, JavaScript, and CSS assets from an authorized HTTPS target.
- Browse captured files in a collapsible right-side file drawer.
- Inspect source files in XEKUTE's editor or render the cloned application in an isolated preview.
- Preview cloned applications without allowing them to access XEKUTE, Node.js, the filesystem, popups, or outbound network services.

WebClone is a review aid, not a guaranteed offline reproduction. Applications that depend on authenticated APIs, server-side rendering, external assets, or live backend requests may only render partially.

### AI-assisted workflow

- Use locally installed Ollama models.
- Choose **Planner**, **Agent**, or **Ask** according to the task.
- Use **Safe** mode for analysis and workspace-safe operations.
- Opt into **Test** mode for policy-controlled active testing within an authorized assessment.
- Configure authority for file access, commands, processes, terminal use, network requests, proxy actions, traffic capture, Map operations, reconnaissance, scanning, and exploit validation.
- Review agent runs, actions, approvals, hypotheses, and tool output.
- Keep chat sessions per workspace until they are explicitly deleted.

Safety modes and policy checks are defense-in-depth controls; they do not replace written authorization or professional judgment.

### Commands and Toolbox

XEKUTE currently includes configurable workflows for:

- `/passive` - passive public-source reconnaissance.
- `/active` - authorized active reconnaissance.
- `/endpoint` - page and endpoint discovery.
- `/webclone` - authorized public-site inventory and cloning.

Commands can use static Python orchestration or an AI-assisted role. Tool selection, output locations, rate limits, threads, wordlists, advanced JSON options, and custom commands can be configured in XEKUTE Settings.

The Toolbox provides presets and configuration surfaces for tools including:

| Category | Tools |
| --- | --- |
| Passive reconnaissance | Amass, Subfinder, theHarvester, Google Dorking |
| Active reconnaissance | Nmap, Naabu, Masscan |
| Web and endpoint discovery | httpx, Katana, ffuf, Gobuster |
| Vulnerability and TLS analysis | Nuclei, Nikto, testssl.sh, SQLmap |

XEKUTE does **not** bundle most third-party security binaries. Install only the tools you need and ensure their executables are available on `PATH`. On Windows, some tools may be easier to run through WSL. Each third-party tool remains subject to its own license and installation requirements.

## Requirements

### Required for development

- Windows 10 or Windows 11, x64.
- [Node.js](https://nodejs.org/) 22 or newer.
- npm 10 or newer.
- Python 3 for command and context parsers.

### Required for AI features

- [Ollama](https://ollama.com/) running locally.
- At least one Ollama model installed.

### Optional

- Any external security tools that you enable in Commands or the Toolbox.
- WSL for Linux-first security tooling on Windows.
- A Windows code-signing certificate when producing signed release installers.

## Quick Start

```powershell
git clone https://github.com/mahirhacks/XEKUTE.git
cd Xekute
npm install
```

Install and start Ollama, then pull a model. For example:

```powershell
ollama pull qwen2.5-coder:7b
ollama serve
```

Start XEKUTE:

```powershell
npm start
```

Ollama is optional when using XEKUTE without AI features.

## Development Mode

Run XEKUTE with automatic application restarts when source files change:

```powershell
npm run dev
```

The development command starts Electron through `electronmon` and opens detached DevTools. Main-process changes require an Electron restart; `electronmon` handles this automatically for watched project files.

## Testing and Verification

Run the automated test suite:

```powershell
npm test
```

Verify production security invariants:

```powershell
npm run verify:production
```

Check the packaged native terminal dependency:

```powershell
npm run verify:native
```

## Packaging for Windows

Create an unpacked Windows application:

```powershell
npm run package
```

Create the Squirrel.Windows installer:

```powershell
npm run make
```

Build artifacts are written under `out/`. Windows signing can be enabled with:

```powershell
$env:WINDOWS_CERTIFICATE_FILE = "C:\path\to\certificate.pfx"
$env:WINDOWS_CERTIFICATE_PASSWORD = "your-password"
npm run make
```

Do not commit signing certificates or passwords.

## Project Structure

```text
Xekute/
|-- src/
|   |-- agent/          # Agent loop, prompts, operating modes, and policy engine
|   |-- bugbounty/      # Assessment, Map, proxy, traffic, and Inspector services
|   |-- commands/       # Static slash-command parser and orchestration
|   |-- context/        # Context import and Markdown preparation
|   |-- shared/         # IPC contracts and shared runtime utilities
|   |-- tools/          # Tool adapters, web research, Toolbox, and WebClone
|   |-- main.js         # Electron lifecycle and privileged services
|   |-- preload.js      # Context-isolated renderer bridge
|   |-- renderer.js     # Application workspace behavior
|   |-- terminal.js     # Integrated terminal presentation
|   |-- index.html      # Desktop application shell
|   `-- style.css       # XEKUTE design system and feature styling
|-- test/               # Node test suite
|-- scripts/            # Production verification and release helpers
|-- forge.config.js     # Electron Forge packaging and security fuses
`-- package.json
```

## Security Model

XEKUTE uses Electron context isolation, renderer sandboxing, disabled Node integration, validated IPC payloads, workspace-confined file operations, process ownership checks, permission denial by default, and hardened Electron fuses.

Additional safeguards include:

- Safe and Test operating modes.
- Granular authority permissions and approval policy.
- Scope and authorization checks before supported active workflows.
- Bounded process output, traffic parsing, Map queries, and WebClone assets.
- Centralized proxy CA storage configurable from XEKUTE Settings.
- Encrypted local chat persistence when Windows secure storage is available.
- Evidence-preserving traffic storage with configurable secret redaction.

No software control can make unauthorized testing acceptable. Always verify scope, ownership, Rules of Engagement, rate limits, and stop conditions before sending traffic.

## Responsible Use

XEKUTE is intended only for systems you own or are explicitly authorized to assess. You are responsible for complying with applicable laws, contracts, disclosure requirements, and testing restrictions. Avoid destructive actions, denial-of-service behavior, unnecessary access to personal data, and unapproved exploitation.

## Contributing

Issues and focused pull requests are welcome while the project is in alpha. Before submitting a change:

1. Keep existing assessment formats backward compatible.
2. Preserve local-first behavior and explicit operator control.
3. Add or update tests for behavioral changes.
4. Run `npm test` and `npm run verify:production`.
5. Do not add remote code, telemetry, or secret-bearing fixtures.

## License

XEKUTE is released under the [MIT License](LICENSE).
