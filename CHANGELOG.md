# Changelog

## [0.6.5] - 2026-10-25

### Added

- Agent-owned checklists, decision-model skill selection, skill-load activity,
  and interrupted-run resume controls.
- Browser action deadlines, dismissible browser notices, and on-demand editor,
  terminal, highlighting, and diagram loading.
- Adversarial hostname and malicious-markup regression tests.

### Fixed

- Checklist sequencing, steering-message ordering, duplicated streamed content,
  context accounting, and long-run checkpoint persistence.
- Wildcard scope consistency across browser and backend tool paths.
- Browser tab scrolling, native view bounds, startup visibility, DevTools
  lifecycle, and maximize/restore state.
- Diagram labels removed by SVG-only sanitization.
- Production verification on clean checkouts and packaging failure propagation.

### Changed

- Refresh checklist visuals, navigation, Settings toggles, and panel icons.
- Update security-sensitive runtime and build dependencies and pin production
  workflow actions to commit SHAs.

## [0.6.4] - 2026-10-20

This release refreshes the update prompt and the empty project panel, and
fixes the File menu and lost keystrokes after creating a file.

### Changed

- Redesign the update prompt with 6px corners, gray 4px buttons, the offered
  version, a flat download bar with a close button, and a check icon on
  completion.
- Use gray, evenly spaced buttons in the No Project Open and assessment setup
  panels.

### Fixed

- Disable File > Create New File, Create New Folder, Save File and Close
  Editor until a project or an editor is open.
- Keep keyboard focus in a newly created file, and stop background explorer
  refreshes from moving focus out of the editor or chat.

## [0.6.3] - 2026-10-20

This release lets the agent sign in with the project's test accounts without
seeing their secrets, fixes three interface bugs, and splits the renderer into
feature modules.

### Added

- Test account variables. The agent's project context lists each saved
  account's label, role, username and `{{account.<id>.username}}`,
  `{{account.<id>.password}}` and `{{account.<id>.cookie}}` variables. A
  variable in any tool input is replaced by the stored value only when the
  tool runs; approvals, the audit log and the transcript keep the variable.
- Tool results mask the project's stored passwords and cookies as their
  variables, including URL-encoded, form-encoded and HTTP Basic forms. An
  unknown account or unsaved field fails the tool call.

### Fixed

- Keep the embedded browser visible under menus and popovers by showing a
  frozen snapshot until the overlay closes.
- Make the Settings > Project section navigation opaque.
- Keep the question card icon at the top left on multi-line prompts.

### Changed

- Split the renderer composition root into feature modules under
  `src/ui/features` and `src/ui/core`, with shared state in `appState`.
  Renderer tests load code by declaration name, and the production gate
  checks every renderer module.

## [0.6.2] - 2026-10-19

This release hardens long-running agent sessions, project switching,
persistence, filesystem access, and proxy lifecycle behavior.

### Fixed

- Preserve the correct context and steering state when summarization is
  interrupted, retried, continued, or recovered after an application restart.
  Superseded model responses and queued tool actions cannot execute against
  an older task revision.
- Recover matching checkpoint and active-ledger state after partial writes
  or corruption. Keep the previous valid checkpoint available and prevent
  duplicate replay of conversation content already included in a checkpoint.
- Prevent stale project loads, file trees, directory maps, profiles,
  identities, guidance, and WebClone responses from replacing the active
  project's UI, including when switching from A to B and back to A.
- Keep manual saves and autosaves bound to their original project and form
  snapshot. Drain queued saves across projects, reject superseded account
  writes, and report rejected save requests without unhandled rejections.
- Prevent an older profile-save response from overwriting a newer profile,
  changing the current status, or starting stale identity and proxy refreshes.
- Persist canonical hypothesis, checklist, and evidence files through a
  durable artifact transaction journal. Include the derived project index
  in the transaction and recover committed state after a restart.
- Preserve committed artifact IDs and cached state when journal cleanup
  fails. Refuse to discard a transaction that already has a durable journal.
  Roll back transaction-owned changes on recovery conflicts while preserving
  conflicting external edits and quarantining the journal.
- Reject symlink and junction escapes in workspace file mutations, WebClone
  reads and builds, traffic storage, artifact destinations, and artifact
  transaction directories.
- Bind traffic reads, appends, and deletions to a validated open file
  descriptor so a swapped log path cannot redirect access to a symlink target.
- Apply assessment exclusions even when no positive allowlist is configured.
  Late traffic writes no longer recreate a project that has been removed.
- Prevent an asynchronous credential save from resurrecting an identity
  deleted while the save was in progress.
- Recover project profiles from a valid backup when the primary file is
  missing or corrupt, and preserve the known-good backup during recovery.
- Serialize proxy configuration changes so an older request cannot replace
  a newer project configuration. Cancel pending listener starts when stopped
  and prevent an earlier listener instance from reviving after a restart.
- Format IPv6 loopback proxy addresses correctly for browser launches.
- Reject private and loopback IPv4-mapped IPv6 addresses and IPv6
  documentation ranges at the public-target scope boundary.
- Finish terminating detached POSIX process groups even when their root
  process exits after SIGTERM.
- Allow repeated references to the same memory identity object while still
  rejecting actual cyclic structures.

### Changed

- Remove the unused bundled BGE model, transformer dependency, and ONNX
  runtime tree. Remove the retired model-asset verification and packaging
  rules. Package verification now rejects these obsolete runtime assets.
- Add regression coverage for interrupted and restarted sessions, partial
  artifact commits, project-switch races, save ordering, proxy lifecycle
  changes, and filesystem escapes.
- Publish version-specific release notes from the repository alongside the
  Windows installer and updater assets.

### Known limitations

- XEKUTE remains an alpha product. Artifact files follow a single-writer
  contract; an unrelated external process can still race the final
  hash-check and rename window when editing the same canonical file.
- The runtime dependency audit reports two low-severity advisories through
  Mermaid and KaTeX. The available automated remediation requires a breaking
  Mermaid major-version upgrade.

[0.6.2]: https://github.com/mahirhacks/XEKUTE/compare/v0.6.1...v0.6.2
