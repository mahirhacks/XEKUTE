"use strict";

function applyPatchesToContent(content, patches) {
  let nextContent = content;

  for (let index = 0; index < patches.length; index += 1) {
    const search = patches[index].search ?? "";
    const replace = patches[index].replace ?? "";
    if (!search) return { error: `Patch ${index + 1}: empty search block` };

    const count = nextContent.split(search).length - 1;
    if (count === 0) return { error: `Patch ${index + 1}: search text not found in file` };
    if (count > 1) {
      return { error: `Patch ${index + 1}: search text matched ${count} times (must be unique)` };
    }

    nextContent = nextContent.replace(search, replace);
  }

  return { content: nextContent, patches_applied: patches.length };
}

function createWorkspaceFiles({ fs, path, workspaceSearch }) {
  if (!fs || !path || !workspaceSearch) {
    throw new TypeError("Workspace files require fs, path, and workspaceSearch dependencies");
  }

  function resolveWorkspaceTarget(workspace, relativePath = "") {
    return workspaceSearch.resolveWorkspaceTarget(workspace, relativePath);
  }

  function editFileInWorkspace(workspace, file, code) {
    const resolved = resolveWorkspaceTarget(workspace, file);
    if (resolved.error) return resolved;

    fs.mkdirSync(path.dirname(resolved.target), { recursive: true });
    fs.writeFileSync(resolved.target, code, "utf8");
    return { ok: true, file, path: resolved.target, mode: "full", content: code };
  }

  function patchFileInWorkspace(workspace, file, patches) {
    const resolved = resolveWorkspaceTarget(workspace, file);
    if (resolved.error) return resolved;
    if (!fs.existsSync(resolved.target)) return { error: `File not found: ${file}` };

    const existing = fs.readFileSync(resolved.target, "utf8");
    const result = applyPatchesToContent(existing, patches);
    if (result.error) return result;

    fs.writeFileSync(resolved.target, result.content, "utf8");
    return {
      ok: true,
      file,
      path: resolved.target,
      mode: "patch",
      content: result.content,
      patches_applied: result.patches_applied,
    };
  }

  async function editWorkspaceFile(workspace, file, { code, patches } = {}) {
    if (!workspace) return { error: "No workspace open" };
    workspaceSearch.invalidate(workspace);

    const resolved = resolveWorkspaceTarget(workspace, file);
    if (resolved.error) return resolved;
    if (patches?.length) return patchFileInWorkspace(workspace, file, patches);
    if (code === undefined) return { error: "No content or patches provided" };

    try {
      return editFileInWorkspace(workspace, file, code);
    } catch (error) {
      return { error: error.message };
    }
  }

  function deleteWorkspaceFile(workspace, file) {
    const resolved = resolveWorkspaceTarget(workspace, file);
    if (resolved.error) return resolved;

    try {
      if (!fs.existsSync(resolved.target)) return { error: `File not found: ${file}` };
      const stat = fs.statSync(resolved.target);
      const targetType = stat.isDirectory() ? "directory" : "file";
      if (stat.isDirectory()) fs.rmSync(resolved.target, { recursive: true, force: true });
      else fs.unlinkSync(resolved.target);
      workspaceSearch.invalidate(workspace);
      return { ok: true, mode: "delete", file, targetType };
    } catch (error) {
      return { error: error.message };
    }
  }

  function transferWorkspacePath(workspace, sourceFile, destinationFile, { move = false } = {}) {
    const source = resolveWorkspaceTarget(workspace, sourceFile);
    if (source.error) return source;
    const destination = resolveWorkspaceTarget(workspace, destinationFile);
    if (destination.error) return destination;
    if (!source.relative) return { error: "The workspace root cannot be transferred" };
    if (!destination.relative) return { error: "Choose a destination inside the workspace" };

    try {
      if (!fs.existsSync(source.target)) return { error: `File not found: ${sourceFile}` };
      if (fs.existsSync(destination.target)) return { error: `Destination already exists: ${destinationFile}` };

      const sourceStat = fs.statSync(source.target);
      const sourceKey = path.resolve(source.target).replace(/[\\/]$/, "").toLowerCase();
      const destinationKey = path.resolve(destination.target).replace(/[\\/]$/, "").toLowerCase();
      if (sourceStat.isDirectory() && (destinationKey === sourceKey || destinationKey.startsWith(`${sourceKey}${path.sep}`))) {
        return { error: "A folder cannot be copied into itself" };
      }

      const destinationParent = path.dirname(destination.target);
      if (!fs.existsSync(destinationParent) || !fs.statSync(destinationParent).isDirectory()) {
        return { error: "The destination folder does not exist" };
      }

      if (move) fs.renameSync(source.target, destination.target);
      else {
        fs.cpSync(source.target, destination.target, {
          recursive: sourceStat.isDirectory(),
          errorOnExist: true,
          force: false,
        });
      }

      workspaceSearch.invalidate(workspace);
      return {
        ok: true,
        mode: move ? "move" : "copy",
        source: source.relative,
        destination: destination.relative,
        targetType: sourceStat.isDirectory() ? "directory" : "file",
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  return Object.freeze({
    resolveWorkspaceTarget,
    editWorkspaceFile,
    deleteWorkspaceFile,
    transferWorkspacePath,
  });
}

module.exports = {
  applyPatchesToContent,
  createWorkspaceFiles,
};
