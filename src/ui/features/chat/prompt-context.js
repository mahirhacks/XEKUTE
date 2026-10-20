import { openTabs, commitActiveTab } from "../../bootstrap.js";
import { AUTO_CONTEXT_ESTIMATE } from "../models/model-settings.js";
import { appState } from "../../core/app-state.js";
import { relativePathFromRoot, joinWorkspacePath } from "../../core/workspace-paths.js";
import { splitFileTags } from "./file-tags.js";

export function buildProjectContextMessage({
  dirMap = "",
  activeFile = null,
  extraFiles = [],
  contextBudget = AUTO_CONTEXT_ESTIMATE,
} = {}) {
  const parts = [];
  const fileLimit = contextBudget <= 4096 ? 32 : contextBudget <= 8192 ? 56 : contextBudget <= 16384 ? 100 : 180;
  const embeddedLimit = contextBudget <= 4096 ? 4200 : contextBudget <= 8192 ? 8000 : contextBudget <= 16384 ? 16000 : 28000;

  if (dirMap) {
    const files = ToolParser.parseProjectFiles(dirMap);
    if (files.length) {
      const shown = files.slice(0, fileLimit);
      const omitted = files.length > shown.length ? `\n- ... ${files.length - shown.length} more files omitted` : "";
      parts.push(`Project files:\n${shown.map((file) => `- ${file}`).join("\n")}${omitted}`);
    }
  }

  const shown = new Set();
  let remainingChars = embeddedLimit;
  for (const file of [activeFile, ...extraFiles]) {
    if (!file?.path || file.content == null) continue;
    const norm = file.path.replace(/\\/g, "/");
    if (shown.has(norm)) continue;
    if (remainingChars < 600) break;
    shown.add(norm);
    const allowance = Math.min(remainingChars, contextBudget <= 4096 ? 3200 : 6000);
    const content = String(file.content);
    const snippet = content.length > allowance
      ? `${content.slice(0, Math.floor(allowance * 0.7))}\n...(truncated)...\n${content.slice(-Math.ceil(allowance * 0.3))}`
      : content;
    remainingChars -= snippet.length;
    const label = file === activeFile ? "Currently open" : "File contents";
    parts.push(`${label} - ${file.path}:\n\`\`\`\n${snippet}\n\`\`\``);
  }

  return parts.join("\n\n");
}

export async function refreshDirMap() {
  const requestGeneration = ++appState.dirMapRequestGeneration;
  const requestedWorkspace = appState.rootPath;
  if (!requestedWorkspace) {
    appState.dirMapCache = "";
    return;
  }
  const result = await window.api.dirMap(requestedWorkspace);
  if (appState.rootPath !== requestedWorkspace || requestGeneration !== appState.dirMapRequestGeneration) return;
  appState.dirMapCache = result.map || "";
}

export function getActiveFileContext() {
  if (!appState.activeTabPath || !openTabs.has(appState.activeTabPath)) return null;
  commitActiveTab();
  const tab = openTabs.get(appState.activeTabPath);
  const rel = relativePathFromRoot(tab.path);
  if (!rel) return null;
  return { path: rel, content: tab.content ?? "" };
}

export async function readWorkspaceFile(relPath) {
  const result = await window.api.readFile(joinWorkspacePath(relPath));
  if (result.error || result.content == null) return null;
  return { path: relPath, content: result.content };
}

/** Load contents of project files mentioned in the user message (small models can't read minds). */
export async function collectMentionedFiles(userMessage) {
  const files = [];
  if (!appState.rootPath || !appState.dirMapCache) return files;

  const projectFiles = ToolParser.parseProjectFiles(appState.dirMapCache);
  const activePath = getActiveFileContext()?.path;
  const parts = splitFileTags(userMessage);
  const taggedPaths = [...new Set(parts.filter(part => part.path).map(part => part.path))];
  const projectPaths = new Set(projectFiles);
  for (const rel of taggedPaths) {
    if (rel === activePath || !projectPaths.has(rel)) continue;
    const file = await readWorkspaceFile(rel);
    if (file) files.push(file);
  }
  const msg = parts.map(part => part.text || "").join(" ").toLowerCase();

  for (const rel of projectFiles) {
    if (files.length >= 3) break;
    if (rel === activePath || taggedPaths.includes(rel)) continue;
    const base = rel.split("/").pop().toLowerCase();
    if (!msg.includes(base) && !msg.includes(rel.toLowerCase())) continue;
    const file = await readWorkspaceFile(rel);
    if (file) files.push(file);
  }

  // Single-file project: always show it so the model can patch correctly.
  if (!files.length && !taggedPaths.length && projectFiles.length === 1 && projectFiles[0] !== activePath) {
    const file = await readWorkspaceFile(projectFiles[0]);
    if (file) files.push(file);
  }

  return files;
}
