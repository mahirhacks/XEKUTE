# XEKUTE

**A local-first, AI-assisted workspace for authorized penetration testing and vulnerability assessment.**

XEKUTE brings assessment scope, HTTP traffic, evidence, security tools, an application behavior map, a terminal, and a local AI assistant into one Windows desktop application. Its primary workflow is human-in-the-loop: the operator defines the authority and remains able to inspect, approve, interrupt, and review every action.

> **Project status:** Alpha. XEKUTE is under active development and should currently be used in controlled, authorized environments. Keep backups of important assessment data.

## Why XEKUTE?

Security work is often split across terminals, proxy tools, notes, JSON files, browser tabs, and AI chats. XEKUTE organizes those parts around a project folder so that traffic, tool output, hypotheses, findings, and reports remain connected to their evidence.

XEKUTE is designed to provide:

- A compact, VS Code-inspired interface for security assessments.
- Local AI through Ollama or an OpenRouter provider, with exactly one active at a time.
- Explicit scope, Rules of Engagement, safety modes, and granular authority controls.
- Transparent agent actions, approvals, hypotheses, run history, and tool output.
- A plain project folder that remains fully usable outside the application.

## Current Capabilities

### Project workspace

- Create a blank project folder or open any existing project folder.
- Leave new project folders untouched: XEKUTE does not scaffold assessment files or phase directories.
- Configure the professional engagement, authorization, contacts, scope, Rules of Engagement, application context, and data handling in **Settings > Project**.
- Keep the project profile in protected XEKUTE app data rather than adding configuration files to the project.
- Create, edit, organize, and delete custom files and folders.
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
- Choose **Hypothesis**, **Agent**, or **Ask** according to the task.
- Use **Safe** mode for analysis and workspace-safe operations.
- Opt into **Test** mode for policy-controlled active testing within an authorized assessment.
- Route a compact tool set by profile: read-only context for Ask and Hypothesis, workspace operations for Safe Agent, and typed security adapters only for Testing Agent.
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
- Node.js 22 or newer (see `engines` in `package.json`).
- npm 10 or newer.

### Required for AI features

- Either [Ollama](https://ollama.com/) running locally with at least one model installed, or an OpenRouter API key and configured model ID.
- Configure the provider and model in XEKUTE Chat or Settings. `OPENROUTER_API_KEY` remains a compatible headless-development fallback.

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

This launches the XEKUTE desktop workbench. It includes the chat interface,
project workspace, security workbench, behavior Map, terminal, editor, and
Toolbox. Ollama is optional when using XEKUTE without AI features.

## Development Mode

```powershell
npm run dev
```

`npm run dev` launches the app through `electronmon` with an inspector on port
5858 for debugging.

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

Regenerate prompt modules from the Markdown sources in `src/content/prompts/`:

```powershell
npm run build:prompts
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
|   |-- README.md       # Source architecture and change-location guide
|   |-- contracts/      # Dependency-free port contracts (tool, llm, assessment, ipc)
|   |-- domain/         # Pure domain rules (scope, assessment, project)
|   |-- application/    # Orchestration, policies, planning, clarification, prompt
|   |-- adapters/       # Concrete implementations (tools, llm)
|   |-- infrastructure/ # DI composition root + config/logging/errors
|   |-- presentation/   # Electron shell + renderer (ui)
|   |-- content/        # Prompt Markdown sources + generated content-addressed build
|   |-- automation/     # Slash-command adapters and context ingestion
|   |-- app/            # Compatibility launcher + app services
|   `-- preload.js      # Context-isolated renderer bridge
|-- test/               # Node test suite
|-- scripts/            # Production verification and release helpers
|-- docs/               # Architecture, audit, release, and migration docs
|-- forge.config.js     # Electron Forge packaging and security fuses
`-- package.json
```

## Security Model

XEKUTE runs a sandboxed Electron renderer (`sandbox: true`, `contextIsolation:
true`, `nodeIntegration: false`) talking to the privileged main process only
through the preload bridge and validated IPC contracts. AI and operator actions
are mode-scoped and policy-gated.

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
