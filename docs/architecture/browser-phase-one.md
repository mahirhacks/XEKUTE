# Browser Phase 1: baseline and development environment

Phase 1 defines the browser contracts and supplies a repeatable local test
environment. It does not replace the production browser or add browser policy
gates. Browser functionality is built in Phases 2–7; the existing gate modules
are integrated individually in Phases 8–9, followed by production cutover.

[Phase 2](browser-phase-two.md) now supplies the native tab and session service
with its own development host and real Electron verification.

## Product goal

The user opens Browser in the same workspace tab strip as files and
Interceptor. The live page occupies the workspace while chat remains
alongside it. Switching to a file and back preserves the browser state.

The user can browse manually and hand the same page to the active chat. The
agent moves a visible browser pointer, clicks, scrolls, types, and drags on
that page without moving the Windows mouse or taking focus from chat.
Takeover and resume preserve the page and authentication. Agent interaction
uses page structure first and screenshot coordinates when needed.

Release verification must demonstrate opening the workspace browser,
switching between it and a file, and completing a shared browsing task with
visible agent input and human takeover. The separate Phase 1 fixture window
is the test environment for this embedded product experience.

## Run the development host

From the repository root:

```powershell
npm run dev:browser
```

This opens a separate Electron window containing synthetic browser fixtures.
Use its navigation links to exercise the pages. The host starts two loopback
HTTP origins and an HTTP capture proxy on ephemeral ports. It loads neither
the production composition root nor project identities, provider settings,
proxy listener, application preload, or application IPC handlers.

The host uses a fresh temporary Electron profile. Closing it stops its servers;
the launcher removes the profile after Electron exits. Its popup windows use
the same fixture session. No normal Xekute profile or external browser profile
is opened. The fixture-only request filter is test-host isolation, not the
assessment/research scope policy planned for Phase 8.

Run the complete Phase 1 checkpoint:

```powershell
npm run verify:browser-phase1
```

This runs the existing browser baseline, contract tests, fixture HTTP/proxy
tests, and development-host isolation tests. It then launches real Electron
and exercises the fixtures using public Playwright APIs. Chrome or Edge must
be installed to check the native prompt fixture separately. That browser uses
an isolated, nonpersistent context and synthetic fixture data.

To run only the real-browser walkthrough:

```powershell
npm run dev:browser -- --smoke
```

The walkthrough prints each completed scenario and writes a screenshot to
`tmp/browser-phase1.png`. Smoke mode uses Electron offscreen rendering so a
hidden test window can produce real compositor screenshots. Interactive mode
uses a normal visible window.

## Baseline recorded on 2026-10-15

The existing browser suite passes 26 tests before Phase 1 changes:

```powershell
node --test test/browser-action.test.js test/browser-session-manager.test.js test/proxy-browser.test.js
```

| Boundary | Current production behavior | Later integration point |
| --- | --- | --- |
| Tool adapter | `src/agent/tools/assessment/browser-action.js` validates nine selector-based actions and invokes an injected provider. | Extend the existing function tool; retain legacy action compatibility. |
| Composition | `src/infrastructure/di/container.js` shares a matching visible proxy context or uses the Playwright manager's headless fallback. | Inject the embedded browser service after its policy integrations pass. |
| Browser state | `src/agent/tools/assessment/browser-session-manager.js` owns identity contexts and chat/page aliases. | Replace aliases with actual tab identities; preserve vault integration. |
| Visible browser | `src/interceptor/proxy-browser.js` launches installed Chrome/Edge with persistent project/identity profiles. | Retire agent fallback after cutover; leave old profile files untouched. |
| UI entry | `src/app/ipc/project.js` handles `proxy:browserLaunch`; preload exposes launch/status. | Open the Browser workspace through trusted application IPC. |
| Native view precedent | `ensureWebClonePreviewView` in `src/app/electron/main.js` attaches a sandboxed, no-preload view to the application window. | Reuse view bounds/visibility patterns, not WebClone's navigation restrictions. |
| Authentication | `src/app/storage/identity-vault-store.js` normalizes encrypted cookies, local storage, and origin-bound headers. | Map supported state into assessment sessions. |
| Scope and gates | `executeToolCall` in the Electron main process enters the existing invocation pipeline. | Adapt browser context in Phases 8–9; keep the existing pipeline order. |
| Model input | `normalizeOpenRouterMessages` currently converts content into strings; model listing already returns input modalities. | Preserve image parts and resolve screenshot artifacts in Phase 6. |
| Output | `src/agent/runtime/result-projector.js` limits serialized tool payloads to 32K characters. | Bound structured observations without cutting their JSON. |
| Shutdown | `shutdownAgentRuntime` and DI teardown close existing browser services. | Add native view and in-flight operation cleanup. |

Existing browser tests predominantly use fake providers. They establish the
current adapter and lifecycle contracts, not compatibility between Playwright
and embedded Electron views. The Phase 1 walkthrough verifies the fixtures
using Playwright's Electron test support; it does not implement or prove the
restricted in-process production bridge planned for Phase 3.

## Contract version 1

`src/contracts/browser/browser-contracts.js` exports:

