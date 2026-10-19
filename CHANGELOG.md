# Changelog

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
