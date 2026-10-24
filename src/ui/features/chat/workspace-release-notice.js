import { appState } from "../../core/app-state.js";

const RELEASE_CODES = new Set(["RESOURCE_RECONCILIATION_REQUIRED", "PROCESS_IDENTITY_UNPROVEN"]);

export function needsWorkspaceRelease(result) {
  return [result?.errorCode, result?.code, result?.error?.code].some((code) => RELEASE_CODES.has(code));
}

// Shown where work was refused because a command handle survived an app
// restart and its PID is still in use. Releasing stops tracking the handle; it
// never ends the PID, which may now belong to an unrelated process.
export function showWorkspaceReleaseNotice(anchor) {
  const turn = anchor?.parentElement;
  if (!turn || turn.querySelector(".workspace-release-notice")) return null;
  const notice = document.createElement("div");
  notice.className = "browser-scope-notice workspace-release-notice";
  const text = document.createElement("span");
  text.textContent = "A command from before the app restarted still holds this workspace, so edits and new commands are blocked.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "browser-scope-notice-action";
  button.textContent = "Release workspace";
  button.addEventListener("click", () => releaseWorkspace(text, button));
  notice.append(text, button);
  anchor.after(notice);
  return notice;
}

async function releaseWorkspace(text, button) {
  const workspace = appState.rootPath;
  if (!workspace || !window.api?.releaseUnreconciledProcesses) return;
  button.disabled = true;
  let result;
  try { result = await window.api.releaseUnreconciledProcesses({ workspace }); }
  catch (error) { result = { ok: false, error: error?.message }; }
  if (!result?.ok) {
    text.textContent = `The workspace could not be released: ${result?.error?.message || result?.error || "unknown error"}`;
    button.disabled = false;
    return;
  }
  const running = (result.value?.released || []).filter((item) => item.stillRunning && item.pid);
  text.textContent = running.length
    ? `Released. Xekute no longer tracks that command. PID ${running.map((item) => item.pid).join(", ")} is still running; if it's the old command, end it in Task Manager.`
    : "Released. The workspace is writable again.";
  button.remove();
}