| Export | Purpose |
| --- | --- |
| `validateBrowserContract(name, value)` | Validate a `tab`, `action`, `operatorCommand`, `observation`, `screenshot`, `event`, or `error`. Returns `{ ok: true, value }` or a structured failure. Unknown contract names throw. |
| `createBrowserTab(input)` | Create a human-owned tab descriptor with generation/revisions zero and an idle operation. This is data only; it creates no browser view. |
| `transitionBrowserTab(tab, event)` | Apply a pure state transition without mutating the prior descriptor. |
| `validateBrowserActionBinding(action, context)` | Check that referenced elements/screenshots belong to the supplied tab and current document/viewport revisions. It performs no scope or authority decision. |

Agent actions do not accept operator ownership commands or a project override.
Trusted `operatorCommand` payloads include open, select, close, handoff, and
takeover. A research tab carries no assessment identity. Selecting another
purpose requires another tab, not mutation of an existing descriptor.

Targets have one representation:

```js
{ kind: "element", observationId: "observation_one", ref: "e1" }
{ kind: "selector", selector: "button[type=submit]" }
{ kind: "point", screenshotId: "image_one", x: 40, y: 80 }
```

Screenshot records carry artifact/tab identity, document and viewport
revisions, MIME type, image dimensions, viewport dimensions, scroll position,
device scale, and zoom. Observations include frames, referenced elements,
bounded text, explicit truncation, and overflow artifact identities. These
record-size bounds are wire-format limits, not configured resource gates.

The proposed action contract uses `target` and normalized text fields.
Production still accepts its existing `selector`, `text`, and `option`
arguments. Phase 5 must normalize those legacy calls when it wires this new
contract into the existing tool; Phase 1 does not change the production schema.

### Control transitions

| Event | Required state | Result |
| --- | --- | --- |
| `handoff` / `takeover` | Current `expectedGeneration`, live tab | Increment generation. Transfer immediately when idle; otherwise retain the owner and enter `stopping` with a pending owner. |
| `operation_started` | Chat owner, idle operation, current generation | Enter `running` with an operation identity. |
| `operation_settled` | Matching running/stopping operation | Become idle; apply a pending owner only after settlement. |
| `operation_uncertain` | Matching running/stopping operation | Enter `recovery_required`; do not silently hand control to someone else. |
| `document_changed` / `viewport_changed` | Live tab | Advance the corresponding revision. |
| `crashed` | Live tab | Invalidate control and document state. Active work requires recovery. |
| `recovered` | Crashed or uncertain tab | Return to human-owned, idle state with fresh revisions. |
| `closed` | Any live tab | Invalidate control and become closed. Repeated closure is idempotent. |

This reducer does not implement queues, native input, permission checks,
timeouts, or browser-side recovery. Those operations consume these contracts
in later phases.

## Fixture coverage

| Route | Observable behavior |
| --- | --- |
| `/form` | Synthetic login, password input, role selection, checkbox, HTTP-only cookie, local storage, and session check. Any nonempty fixture credentials work. |
| `/spa` | Filterable controls, replaced DOM nodes, and URL revision changes. |
| `/frames` | Cross-origin iframe with a nested frame returning to the primary origin. |
| `/popups` | Scripted popup, linked tab, and opener messaging. |
| `/dialogs` | Alert, confirmation, and prompt controls. |
| `/canvas` | Canvas-only click target plus native drag-and-drop controls. |
| `/files` | In-memory upload inspection and a deterministic downloadable report. |
| `/redirect` | Redirect between fixture origins; external destinations are rejected. |
| `/health` | JSON identifying the serving fixture origin. |

The capture proxy accepts only the two generated fixture origins, strips its
synthetic identity header before forwarding, and records bounded request and
response bodies. It is an HTTP-only fixture proxy; CONNECT is rejected. It is
not Xekute's production interception listener or the TLS/CA integration planned
for Phase 2.

### Discovered runtime limitation

Electron does not implement `window.prompt()` in this host. The fixture shows
`Prompt unavailable: prompt() is not supported.` rather than pretending the
dialog succeeded. The checkpoint verifies this actual Electron behavior and
also checks that the same prompt fixture succeeds in installed Chromium.

Managed prompt handling remains a later browser-runtime requirement. Alerts
and confirmations are verified in Electron. The fixture host must not acquire
a privileged target-page preload merely to hide this difference.

## Phase 1 completion checks

- 1.1: Existing behavior and integration boundaries recorded; baseline rerun.
- 1.2: Contracts and pure control transitions tested, including stale control,
  cross-tab references, malformed targets, and uncertain operations.
- 1.3: Local fixture APIs, two origins, upload/download bytes, and capture proxy
  tested; real-browser fixture walkthrough provided.
- 1.4: Standalone development host, temporary-profile cleanup, explicit launch
  guard, production import separation, and packaging exclusion tested.

`npm run verify:browser-phase1` is the rerunnable main-phase checkpoint. No
provider key or live assessment target is needed. OpenRouter image transmission,
the product Browser workspace, native view ownership, the custom automation
bridge, and browser-specific gates are not implemented by Phase 1.
