import { appState } from "../../core/app-state.js";
import {
  webcloneFileList, webcloneFileCount, webclonePreviewAction, webcloneFileTitle, webcloneFileMeta,
  webcloneFileContent, webcloneTarget, webcloneStatus, webcloneEmpty, webcloneContent,
  webcloneBuildAction, webcloneFilesToggle, webclonePreviewFrame, webclonePreviewPane,
  webcloneEditorPane, editorPane, resourceViewer, appSettingsWorkspace, securityWorkspace,
  webcloneWorkspace,
} from "../../core/dom-refs.js";
import { escapeHtml } from "../../core/text-format.js";
import { addErrorMessage } from "../chat/chat-messages.js";
import { setTerminalMaximized } from "../terminal/terminal-panel.js";
import { syncWorkspaceActivity, setCodeEditorVisible } from "../layout/workspace-switcher.js";

export function webcloneTargetFromScope() {
  try {
    const raw = appState.resourcePreviewText || "";
    const parsed = JSON.parse(raw);
    const values = Array.isArray(parsed?.targets) ? parsed.targets : [];
    const first = values.find((value) => typeof value === "string" ? /^https?:\/\//i.test(value) : /^https?:\/\//i.test(String(value?.value || "")));
    return typeof first === "string" ? first : String(first?.value || "");
  } catch { return ""; }
}

export function renderWebCloneFiles() {
  if (!webcloneFileList) return;
  const files = Array.isArray(appState.webcloneManifest?.files) ? appState.webcloneManifest.files : [];
  if (webcloneFileCount) webcloneFileCount.textContent = String(files.length);
  webcloneFileList.innerHTML = files.length ? files.map((file, index) => `<button type="button" class="webclone-file-item${file.path === appState.webcloneSelectedFile ? " selected" : ""}" data-webclone-file="${escapeHtml(file.path)}" role="treeitem" aria-selected="${file.path === appState.webcloneSelectedFile}"><span class="codicon ${String(file.path).endsWith(".html") ? "codicon-file-code" : String(file.path).endsWith(".css") ? "codicon-symbol-color" : String(file.path).endsWith(".js") ? "codicon-symbol-event" : "codicon-file"}"></span><span>${escapeHtml(file.path.replace(/^WebClone\//, ""))}</span><small>${Math.ceil(Number(file.bytes || 0) / 1024)} KB</small></button>`).join("") : '<div class="webclone-file-empty">Build a clone to populate files.</div>';
  webcloneFileList.querySelectorAll("[data-webclone-file]").forEach((button) => button.addEventListener("click", () => openWebCloneFile(button.dataset.webcloneFile)));
}

export async function openWebCloneFile(relativePath) {
  if (!relativePath || !appState.assessmentPath) return;
  const requestedAssessment = appState.assessmentPath;
  const requestGeneration = ++appState.webcloneFileRequestGeneration;
  const file = await window.api.webCloneReadFile?.({ path: requestedAssessment, relativePath });
  if (appState.assessmentPath !== requestedAssessment || requestGeneration !== appState.webcloneFileRequestGeneration) return;
  if (!file || file?.error) return addErrorMessage(file?.error || "WebClone file reader is unavailable.");
  appState.webcloneSelectedFile = relativePath;
  if (webcloneFileTitle) webcloneFileTitle.textContent = relativePath.replace(/^WebClone\//, "");
  if (webcloneFileMeta) webcloneFileMeta.textContent = `${file.content?.length || 0} characters`;
  if (webcloneFileContent) webcloneFileContent.textContent = String(file.content || "");
  renderWebCloneFiles();
  if (webclonePreviewAction) webclonePreviewAction.disabled = !String(relativePath).endsWith("index.html");
}

export async function loadWebCloneManifest() {
  if (!appState.assessmentPath) return;
  const requestedAssessment = appState.assessmentPath;
  const requestGeneration = ++appState.webcloneManifestRequestGeneration;
  const result = await window.api.webCloneManifest?.({ path: requestedAssessment });
  if (appState.assessmentPath !== requestedAssessment || requestGeneration !== appState.webcloneManifestRequestGeneration) return;
  appState.webcloneManifest = result?.ok === false ? null : result;
  const files = appState.webcloneManifest?.files || [];
  if (webcloneEmpty) webcloneEmpty.hidden = files.length > 0;
  if (webcloneContent) webcloneContent.hidden = files.length === 0;
  if (webcloneStatus) webcloneStatus.textContent = files.length ? `${files.length} files · ${appState.webcloneManifest.builtAt ? new Date(appState.webcloneManifest.builtAt).toLocaleString() : "ready"}` : "No clone built";
  if (webcloneTarget && appState.webcloneManifest?.target) webcloneTarget.value = appState.webcloneManifest.target;
  if (files.length) {
    appState.webcloneSelectedFile = files.some((file) => file.path === appState.webcloneSelectedFile) ? appState.webcloneSelectedFile : files[0].path;
    renderWebCloneFiles();
    await openWebCloneFile(appState.webcloneSelectedFile);
  } else renderWebCloneFiles();
}

export async function buildWebClone() {
  if (!appState.assessmentPath) return addErrorMessage("Open an assessment before building WebClone.");
  let target = String(webcloneTarget?.value || appState.webcloneManifest?.target || webcloneTargetFromScope()).trim();
  if (!target) return;
  webcloneBuildAction.disabled = true;
  if (webcloneStatus) webcloneStatus.textContent = "Building…";
  try {
    const result = await window.api.webCloneBuild?.({ path: appState.assessmentPath, target, maxAssets: 80 });
    if (result?.error) return addErrorMessage(result.error);
    appState.webcloneManifest = result;
    appState.webcloneSelectedFile = "WebClone/index.html";
    await loadWebCloneManifest();
  } finally { webcloneBuildAction.disabled = false; }
}

export function setWebCloneFilesCollapsed(collapsed) {
  appState.webcloneFilesCollapsed = Boolean(collapsed);
  webcloneContent?.classList.toggle("files-collapsed", appState.webcloneFilesCollapsed);
  webcloneFilesToggle?.setAttribute("aria-label", appState.webcloneFilesCollapsed ? "Expand files" : "Collapse files");
  webcloneFilesToggle?.setAttribute("title", appState.webcloneFilesCollapsed ? "Expand files" : "Collapse files");
  if (webcloneFilesToggle) webcloneFilesToggle.innerHTML = `<span class="codicon codicon-chevron-${appState.webcloneFilesCollapsed ? "left" : "right"}"></span>`;
}

export function getWebClonePreviewBounds() {
  const rect = webclonePreviewFrame?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

export function syncWebClonePreviewBounds() {
  if (webclonePreviewPane?.hidden !== false || !webclonePreviewFrame) return;
  if (appState.webClonePreviewResizeFrame) cancelAnimationFrame(appState.webClonePreviewResizeFrame);
  appState.webClonePreviewResizeFrame = requestAnimationFrame(() => {
    appState.webClonePreviewResizeFrame = 0;
    const bounds = getWebClonePreviewBounds();
    if (bounds) window.api.webClonePreviewBounds?.({ bounds });
  });
}

export async function toggleWebClonePreview(show = true) {
  if (!webclonePreviewPane || !webclonePreviewFrame) return;
  webclonePreviewPane.hidden = !show;
  if (webcloneEditorPane) webcloneEditorPane.hidden = show;
  webclonePreviewAction?.setAttribute("aria-pressed", String(show));
  if (webclonePreviewAction) webclonePreviewAction.innerHTML = `<span class="codicon codicon-${show ? "file-code" : "play"}"></span>${show ? "Files" : "Preview"}`;
  if (!show) {
    await window.api.webCloneHidePreview?.();
    return;
  }
  if (show && webcloneFileContent && appState.webcloneSelectedFile.endsWith("index.html")) {
    // Parse the untrusted clone only to rewrite local assets. Its serialized
    // HTML runs in a separate sandboxed WebContentsView with no Node/preload;
    // the preview server applies a restrictive CSP and blocks network egress.
    const html = String(webcloneFileContent.textContent || "").replace(/^\uFEFF/, "");
    const previewDocument = new DOMParser().parseFromString(html, "text/html");
    const csp = previewDocument.createElement("meta");
    csp.httpEquiv = "Content-Security-Policy";
    csp.content = "default-src data: blob:; img-src data: blob:; style-src data: blob: 'unsafe-inline'; script-src data: blob: 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';";
    previewDocument.head.prepend(csp);
    const files = Array.isArray(appState.webcloneManifest?.files) ? appState.webcloneManifest.files : [];
    const embeddedAssets = [];
    for (const file of files) {
      if (file.path === "WebClone/index.html") continue;
      const loaded = await window.api.webCloneReadFile?.({ path: appState.assessmentPath, relativePath: file.path });
      if (loaded?.error || typeof loaded.content !== "string") continue;
      const relative = file.path.replace(/^WebClone\//, "");
      if (!/\.(?:css|js|mjs)$/i.test(relative)) continue;
      const encoded = `data:${file.contentType || "text/plain"};charset=utf-8,${encodeURIComponent(loaded.content)}`;
      let sourceUrl = "";
      let sourcePath = "";
      try {
        const parsedSource = file.source ? new URL(file.source) : null;
        sourceUrl = parsedSource?.href || "";
        sourcePath = parsedSource?.pathname || "";
      } catch { /* Source metadata is optional. */ }
      embeddedAssets.push({ relative, basename: relative.split("/").pop(), sourceUrl, sourcePath, encoded });
    }
    const baseUrl = appState.webcloneManifest?.finalUrl || appState.webcloneManifest?.target || "https://xekute.invalid/";
    previewDocument.querySelectorAll("script[src], link[rel~='stylesheet'][href]").forEach((element) => {
      const attribute = element.hasAttribute("src") ? "src" : "href";
      const original = String(element.getAttribute(attribute) || "").trim();
      let absolute = "";
      let pathname = "";
      try {
        const parsed = new URL(original, baseUrl);
        absolute = parsed.href;
        pathname = parsed.pathname;
      } catch { /* Leave malformed attributes untouched. */ }
      const match = embeddedAssets.find((asset) => (
        (asset.sourceUrl && absolute === asset.sourceUrl)
        || (asset.sourcePath && pathname === asset.sourcePath)
        || original === asset.relative
        || original === `/${asset.relative}`
        || (!asset.sourceUrl && asset.basename && pathname.endsWith(`/${asset.basename}`))
      ));
      if (match) element.setAttribute(attribute, match.encoded);
      else if (element.tagName === "SCRIPT" && element.hasAttribute("src")) element.remove();
      else if (element.tagName === "LINK" && String(element.getAttribute("rel") || "").toLowerCase() === "stylesheet") element.remove();
    });
    const previewHtml = `<!doctype html>\n${previewDocument.documentElement.outerHTML}`;
    const bounds = getWebClonePreviewBounds();
    const previewResult = await window.api.webClonePreviewDocument?.({ html: previewHtml, bounds });
    if (!previewResult || previewResult?.error || previewResult.ok === false) {
      addErrorMessage(previewResult?.error || "WebClone preview service is unavailable.");
      return;
    }
  }
}

export async function showWebCloneWorkspace() {
  appState.browserWorkspace?.setVisible(false);
  if (appState.terminalMaximized) setTerminalMaximized(false);
  appState.currentWorkspaceMode = "webclone";
  setCodeEditorVisible(false);
  resourceViewer.hidden = true; securityWorkspace.hidden = true; appSettingsWorkspace.hidden = true; webcloneWorkspace.hidden = false;
  editorPane?.setAttribute("aria-label", "WebClone workspace");
  toggleWebClonePreview(false);
  setWebCloneFilesCollapsed(false);
  syncWorkspaceActivity();
  await loadWebCloneManifest();
}
