import { explorerPathKey } from "../bootstrap.js";
import { appState } from "./app-state.js";

export function normPath(p) {
  return p.replace(/\\/g, "/");
}

export function basenameOf(filePath) {
  return String(filePath || "").replace(/\\/g, "/").split("/").pop() || "";
}

export function workspaceParentRelative(relativePath) {
  const normalized = normPath(relativePath || "").replace(/^\/+|\/+$/g, "");
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
}

export function remapWorkspacePath(pathValue, sourceAbsolute, destinationAbsolute) {
  const value = normPath(pathValue || "");
  const source = normPath(sourceAbsolute || "");
  const destination = normPath(destinationAbsolute || "");
  if (value === source) return destination;
  return value.startsWith(`${source}/`) ? `${destination}${value.slice(source.length)}` : value;
}

export function pathIsAtOrUnder(candidatePath, parentPath) {
  const candidate = explorerPathKey(candidatePath);
  const parent = explorerPathKey(parentPath);
  return Boolean(parent) && (candidate === parent || candidate.startsWith(`${parent}/`));
}

export function relativePathFromRoot(absPath) {
  if (!appState.rootPath || !absPath) return null;
  const root = normPath(appState.rootPath).replace(/\/$/, "");
  const file = normPath(absPath);
  const caseInsensitive = root.includes("\\") || /^[a-zA-Z]:/.test(root);
  if (caseInsensitive) {
    if (file.toLowerCase() === root.toLowerCase()) return "";
    const prefix = `${root.toLowerCase()}/`;
    if (!file.toLowerCase().startsWith(prefix)) return null;
  } else {
    if (file === root) return "";
    if (!file.startsWith(`${root}/`)) return null;
  }
  return file.slice(root.length + 1);
}

export function joinWorkspacePath(relPath) {
  if (!appState.rootPath) return relPath;
  const sep = appState.rootPath.includes("\\") ? "\\" : "/";
  return appState.rootPath + sep + relPath.replace(/[/\\]/g, sep);
}
