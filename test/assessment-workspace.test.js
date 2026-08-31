const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  ASSESSMENT_ITEM_FILES,
  ASSESSMENT_VERSION,
  JSON_TEMPLATES,
  createAssessmentWorkspace,
  redactHttpMessage,
  validateCustomEntryPath,
} = require("../src/domain/assessment/assessment-workspace");
const { createProjectArtifactService } = require("../src/app/services/artifacts/project-artifact-service.js");

test("every assessment sidebar item maps to its required backing file", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  for (const [item, relativePath] of Object.entries(ASSESSMENT_ITEM_FILES)) {
    if (String(relativePath).startsWith(".xekute/")) continue;
    if (!html.includes(`data-bounty-item="${item}"`)) continue;
    assert.ok(
      html.includes(`data-bounty-item="${item}" data-bounty-file="${relativePath}"`),
      `${item} should open ${relativePath}`,
    );
  }
});

test("custom entries cannot reuse built-in assessment file or folder names", () => {
  for (const reserved of ["traffic", "Map", "WebClone", "report.md", "checklist.md", "hypotheses.md", "project_info", "agent-actions.jsonl"]) {
    const result = validateCustomEntryPath(`custom/notes/${reserved}`);
    assert.equal(result.code, "RESERVED_NAME", reserved);
  }
  assert.equal(validateCustomEntryPath("custom/settings.config").ok, true);
  assert.equal(validateCustomEntryPath("custom/pen_context.md").ok, true);
  assert.equal(validateCustomEntryPath("custom/CON.txt").code, "RESERVED_NAME");
  assert.equal(validateCustomEntryPath("custom/../scope").code, "INVALID_NAME");
  assert.deepEqual(validateCustomEntryPath("custom/research/auth-notes.md"), { ok: true, normalized: "custom/research/auth-notes.md" });
});

test("multi-delete removes only selected Custom roots and never assessment files", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "custom-delete");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });
  fs.mkdirSync(path.join(root, "custom", "notes", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "custom", "notes", "nested", "one.md"), "one");
  fs.writeFileSync(path.join(root, "custom", "keep.md"), "keep");
  fs.writeFileSync(path.join(root, "custom", "remove.md"), "remove");

  const deleted = workspace.deleteCustomEntries(root, ["notes", "notes/nested/one.md", "remove.md"]);
  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.deleted.sort(), ["notes", "remove.md"]);
  assert.equal(fs.existsSync(path.join(root, "custom", "notes")), false);
  assert.equal(fs.existsSync(path.join(root, "custom", "keep.md")), true);
  assert.equal(workspace.deleteCustomEntries(root, ["../traffic"]).code, "INVALID_NAME");
  assert.equal(fs.existsSync(path.join(root, "traffic", "raw.jsonl")), true);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("security workspace exposes Traffic Raw history with request and response details", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  assert.ok(html.includes('id="security-history-toggle"'));
  assert.ok(html.includes('id="security-history-rows"'));
  for (const key of ["number", "host", "method", "path", "params", "status", "length", "mime", "tool", "time"]) {
    assert.ok(html.includes(`data-history-sort="${key}"`), `History should sort by ${key}`);
  }
  assert.ok(html.indexOf('id="security-history-panel"') < html.indexOf('id="security-workbench"'));
  assert.ok(html.includes('id="security-request-editor"'));
  assert.ok(html.includes('id="security-response-editor"'));
  assert.ok(html.includes('id="security-inspector-toggle"'));
  assert.ok(html.includes('data-inspector-tab="decoder"'));
  assert.ok(html.includes('data-inspector-tab="jwt"'));
  assert.ok(html.includes('data-inspector-tab="cookies"'));
  const runtimeModules = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "core", "runtime-modules.js"), "utf8");
  assert.match(runtimeModules, /features\/security\/security-inspector\.js/);
  assert.match(renderer, /selectedSecurityHistoryRequestIds/);
  assert.match(renderer, /preservedRequestIds/);
  assert.match(renderer, /loadSecurityHistoryRecord\(/);
  assert.match(renderer, /selectedSecurityHistoryIndices/);
  assert.match(renderer, /function sortedSecurityHistoryRecords/);
  assert.match(renderer, /function securityHistoryTimeValue/);
  const analyzeSource = renderer.slice(renderer.indexOf("async function analyzeSecurityExchange"), renderer.indexOf("function clearSecurityExchange"));
  assert.doesNotMatch(analyzeSource, /setChatMode\(/);
});

test("workspace editor renders synchronized logical line numbers", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  assert.ok(html.includes('id="resource-editor-shell"'));
  assert.ok(html.includes('id="resource-line-numbers"'));
  assert.ok(html.indexOf('id="resource-line-numbers"') < html.indexOf('id="resource-viewer-content"'));
  assert.match(renderer, /resourceViewerContent\.value\.split\("\\n"\)\.length/);
  assert.match(renderer, /resourceLineNumbers\.scrollTop = resourceViewerContent\.scrollTop/);
  assert.match(css, /\.resource-line-numbers/);
});

test("chat markdown wraps long security values without horizontal expansion", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  assert.match(css, /#messages\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.assistant-reply\s*\{[^}]*overflow-wrap:\s*break-word/s);
  assert.match(css, /\.assistant-reply\s+:not\(pre\)\s*>\s*code[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.md-code-block pre\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*break-word/s);
});

test("chat sessions are restored per workspace and saved after explicit lifecycle changes", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "preload.js"), "utf8");
  assert.match(preload, /loadChatHistory/);
  assert.match(preload, /recordChatEvent/);
  assert.match(preload, /saveChatHistoryBeforeClose/);
  assert.match(renderer, /restoreChatSessionsForCurrentWorkspace/);
  assert.match(renderer, /beginChatHistoryBlock/);
  assert.match(renderer, /await restoreChatSessionsForCurrentWorkspace\(\)/);
  assert.match(renderer, /flushChatHistory/);
});

