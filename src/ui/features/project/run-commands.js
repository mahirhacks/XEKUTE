import { appState } from "../../core/app-state.js";
import { menuRunCode } from "../../core/dom-refs.js";
import { openTabs } from "../editor/editor-tabs.js";
import { TerminalManager } from "../../core/runtime-globals.js";
import { basenameOf, joinWorkspacePath } from "../../core/workspace-paths.js";

export const RUN_COMMAND_KEY = "pointer:runCommands";

export function loadRunCommands() {
  try {
    const raw = localStorage.getItem(RUN_COMMAND_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    localStorage.removeItem(RUN_COMMAND_KEY);
    return {};
  }
}

export function runCommandKey() {
  return appState.rootPath || "__global__";
}

export function getRunCommand() {
  return loadRunCommands()[runCommandKey()] || "";
}

export function setRunCommand(command) {
  const commands = loadRunCommands();
  const key = runCommandKey();
  const value = String(command || "").trim();
  if (value) commands[key] = value;
  else delete commands[key];
  localStorage.setItem(RUN_COMMAND_KEY, JSON.stringify(commands));
  updateRunMenuState();
}

export function updateRunMenuState() {
  if (!menuRunCode) return;
  const command = getRunCommand();
  menuRunCode.disabled = !command;
  menuRunCode.title = command ? `Run: ${command}` : "Configure a run command first";
}

export async function configureRunCommand() {
  const current = getRunCommand();
  const hint = appState.activeTabPath && openTabs.has(appState.activeTabPath)
    ? `Example: python ${openTabs.get(appState.activeTabPath).name}`
    : "Example: python main.py";
  const value = await AppDialog.prompt(`Command to run from the project folder:\n${hint}`, current, { title: "Run command" });
  if (value === null) return;
  setRunCommand(value);
}

export async function runConfiguredCommand() {
  const command = getRunCommand();
  if (!command) return;
  await TerminalManager.runCommand(command);
}

export const WORKSPACE_RUNNABLE_EXTENSIONS = new Set([
  ".bat", ".c", ".cc", ".cjs", ".clj", ".cmd", ".coffee", ".cpp", ".csx", ".cxx",
  ".dart", ".exs", ".fsx", ".go", ".groovy", ".hs", ".java", ".jl", ".js", ".jsx",
  ".lua", ".mjs", ".nim", ".php", ".pl", ".ps1", ".py", ".pyw", ".r", ".rb", ".rs",
  ".scala", ".sh", ".swift", ".tcl", ".ts", ".tsx", ".vbs",
]);

export function workspaceFileExtension(name = "") {
  const fileName = basenameOf(name).toLowerCase();
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot) : "";
}

export function quoteWorkspaceRunArgument(value = "") {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function compiledWorkspaceRunCommand(compiler, fileName, stem) {
  const source = quoteWorkspaceRunArgument(fileName);
  const outputName = `xekute-${String(stem || "program").replace(/[^a-z0-9_-]+/gi, "-")}-${Date.now()}.exe`;
  const output = quoteWorkspaceRunArgument(outputName);
  return `$xekuteRunOutput = Join-Path $env:TEMP ${output}; ${compiler} ${source} -o $xekuteRunOutput; if ($LASTEXITCODE -eq 0) { & $xekuteRunOutput }; Remove-Item -LiteralPath $xekuteRunOutput -ErrorAction SilentlyContinue`;
}

export function workspaceRunCommand(target) {
  if (!target || target.isDir) return "";
  const fileName = target.name || basenameOf(target.relativePath || target.path);
  const extension = workspaceFileExtension(fileName);
  if (!WORKSPACE_RUNNABLE_EXTENSIONS.has(extension)) return "";
  const filePath = target.path || joinWorkspacePath(target.relativePath || fileName);
  const file = quoteWorkspaceRunArgument(filePath);
  const stem = fileName.slice(0, Math.max(0, fileName.length - extension.length));

  switch (extension) {
    case ".js": case ".mjs": case ".cjs": return `node ${file}`;
    case ".ts": case ".tsx": case ".jsx": return `tsx ${file}`;
    case ".coffee": return `coffee ${file}`;
    case ".py": case ".pyw": return `python ${file}`;
    case ".rb": return `ruby ${file}`;
    case ".php": return `php ${file}`;
    case ".pl": return `perl ${file}`;
    case ".lua": return `lua ${file}`;
    case ".r": return `Rscript ${file}`;
    case ".jl": return `julia ${file}`;
    case ".go": return `go run ${file}`;
    case ".java": return `java ${file}`;
    case ".dart": return `dart run ${file}`;
    case ".swift": return `swift ${file}`;
    case ".scala": return `scala ${file}`;
    case ".groovy": return `groovy ${file}`;
    case ".clj": return `clojure ${file}`;
    case ".hs": return `runghc ${file}`;
    case ".nim": return `nim compile --run ${file}`;
    case ".exs": return `elixir ${file}`;
    case ".fsx": return `dotnet fsi ${file}`;
    case ".csx": return `dotnet script ${file}`;
    case ".tcl": return `tclsh ${file}`;
    case ".sh": return `bash ${file}`;
    case ".ps1": return `powershell -NoProfile -ExecutionPolicy Bypass -File ${file}`;
    case ".bat": case ".cmd": return `& ${file}`;
    case ".vbs": return `cscript //nologo ${file}`;
    case ".c": return compiledWorkspaceRunCommand("gcc", filePath, stem);
    case ".cc": case ".cpp": case ".cxx": return compiledWorkspaceRunCommand("g++", filePath, stem);
    case ".rs": return compiledWorkspaceRunCommand("rustc", filePath, stem);
    default: return "";
  }
}
