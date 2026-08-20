/* Prompt orchestration and untrusted context packaging. */

const CHAT_MODES = new Set(["agent", "plan", "ask", "hypothesis"]);
const DEFAULT_CONTEXT_TOKENS = 8192;
const { normalizeProfile, profileKey } = require("../modes/mode-registry");
const PromptCompiler = require("./prompt-compiler");
const InitialPrompts = require("../../prompts/instructions/initial-context.js");
const RequestIntentRules = require("../../prompts/rules/request-intent-rules");
const ModeSkills = require("../../prompts/skills/mode-skills.js");

function parseProjectFiles(dirMap) {
  if (!dirMap) return [];
  const lines = dirMap.split("\n");
  const files = [];
  const stack = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const depth = line.search(/\S/);
    const level = depth <= 0 ? 0 : Math.floor(depth / 2);
    const name = line.trim();
    while (stack.length > level) stack.pop();
    if (name.endsWith("/")) stack.push(name.slice(0, -1));
    else files.push([...stack, name].join("/").replace(/\\/g, "/"));
  }
  return files;
}

function basename(filePath) {
  return (filePath || "").replace(/\\/g, "/").split("/").pop() || "";
}

function isEditRequest(text) {
  return RequestIntentRules.isEditRequest(text, { includeWorkspaceActions: true });
}

function resolveToolPath(requested, context = {}) {
  let filePath = String(requested || "").replace(/\\/g, "/").trim().replace(/^\/+/, "");
  if (!filePath) return filePath;
  if (/^relative\//i.test(filePath)) filePath = filePath.replace(/^relative\//i, "");

  const projectFiles = parseProjectFiles(context.dirMap || "");
  const activePath = context.activeFile?.path?.replace(/\\/g, "/") || null;
  const intentPath = context.targetFile?.replace(/\\/g, "/") || null;
  const userMessage = context.userMessage || "";
  const userNamedIntent = intentPath && (userMessage.includes(intentPath) || userMessage.includes(basename(intentPath)));
  if (intentPath && projectFiles.includes(intentPath) && userNamedIntent && filePath !== intentPath) return intentPath;
  if (projectFiles.includes(filePath)) return filePath;

  const name = basename(filePath);
  const matches = projectFiles.filter((file) => basename(file) === name);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    if (intentPath && matches.includes(intentPath)) return intentPath;
    if (activePath && matches.includes(activePath)) return activePath;
    matches.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    return matches[0];
  }
  if (intentPath && projectFiles.includes(intentPath)) return intentPath;
  if (intentPath && basename(intentPath) === name) return intentPath;
  if (activePath && basename(activePath) === name) return activePath;
  return filePath;
}

function resolveTools(tools, context = {}) {
  return tools.map((tool) => {
    if (Array.isArray(tool.files) && tool.files.length) return { ...tool, files: tool.files.map((file) => resolveToolPath(file, context)) };
    if (!tool.file) {
      const fileActions = ["read_file", "apply_patch", "search_workspace"];
      if (fileActions.includes(tool.action) && context.targetFile) return { ...tool, file: context.targetFile };
      return tool;
    }
    const resolved = resolveToolPath(tool.file, context);
    return resolved === tool.file ? tool : { ...tool, file: resolved, requestedFile: tool.file };
  });
}

function inferEditTarget(userMessage, activeFile, dirMap = "") {
  if (!userMessage) return activeFile?.path || null;
  const patterns = [
    /(?:update|edit|modify|change|fix|patch|rewrite|replace|revamp|in)\s+(?:the\s+)?(?:file\s+)?[`"']?([\w./\\-]+\.\w+)/i,
    /[`"']?([\w./\\-]+\.\w+)[`"']?(?:\s+file)?(?:\s+(?:to|with|that|has|contains))/i,
    /(?:for|to|into)\s+[`"']?([\w./\\-]+\.\w+)/i,
  ];
  for (const pattern of patterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const raw = match[1].replace(/\\/g, "/");
      return resolveToolPath(raw, { activeFile, targetFile: raw, dirMap });
    }
  }
  return activeFile?.path || null;
}

function normalizeMode(mode) {
  const value = String(mode || "agent").toLowerCase();
  return CHAT_MODES.has(value) ? value : normalizeProfile(value).legacyMode;
}

function contextLimits(numCtx) {
  const tokens = Number.isFinite(Number(numCtx)) ? Number(numCtx) : DEFAULT_CONTEXT_TOKENS;
  if (tokens <= 4096) return { projectFiles: 32, embeddedChars: 4200, perFileChars: 3200, memoryChars: 1800 };
  if (tokens <= 8192) return { projectFiles: 56, embeddedChars: 8000, perFileChars: 5200, memoryChars: 3200 };
  if (tokens <= 16384) return { projectFiles: 100, embeddedChars: 16000, perFileChars: 9000, memoryChars: 5200 };
  return { projectFiles: 180, embeddedChars: 28000, perFileChars: 14000, memoryChars: 9000 };
}

function clipText(value, maxChars) {
  const text = String(value || "");
  if (!maxChars || text.length <= maxChars) return text;
  const headSize = Math.max(1, Math.floor(maxChars * 0.68));
  const tailSize = Math.max(1, maxChars - headSize);
  return `${text.slice(0, headSize)}\n... omitted to preserve context ...\n${text.slice(-tailSize)}`;
}

function buildSystemContext({ mode = "agent", modeFamily = "xekute", promptConfig = null, depth = "operational", specializedGuidance = "" } = {}) {
  const profile = normalizeProfile(modeFamily, mode);
  const guidance = [ModeSkills.render(profile.key), specializedGuidance].filter(Boolean).join("\n\n");
  return PromptCompiler.compile({ family: profile.family, mode: profile.key, overrides: promptConfig, depth, specializedGuidance: guidance });
}

function buildUntrustedContext({ dirMap = "", activeFile = null, extraFiles = [], discovery = null, userMessage = "", numCtx = DEFAULT_CONTEXT_TOKENS } = {}) {
  const limits = contextLimits(numCtx);
  const lines = InitialPrompts.untrustedContextHeader();
  if (userMessage) lines.push("", "OBJECTIVE", clipText(userMessage, 2000));
  const files = parseProjectFiles(dirMap || "").slice(0, limits.projectFiles);
  if (files.length) lines.push("", "WORKSPACE INVENTORY", ...files.map((file) => `- ${file}`));
  if (discovery?.files?.length) lines.push("", "DISCOVERY HINTS", ...discovery.files.slice(0, 8).map((file) => `- ${file}`));
  if (discovery?.snippets?.length) {
    lines.push("", "SEARCH EXCERPTS");
    for (const hit of discovery.snippets.slice(0, 2)) lines.push(`Source: ${hit.path}`, clipText(hit.snippet, 1200));
  }
  let remaining = limits.embeddedChars;
  for (const file of [activeFile, ...(Array.isArray(extraFiles) ? extraFiles : [])]) {
    if (!file?.path || file.content == null || remaining < 800) continue;
    const value = clipText(file.content, Math.min(limits.perFileChars, remaining));
    remaining -= value.length;
    lines.push("", `FILE DATA: ${file.path}`, "```text", value, "```");
  }
  return lines.join("\n");
}

module.exports = {
  buildSystemContext,
  buildUntrustedContext,
  contextLimits,
  inferEditTarget,
  isEditRequest,
  normalizeMode,
  normalizeProfile,
  profileKey,
  parseProjectFiles,
  resolveToolPath,
  resolveTools,
};