test("authority UI does not offer unrestricted mode", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  assert.doesNotMatch(html, /Unrestricted|data-authority-mode=["']unrestricted["']/);
  assert.doesNotMatch(renderer, /\["unrestricted",\s*"Unrestricted"/);
});

test("terminal sash resizing is frame-synchronized and deduplicates PTY dimensions", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "features", "terminal", "terminal-controller.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  assert.match(renderer, /addEventListener\("pointerdown"/);
  assert.match(renderer, /requestAnimationFrame\(flush\)/);
  assert.match(renderer, /availableH = Math\.max\(0, rect\.height - sashH\)/);
  assert.match(renderer, /terminalDragShouldCollapse/);
  assert.match(terminal, /cols !== session\.lastCols \|\| rows !== session\.lastRows/);
  assert.match(terminal, /fitAnimationFrame = requestAnimationFrame/);
  assert.match(css, /#terminal-pane\s*\{[^}]*contain:\s*layout paint/s);
});

test("terminal stays collapsed without a session and creates one when expanded", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "features", "terminal", "terminal-controller.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  assert.match(terminal, /function hasSessions\(\)/);
  assert.match(terminal, /async function ensureTerminal\(\)/);
  assert.doesNotMatch(terminal, /async function openWithProject\(path\)\s*\{[^}]*createTerminal\(/s);
  assert.match(renderer, /setTerminalCollapsed\(!TerminalManager\.hasSessions\(\), \{ createIfMissing: false \}\)/);
  assert.match(renderer, /if \(createIfMissing && !TerminalManager\.hasSessions\(\)\)/);
  assert.match(renderer, /onTerminalSessionStateChange[^]*count === 0[^]*setTerminalCollapsed\(true/s);
  assert.ok(html.includes('id="btn-terminal-split"'));
  assert.ok(html.includes('id="terminal-session-menu"'));
  assert.ok(!html.includes('id="activity-terminal"'));
  assert.ok(!html.includes('id="activity-chat"'));
  assert.ok(html.includes('data-action="toggle-terminal"'));
  assert.ok(html.includes('data-action="toggle-chat"'));
  assert.match(terminal, /async function splitActive\(\)/);
  assert.match(terminal, /session\.groupId === active\.groupId/);
  assert.match(terminal, /data-shell-profile/);
  assert.match(main, /ipcMain\.handle\("terminal:shells"/);
  assert.match(main, /resolveTerminalShell\(String\(profileId/);
});

test("project workspace exposes a plain folder flow and professional project settings", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const baseStyles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  const settingsStyles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "settings.css"), "utf8");
  const layoutRevampStyles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "layout-revamp.css"), "utf8");
  const chatStyles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "chat.css"), "utf8");
  assert.ok(html.includes(">Core<"));
  assert.ok(html.includes(">Scoute<"));
  assert.ok(html.includes('id="btn-context-add"'));
  assert.ok(html.includes('data-bounty-file=".xekute/project_info/index.md"'));
  assert.ok(html.includes(">Custom<"));
  assert.ok(html.includes('data-bounty-folder="Map"'));
  assert.ok(html.includes('data-bounty-folder="WebClone"'));
  assert.ok(html.indexOf(">Context Sources<") < html.indexOf(">Core<"));
  assert.ok(html.indexOf(">Scoute<") < html.indexOf('data-bounty-folder="Map"'));
  assert.ok(html.includes('id="custom-commands-input"'));
  assert.ok(html.includes('id="command-registry-input"'));
  assert.ok(html.includes('id="app-settings-workspace"'));
  assert.ok(html.includes('id="app-settings-commands-panel"'));
  assert.ok(html.includes('id="mcp-settings-list"'));
  assert.ok(html.includes('id="mcp-settings-tabs"'));
  assert.match(html, /class="guidance-customize-page tools-settings-page"/);
  assert.ok(html.includes('data-app-settings-section="commands"'));
  assert.ok(html.includes('data-app-settings-section="project"'));
  assert.ok(html.includes('data-app-settings-section="authority"'));
  assert.ok(html.includes('data-app-settings-section="prompts"'));
  assert.match(html, /class="guidance-customize-page rules-settings-page"/);
  assert.ok(html.includes('data-app-settings-section="certificates"'));
  assert.ok(html.includes('id="app-settings-authority-panel"'));
  assert.ok(html.includes('id="app-settings-certificates-panel"'));
  assert.match(html, /class="certificate-settings-content browser-network-page"/);
  assert.match(html, /id="security-proxy-browser"[\s\S]*?codicon-globe/);
  assert.match(renderer, /proxyBrowserLaunch\(\{ assessmentPath, identityId:/);
  assert.match(renderer, /setSecurityHistoryVisible\(true\)/);
  const engagementMarkup = html.slice(html.indexOf('id="project-settings-engagement"'), html.indexOf('id="project-settings-authorization"'));
  const certificateMarkup = html.slice(html.indexOf('id="app-settings-certificates-panel"'));
  assert.match(engagementMarkup, /id="engagement-account-list"/);
  assert.match(engagementMarkup, /id="engagement-account-add"[^>]*>Add more \+<\/button>/);
  assert.match(engagementMarkup, /Authentication Accounts/);
  assert.match(engagementMarkup, /Contacts &amp; Reporting/);
  assert.doesNotMatch(engagementMarkup, /identity-runtime-status|identity-list|credential-list|credential-new-|project-auth-source|Browser identity sessions|Import auth state/);
  assert.match(engagementMarkup, /data-project-field="engagement\.executionModel"/);
  assert.match(engagementMarkup, /Shared browser state is not exported to command-line scanners/);
  assert.match(renderer, /function saveEngagementAccounts\(\)/);
  assert.match(renderer, /window\.api\.credentialSave/);
  assert.doesNotMatch(renderer, /while \(engagementAccountList\.children\.length < 2\)/);
  assert.match(renderer, /engagementAccountAdd\?\.addEventListener\("click", \(\) => \{\s*appendEngagementAccountRow\(\)/);
  assert.match(renderer, /function reindexEngagementAccountRows\(\)[\s\S]*?const accountNumber = index \+ 1;[\s\S]*?heading\.textContent = accountLabel;[\s\S]*?setAttribute\("aria-label", `\$\{accountLabel\} \$\{input\.dataset\.accountField\}`\)/);
  assert.match(renderer, /function deleteEngagementAccountRow\(row\)[\s\S]*?window\.api\.credentialDelete\(\{ workspace, credentialId \}\)[\s\S]*?row\.remove\(\);[\s\S]*?reindexEngagementAccountRows\(\)/);
  assert.match(layoutRevampStyles, /\.engagement-account-header \{[\s\S]*?justify-content: space-between/);
  assert.match(layoutRevampStyles, /\.engagement-account-delete \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none/);
  assert.match(layoutRevampStyles, /\.engagement-account-row:hover > \.engagement-account-header \.engagement-account-delete,[\s\S]*?opacity: 1;[\s\S]*?pointer-events: auto/);
  assert.match(layoutRevampStyles, /\.engagement-account-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(certificateMarkup, /id="identity-list"|id="credential-list"|Identity sessions|Authentication accounts/);
  assert.match(renderer, /onIdentityStatus\?\.\(\(snapshot\) => \{\s*if \(appSettingsSection !== "project"\) return;/);
  assert.match(renderer, /onIdentityPersistence\?\.\(\(event\) => \{\s*if \(appSettingsSection !== "project"\) return;/);
  assert.ok(html.includes("<strong>Security Workbench</strong>"));
  assert.ok(!html.includes("Intercept, replay, and test authorized HTTP traffic."));
  assert.doesNotMatch(html, /id="(?:command-settings-save|llm-settings-save|kali-access-save)"/);
  assert.match(html, /id="llm-settings-test"[^>]*>Test provider<\/button>/);
  assert.match(renderer, /function scheduleProjectProfileAutosave\([\s\S]*?queueProjectProfileAutosave\(immediate \? 0 : 650\)/);
  assert.match(renderer, /function queueLlmSettingsAutosave\([\s\S]*?flushLlmSettingsAutosave/);
  assert.match(renderer, /projectSettingsForm\?\.addEventListener\("input"[\s\S]*?scheduleProjectProfileAutosave\(\)/);
  assert.ok(html.includes('id="models-settings-search"'));
  assert.match(html, /class="models-catalog-section"[\s\S]*?id="models-catalog-title">Available models/);
  assert.doesNotMatch(html, /class="models-context-settings-body"/);
  assert.match(html, /Providers &amp; API keys/);
  assert.match(html, /id="llm-openrouter-config" class="models-api-provider-block" hidden/);
  assert.match(renderer, /function syncLlmProviderUi\(provider = "ollama"\)[\s\S]*?llmOllamaConfig\.hidden = active !== "ollama";[\s\S]*?llmOpenRouterConfig\.hidden = active !== "openrouter";/);
  assert.doesNotMatch(html, /context-compaction-model|context-compaction-cross-provider|models-context-settings/);
  assert.doesNotMatch(settingsStyles, /context-compaction-model|models-context-settings/);
  assert.match(layoutRevampStyles, /#app-settings-llm-panel \.models-settings-list \{[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 12px;[\s\S]*?background: #1b1b1b;/);
  assert.match(layoutRevampStyles, /#app-settings-llm-panel \.models-api-keys-body,[\s\S]*?flex-direction: column;[\s\S]*?gap: 12px;/);
  assert.match(layoutRevampStyles, /#app-settings-prompts-panel, #app-settings-commands-panel\) \.guidance-scope-tabs \{[\s\S]*?border-radius: 999px;[\s\S]*?background: #1b1b1b;/);
  assert.match(layoutRevampStyles, /#app-settings-commands-panel \.mcp-connection-editor \{[\s\S]*?margin-top: 42px;[\s\S]*?border-radius: 12px;[\s\S]*?background: #1b1b1b;/);
  assert.match(layoutRevampStyles, /#app-settings-certificates-panel \.certificate-settings-card \{[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 12px;[\s\S]*?background: #1b1b1b;/);
  assert.ok(html.includes('id="models-settings-list"'));
  assert.ok(html.includes('id="models-explore-subagent"'));
  assert.match(html, /id="app-settings-authority-panel"[\s\S]*?class="agent-subagent-settings"[\s\S]*?id="models-explore-subagent"/);
  assert.doesNotMatch(html, /Explore Subagent Model/);
  assert.match(renderer, /function modelsVisibleInPicker\(\)[\s\S]*?filter\(\(name\) => enabled\.has\(name\)\)/);
  assert.match(renderer, /option\.textContent = "Enable a model in Models"/);
  assert.ok(html.includes('<img src="../../xekute_icon.png" alt="" class="resource-viewer-empty-logo">'));
  assert.doesNotMatch(html, /Do something to get started/);
  assert.ok(baseStyles.includes(".resource-viewer-empty-logo {"));
  assert.match(baseStyles, /width: 84px;/);
  assert.match(baseStyles, /height: 84px;/);
  assert.match(baseStyles, /opacity: 0\.25;/);
  assert.match(html, /class="guidance-customize-page (?:tools|rules)-settings-page"/);
  assert.ok(html.includes("Tools &amp; MCPs"));
  assert.ok(html.includes('data-chat-mode="hypothesis"'));
  assert.ok(html.includes('data-chat-mode="plan"'));
  assert.ok(html.includes('data-chat-mode="agent"'));
  assert.ok(html.includes('data-chat-mode="ask"'));
  assert.doesNotMatch(html, /data-chat-mode="(?:assist|testing):/);
  assert.doesNotMatch(html, /chat-safety-toggle|chat-safety-button|chat-safety-tooltip|chat-mode-policy-note/);
  assert.ok(html.includes('<option value="hypothesis">Hypothesis</option><option value="plan">Plan</option><option value="agent">Agent</option><option value="ask">Ask</option>'));
  assert.doesNotMatch(html, /assessment-run-profile[^>]*>[\s\S]*?testing:execution/);
  assert.ok(html.includes('data-bounty-item="agent-actions" data-bounty-file=".xekute/logs/agent-actions.jsonl"'));
  assert.doesNotMatch(html, /agent-hypotheses|agent-hypotheses\.jsonl/);
  assert.ok(html.includes('id="app-menu"'));
  assert.ok(html.includes('data-menu="files"'));
  assert.match(html, /data-action="create-project"[^>]*>Create New Project/);
  assert.match(html, /data-action="open-project"[^>]*>Open Existing Project/);
  assert.doesNotMatch(html, /data-action="create-assessment"/);
  assert.doesNotMatch(html, /data-action="open-assessment"/);
  assert.ok(html.includes('id="project-settings-form"'));
  assert.ok(html.includes('data-project-settings-target="project-settings-overview"'));
  assert.ok(html.includes('data-project-settings-target="project-settings-data"'));
  assert.ok(html.includes('data-project-field="authorization.confirmed"'));
  assert.ok(html.includes('data-project-field="scope.inScopeTargets"'));
  assert.ok(html.includes('data-project-field="rulesOfEngagement.stopConditions"'));
  assert.ok(html.includes('data-project-field="context.applicationOverview"'));
  assert.ok(html.includes('data-menu="edit"'));
  assert.ok(html.includes('data-menu="view"'));
  assert.ok(html.includes('data-menu="help"'));
  assert.ok(html.includes('data-action="help-guide"'));
  assert.ok(html.includes('id="help-guide-overlay"'));
  assert.doesNotMatch(html, /custom-scripts-list/);
  assert.ok(html.includes('id="slash-command-suggestions"'));
  assert.match(renderer, /\/pentest/);
  assert.match(renderer, /\/report/);
  assert.doesNotMatch(renderer, /\/passive(?:\s|["'])/);
  assert.doesNotMatch(renderer, /\/endpoint(?:\s|["'])/);
  assert.match(renderer, /slice\(0, 3\)/);
  assert.match(renderer, /availableSlashCommands/);
  assert.match(renderer, /runSpecialSlashCommand/);
  assert.match(renderer, /slashCommandOverrides/);
  assert.match(renderer, /appSettingsWorkspace\.hidden = false/);
  assert.match(renderer, /openChatPane\(\{ createIfEmpty: true \}\)/);
  assert.match(renderer, /setTerminalCollapsed\(false\)/);
  assert.doesNotMatch(renderer, /settings-mode/);
  assert.doesNotMatch(html, /data-settings-placeholder|data-general-settings-action/);
  assert.doesNotMatch(html, /data-general-layout|general-conversation-density/);
  assert.doesNotMatch(renderer, /generalLayoutButtons|generalConversationDensity|xekuteLayoutPreference|xekuteConversationDensity/);
  assert.match(renderer, /function setProjectSettingsTarget/);
  assert.match(renderer, /section\.hidden = section\.id !== resolvedTarget/);
  assert.match(renderer, /setAttribute\("aria-pressed", String\(active\)\)/);
  assert.match(settingsStyles, /\.project-settings-section\[hidden\]\s*\{\s*display:none !important;/);
  assert.doesNotMatch(settingsStyles, /#layout\.settings-mode/);
  assert.match(settingsStyles, /\.app-settings-tabs \{[\s\S]*align-items:stretch;[\s\S]*justify-content:flex-start;[\s\S]*gap:0;/);
  assert.match(settingsStyles, /\.app-settings-nav-group \{[\s\S]*flex:0 0 auto;[\s\S]*width:100%;/);
  assert.match(settingsStyles, /\.app-settings-tabs button \{[\s\S]*height:auto;[\s\S]*min-height:31px;/);
  assert.match(settingsStyles, /\.app-settings-content > \.app-settings-panel \{[\s\S]*margin:0 auto;/);
  assert.match(settingsStyles, /\.project-toggle-grid > label::before[\s\S]*width:30px[\s\S]*height:18px/);
  assert.match(settingsStyles, /\.project-toggle-grid > label:has\(input:checked\)::before[\s\S]*background:#2f8cf4/);
  assert.match(settingsStyles, /\.project-toggle-grid > label:has\(input:checked\)::after[\s\S]*transform:translateX\(12px\)/);
  assert.match(settingsStyles, /\.agent-subagent-settings \{[\s\S]*background:var\(--settings-panel\)/);
  assert.match(settingsStyles, /#app-settings-prompts-panel[\s\S]*grid-template-columns:240px/);
  assert.match(settingsStyles, /@container app-settings \(max-width: 780px\)[\s\S]*\.app-settings-sidebar \{[\s\S]*width:64px/);
  assert.match(settingsStyles, /grid-template-columns:auto minmax\(0,1fr\)/);
  assert.match(settingsStyles, /\.llm-provider-actions button[\s\S]*border:0[\s\S]*border-radius:999px/);
  assert.match(settingsStyles, /#llm-settings-test \{[\s\S]*background:#6a541d/);
  assert.match(chatStyles, /\.model-pill \{[\s\S]*border-radius: 999px[\s\S]*background: transparent/);
  assert.equal((settingsStyles.match(/^\.app-settings-workspace \{/gm) || []).length, 1);
  assert.doesNotMatch(renderer, /saveAuthoritySettings|renderAuthoritySettings/);
  assert.match(renderer, /renderMcpSettings/);
  assert.match(renderer, /openMcpConfig/);
  assert.match(renderer, /loadMcpSettings/);
  assert.match(renderer, /setUiZoom/);
  assert.match(renderer, /showHelpGuide/);
  assert.match(renderer, /async function openProject\(\)/);
  assert.match(renderer, /activateProjectWorkspace/);
  assert.match(renderer, /modeFamily/);
  assert.doesNotMatch(renderer, /approvalGranted/);
  assert.doesNotMatch(renderer, /saveActiveSettingsSection|commandSettingsSave|llmSettingsSave|kaliAccessSave\?\.addEventListener/);
});

test("Scout Map is a dedicated buildable behavior-graph workspace", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "main.js"), "utf8");
  const projectIpc = fs.readFileSync(path.join(__dirname, "..", "src", "app", "ipc", "project.js"), "utf8");
  const activeIpc = `${main}\n${projectIpc}`;
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "preload.js"), "utf8");
  assert.ok(html.includes('data-bounty-folder="Map"'));
  assert.ok(html.includes('id="map-workspace"'));
  assert.ok(html.includes('id="map-build-action"'));
  assert.ok(html.includes('id="map-graph"'));
  assert.match(html, /id="map-host-filter-toggle"/);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*id="map-host-filter-all"/);
  assert.match(html, /id="map-host-filter-options"/);
  assert.ok(html.includes('data-map-mode="route"'));
  assert.ok(html.includes('data-map-mode="workflow"'));
  assert.ok(html.includes('data-map-mode="state"'));
  assert.ok(html.includes('data-map-mode="risk"'));
  assert.ok(html.includes('id="map-detail-toggle"'));
  assert.ok(html.includes('id="map-detail-body"'));
  assert.match(renderer, /item\.dataset\.bountyFolder === "Map"/);
  assert.match(renderer, /async function openApplicationGraphTab\(\{ build = false \} = \{\}\)/);
  assert.match(renderer, /buildTrafficGraphFromToolbar\(\)[\s\S]*?openApplicationGraphTab\(\{ build: true \}\)/);
  assert.match(renderer, /assessmentBuildMap/);
  assert.match(renderer, /openMapEvidence/);
  assert.match(renderer, /map-ai-summary/);
  assert.match(renderer, /Candidate hypotheses/);
  assert.match(renderer, /mapNodePositionsByMode/);
  assert.match(renderer, /updateDraggedMapNode/);
  assert.match(renderer, /activeMapPositionOverrides/);
  assert.match(renderer, /persistMapNodePositions/);
  assert.match(renderer, /applicationMap\.edges \|\| \[\]\)\.forEach/);
  assert.match(renderer, /selectedMapNodeId = "";\s*renderApplicationMap\(\)/);
  assert.match(renderer, /const limit = 1_000_000/);
  assert.match(renderer, /Math\.min\(4, mapZoom \* 1\.2\)/);
  assert.match(renderer, /variantItems = Array\.isArray\(node\.variants\)/);
  assert.match(renderer, /map-variant-meta/);
  assert.match(renderer, /Priority factors/);
  assert.match(html, /High priority/);
  assert.match(html, />Priority<\/button>/);
  assert.match(renderer, /requestShapeHash/);
  assert.match(css, /\.map-variant-meta/);
  assert.match(css, /\.map-variants-empty/);
  assert.match(css, /\.map-detail-empty\[hidden\]\s*\{\s*display:none;/);
  assert.match(css, /#map-detail-content\s*\{\s*padding:14px;/);
  assert.doesNotMatch(html, /map-tool-(cursor|hand)/);
  assert.match(renderer, /is-holding/);
  assert.match(renderer, /setTimeout\(\(\) =>/);
  assert.match(renderer, /200/);
  assert.match(renderer, /armed: false/);
  assert.match(renderer, /function selectMapNode\(nodeId\)/);
  assert.match(renderer, /let selectedMapHosts = new Set\(\)/);
  assert.match(renderer, /function renderMapHostFilter\(hosts = \[\]\)/);
  assert.match(renderer, /hosts\.size && !hosts\.has\(route\.host\)/);
  assert.match(renderer, /mapHostFilterOptions\?\.addEventListener\("change"/);
  assert.match(renderer, /pointer release/);
  assert.match(css, /\.map-graph\.is-holding/);
  const mapDragSource = renderer.slice(renderer.indexOf('mapGraph?.addEventListener("pointerdown"'), renderer.indexOf('mapGraph?.addEventListener("pointermove"'));
  assert.doesNotMatch(mapDragSource, /applicationMapMode === "workflow"/);
  assert.match(mapDragSource, /event\.button === 0/);
  assert.match(renderer, /setMapDetailCollapsed/);
  assert.match(css, /\.map-main\.detail-collapsed/);
  assert.match(css, /\.map-node\.draggable/);
  assert.match(activeIpc, /assessment:buildMap/);
  assert.match(activeIpc, /assessment:mapOverview/);
  assert.match(preload, /assessmentMapPaths/);
  assert.match(preload, /assessmentBuildMap/);
});

test("clean assessment schemas cover recon, enumeration, runs, and no removed stores", () => {
  assert.equal(ASSESSMENT_VERSION, 5);
  assert.ok(Object.values(JSON_TEMPLATES).every((template) => template.schemaVersion === 5));
  assert.ok(JSON_TEMPLATES["enumeration/assets.json"].assetTemplate.inScope === null);
  assert.ok(JSON_TEMPLATES["enumeration/endpoints.json"].endpointTemplate.method === "GET");
  assert.ok(JSON_TEMPLATES["runs/runs.json"].runTemplate.scopeSnapshotSha256 !== undefined);
  for (const removed of ["settings.config", "scope/engagement.json", "scope/in-scope.json", "vulnerability-scans/high.json", "penetration-testing/coverage.json"]) {
    assert.equal(JSON_TEMPLATES[removed], undefined, removed);
  }
});

test("runtime controls are app-managed Project Settings, not assessment files", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const profileSource = fs.readFileSync(path.join(__dirname, "..", "src", "app", "storage", "project-profile-store.js"), "utf8");
  assert.match(html, /data-app-settings-section="project"/);
  assert.match(profileSource, /runtime:\s*\{/);
  assert.doesNotMatch(html, /settings\.config|pen_context\.md|\.pointer-assessment\.json/);
});

test("project settings tabs map vertical wheel movement to horizontal scrolling", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "layout-revamp.css"), "utf8");
  assert.match(renderer, /projectSettingsNav\?\.addEventListener\("wheel"/);
  assert.match(renderer, /projectSettingsNav\.scrollLeft \+ delta/);
  assert.match(renderer, /projectSettingsNav\.scrollTo\(\{ left: 0, behavior \}\)/);
  assert.match(styles, /scroll-snap-type:\s*x mandatory/);
  assert.match(styles, /scroll-snap-align:\s*start/);
  assert.match(styles, /@container app-settings \(max-width: 1120px\)[\s\S]*?\.app-settings-content \.project-settings-nav\s*\{[\s\S]*?min-height:\s*48px/);
});

test("Custom actions are hover-revealed and Scope/Config files are not workspace items", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  assert.ok(html.includes('class="bounty-subsection-label bounty-custom-label"'));
  assert.doesNotMatch(html, /data-bounty-file="settings\.config"/);
  assert.doesNotMatch(html, /scope\/in-scope\.json|scope\/out-of-scope\.json|scope\/configurations\.json|pen_context\.md/);
  assert.match(renderer, /beginCustomEntry/);
  assert.match(renderer, /custom-create-row/);
  assert.match(renderer, /custom-folder-actions/);
  assert.match(renderer, /selectedCustomFolder/);
  assert.match(renderer, /selectedCustomEntries/);
  assert.match(renderer, /openCustomContextMenu/);
  assert.match(renderer, /deleteSelectedCustomEntries/);
  assert.match(renderer, /parent \? `\$\{parent\}\/\$\{name\}` : name/);
  assert.doesNotMatch(renderer, /prompt\(type === "directory"/);
  assert.doesNotMatch(renderer, /scope\/in-scope\.json|settings\.config/);
  assert.match(css, /custom-create-input/);
  assert.match(css, /custom-entry-row:hover \.custom-folder-actions/);
  assert.match(css, /custom-context-menu/);
  assert.match(css, /bounty-custom-label:hover \.bounty-subsection-actions/);
  assert.match(css, /bounty-custom-label \.bounty-subsection-actions \{ opacity:0/);
});

test("incomplete assessments keep the tree visible and expose a repair review dialog", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  assert.ok(html.includes('id="assessment-repair-overlay"'));
  assert.ok(html.includes('id="assessment-repair-list"'));
  assert.ok(html.includes('id="assessment-repair-confirm"'));
  assert.match(renderer, /const showAssessmentTree = ready \|\| incomplete \|\| repairing/);
  assert.match(renderer, /openAssessmentRepairDialog/);
  assert.match(renderer, /Create missing items/);
  assert.match(css, /\.assessment-repair-overlay/);
  assert.match(css, /\.assessment-repair-item/);
});

test("framework checklist JSON stores are not part of the assessment workspace", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  assert.equal(JSON_TEMPLATES["penetration-testing/wstg-checklist.json"], undefined);
  assert.equal(JSON_TEMPLATES["penetration-testing/mitre-checklist.json"], undefined);
  assert.equal(JSON_TEMPLATES["penetration-testing/asvs-checklist.json"], undefined);
  assert.doesNotMatch(html, /penetration-testing\/|vulnerability-scans\/|data-bounty-file="settings\.config"/);
  assert.ok(html.includes('data-bounty-file=".xekute/checklist.md"'));
});

test("assessment repair creates the requested workspace tree and ignores leftover files", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "example-target");
  const artifacts = createProjectArtifactService({ fs, path });
  const workspace = createAssessmentWorkspace({
    fs,
    path,
    projectArtifacts: artifacts,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });

  const initial = workspace.verify(root);
  assert.equal(initial.code, "NOT_FOUND");

  const repaired = workspace.repair(root, { createRoot: true });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.valid, true);
  assert.equal(repaired.missingCount, 0);
  for (const entry of [
    "report/report.md", "context/sources", "custom", "custom_scripts", "tools", "evidence",
    ".xekute", "runs", "runs/runs.json", "Map", "WebClone", "recon/active-recon.json",
    "enumeration/assets.json", "traffic/raw.jsonl",
  ]) assert.ok(repaired.created.includes(entry), entry);
  for (const removed of [
    ".pointer-assessment.json", "pen_context.md", "settings.config", "scope/engagement.json",
    "penetration-testing/wstg-checklist.json", "penetration-testing/coverage.json",
    "vulnerability-scans/high.json", "findings/findings.json",
  ]) {
    assert.equal(repaired.created.includes(removed), false, removed);
    assert.equal(fs.existsSync(path.join(root, ...removed.split("/"))), false, removed);
  }

  const bootstrapped = artifacts.bootstrap(root);
  assert.equal(bootstrapped.ok, true, bootstrapped.error);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "project_info", "index.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "checklist.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "evidence", "index.md")), true);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "findings")), false);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("professional assessment records preserve operational evidence hashes, canonical E-####, assets, and run snapshots", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "professional-records");
  const artifacts = createProjectArtifactService({ fs, path, now: () => new Date("2026-01-02T03:04:05.000Z") });
  const workspace = createAssessmentWorkspace({ fs, path, now: () => new Date("2026-01-02T03:04:05.000Z"), projectArtifacts: artifacts });
  workspace.repair(root, { createRoot: true });
  artifacts.bootstrap(root);

  fs.mkdirSync(path.join(root, "findings"), { recursive: true });
  fs.writeFileSync(path.join(root, "findings", "findings.json"), `${JSON.stringify({ findings: [{ id: "LEGACY", title: "Leftover" }] }, null, 2)}\n`);

  const evidence = workspace.appendEvidenceRecord(root, { id: "ev-1", request: "GET / HTTP/1.1", response: "HTTP/1.1 200 OK", source: "test" });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.record.sha256.length, 64);
  const evidenceLines = workspace.readJsonl(root, "evidence/index.jsonl");
  assert.ok(evidenceLines.records.some((entry) => entry.id === "ev-1"));
  assert.equal(typeof workspace.appendFinding, "undefined");

  const snapshot = artifacts.inspect(root);
  const h = artifacts.stage(root, { mode: "hypothesis", expected_revisions: snapshot.revisions, operations: [{ kind: "hypothesis.create", client_ref: "h1", title: "Session handling" }] });
  assert.equal(h.ok, true, h.error);
  assert.equal(artifacts.commit(root, h.staging_id).ok, true);
  const afterH = artifacts.inspect(root);
  const c = artifacts.stage(root, {
    mode: "plan",
    expected_revisions: afterH.revisions,
    operations: [{
      kind: "checklist.create", client_ref: "c1", hypothesis_id: "H-0001", title: "Check cookies", phase: "execution",
      target: "app.example", knowledge_release_id: "rel-1", procedure_id: "proc-1", source_hash: "abc123",
    }],
  });
  assert.equal(c.ok, true, c.error);
  assert.equal(artifacts.commit(root, c.staging_id).ok, true);
  const afterC = artifacts.inspect(root);
  const e = artifacts.stage(root, {
    mode: "agent",
    expected_revisions: afterC.revisions,
    operations: [{
      kind: "evidence.create", client_ref: "e1", title: "Cookie observed", status: "verified", verifier: "hybrid-accept",
      checklist_refs: ["C-0001"], hypothesis_refs: ["H-0001"], source_refs: ["traffic:1"], sanitized_excerpts: "Set-Cookie: sid",
    }],
  });
  assert.equal(e.ok, true, e.error);
  assert.equal(artifacts.commit(root, e.staging_id).ok, true);
  assert.equal(fs.existsSync(path.join(root, ".xekute", "evidence", "E-0001.md")), true);

  const run = workspace.createRun(root, { profile: "agent", status: "running" });
  assert.equal(run.ok, true);
  assert.equal(run.run.scopeSnapshotSha256.length, 64);
  const stopped = workspace.updateRun(root, run.run.id, { status: "stopped", stopReason: "operator stop" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.run.stopReason, "operator stop");
  const report = workspace.generateReport(root);
  assert.equal(report.ok, true);
  assert.match(report.path, /^report\/exports\/security-report-/);
  assert.equal(report.workingPath, "report/report.md");
  assert.ok(fs.existsSync(path.join(root, report.path.replace(/\//g, path.sep))));
  const markdown = fs.readFileSync(path.join(root, "report", "report.md"), "utf8");
  assert.match(markdown, /E-0001/);
  assert.match(markdown, /Cookie observed/);
  assert.doesNotMatch(markdown, /Leftover|F-0001/);
  fs.rmSync(parent, { recursive: true, force: true });
});

test("assessment repair recreates missing files without rewriting existing JSON", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "preserve-data");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const assetsPath = path.join(root, "enumeration", "assets.json");
  const missingPath = path.join(root, "enumeration", "endpoints.json");
  const original = JSON.parse(fs.readFileSync(assetsPath, "utf8"));
  original.notes = "operator preserved";
  original.assets = [{ id: "asset-1", value: "app.example" }];
  fs.writeFileSync(assetsPath, `${JSON.stringify(original, null, 2)}\n`, "utf8");
  fs.rmSync(missingPath);

  const invalid = workspace.verify(root);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.missing.map((entry) => entry.path), ["enumeration/endpoints.json"]);

  const repaired = workspace.repair(root);
  assert.equal(repaired.valid, true);
  assert.deepEqual(repaired.created, ["enumeration/endpoints.json"]);
  const preserved = JSON.parse(fs.readFileSync(assetsPath, "utf8"));
  assert.equal(preserved.notes, "operator preserved");
  assert.equal(preserved.assets[0].id, "asset-1");

  fs.rmSync(parent, { recursive: true, force: true });
});

test("assessment repair does not replace paths having the wrong type", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "wrong-type");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const reportPath = path.join(root, "report", "report.md");
  fs.rmSync(reportPath);
  fs.mkdirSync(reportPath);

  const repaired = workspace.repair(root);
  assert.equal(repaired.valid, false);
  assert.deepEqual(repaired.blocked, [{ path: "report/report.md", reason: "wrong_type" }]);
  assert.equal(fs.lstatSync(reportPath).isDirectory(), true);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("traffic history reads newest HTTP exchanges from Traffic Raw with bounded, resilient parsing", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "traffic-history");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  workspace.appendTrafficRecord(root, {
    requestId: "first",
    method: "GET",
    url: "https://authorized.example/one",
    statusCode: 200,
    request: "GET /one HTTP/1.1\r\nHost: authorized.example\r\n\r\n",
    response: "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\none",
  });
  workspace.appendTrafficRecord(root, {
    requestId: "second",
    method: "POST",
    url: "https://authorized.example/two",
    statusCode: 201,
    request: "POST /two HTTP/1.1\r\nHost: authorized.example\r\n\r\ntwo",
    response: "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\n\r\n{}",
  });
  fs.appendFileSync(path.join(root, "traffic", "raw.jsonl"), "not-json\n", "utf8");

  const history = workspace.readTrafficHistory(root, { limit: 1 });
  assert.equal(history.ok, true);
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].requestId, "second");
  assert.equal(history.records[0].statusCode, 201);
  assert.equal(history.invalidCount, 1);
  assert.equal(history.truncated, true);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("traffic persistence stores raw secrets without masking", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "traffic-redaction");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const rawRequest = "POST /login HTTP/1.1\r\nHost: authorized.example\r\nAuthorization: Bearer top-secret\r\nCookie: sid=abc\r\nContent-Type: application/json\r\n\r\n{\"username\":\"tester\",\"password\":\"hunter2\",\"nested\":{\"api_key\":\"key-1\"}}";
  assert.match(redactHttpMessage(rawRequest), /top-secret/);

  workspace.appendTrafficRecord(root, {
    requestId: "raw-record",
    method: "POST",
    url: "https://authorized.example/login?token=query-secret&next=dashboard",
    statusCode: 200,
    request: rawRequest,
    response: "HTTP/1.1 200 OK\r\nSet-Cookie: session=response-secret\r\n\r\n{}",
  });
  const stored = workspace.readTrafficHistory(root).records[0];
  assert.equal(stored.redacted, false);
  assert.match(JSON.stringify(stored), /top-secret/);
  assert.match(stored.request, /sid=abc/);
  assert.match(stored.url, /token=query-secret/);
  assert.match(stored.response, /response-secret/);
  assert.match(stored.request, /username/);
  assert.match(stored.url, /next=dashboard/);

  fs.rmSync(parent, { recursive: true, force: true });
});

test("traffic capture remains available after assessment files change without writing evidence indexes", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "traffic-incomplete");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });
  fs.writeFileSync(path.join(root, "enumeration", "assets.json"), "[]\n", "utf8");

  const verification = workspace.verify(root);
  assert.equal(verification.valid, false);
  const logged = workspace.appendTrafficRecord(root, {
    requestId: "capture-during-repair",
    method: "GET",
    url: "https://authorized.example/",
    statusCode: 200,
    request: "GET / HTTP/1.1\r\nHost: authorized.example\r\n\r\n",
    response: "HTTP/1.1 200 OK\r\n\r\n",
  });
  assert.equal(logged.ok, true);
  assert.equal(logged.evidence, undefined);
  assert.equal(fs.existsSync(path.join(root, "evidence", "index.jsonl")), false);
  assert.equal(workspace.readTrafficHistory(root).records[0].requestId, "capture-during-repair");

  fs.rmSync(parent, { recursive: true, force: true });
});

test("traffic history delete removes selected exchanges from Traffic Raw", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "traffic-delete");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  workspace.appendTrafficRecord(root, {
    requestId: "keep-me",
    method: "GET",
    url: "https://authorized.example/keep",
    statusCode: 200,
    request: "GET /keep HTTP/1.1\r\nHost: authorized.example\r\n\r\n",
    response: "HTTP/1.1 200 OK\r\n\r\n",
  });
  workspace.appendTrafficRecord(root, {
    requestId: "remove-a",
    method: "POST",
    url: "https://authorized.example/remove-a",
    statusCode: 201,
    request: "POST /remove-a HTTP/1.1\r\nHost: authorized.example\r\n\r\n",
    response: "HTTP/1.1 201 Created\r\n\r\n",
  });
  workspace.appendTrafficRecord(root, {
    requestId: "remove-b",
    method: "POST",
    url: "https://authorized.example/remove-b",
    statusCode: 201,
    request: "POST /remove-b HTTP/1.1\r\nHost: authorized.example\r\n\r\n",
    response: "HTTP/1.1 201 Created\r\n\r\n",
  });
  fs.appendFileSync(path.join(root, "traffic", "raw.jsonl"), "not-json\n", "utf8");

  const deleted = workspace.deleteTrafficRecords(root, { requestIds: ["remove-a", "remove-b", "missing"] });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted, 2);

  const history = workspace.readTrafficHistory(root, { limit: 10 });
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].requestId, "keep-me");
  assert.equal(history.invalidCount, 1);

  const exchanges = fs.readFileSync(path.join(root, "traffic", "raw.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((record) => record?.recordType === "http-exchange");
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].requestId, "keep-me");

  fs.rmSync(parent, { recursive: true, force: true });
});
