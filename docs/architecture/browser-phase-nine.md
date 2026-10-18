# Browser phase 9

Phase 9 adds per-project transfer settings, tab-specific admission, and a
dispatch-time recheck that keeps queued work from running on a stale decision.

## Browser transfers

The project profile has a `browser` block, edited in Settings › Project ›
Browser transfers:

| Field | Values | Default |
|---|---|---|
| `uploads` | `allowed`, `blocked` | `allowed` |
| `downloads` | `allowed`, `blocked` | `allowed` |
| `maxDownloadMiB` | 1 to 12 | 12 |

Agent uploads still come only from files inside the project. A blocked
`upload` or `download` action is denied at the authority gate with
`BROWSER_UPLOAD_BLOCKED` or `BROWSER_DOWNLOAD_BLOCKED`, before any file or
artifact is read.

Downloads started in agent-owned tabs follow the project rule in the native
service. A blocked download is cancelled before it is saved. A download above
the limit is cancelled at its declared size or as soon as it passes the limit.
Either way the tab records a failed download with no artifact. Tabs a person
controls keep the fixed 12 MiB artifact cap. Site permissions (camera,
microphone, location, notifications, clipboard) stay denied for every tab.

## Admission

The concurrency gate no longer locks every browser action of one identity
behind a single `main` page key. With the live tab from `main.js`, an action
claims:

- its tab, exclusively, so one tab still runs one action at a time;
- its identity, shared, so tabs using one identity progress together while an
  identity edit or import waits for them to finish;
- a project traffic slot, only for `interact` and `sensitive` actions. The
  pool size is the project's rules-of-engagement `maximumConcurrency`, so
  `observe`, `screenshot`, and `wait` never hold back other tabs.

Workspace file work does not wait on browser actions.

## Dispatch recheck

The policy is decided before an action queues for its leases. Just before
dispatch, `main.js` decides again with a freshly read profile and the live
tab. If the fresh decision is stricter, the action fails with
`BROWSER_POLICY_CHANGED` and nothing runs. An approved scope exception still
holds only when it is the same exception (same tab, generation, and origin).
Uncertain actions are still never replayed.

## Verification

`test/browser-admission.test.js` covers the claims, slot limits, identity
coordination, transfer denials, and the recheck. The real Electron transfer
scenario in `scripts/browser-dev/verify-agent.cjs` proves blocked and
oversized downloads store nothing. `npm run verify:browser-agent` and
`npm run verify:browser-workspace` pass.

The default `maximumConcurrency` is 1, so by default one traffic-generating
browser action runs at a time per project. Raise it in Settings › Project ›
Operating limits to let several agent tabs act at once.
