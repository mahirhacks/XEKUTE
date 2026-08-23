"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createMcpConfigService } = require("../services/assessment/knowledge/mcp-config-service.js");
const { createKaliAccessService } = require("../services/assessment/knowledge/kali-access-service.js");

const MAX_EDITABLE_FILE_BYTES = 5 * 1024 * 1024;

/* Project-facing IPC registration. The Electron composition root supplies
 * stateful services; this module owns only feature handler registration. */
function registerProjectIpc({
  ipcMain,
  app,
  dialog,
  shell,
  container,
  getMainWindow,
  projectProfileStore,
  readProjectProfile,
  validateCustomEntryPath,
  effectiveProjectRuntimeSettings,
  effectiveOperatorRuntimeSettings,
  assessmentWorkspace,
  assessmentMap,
  assessmentIntelligence,
  securityHttpWorkbench,
  proxyListener,
  webClone,
  webClonePreviewDocuments,
  preview,
  syncWebClonePreviewState,
  ensureWebClonePreviewServer,
  normalizeWebClonePreviewBounds,
  ensureWebClonePreviewView,
  hideWebClonePreviewView,
  deleteWorkspaceFile,
  transferWorkspacePath,
  startWorkspaceWatch,
  stopWorkspaceWatch,
  buildIntruderRequests,
  buildContext,
  readApplicationPreferences,
  writeApplicationPreferences,
  certificateSettingsSnapshot,
  configuredCentralCaDirectory,
  fetchOllamaTags,
  parseOllamaTags,
  getActiveProvider,
  openRouterFetch,
  ollamaSettingsSnapshot,
  normalizeOllamaHostInput,
  getOllamaBaseUrl,
  ollamaHostLabel,
  saveLlmSettings,
  llmSettingsSnapshot,
  GUIDANCE_EXTENSIONS,
  MAX_GUIDANCE_FILE_BYTES,
  formatWorkspaceGuidance,
  guidancePathInfo,
  listGuidanceEntries,
  normalizeGuidanceKind,
  readGuidanceEntry,
  clearBrowserTarget = () => {},
  clearBrowserSessionTargets = () => {},
  clearBrowserIdentityTargets = () => {},
}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") throw new TypeError("registerProjectIpc requires ipcMain");
  if (typeof getMainWindow !== "function") throw new TypeError("registerProjectIpc requires getMainWindow");
  const mcpConfig = createMcpConfigService({ fs, path, home: () => app.getPath("home") });
  const kaliAccess = createKaliAccessService({ fs, path, home: () => app.getPath("home") });

// â”€â”€ File System IPC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Open a folder picker, return the chosen path */
ipcMain.handle("fs:openFolder", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "Open Project",
    buttonLabel: "Open Project",
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("project:create", async (_event, { defaultParent } = {}) => {
  const parent = defaultParent && path.isAbsolute(defaultParent) && fs.existsSync(defaultParent)
    ? path.dirname(defaultParent)
    : app.getPath("documents");
  const result = await dialog.showSaveDialog(getMainWindow(), {
    title: "Create New Project",
    buttonLabel: "Create Project",
    defaultPath: path.join(parent, "new-project"),
    properties: ["createDirectory", "showOverwriteConfirmation", "dontAddToRecent"],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  const projectPath = path.resolve(result.filePath);
  try {
    if (fs.existsSync(projectPath)) {
      const stat = fs.statSync(projectPath);
      if (!stat.isDirectory()) return { error: "A file already exists at that location." };
      if (fs.readdirSync(projectPath).length) return { error: "Choose a new or empty folder for the project." };
    } else {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    return { ok: true, path: projectPath };
  } catch (error) {
    return { error: error?.message || "Could not create the project folder." };
  }
});

ipcMain.handle("project-profile:get", async (_event, { path: projectPath } = {}) => {
  return projectProfileStore().read(projectPath);
});

ipcMain.handle("project-profile:save", async (_event, { path: projectPath, profile } = {}) => {
  return projectProfileStore().save(projectPath, profile);
});

/** Open a file picker, return the chosen path */
ipcMain.handle("fs:openFile", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

/** List directory entries (one level) */
ipcMain.handle("fs:readdir", async (_event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDir: e.isDirectory(),
      path: path.join(dirPath, e.name),
    })).sort((a, b) => {
      // dirs first, then alphabetical
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    return { error: err.message };
  }
});

/** Read a file as text */
ipcMain.handle("fs:readFile", async (_event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_EDITABLE_FILE_BYTES) {
      return { error: "File too large to edit (> 5 MB)" };
    }
    const content = fs.readFileSync(filePath, "utf8");
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

/** Write text to a file */
ipcMain.handle("fs:writeFile", async (_event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

/** Create a new folder */
ipcMain.handle("fs:mkdir", async (_event, dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("fs:deletePath", async (_event, { workspace, path: relPath }) => {
  return deleteWorkspaceFile(workspace, relPath);
});

ipcMain.handle("fs:copyPath", async (_event, { workspace, source, destination } = {}) => {
  return transferWorkspacePath(workspace, source, destination);
});

ipcMain.handle("fs:movePath", async (_event, { workspace, source, destination } = {}) => {
  return transferWorkspacePath(workspace, source, destination, { move: true });
});

ipcMain.handle("assessment:create", async (_event, { defaultParent } = {}) => {
  const parent = defaultParent && path.isAbsolute(defaultParent) && fs.existsSync(defaultParent)
    ? defaultParent
    : app.getPath("documents");
  const result = await dialog.showSaveDialog(getMainWindow(), {
    title: "Create Assessment Folder",
    buttonLabel: "Create Assessment",
    defaultPath: path.join(parent, "bug-bounty-assessment"),
    properties: ["createDirectory", "showOverwriteConfirmation", "dontAddToRecent"],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const repaired = assessmentWorkspace.repair(result.filePath, { createRoot: true });
  return repaired.error ? repaired : { ...repaired, path: repaired.root };
});

ipcMain.handle("assessment:open", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "Open Assessment Folder",
    buttonLabel: "Open Assessment",
    properties: ["openDirectory", "createDirectory", "dontAddToRecent"],
  });
  return result.canceled ? { canceled: true } : { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("assessment:verify", async (_event, { path: assessmentPath } = {}) => {
  return assessmentWorkspace.verify(assessmentPath);
});

ipcMain.handle("assessment:repair", async (_event, { path: assessmentPath } = {}) => {
  return assessmentWorkspace.repair(assessmentPath);
});

ipcMain.handle("assessment:trafficLog", async (_event, { path: assessmentPath, record, filtered = false } = {}) => {
  const result = assessmentWorkspace.appendTrafficRecord(assessmentPath, record || {}, { filtered: Boolean(filtered) });
  Promise.resolve(assessmentIntelligence?.refresh?.(assessmentPath)).catch(() => {});
  return result;
});

ipcMain.handle("assessment:trafficHistory", async (_event, { path: assessmentPath, limit = 500 } = {}) => {
  return assessmentWorkspace.readTrafficHistory(assessmentPath, { limit });
});

ipcMain.handle("session-memory:load", async (_event, { workspace } = {}) => {
  return container.sessionMemoryStore().load(workspace);
});

ipcMain.handle("session-memory:begin", async (_event, { workspace, sessionId, title, userPrompt, userMessageId, session } = {}) => {
  return container.sessionMemoryStore().begin(workspace, {
    sessionId,
    title,
    userPrompt,
    userMessageId,
    session,
  });
});

ipcMain.handle("session-memory:event", async (_event, { workspace, ...event } = {}) => {
  return container.sessionMemoryStore().record(workspace, event);
});

ipcMain.handle("session-memory:update", async (_event, { workspace, sessionId, sessionMeta } = {}) => {
  return container.sessionMemoryStore().record(workspace, { type: "session_meta", sessionId, sessionMeta });
});

ipcMain.handle("session-memory:close", async (_event, { workspace, sessionId } = {}) => {
  const result = container.sessionMemoryStore().close(workspace, sessionId);
  await container.browserSessionManager?.closeSession?.(workspace, sessionId);
  container.contextCompiler?.clearSession?.(workspace, sessionId);
  container.mcpRuntime?.clearSession?.(sessionId, workspace);
  clearBrowserSessionTargets(workspace, sessionId);
  return result;
});

ipcMain.handle("session-memory:reopen", async (_event, { workspace, sessionId } = {}) => {
  return container.sessionMemoryStore().reopen(workspace, sessionId);
});

ipcMain.handle("session-memory:archive", async (_event, { workspace, sessionId } = {}) => {
  return container.sessionMemoryStore().record(workspace, { type: "archive", sessionId });
});

ipcMain.handle("session-memory:unarchive", async (_event, { workspace, sessionId } = {}) => {
  return container.sessionMemoryStore().record(workspace, { type: "unarchive", sessionId });
});

ipcMain.handle("session-memory:flush", async () => {
  return container.sessionMemoryStore().flush();
});

ipcMain.handle("session-memory:delete", async (_event, { workspace, sessionId } = {}) => {
  const loaded = container.sessionMemoryStore().load(workspace);
  const sessions = [...(loaded.sessions || []), ...(loaded.closedSessions || []), ...(loaded.archivedSessions || [])];
  const session = sessions.find((item) => String(item.id) === String(sessionId));
  if (session) {
    if (!container.contextCompiler?.prepareFinalization) return { ok: false, error: "Project-memory finalization is unavailable; the session was not deleted.", code: "CONTEXT_FINALIZATION_UNAVAILABLE" };
    try {
      const prepared = container.contextCompiler.prepareFinalization({
        workspace,
        sessionId,
        messages: session.history || session.messages || [],
        outcome: "deleted",
      });
      prepared.completion.catch(() => {});
    } catch (error) {
      return { ok: false, error: error.message || "Project-memory finalization could not be made durable; the session was not deleted.", code: error.code || "CONTEXT_FINALIZATION_FAILED" };
    }
  }
  container.contextCompiler?.clearSession?.(workspace, sessionId);
  container.mcpRuntime?.clearSession?.(sessionId, workspace);
  await container.browserSessionManager?.closeSession?.(workspace, sessionId);
  clearBrowserSessionTargets(workspace, sessionId);
  return container.sessionMemoryStore().remove(workspace, sessionId);
});

ipcMain.handle("context:projectMemory", async (_event, { workspace } = {}) => {
  return container.projectMemoryStore?.load?.(workspace) || { ok: false, code: "PROJECT_MEMORY_UNAVAILABLE" };
});

ipcMain.handle("context:consolidate", async (_event, { workspace, ...input } = {}) => {
  const result = container.contextCompiler?.sealEpisode?.({ workspace, ...input }) || { ok: false, code: "CONTEXT_COMPILER_UNAVAILABLE" };
  if (input.expireKnowledge) container.mcpRuntime?.clearSession?.(input.sessionId, workspace);
  return result;
});

ipcMain.handle("context:event", async (_event, { workspace, ...input } = {}) => {
  return container.contextCompiler?.recordKeyEvent?.({ workspace, ...input }) || { ok: false, code: "CONTEXT_COMPILER_UNAVAILABLE" };
});

ipcMain.handle("context:flush", async () => {
  return container.contextCompiler?.flush?.() || { ok: true };
});

ipcMain.on("session-memory:save-before-close", (event, { workspace, ...memoryEvent } = {}) => {
  try {
    event.returnValue = container.sessionMemoryStore().recordSync(workspace, memoryEvent);
  } catch (error) {
    event.returnValue = { ok: false, error: error.message };
  }
});

ipcMain.handle("assessment:evidence", async (_event, { path: assessmentPath, limit = 500 } = {}) => {
  return assessmentWorkspace.readJsonl(assessmentPath, "evidence/index.jsonl", { limit });
});
ipcMain.handle("assessment:appendEvidence", async (_event, { path: assessmentPath, record } = {}) => {
  const result = assessmentWorkspace.appendEvidenceRecord(assessmentPath, record || {});
  Promise.resolve(assessmentIntelligence?.refresh?.(assessmentPath)).catch(() => {});
  Promise.resolve(container.contextCompiler?.recordKeyEvent?.({ workspace: assessmentPath, events: [{ type: "evidence_relationship", summary: record?.title || record?.type || "Evidence captured", evidenceIds: [result?.record?.id || record?.id].filter(Boolean) }] })).catch(() => {});
  return result;
});
ipcMain.handle("assessment:appendFinding", async (_event, { path: assessmentPath, finding } = {}) => {
  const result = assessmentWorkspace.appendFinding(assessmentPath, finding || {});
  Promise.resolve(assessmentIntelligence?.refresh?.(assessmentPath)).catch(() => {});
  Promise.resolve(container.contextCompiler?.recordKeyEvent?.({ workspace: assessmentPath, events: [{ type: "finding_status", summary: finding?.title || finding?.name || "Finding status changed", findingId: result?.record?.id || finding?.id || "", outcome: finding?.status || "updated", evidenceIds: finding?.evidenceIds || [] }] })).catch(() => {});
  return result;
});
ipcMain.handle("assessment:createRun", async (_event, { path: assessmentPath, run } = {}) => {
  const result = assessmentWorkspace.createRun(assessmentPath, run || {});
  return result;
});
ipcMain.handle("assessment:updateRun", async (_event, { path: assessmentPath, id, patch } = {}) => {
  const result = assessmentWorkspace.updateRun(assessmentPath, id, patch || {});
  if (patch?.status && ["completed", "stopped", "failed", "inconclusive"].includes(String(patch.status))) {
    Promise.resolve(container.contextCompiler?.recordKeyEvent?.({ workspace: assessmentPath, events: [{ type: "run_completed", runId: id, outcome: patch.status, summary: patch.notes || `Assessment run ${patch.status}` }] })).catch(() => {});
  }
  return result;
});
ipcMain.handle("assessment:generateReport", async (_event, { path: assessmentPath } = {}) => {
  return assessmentWorkspace.generateReport(assessmentPath);
});
ipcMain.handle("assessment:runHistory", async (_event, { path: assessmentPath, limit = 500 } = {}) => {
  const result = assessmentWorkspace.readJsonl(assessmentPath, ".xekute/logs/agent-runs.jsonl", { limit });
  return result;
});

ipcMain.handle("assessment:deleteTrafficRecords", async (_event, { path: assessmentPath, requestIds = [] } = {}) => {
  return assessmentWorkspace.deleteTrafficRecords(assessmentPath, { requestIds });
});

ipcMain.handle("assessment:map", async (_event, { path: assessmentPath } = {}) => {
  return assessmentMap.read(assessmentPath, { operatorInitiated: true });
});

ipcMain.handle("assessment:buildMap", async (_event, { path: assessmentPath } = {}) => {
  return container.graphBuildService.build(assessmentPath, { operatorInitiated: true });
});
ipcMain.handle("assessment:deepCollectGraph", async (_event, { path: assessmentPath, seeds = [], force = false, maxFiles } = {}) => {
  const collected = await container.javascriptCollector.collect({ workspace: assessmentPath, seeds, force, maxFiles });
  if (collected?.ok === false) return collected;
  const built = await container.graphBuildService.build(assessmentPath, { operatorInitiated: true });
  return built?.error ? { ...collected, graph: built } : { ...collected, graph: { ok: true, path: built.path, htmlPath: built.htmlPath, unchanged: built.unchanged, stats: built.graph?.stats || {} } };
});
ipcMain.handle("assessment:mapOverview", async (_event, { path: assessmentPath } = {}) => assessmentMap.getOverview(assessmentPath));
ipcMain.handle("assessment:mapNode", async (_event, { path: assessmentPath, id } = {}) => assessmentMap.getNode(assessmentPath, id));
ipcMain.handle("assessment:mapNeighbors", async (_event, { path: assessmentPath, id, edgeTypes, minConfidence } = {}) => assessmentMap.getNeighbors(assessmentPath, id, { edgeTypes, minConfidence }));
ipcMain.handle("assessment:mapPaths", async (_event, { path: assessmentPath, from, to, maxHops, minConfidence } = {}) => assessmentMap.findPaths(assessmentPath, from, to, { maxHops, minConfidence }));
ipcMain.handle("assessment:mapRoutes", async (_event, { path: assessmentPath, pattern, tags } = {}) => assessmentMap.searchRoutes(assessmentPath, pattern, { tags }));
ipcMain.handle("assessment:mapSharedObjects", async (_event, { path: assessmentPath, id } = {}) => assessmentMap.getSharedObjects(assessmentPath, id));
ipcMain.handle("assessment:mapEvidence", async (_event, { path: assessmentPath, evidenceIds } = {}) => assessmentMap.getEvidence(assessmentPath, evidenceIds));
ipcMain.handle("assessment:mapHypotheses", async (_event, { path: assessmentPath, status } = {}) => assessmentMap.getHypotheses(assessmentPath, { status }));
ipcMain.handle("assessment:mapAnnotateFinding", async (_event, { path: assessmentPath, ...input } = {}) => assessmentMap.annotateFinding(assessmentPath, input));
ipcMain.handle("assessment:intelligenceStatus", async (_event, { path: assessmentPath } = {}) => assessmentIntelligence.status(assessmentPath));
ipcMain.handle("assessment:intelligenceStart", async (_event, { path: assessmentPath, runId, planId } = {}) => assessmentIntelligence.start(assessmentPath, { runId, planId }));
ipcMain.handle("assessment:intelligencePause", async (_event, { path: assessmentPath } = {}) => assessmentIntelligence.pause(assessmentPath));
ipcMain.handle("assessment:intelligenceResume", async (_event, { path: assessmentPath, runId, planId } = {}) => assessmentIntelligence.resume(assessmentPath, { runId, planId }));
ipcMain.handle("assessment:intelligenceRebuild", async (_event, { path: assessmentPath, runId, planId } = {}) => assessmentIntelligence.rebuild(assessmentPath, { runId, planId }));
ipcMain.handle("assessment:intelligenceQuery", async (_event, { path: assessmentPath, ...input } = {}) => assessmentIntelligence.query(assessmentPath, input));
ipcMain.handle("assessment:intelligenceExpand", async (_event, { path: assessmentPath, ...input } = {}) => assessmentIntelligence.expand(assessmentPath, input));
ipcMain.handle("webclone:build", async (_event, { path: assessmentPath, target, maxAssets } = {}) => {
  return webClone.build({ root: assessmentPath, target, maxAssets });
});
ipcMain.handle("webclone:manifest", async (_event, { path: assessmentPath } = {}) => webClone.readManifest(assessmentPath));
ipcMain.handle("webclone:readFile", async (_event, { path: assessmentPath, relativePath } = {}) => webClone.readFile(assessmentPath, relativePath));
ipcMain.handle("webclone:previewDocument", async (_event, { html, bounds } = {}) => {
  const documentHtml = String(html || "");
  if (!documentHtml || Buffer.byteLength(documentHtml, "utf8") > 6_000_000) return { error: "WebClone preview document is empty or exceeds the 6 MB limit." };
  const token = crypto.randomUUID();
  const now = Date.now();
  webClonePreviewDocuments.set(token, { html: documentHtml, createdAt: now, ownerId: _event.sender.id });
  for (const [id, record] of webClonePreviewDocuments) {
    if (now - record.createdAt > 10 * 60 * 1000 || webClonePreviewDocuments.size > 12) webClonePreviewDocuments.delete(id);
  }
  try {
    const port = await ensureWebClonePreviewServer();
    if (!port) return { error: "WebClone preview server could not start." };
    const normalizedBounds = normalizeWebClonePreviewBounds(bounds);
    if (!normalizedBounds) return { error: "WebClone preview window is unavailable." };
    preview.url = `http://127.0.0.1:${port}/preview/${token}/index.html`;
    syncWebClonePreviewState();
    const view = ensureWebClonePreviewView();
    view.setVisible(false);
    view.setBounds(normalizedBounds);
    await view.webContents.loadURL(preview.url);
    view.setVisible(true);
    return { ok: true };
  } catch (error) {
    webClonePreviewDocuments.delete(token);
    return { error: `WebClone preview server could not start: ${error.message}` };
  }
});
ipcMain.handle("webclone:previewBounds", async (_event, { bounds } = {}) => {
  const normalizedBounds = normalizeWebClonePreviewBounds(bounds);
  if (!normalizedBounds || !preview.view) return { ok: false };
  preview.view.setBounds(normalizedBounds);
  return { ok: true };
});
ipcMain.handle("webclone:hidePreview", async () => {
  hideWebClonePreviewView();
  return { ok: true };
});

ipcMain.handle("assessment:settings", async (_event, { path: assessmentPath } = {}) => {
  const legacy = assessmentWorkspace.readSettings(assessmentPath);
  if (!legacy?.error) return legacy;
  const project = projectProfileStore().read(assessmentPath);
  if (project?.error) return legacy;
  return {
    ok: true,
    root: project.root,
    settings: effectiveProjectRuntimeSettings(project.root),
    virtual: true,
  };
});

ipcMain.handle("assessment:writeSettings", async (_event, { path: assessmentPath, settings } = {}) => {
  return assessmentWorkspace.writeSettings(assessmentPath, settings);
});

function safeAssessmentChild(root, relativePath) {
  const base = path.resolve(root || "");
  const target = path.resolve(base, String(relativePath || ""));
  return base && target !== base && target.startsWith(`${base}${path.sep}`) ? target : "";
}

function guidanceWorkspaceRoot(workspace) {
  const root = path.resolve(String(workspace || ""));
  try {
    return workspace && path.isAbsolute(root) && fs.existsSync(root) && fs.statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

function globalGuidanceRoot() {
  return app.getPath("userData");
}

function validateGuidancePath(relativePath) {
  return guidancePathInfo(relativePath);
}

function resolveGuidanceTarget(workspace, relativePath, scope = "project") {
  const selectedScope = String(scope || "project").toLowerCase() === "global" ? "global" : "project";
  const root = selectedScope === "global" ? globalGuidanceRoot() : guidanceWorkspaceRoot(workspace);
  if (!root) {
    return { error: selectedScope === "global" ? "Global guidance storage is unavailable" : "Open a project before managing guidance", code: "WORKSPACE_REQUIRED" };
  }
  const validated = validateGuidancePath(relativePath);
  if (validated.error) return validated;
  const target = path.resolve(root, ...validated.normalized.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: "Guidance files must stay inside the selected storage", code: "INVALID_GUIDANCE_PATH" };
  }
  if (guidancePathHasSymlink(root, target)) return { error: "Guidance paths cannot pass through symbolic links", code: "SYMLINK_NOT_ALLOWED" };
  return { ok: true, root, scope: selectedScope, target, ...validated };
}

function guidancePathHasSymlink(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return true;
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

ipcMain.handle("guidance:entries", async (_event, { workspace, scope = "all" } = {}) => {
  const selectedScope = String(scope || "all").toLowerCase();
  const root = guidanceWorkspaceRoot(workspace);
  if (selectedScope === "project" && !root) return { error: "Open a project before managing project guidance", code: "WORKSPACE_REQUIRED" };
  return { ok: true, entries: listGuidanceEntries({ workspace: root || "", globalRoot: globalGuidanceRoot(), scope: selectedScope }) };
});

ipcMain.handle("guidance:read", async (_event, { workspace, relativePath, scope = "project" } = {}) => {
  const resolved = resolveGuidanceTarget(workspace, relativePath, scope);
  if (resolved.error) return resolved;
  try {
    if (!fs.existsSync(resolved.target) || !fs.statSync(resolved.target).isFile()) return { error: "Guidance file not found", code: "GUIDANCE_NOT_FOUND" };
  } catch {
    return { error: "Guidance file not found", code: "GUIDANCE_NOT_FOUND" };
  }
  const content = readGuidanceEntry(resolved.scope === "project" ? resolved.root : "", { relativePath: resolved.normalized, scope: resolved.scope }, { globalRoot: globalGuidanceRoot() });
  return content == null
    ? { error: "Guidance file could not be read", code: "GUIDANCE_READ_FAILED" }
    : { ok: true, content, path: resolved.target, relativePath: resolved.normalized, kind: resolved.kind, scope: resolved.scope };
});

ipcMain.handle("guidance:context", async (_event, { workspace } = {}) => {
  const root = guidanceWorkspaceRoot(workspace);
  return { ok: true, context: formatWorkspaceGuidance(root || "", undefined, { globalRoot: globalGuidanceRoot() }) };
});

ipcMain.handle("guidance:save", async (_event, { workspace, relativePath, content = "", scope = "project" } = {}) => {
  const resolved = resolveGuidanceTarget(workspace, relativePath, scope);
  if (resolved.error) return resolved;
  const value = String(content);
  if (Buffer.byteLength(value, "utf8") > MAX_GUIDANCE_FILE_BYTES) return { error: "Guidance files are limited to 100 KB", code: "GUIDANCE_TOO_LARGE" };
  try {
    if (fs.existsSync(resolved.target) && !fs.statSync(resolved.target).isFile()) return { error: "A folder already exists at that path", code: "GUIDANCE_PATH_CONFLICT" };
    fs.mkdirSync(path.join(resolved.root, ".xekute"), { recursive: true });
    fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
    fs.writeFileSync(resolved.target, value, "utf8");
    return { ok: true, relativePath: resolved.normalized, kind: resolved.kind, scope: resolved.scope };
  } catch (error) {
    return { error: error.message, code: "GUIDANCE_WRITE_FAILED" };
  }
});

ipcMain.handle("guidance:import", async (_event, { workspace, kind, scope = "project" } = {}) => {
  const selectedScope = String(scope || "project").toLowerCase() === "global" ? "global" : "project";
  const root = selectedScope === "global" ? globalGuidanceRoot() : guidanceWorkspaceRoot(workspace);
  if (!root) return { error: "Open a project before importing project guidance", code: "WORKSPACE_REQUIRED" };
  const selectedKind = normalizeGuidanceKind(kind);
  const picked = await dialog.showOpenDialog(getMainWindow(), {
    title: `Import ${selectedKind.slice(0, -1)} guidance`,
    buttonLabel: "Import guidance",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Guidance files", extensions: ["md", "markdown", "txt", "yaml", "yml", "json"] }],
  });
  if (picked.canceled || !picked.filePaths?.length) return { canceled: true };
  const imported = [];
  try {
    for (const source of picked.filePaths.slice(0, 20)) {
      const stat = fs.statSync(source);
      const extension = path.extname(source).toLowerCase();
      if (!stat.isFile() || stat.size > MAX_GUIDANCE_FILE_BYTES || !GUIDANCE_EXTENSIONS.has(extension)) continue;
      const original = path.basename(source).replace(/[<>:"|?*\x00-\x1f]/g, "_");
      const baseName = original || `guidance-${Date.now()}.md`;
      let candidate = path.posix.join(".xekute", selectedKind, baseName);
      let target = path.resolve(root, ...candidate.split("/"));
      let suffix = 2;
      while (fs.existsSync(target)) {
        const parsed = path.parse(baseName);
        candidate = path.posix.join(".xekute", selectedKind, `${parsed.name}-${suffix}${parsed.ext}`);
        target = path.resolve(root, ...candidate.split("/"));
        suffix += 1;
      }
      const validated = validateGuidancePath(candidate);
      if (validated.error) continue;
      if (guidancePathHasSymlink(root, target)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
      imported.push(validated.normalized);
    }
    return { ok: true, paths: imported, entries: listGuidanceEntries({ workspace: selectedScope === "project" ? root : "", globalRoot: globalGuidanceRoot(), scope: selectedScope }) };
  } catch (error) {
    return { error: error.message, code: "GUIDANCE_IMPORT_FAILED" };
  }
});

ipcMain.handle("guidance:delete", async (_event, { workspace, relativePath, scope = "project" } = {}) => {
  const resolved = resolveGuidanceTarget(workspace, relativePath, scope);
  if (resolved.error) return resolved;
  try {
    if (!fs.existsSync(resolved.target)) return { error: "Guidance file not found", code: "GUIDANCE_NOT_FOUND" };
    if (!fs.statSync(resolved.target).isFile()) return { error: "Only guidance files can be deleted here", code: "GUIDANCE_NOT_FILE" };
    fs.unlinkSync(resolved.target);
    return { ok: true, relativePath: resolved.normalized, scope: resolved.scope };
  } catch (error) {
    return { error: error.message, code: "GUIDANCE_DELETE_FAILED" };
  }
});

ipcMain.handle("mcp:read", async (_event, { workspace = "" } = {}) => mcpConfig.read(workspace));

ipcMain.handle("mcp:ensure", async (_event, { workspace = "", scope = "global" } = {}) => mcpConfig.ensure(scope, workspace));

ipcMain.handle("kali-access:pickIdentity", async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "Select SSH private key",
    defaultPath: path.join(app.getPath("home"), ".ssh"),
    properties: ["openFile"],
    filters: [{ name: "SSH private keys", extensions: ["pem", "key"] }, { name: "All files", extensions: ["*"] }],
  });
  return result.canceled || !result.filePaths?.[0] ? { canceled: true } : { ok: true, filePath: result.filePaths[0] };
});

ipcMain.handle("kali-access:get", async () => kaliAccess.read());

ipcMain.handle("kali-access:save", async (_event, payload = {}) => {
  const result = kaliAccess.save(payload);
  if (result.ok) container.mcpRuntime?.clearAll?.();
  return result;
});

ipcMain.handle("kali-access:test", async (_event, payload = {}) => kaliAccess.test(payload));

ipcMain.handle("assessment:customEntries", async (_event, { path: assessmentPath } = {}) => {
  const verification = assessmentWorkspace.verify(assessmentPath);
  if (verification.error) return verification;
  const walk = (folder, prefix = "", source = "custom") => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) return [{ name: entry.name, relativePath, type: "directory", source }, ...walk(path.join(folder, entry.name), relativePath, source)];
    return [{ name: entry.name, relativePath, type: "file", source }];
  });
  try {
    const custom = walk(path.join(verification.root, "custom"));
    const tools = walk(path.join(verification.root, "tools"), "", "tools");
    return { ok: true, entries: [...custom, ...tools].slice(0, 500) };
  } catch (error) { return { error: error.message }; }
});

ipcMain.handle("assessment:createEntry", async (_event, { path: assessmentPath, relativePath, type = "file", content = "" } = {}) => {
  const verification = assessmentWorkspace.verify(assessmentPath);
  if (verification.error) return verification;
  const validated = validateCustomEntryPath(relativePath);
  if (validated.error) return validated;
  if (!['file', 'directory'].includes(type)) return { error: "Unsupported custom entry type", code: "INVALID_ENTRY_TYPE" };
  const target = safeAssessmentChild(verification.root, validated.normalized);
  if (!target || !path.relative(verification.root, target).replace(/\\/g, "/").startsWith("custom/")) return { error: "Custom entries must stay inside Custom" };
  try {
    if (fs.existsSync(target)) return { error: "That name already exists" };
    if (type === "directory") fs.mkdirSync(target, { recursive: true });
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, String(content), "utf8"); }
    return { ok: true, path: target };
  } catch (error) { return { error: error.message }; }
});

ipcMain.handle("assessment:deleteEntries", async (_event, { path: assessmentPath, relativePaths = [] } = {}) => {
  return assessmentWorkspace.deleteCustomEntries(assessmentPath, relativePaths);
});

ipcMain.handle("assessment:buildContext", async (_event, { path: assessmentPath } = {}) => {
  const verification = assessmentWorkspace.verify(assessmentPath);
  if (verification.error) return verification;
  const picked = await dialog.showOpenDialog(getMainWindow(), { title: "Add Context Files", buttonLabel: "Build pen_context.md", properties: ["openFile", "multiSelections"] });
  if (picked.canceled || !picked.filePaths.length) return { canceled: true };
  const output = path.join(verification.root, "pen_context.md");
  const sourceRoot = path.join(verification.root, "context", "sources");
  const imported = picked.filePaths.map((source, index) => {
    const safeName = path.basename(source).replace(/[^\w.() -]/g, "_");
    let target = path.join(sourceRoot, safeName);
    if (fs.existsSync(target)) target = path.join(sourceRoot, `${path.parse(safeName).name}-${Date.now()}-${index}${path.extname(safeName)}`);
    fs.copyFileSync(source, target);
    return target;
  });
  try {
    const details = buildContext({ output, files: imported });
    return { ok: true, path: output, ...details };
  } catch (error) {
    return { error: error.message || "Context extraction failed", code: "CONTEXT_BUILD_FAILED" };
  }
});

ipcMain.handle("security:httpRequest", async (_event, payload = {}) => {
  const project = readProjectProfile(payload.assessmentPath);
  return securityHttpWorkbench.run({
    ...payload,
    projectProfile: project?.profile || null,
    runtimeSettings: effectiveOperatorRuntimeSettings(payload.assessmentPath),
  });
});

ipcMain.handle("security:buildIntruder", async (_event, payload = {}) => {
  const maxRequests = Math.max(1, Math.min(Number(payload.maxRequests) || 25, 25));
  return buildIntruderRequests(payload.rawRequest, payload.payloadSets, payload.attackType, maxRequests);
});

ipcMain.handle("proxy:configure", async (_event, { assessmentPath } = {}) => {
  const browserStatus = container.proxyBrowser.status();
  if (browserStatus.running && (!assessmentPath || path.resolve(browserStatus.workspace) !== path.resolve(assessmentPath))) {
    await container.proxyBrowser.close(browserStatus.workspace);
  }
  const project = readProjectProfile(assessmentPath);
  const result = await proxyListener.configure(assessmentPath, {
    settings: assessmentPath ? effectiveOperatorRuntimeSettings(assessmentPath) : null,
    targets: project?.profile?.scope?.inScopeTargets || null,
  });
  if (!result?.running && assessmentPath) await container.proxyBrowser.close(assessmentPath);
  return result;
});

ipcMain.handle("proxy:status", async () => proxyListener.getStatus());

ipcMain.handle("proxy:browserLaunch", async (_event, { assessmentPath = "", identityId = "" } = {}) => {
  if (!assessmentPath) return { ok: false, error: { code: "PROXY_BROWSER_PROJECT_REQUIRED", message: "Open a project before launching the proxied browser.", retryable: false } };
  const resolvedProject = path.resolve(assessmentPath);
  let proxyStatus = proxyListener.getStatus();
  const sameProject = proxyStatus.running && proxyStatus.assessmentPath && path.resolve(proxyStatus.assessmentPath) === resolvedProject;
  if (sameProject && proxyStatus.error) proxyStatus = proxyListener.clearError();
  if (!sameProject) {
    const settings = JSON.parse(JSON.stringify(effectiveOperatorRuntimeSettings(assessmentPath) || {}));
    settings.listener = { ...(settings.listener || {}), enabled: true };
    const project = readProjectProfile(assessmentPath);
    proxyStatus = await proxyListener.configure(assessmentPath, {
      settings,
      targets: project?.profile?.scope?.inScopeTargets || null,
    });
  }
  if (!proxyStatus?.running) {
    return { ok: false, error: { code: proxyStatus?.code || "PROXY_BROWSER_PROXY_NOT_RUNNING", message: proxyStatus?.error || "The XEKUTE proxy listener could not be started.", retryable: false } };
  }
  let identity = null;
  if (identityId) {
    const snapshot = identityStatusSnapshot(assessmentPath);
    if (snapshot?.ok === false) return snapshot;
    const selected = (snapshot.identities || []).find((item) => item.identityId === identityId);
    if (!selected) return { ok: false, error: { code: "PROXY_BROWSER_IDENTITY_NOT_FOUND", message: "The selected browser identity no longer exists.", retryable: false } };
    identity = { id: selected.identityId, label: selected.displayName || selected.identityId, role: selected.role || "user" };
  }
  const captureIdentity = identity || { id: "anonymous", label: "Anonymous", role: "anonymous" };
  const existingBrowser = container.proxyBrowser.status(assessmentPath, captureIdentity.id);
  if (existingBrowser?.running) {
    const reopened = await container.proxyBrowser.launch({
      workspace: assessmentPath,
      proxy: proxyStatus,
      caCertPath: proxyStatus.caCertPath,
      identity: captureIdentity,
    });
    return reopened?.ok === false ? reopened : { ...reopened, proxy: proxyStatus };
  }
  const captureToken = crypto.randomUUID();
  const registered = proxyListener.registerCaptureContext(captureToken, captureIdentity);
  if (registered?.ok === false) return registered;
  const launched = await container.proxyBrowser.launch({
    workspace: assessmentPath,
    proxy: proxyStatus,
    caCertPath: proxyStatus.caCertPath,
    identity: captureIdentity,
    captureToken,
  });
  if (launched?.ok === false) proxyListener.unregisterCaptureContext(captureToken);
  return launched?.ok === false ? launched : { ...launched, proxy: proxyStatus };
});

ipcMain.handle("proxy:browserStatus", async (_event, { assessmentPath = "", identityId = "" } = {}) => container.proxyBrowser.status(assessmentPath, identityId));

ipcMain.handle("proxy:forward", async (_event, { id, request } = {}) => {
  return proxyListener.forward(id, request);
});

ipcMain.handle("proxy:drop", async (_event, { id } = {}) => proxyListener.drop(id));

ipcMain.handle("proxy:showCa", async () => {
  const caCertPath = proxyListener.getStatus().caCertPath;
  if (!caCertPath || !fs.existsSync(caCertPath)) return { error: "Proxy CA certificate has not been generated yet" };
  shell.showItemInFolder(caCertPath);
  return { ok: true, path: caCertPath };
});

ipcMain.handle("settings:certificatesGet", async () => certificateSettingsSnapshot());

ipcMain.handle("settings:certificatesChoose", async (_event, { assessmentPath = "" } = {}) => {
  const current = configuredCentralCaDirectory();
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: "Choose XEKUTE CA storage folder",
    defaultPath: current,
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Use this folder",
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true, ...certificateSettingsSnapshot() };
  const selected = path.resolve(result.filePaths[0]);
  fs.mkdirSync(selected, { recursive: true, mode: 0o700 });
  const preferences = readApplicationPreferences();
  preferences.certificates = { ...(preferences.certificates || {}), caDirectory: selected };
  writeApplicationPreferences(preferences);
  await proxyListener.stop();
  if (assessmentPath) {
    const project = readProjectProfile(assessmentPath);
    await proxyListener.configure(assessmentPath, {
      settings: effectiveProjectRuntimeSettings(assessmentPath),
      targets: project?.profile?.scope?.inScopeTargets || null,
    });
  }
  return certificateSettingsSnapshot();
});

ipcMain.handle("settings:certificatesReset", async (_event, { assessmentPath = "" } = {}) => {
  const preferences = readApplicationPreferences();
  preferences.certificates = { ...(preferences.certificates || {}), caDirectory: "" };
  writeApplicationPreferences(preferences);
  await proxyListener.stop();
  if (assessmentPath) {
    const project = readProjectProfile(assessmentPath);
    await proxyListener.configure(assessmentPath, {
      settings: effectiveProjectRuntimeSettings(assessmentPath),
      targets: project?.profile?.scope?.inScopeTargets || null,
    });
  }
  return certificateSettingsSnapshot();
});

ipcMain.handle("settings:certificatesShow", async () => {
  const snapshot = certificateSettingsSnapshot();
  fs.mkdirSync(snapshot.directory, { recursive: true, mode: 0o700 });
  const error = await shell.openPath(snapshot.directory);
  return error ? { error, code: "CA_DIRECTORY_OPEN_FAILED" } : snapshot;
});

function identityStatusSnapshot(workspace = "") {
  const vault = container.identityVault?.();
  if (!vault || !workspace) return { ok: false, error: "A project workspace is required.", code: "IDENTITY_PROJECT_REQUIRED" };
  const migration = vault.migrateLegacy?.(workspace);
  const listed = vault.list(workspace);
  const credentialed = vault.listCredentials?.(workspace) || { ok: true, value: { credentials: [], count: 0, secureStorageAvailable: false } };
  const runtime = container.browserSessionManager?.runtime?.() || { name: "none", executablePath: "" };
  const persistence = container.browserSessionManager?.persistenceStatus?.(workspace) || { ok: true, pending: 0, warnings: [] };
  const listedValue = listed?.value || {};
  if (listed?.ok === false) {
    return {
      ok: false,
      error: listed.error?.message || listed.error || "Identity vault is unavailable.",
      code: listed.error?.code || "IDENTITY_VAULT_UNAVAILABLE",
      runtime: { name: runtime.name || "none", available: runtime.name !== "none", activeContexts: container.browserSessionManager?.activeContexts?.() || 0, activeLogins: container.browserSessionManager?.activeLogins?.() || 0 },
      credentials: [],
      credentialCount: 0,
      credentialsError: credentialed?.ok === false ? { code: credentialed.error?.code, message: credentialed.error?.message } : null,
      persistence,
    };
  }
  return {
    ok: true,
    identities: Array.isArray(listedValue.identities) ? listedValue.identities.map((identity) => ({
      ...identity,
      activePageCount: container.browserSessionManager?.activePages?.(workspace, identity.identityId) || 0,
    })) : [],
    count: Number(listedValue.count) || 0,
    activeId: listedValue.activeId || null,
    secureStorageAvailable: Boolean(listedValue.secureStorageAvailable),
    credentials: Array.isArray(credentialed?.value?.credentials) ? credentialed.value.credentials : [],
    credentialCount: Number(credentialed?.value?.count) || 0,
    credentialsError: credentialed?.ok === false ? { code: credentialed.error?.code, message: credentialed.error?.message } : null,
    migration: migration?.ok === false ? { ok: false, code: migration.error?.code, message: migration.error?.message } : migration,
    runtime: { name: runtime.name || "none", available: runtime.name !== "none", activeContexts: container.browserSessionManager?.activeContexts?.() || 0, activeLogins: container.browserSessionManager?.activeLogins?.() || 0 },
    persistence,
  };
}

function emitIdentityStatus(workspace = "") {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) window.webContents.send("identity:status", identityStatusSnapshot(workspace));
}

ipcMain.handle("settings:identitiesGet", async (_event, { workspace = "" } = {}) => identityStatusSnapshot(workspace));
ipcMain.handle("settings:identityStatus", async (_event, { workspace = "" } = {}) => identityStatusSnapshot(workspace));
ipcMain.handle("settings:credentialsGet", async (_event, { workspace = "" } = {}) => {
  const snapshot = identityStatusSnapshot(workspace);
  if (snapshot?.ok === false) return snapshot;
  if (snapshot.credentialsError) {
    return {
      ok: false,
      error: {
        code: snapshot.credentialsError.code || "CREDENTIAL_VAULT_UNAVAILABLE",
        message: snapshot.credentialsError.message || "Encrypted test credentials are unavailable.",
        retryable: false,
      },
    };
  }
  return {
    ok: true,
    credentials: snapshot.credentials || [],
    count: snapshot.credentialCount || 0,
    secureStorageAvailable: Boolean(snapshot.secureStorageAvailable),
  };
});
ipcMain.handle("settings:identityRuntime", async () => {
  const runtime = container.browserSessionManager?.runtime?.() || { name: "none", executablePath: "" };
  return { ok: true, runtime: { name: runtime.name || "none", available: runtime.name !== "none", executablePath: runtime.executablePath || "" } };
});
ipcMain.handle("settings:identityCreate", async (_event, { workspace = "", identity = {} } = {}) => {
  const result = container.identityVault?.().create(workspace, identity) || { ok: false, error: "Identity vault is unavailable.", code: "IDENTITY_VAULT_UNAVAILABLE" };
  if (result.ok) emitIdentityStatus(workspace);
  return result;
});
ipcMain.handle("settings:identityUpdate", async (_event, { workspace = "", identityId = "", patch = {} } = {}) => {
  const result = container.identityVault?.().update(workspace, identityId, patch) || { ok: false, error: "Identity vault is unavailable.", code: "IDENTITY_VAULT_UNAVAILABLE" };
  if (result.ok) emitIdentityStatus(workspace);
  return result;
});
ipcMain.handle("settings:identityDelete", async (_event, { workspace = "", identityId = "" } = {}) => {
  await container.browserSessionManager?.closeIdentity?.(workspace, identityId);
  await container.proxyBrowser?.close?.(workspace, identityId);
  clearBrowserIdentityTargets(workspace, identityId);
  const result = container.identityVault?.().remove(workspace, identityId) || { ok: false, error: "Identity vault is unavailable.", code: "IDENTITY_VAULT_UNAVAILABLE" };
  if (result.ok) emitIdentityStatus(workspace);
  return result;
});
ipcMain.handle("settings:identityLoginStart", async (_event, { workspace = "", identityId = "", url = "" } = {}) => {
  const result = await container.browserSessionManager?.startLogin?.({ workspace, identityId, url });
  if (result?.ok) emitIdentityStatus(workspace);
  return result || { ok: false, error: "Browser session manager is unavailable.", code: "BROWSER_MANAGER_UNAVAILABLE" };
});
ipcMain.handle("settings:identityLoginSave", async (_event, { workspace = "", identityId = "" } = {}) => {
  const result = await container.browserSessionManager?.saveLogin?.({ workspace, identityId });
  if (result?.ok) {
    clearBrowserIdentityTargets(workspace, identityId);
    emitIdentityStatus(workspace);
  }
  return result || { ok: false, error: "Browser session manager is unavailable.", code: "BROWSER_MANAGER_UNAVAILABLE" };
});
ipcMain.handle("settings:identityLoginCancel", async (_event, { workspace = "", identityId = "" } = {}) => {
  const result = await container.browserSessionManager?.cancelLogin?.({ workspace, identityId });
  if (result?.ok) emitIdentityStatus(workspace);
  return result || { ok: false, error: "Browser session manager is unavailable.", code: "BROWSER_MANAGER_UNAVAILABLE" };
});
ipcMain.handle("settings:identityImport", async (_event, { workspace = "", identityId = "", format = "", data = null } = {}) => {
  let imported = data;
  if (["storage_state_file", "cookies_file"].includes(format)) {
    const picked = await dialog.showOpenDialog(getMainWindow(), { title: "Import authenticated browser state", properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
    if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
    try {
      const stat = fs.statSync(picked.filePaths[0]);
      if (stat.size > 4 * 1024 * 1024) return { ok: false, error: { code: "IDENTITY_IMPORT_TOO_LARGE", message: "Authentication state files must be 4 MB or smaller.", retryable: false } };
      imported = JSON.parse(fs.readFileSync(picked.filePaths[0], "utf8"));
    }
    catch (error) { return { ok: false, error: { code: "IDENTITY_IMPORT_INVALID_JSON", message: error.message, retryable: false } }; }
  }
  try {
    const secret = format === "headers" ? { headerBindings: imported } : format === "cookies" || format === "cookies_file" ? { cookies: imported } : { storageState: imported };
    // A live headless context may contain older authentication state. Close it
    // without persisting before replacing the vault record, otherwise its
    // final state can overwrite a successful import.
    await container.browserSessionManager?.closeIdentity?.(workspace, identityId, { persist: false });
    // The closed context can no longer service follow-up browser actions,
    // regardless of whether secure storage accepts the replacement.
    clearBrowserIdentityTargets(workspace, identityId);
    const vault = container.identityVault?.();
    const result = await (vault?.saveSecretAsync?.(workspace, identityId, secret) || Promise.resolve(vault?.saveSecret?.(workspace, identityId, secret))) || { ok: false, error: "Identity vault is unavailable.", code: "IDENTITY_VAULT_UNAVAILABLE" };
    if (result.ok) {
      emitIdentityStatus(workspace);
    }
    return result;
  } finally {
    // Do not retain imported header/cookie objects in the handler closure after
    // the vault has accepted or rejected them.
    imported = null;
    data = null;
  }
});
ipcMain.handle("settings:credentialCreate", async (_event, { workspace = "", credential = {} } = {}) => {
  let input = credential && typeof credential === "object" ? {
    credentialId: credential.credentialId,
    label: credential.label,
    username: credential.username,
    password: credential.password,
    role: credential.role,
    notes: credential.notes,
  } : {};
  try {
    const result = container.identityVault?.().createCredential(workspace, input) || { ok: false, error: "Identity vault is unavailable.", code: "IDENTITY_VAULT_UNAVAILABLE" };
    if (result.ok) emitIdentityStatus(workspace);
    return result;
  } finally {
    if (credential && typeof credential === "object") credential.password = "";
    if (input) input.password = "";
    input = null;
  }
});
ipcMain.handle("settings:credentialSave", async (_event, { workspace = "", credential = {} } = {}) => {
  let input = credential && typeof credential === "object" ? {
    credentialId: credential.credentialId,
    label: credential.label,
    username: credential.username,
    password: credential.password,
    role: credential.role,
    cookie: credential.cookie,
  } : {};
  try {
    const result = container.identityVault?.().saveCredential(workspace, input) || { ok: false, error: "Identity vault is unavailable.", code: "IDENTITY_VAULT_UNAVAILABLE" };
    if (result.ok) emitIdentityStatus(workspace);
    return result;
  } finally {
    if (credential && typeof credential === "object") {
      credential.password = "";
      credential.cookie = "";
    }
    if (input) {
      input.password = "";
      input.cookie = "";
    }
    input = null;
  }
});
ipcMain.handle("settings:credentialDelete", async (_event, { workspace = "", credentialId = "" } = {}) => {
  const result = container.identityVault?.().removeCredential(workspace, credentialId) || { ok: false, error: "Identity vault is unavailable.", code: "IDENTITY_VAULT_UNAVAILABLE" };
  if (result.ok) emitIdentityStatus(workspace);
  return result;
});

ipcMain.handle("settings:llmGet", async () => llmSettingsSnapshot());
ipcMain.handle("settings:llmSet", async (_event, payload = {}) => { try { return saveLlmSettings(payload); } catch (error) { return { error: error.message || "Invalid LLM settings.", code: "LLM_SETTINGS_INVALID" }; } });
ipcMain.handle("settings:llmTest", async () => {
  if (getActiveProvider() === "openrouter") {
    try { const response = await openRouterFetch("/models"); const data = await response.json(); return response.ok ? { ok: true, provider: "openrouter", modelCount: Array.isArray(data?.data) ? data.data.length : 0 } : { error: data?.error?.message || `OpenRouter error: ${response.status}`, code: "OPENROUTER_TEST_FAILED" }; }
    catch (error) { return { error: error.message, code: error.code || "OPENROUTER_TEST_FAILED" }; }
  }
  const baseUrl = getOllamaBaseUrl();
  try { const { res, data } = await fetchOllamaTags(baseUrl); return res.ok ? { ok: true, provider: "ollama", modelCount: parseOllamaTags(data).length } : { error: data?.error || `Ollama API error (${res.status})`, code: "OLLAMA_TEST_FAILED" }; }
  catch (error) { return { error: error?.message || "Cannot reach Ollama.", code: "OLLAMA_TEST_FAILED" }; }
});

ipcMain.handle("settings:ollamaGet", async () => ollamaSettingsSnapshot());

ipcMain.handle("settings:ollamaSet", async (_event, { host = "" } = {}) => {
  const preferences = readApplicationPreferences();
  const trimmed = String(host || "").trim();
  if (!trimmed) {
    preferences.ollama = { ...(preferences.ollama || {}), host: "" };
    writeApplicationPreferences(preferences);
    return ollamaSettingsSnapshot();
  }
  try {
    const normalized = normalizeOllamaHostInput(trimmed);
    preferences.ollama = { ...(preferences.ollama || {}), host: normalized };
    writeApplicationPreferences(preferences);
    return ollamaSettingsSnapshot();
  } catch (err) {
    return { error: err.message || "Invalid Ollama host URL.", code: "OLLAMA_HOST_INVALID" };
  }
});

ipcMain.handle("settings:ollamaTest", async () => {
  const baseUrl = getOllamaBaseUrl();
  try {
    const { res, data } = await fetchOllamaTags(baseUrl);
    if (!res.ok) return { error: data?.error || `Ollama API error (${res.status})`, code: "OLLAMA_TEST_FAILED" };
    const models = parseOllamaTags(data);
    return { ok: true, host: ollamaHostLabel(baseUrl), models, modelCount: models.length };
  } catch (err) {
    return {
      error: err?.name === "AbortError" ? "Ollama API timed out." : (err?.message || "Cannot reach Ollama API."),
      code: "OLLAMA_TEST_FAILED",
    };
  }
});

ipcMain.handle("workspace:watch", async (event, workspace) => {
  return startWorkspaceWatch(event.sender, workspace);
});

ipcMain.handle("workspace:unwatch", async (event) => {
  stopWorkspaceWatch(event.sender.id);
  return { ok: true };
});

// â”€â”€ Tools IPC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
}

module.exports = Object.freeze({
  MAX_EDITABLE_FILE_BYTES,
  channels: Object.freeze([
    "fs:openFolder", "fs:openFile", "fs:readdir", "fs:readFile", "fs:writeFile", "fs:mkdir",
    "fs:deletePath", "fs:copyPath", "fs:movePath", "project:create", "project-profile:get",
    "project-profile:save", "workspace:watch", "workspace:unwatch", "workspace:changed",
    "guidance:entries", "guidance:read", "guidance:context", "guidance:save", "guidance:import",
    "guidance:delete", "mcp:read", "mcp:ensure",
    "kali-access:get", "kali-access:save", "kali-access:test", "kali-access:pickIdentity", "clipboard:writeText",
    "assessment:create", "assessment:open", "assessment:verify", "assessment:repair",
    "assessment:trafficLog", "assessment:trafficHistory", "assessment:evidence",
    "assessment:appendEvidence", "assessment:appendFinding", "assessment:createRun",
    "assessment:updateRun", "assessment:generateReport", "assessment:runHistory",
    "assessment:deleteTrafficRecords", "assessment:map", "assessment:buildMap", "assessment:deepCollectGraph", "assessment:graphStatus",
    "assessment:mapOverview", "assessment:mapNode", "assessment:mapNeighbors", "assessment:mapPaths",
    "assessment:mapRoutes", "assessment:mapSharedObjects", "assessment:mapEvidence",
    "assessment:mapHypotheses", "assessment:mapAnnotateFinding", "assessment:settings",
    "assessment:intelligenceStatus", "assessment:intelligenceStart", "assessment:intelligencePause",
    "assessment:intelligenceResume", "assessment:intelligenceRebuild", "assessment:intelligenceQuery",
    "assessment:intelligenceExpand", "assessment:intelligence",
    "assessment:writeSettings", "assessment:customEntries", "assessment:createEntry",
    "assessment:deleteEntries", "assessment:buildContext",
    "session-memory:load", "session-memory:begin", "session-memory:event", "session-memory:update",
    "session-memory:close", "session-memory:reopen", "session-memory:archive", "session-memory:unarchive",
    "session-memory:flush", "session-memory:save-before-close", "session-memory:delete",
    "context:projectMemory", "context:consolidate", "context:event", "context:flush",
    "security:httpRequest", "security:buildIntruder", "proxy:configure", "proxy:status",
    "proxy:forward", "proxy:drop", "proxy:showCa", "proxy:browserLaunch", "proxy:browserStatus", "webclone:build", "webclone:manifest",
    "webclone:readFile", "webclone:previewDocument", "webclone:previewBounds", "webclone:hidePreview",
    "settings:certificatesGet", "settings:certificatesChoose", "settings:certificatesReset",
    "settings:certificatesShow", "settings:llmGet", "settings:llmSet", "settings:llmTest",
    "settings:ollamaGet", "settings:ollamaSet", "settings:ollamaTest",
    "settings:identitiesGet", "settings:identityCreate", "settings:identityUpdate",
    "settings:identityDelete", "settings:identityLoginStart", "settings:identityLoginSave",
    "settings:identityLoginCancel", "settings:identityImport", "settings:identityRuntime",
    "settings:identityStatus", "settings:credentialsGet", "settings:credentialCreate", "settings:credentialSave", "settings:credentialDelete",
  ]),
  registerProjectIpc,
});
