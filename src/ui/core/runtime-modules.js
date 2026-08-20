// Renderer composition imports. Feature modules publish their browser APIs
// on globalThis for the existing composition root to consume; this file keeps
// their load order in one native-module graph.
import "./dom.js";
import "../features/terminal/terminal-controller.js";
import "../features/security/security-inspector.js";
import "../../prompts/rules/request-intent-rules.js";
import "../../prompts/skills/context-router.js";
import "../../agent/modes/mode-registry.js";
import "../../prompts/instructions/system-prompt.js";
import "../../prompts/instructions/initial-context.js";
import "../../agent/runtime/prompt-compiler.js";
import "../features/toolbox/toolbox-controller.js";
import "../../agent/runtime/context-budget.js";
import "../features/editor/editor-controller.js";
import "../features/project/explorer-selection.js";
import "../../agent/runtime/tunables.js";
import "../../agent/memory/failure-memory.js";
import "../../agent/memory/context-memory.js";
import "./markdown.js";
import "./app-core.js";
import "../features/dialog/app-dialog.js";

export const rendererModulesLoaded = true;
