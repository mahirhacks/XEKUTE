# Browser Phase 2: native tabs and sessions

Phase 2 adds the main-process browser service and verifies it in an isolated
Electron development host. It uses real `WebContentsView` pages, the existing
encrypted identity vault, and Xekute's production capture listener.

[Phases 3 and 4](browser-phases-three-four.md) now add the product workspace UI
and control bridge. The Interceptor Browser button opens that workspace.
Model-facing agent tools still use their existing adapter until Phase 5.
Scope, authority, and resource-policy integrations remain in the later phases,
following the user's requested implementation order.

## Run the native development host

From the repository root:

```powershell
npm run dev:browser -- --native
```

The host opens a native browser view inside its Electron window. It starts
synthetic local fixtures and an isolated instance of the real capture listener.
The host uses temporary projects, a temporary application profile, and a vault
protected by Electron `safeStorage`. Closing it shuts down the browser before
the listener, and the launcher removes its temporary profile.

The host is a development entry point. It does not load production application
composition, settings, project identities, or application preload. Target pages
have no Node integration, preload, application IPC, or webview support. The
development scripts and fixtures remain excluded from packaged builds.

Run the complete Phase 2 checkpoint:

```powershell
npm run verify:browser-phase2
```

Run only the real Electron scenarios:

```powershell
npm run dev:browser -- --native --smoke
```

The checkpoint runs 43 focused tests and 13 native-browser scenarios. Its quit
and reopen scenario launches Electron twice against the same temporary profile.
Fixture servers remain alive in the verifier so saved pages and authentication
can be checked after the actual application restart. The verifier supplies the
synthetic upstream TLS certificate to Node's extra CA configuration. Chromium's
research session still rejects that certificate.

## Service boundaries

| Module | Responsibility |
| --- | --- |
| `src/app/services/browser/native-browser-service.js` | Stable tab IDs, native views, navigation metadata, document revisions, selection, destruction, project switching, and shutdown. |
| `src/app/services/browser/native-browser-sessions.js` | Separate partitions, vault state, origin-bound headers, proxy routing, capture attribution, and session cleanup. |
| `src/app/services/browser/browser-storage.js` | Import and export supported cookies and local storage without visiting saved origins on the network. |
| `src/app/storage/browser-tab-store.js` | Encrypt restorable tab metadata with the supplied application protector and write it atomically. |

`createNativeBrowserService` accepts Electron, the owning window accessor,
identity vault, proxy listener, optional tab store, and an event callback.
It imports no Electron singleton and creates no global debugging endpoint.

| API | Result |
| --- | --- |
| `activateProject({ id, workspace }, prepareProxy)` | Close the previous project's views and sessions, then call the supplied proxy configuration callback. A cleanup failure prevents the callback. |
| `open({ purpose, identityId, url })` | Create a sandboxed native tab and resolve with its descriptor after navigation. Failed navigation rejects and leaves the tab available for recovery. |
| `navigate(id, url)` / `reload(id)` | Navigate the actual page. Navigation does not hold the lifecycle queue, so closing or switching projects can interrupt it. Reload recovers a crashed tab. |
| `select(id, bounds)` / `hide()` | Show one view or hide views without discarding page state. UI layout synchronization and clamping arrive in Phase 4. |
| `list()` / `status()` | Return copied tab metadata or service counts. |
| `getContents(id)` | Return the native contents to trusted main-process code. No renderer API exposes this method. The Phase 3 bridge will use the tab registry to exclude helper and application contents. |
| `restore()` | Recreate saved tabs with human ownership and idle operation state. Existing live tab IDs are skipped. Navigation failures are reported through events without discarding other restored tabs. |
| `close(id)` / `closeProject()` / `shutdown()` | Stop and destroy views, persist supported identity state, close connections, clear partitions, and unregister capture tokens. Repeated close and shutdown calls are safe. |

