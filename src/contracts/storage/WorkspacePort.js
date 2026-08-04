"use strict";

/**
 * WorkspacePort
 *
 * Dependency-free contract for safe workspace file operations. Backs
 * filesystem-dependent guidance ops and storage adapters. Concrete fs/path
 * behavior is injected by the composition root; domain/application code depends
 * only on this port.
 */

const WorkspacePort = Object.freeze({
  resolveWorkspaceTarget(workspace, file) { return { ok: false, error: "WorkspacePort.resolveWorkspaceTarget must be injected" }; },
  editWorkspaceFile(workspace, file, payload) { return Promise.resolve({ ok: false, error: "WorkspacePort.editWorkspaceFile must be injected" }); },
  deleteWorkspaceFile(workspace, file) { return { ok: false, error: "WorkspacePort.deleteWorkspaceFile must be injected" }; },
  copyPath(source, destination) { return { ok: false, error: "WorkspacePort.copyPath must be injected" }; },
  movePath(source, destination) { return { ok: false, error: "WorkspacePort.movePath must be injected" }; },
  listProjectFiles(workspace) { return { ok: false, files: [], error: "WorkspacePort.listProjectFiles must be injected" }; },
  runtimeDirectory() { return ""; },
});

module.exports = WorkspacePort;
