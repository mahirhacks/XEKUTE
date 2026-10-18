# Browser Phases 3 and 4: control and workspace integration

The Interceptor's Browser button now opens Browser in Xekute's workspace tab
strip, beside files and Interceptor. The live page shares the workspace with
chat. The workspace provides web tabs, address and navigation controls, new
assessment or research tabs, identity selection, ownership status, takeover,
and resume.

## Run and verify

Build and start Xekute with its normal development command. Click **Security
Tools**, then **Browser**. Opening an assessment tab prepares the project's
capture listener. Research tabs use separate anonymous sessions.

Run the combined Phase 3 and 4 checkpoint:

```powershell
npm run verify:browser-workspace
```

The command builds the actual UI, runs the focused contract, IPC, renderer,
encryption, and network tests, and launches two real Electron checks:

- `scripts/browser-dev/verify-control.cjs` checks public Playwright control of
  real native tabs, cross-origin and nested frames, popup/opener behavior,
  takeover during a wait, queued-action revocation, target isolation, and
  debugger-loss recovery.
- `scripts/browser-dev/verify-workspace.cjs` launches Xekute's actual main
  process and built renderer with an isolated temporary profile. It clicks the
  Interceptor Browser button, navigates a fixture, switches to a file and back,
  checks overlay hiding, and exercises handoff, takeover, and resume.

The Windows workspace check captures its own application window, including
native child views, in `tmp/browser-workspace.png`. A screenshot of the shell's
web contents alone excludes native child views and cannot verify their pixels.
The test hosts and their temporary projects remain outside packaged files.

## Restricted control bridge

`browser-cdp-transport.js` implements Playwright's public custom CDP transport.
`native-browser-service.js` connects through `chromium.connectOverCDP` with
`noDefaults: true`. No debugging socket, HTTP endpoint, or application-wide
target discovery is added.

The bridge exposes the leased native tab and eligible popup descendants.
It excludes the application shell, storage-transfer helpers, input shields,
other identities, and tabs owned by another chat. The browser-level facade
supports version information, approved target discovery, and attachment setup.
It rejects browser-context creation and other unsupported global commands.
Page commands route through the approved contents' Electron debugger. Native
child session IDs route cross-origin frames through their owning contents.
Navigation rejects schemes outside the browser contract.

Popup handling adopts the WebContents supplied by Electron's `createWindow`
callback. This preserves the real opener relationship and initial navigation.
Background tabs without supplied contents load their URL explicitly. Popups
inherit project, purpose, identity, and ownership, and appear as workspace
pages. Page auto-attachment remains in the browser service. Native automatic
attachment handles frame descendants rather than duplicating popup targets.

The supported contract is tested against the pinned Electron and Playwright
versions. It does not promise arbitrary browser-global CDP compatibility.

## Ownership and cancellation

Trusted callers use this main-process API:

```js
const tab = await browser.handoff(tabId, chatSessionId, expectedGeneration);
await browser.withPage(tabId, chatSessionId, tab.controlGeneration, async page => {
	await page.getByRole("button", { name: "Continue" }).click();
}, { signal });
```

The chat identity is the stable chat session ID used by the workspace handoff.
The Phase 5 tool adapter must bind its execution context to that same identity.
The page object and CDP transport remain in trusted main-process code.

Each tab serializes its operations. Every queued operation checks ownership
and control generation again before connecting. Every dispatched CDP command
checks its lease. Popup descendants participating in a workflow share its
operation settlement and stop handler.

Takeover increments the generation, revokes queued work, closes the operation's
transport, and stops navigation. Ownership transfers only after settlement.
An action that cannot settle enters `recovery_required`. Reload is explicit
recovery and returns human ownership. Debugger loss does not replay an action.
Closing, switching projects, deleting an identity, stopping a chat, and shutting
down revoke affected control before releasing native views.

A transparent native input shield covers a chat-owned visible page. Browser
protocol input goes directly to the target view. Physical mouse input reaches
the shield, and target keyboard events require protocol dispatch while chat
ownership is active. Handoff returns focus to the shell without changing its
active composer element. Takeover removes the shield and retains page state.
Shields carry no preload or application IPC and never enter target discovery.

## Workspace boundary

`src/app/ipc/browser.js` handles only structured UI commands. Its handlers
require the application shell's main frame and validate payloads before calling
the service. The preload exposes open, list, command, layout, hide, and events.
It exposes no native contents or CDP method.

The renderer module `src/ui/features/browser/browser-workspace.js` owns browser
controls and metadata. Xekute's existing workspace tab model owns the Browser
workspace tab. A resize observer reports the viewport's client rectangle. The
service converts shell zoom to native bounds, clamps to the window, and avoids
invalidating the viewport revision for unchanged bounds.

Switching workspace tabs, opening an overlapping app menu or modal dialog,
minimizing, or losing window focus hides native views without discarding state.
Returning to the browser restores its bounds. Native file pickers hide views
before opening. Native pages cannot cover the address controls or chat pane.

The DI container creates the browser lazily and supplies the existing identity
vault, proxy listener, and encrypted tab store. Saved tabs restore before a new
tab can overwrite their metadata. Restoration can return while navigation is
pending, so an unavailable saved URL does not hold up the UI. Proxy ownership
changes close the old project's views first.

## Remaining phases

These phases make the browser usable inside Xekute and provide its control
bridge. The existing model-facing `browser_action` still uses its current
adapter. Phase 5 connects that tool and its observations to the workspace tab
IDs and control leases. OpenRouter screenshot inputs arrive in Phase 6, the
visible agent pointer and visual fallback in Phase 7, and policy integrations
in Phases 8 and 9. The user-requested Browser button migration was moved into
Phase 4. Other legacy browser entry points remain for the final migration.