The service emits opened, updated, closed, navigation-error, crashed, and
warning events. Persistence errors reject the triggering operation and emit a
warning. Shutdown still attempts session cleanup after a persistence failure.
Document revisions advance for main-frame navigation, history changes, and
subframe navigation. Destruction removes the native contents from the registry.

## Session and persistence behavior

Assessment tabs share a partition only within the same active project and
identity. Anonymous assessment tabs share their own project partition. Research
uses a separate anonymous partition and cannot carry an assessment identity.
Every partition is in memory and receives a fresh name after project closure
or application restart. Chromium authentication databases are not persisted.

Named assessment identities persist supported cookies and local storage through
the existing encrypted vault. Header bindings, unmapped tokens, and certificate
records are retained when browser storage is saved. Only header bindings are
applied to requests in this phase. Client certificate selection remains a later
integration. Storage uses the existing vault's normalization and size limits.
Research and anonymous assessment authentication are temporary.

Cookie import preserves host-only versus domain cookies, HTTP-only flags,
security flags, supported SameSite values, and expiration. Expired persistent
cookies are skipped. Local-storage transfer uses a separate sandboxed helper
view in the same partition. CDP fulfills every helper request with an empty
document. An isolated-world script transfers storage without site scripts,
preload, or upstream requests. The helper closes after each transfer and never
enters the tab registry. This limited storage helper is separate from the
production Playwright transport planned for Phase 3.

Restorable tab metadata contains IDs, purpose, identity reference, URL, and
title. The store encrypts the complete payload because URLs can contain secrets.
It never saves automation ownership or active operation state. Normal
navigation updates metadata, and orderly project closure saves the current
tab list. Renderer memory, session storage, IndexedDB, service workers, and
live operations are not exported to the vault.

## Proxy routing and lifecycle

Assessment creation requires a running listener for the same project and its
CA certificate. Chromium uses a fixed proxy with loopback bypass disabled.
Each partition registers a capture token using the listener's existing
attribution API. The listener strips that token before forwarding traffic.
Identity headers match the configured origin and complete path prefix. Every
request removes identity-controlled header names before applying the current
URL's bindings, including across redirects.

The session certificate verifier accepts the configured project CA only after
validating the certificate chain, hostname, and validity. It retains Chromium's
normal verification for publicly trusted certificates. Research uses direct
networking and default certificate trust, with no capture token or assessment
headers. The development host disables QUIC. Production startup configuration
will be connected during cutover.

Listener loss blocks assessment requests rather than using direct networking.
Project activation closes old views and clears session connections, workers,
storage, and capture registrations before proxy ownership can change. The
caller must route proxy ownership changes through this lifecycle boundary.
Automatic listener recovery and its application event wiring belong to later
failure-recovery and cutover work.

Permission requests are denied by default in this foundation. Native popup
adoption belongs to Phase 3, managed uploads/downloads and dialogs to Phase 5,
and the workspace controls to Phase 4. No scope-policy or authority-pipeline
integration is introduced here.

## Verified behavior

The real Electron checkpoint verifies these scenarios:

1. Native sandboxed views, in-memory partitions, navigation metadata, and invalid identity combinations.
2. Encrypted cookie and local-storage import, continuity across tabs of the same identity, and isolation from a second identity.
3. Real capture attribution, origin-bound headers, and absence of storage-helper traffic at the listener.
4. Anonymous research storage and absence of research traffic in assessment capture.
5. HTTPS interception with the project CA and certificate rejection in research.
6. View selection, hiding, and destruction without discarding other tabs.
7. Renderer crash reporting and reload recovery.
8. Project switching during a pending navigation, with native contents destroyed before proxy ownership changes.
9. Identity restoration and fresh research storage after project switching.
10. Actual application quit and reopen with restored authentication and human-owned tabs.
11. Visible encrypted persistence failure with resource cleanup.
12. Listener failure without direct assessment fallback.
13. Repeated shutdown with no live registered tabs or sessions.

Unit tests also cover encrypted tab-file corruption, unavailable encryption,
project separation, complete header path matching, and rejection of unrelated,
expired, malformed, and wrong-host certificates.
