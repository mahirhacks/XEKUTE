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

test("every assessment sidebar item maps to its required backing file", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  for (const [item, relativePath] of Object.entries(ASSESSMENT_ITEM_FILES)) {
    assert.ok(
      html.includes(`data-bounty-item="${item}" data-bounty-file="${relativePath}"`),
      `${item} should open ${relativePath}`,
    );
  }
});

test("custom entries cannot reuse built-in assessment file or folder names", () => {
  for (const reserved of ["Scope", "traffic", "Map", "WebClone", "report.md", "settings.config", "pen_context.md", "wstg-checklist.json", "in-scope.json"]) {
    const result = validateCustomEntryPath(`custom/notes/${reserved}`);
    assert.equal(result.code, "RESERVED_NAME", reserved);
  }
  assert.equal(validateCustomEntryPath("custom/Scope").code, "RESERVED_NAME");
  assert.equal(validateCustomEntryPath("custom/sCoPe").code, "RESERVED_NAME");
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
  assert.equal(workspace.deleteCustomEntries(root, ["../scope"]).code, "INVALID_NAME");
  assert.equal(fs.existsSync(path.join(root, "scope", "in-scope.json")), true);
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
  assert.match(renderer, /loadSecurityHistoryRecord\(restoredIndices\[0\]\)/);
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
  assert.match(css, /\.assistant-reply\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.assistant-reply\s+:not\(pre\)\s*>\s*code[\s\S]*?word-break:\s*break-all/);
  assert.match(css, /\.md-code-block pre\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/s);
});

test("chat sessions are restored per workspace and saved after explicit lifecycle changes", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "src", "app", "electron", "preload.js"), "utf8");
  assert.match(preload, /loadSessionMemory/);
  assert.match(preload, /recordSessionMemoryEvent/);
  assert.match(preload, /saveSessionMemoryBeforeClose/);
  assert.match(renderer, /restoreChatSessionsForCurrentWorkspace/);
  assert.match(renderer, /beginSessionMemoryBlock/);
  assert.match(renderer, /await restoreChatSessionsForCurrentWorkspace\(\)/);
  assert.match(renderer, /flushSessionMemory/);
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
  assert.ok(html.includes('data-bounty-file="pen_context.md"'));
  assert.ok(html.includes(">Custom<"));
  assert.ok(html.includes('data-bounty-folder="Map"'));
  assert.ok(html.includes('data-bounty-folder="WebClone"'));
  assert.ok(html.indexOf(">Context<") < html.indexOf(">Core<"));
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
  assert.match(html, /class="models-context-settings-body"/);
  assert.match(html, /Providers &amp; API keys/);
  assert.match(html, /id="llm-openrouter-config" class="models-api-provider-block" hidden/);
  assert.match(renderer, /function syncLlmProviderUi\(provider = "ollama"\)[\s\S]*?llmOllamaConfig\.hidden = active !== "ollama";[\s\S]*?llmOpenRouterConfig\.hidden = active !== "openrouter";/);
  assert.match(html, /class="models-api-keys models-context-settings"[\s\S]*?id="context-compaction-model"[\s\S]*?id="context-compaction-cross-provider"/);
  assert.match(settingsStyles, /\.app-settings-content #context-compaction-model:-webkit-autofill,[\s\S]*?-webkit-text-fill-color:#e1e1e1 !important;[\s\S]*?-webkit-box-shadow:0 0 0 1000px #181818 inset !important;/);
  assert.match(settingsStyles, /\.app-settings-content \.models-context-settings \{[\s\S]*?display:flex;[\s\S]*?flex-direction:column;[\s\S]*?gap:12px;/);
  assert.match(layoutRevampStyles, /#app-settings-llm-panel \.models-settings-list \{[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 12px;[\s\S]*?background: #1b1b1b;/);
  assert.match(layoutRevampStyles, /#app-settings-llm-panel \.models-context-settings-body,[\s\S]*?flex-direction: column;[\s\S]*?gap: 12px;/);
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
  assert.ok(html.includes('data-bounty-item="agent-hypotheses" data-bounty-file=".xekute/logs/agent-hypotheses.jsonl"'));
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
  assert.match(renderer, /\/passive/);
  assert.match(renderer, /\/endpoint/);
  assert.match(renderer, /slice\(0, 3\)/);
  assert.match(renderer, /availableSlashCommands/);
  assert.match(renderer, /runStaticSlashCommand/);
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
  assert.match(settingsStyles, /\.certificate-security-note \{[\s\S]*display:block[\s\S]*border:0[\s\S]*background:transparent/);
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

test("professional assessment schemas cover scope, evidence, services, findings, and frameworks", () => {
  assert.equal(ASSESSMENT_VERSION, 4);
  assert.ok(Object.values(JSON_TEMPLATES).every((template) => template.schemaVersion === 4));
  assert.ok(JSON_TEMPLATES["scope/engagement.json"].rulesOfEngagement.stopConditions.length);
  assert.ok(JSON_TEMPLATES["enumeration/assets.json"].assetTemplate.inScope === null);
  assert.ok(JSON_TEMPLATES["findings/findings.json"].lifecycle.includes("retest-required"));
  assert.ok(JSON_TEMPLATES["penetration-testing/coverage.json"].frameworks.some((framework) => framework.id === "asvs"));
  assert.ok(JSON_TEMPLATES["penetration-testing/asvs-checklist.json"].checks.some((check) => check.id === "V4"));
  assert.ok(JSON_TEMPLATES["runs/runs.json"].runTemplate.scopeSnapshotSha256 !== undefined);

  const inScope = JSON_TEMPLATES["scope/in-scope.json"];
  assert.deepEqual(Object.keys(inScope.engagement), [
    "name", "programName", "platform", "engagementType", "clientOrOwner", "primaryContact",
    "emergencyContact", "timezone", "startDate", "endDate",
  ]);
  assert.ok("authorizationReference" in inScope.authorization);
  assert.ok("allowedTechniques" in inScope.targetTemplate);
  assert.ok("credentialsReference" in inScope.targetTemplate);

  const configurations = JSON_TEMPLATES["scope/configurations.json"];
  assert.equal("authorizationGate" in configurations, false);
  assert.ok("stopConditions" in configurations);
  assert.ok("dataHandling" in configurations);
  assert.ok("rateLimits" in configurations);

  const finding = JSON_TEMPLATES["vulnerability-scans/high.json"].findingTemplate;
  assert.ok("cvss" in finding);
  assert.ok("classification" in finding);
  assert.ok("reproduction" in finding);
  assert.ok("remediation" in finding);
  assert.ok("validation" in finding);

  const service = JSON_TEMPLATES["vulnerability-scans/services.json"].serviceTemplate;
  assert.ok("latestKnownVersion" in service);
  assert.ok("endOfLife" in service);
  assert.ok("cveIds" in service);

  const settings = JSON_TEMPLATES["settings.config"];
  assert.equal(settings.listener.bindAddress, "127.0.0.1");
  assert.equal(settings.listener.port, 8080);
  assert.ok("interception" in settings);
  assert.ok("authorization" in settings);
  assert.equal("authorizationGate" in settings, false);
  assert.ok("authority" in settings);
  assert.ok(Object.values(settings.authority.permissions).every((enabled) => enabled === true));
  assert.ok("upstreamProxy" in settings);
  assert.ok("intruder" in settings);
  assert.ok("logging" in settings);
});

test("settings UI controls map to real settings.config fields", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const settings = JSON_TEMPLATES["settings.config"];
  const paths = [...html.matchAll(/data-setting-path="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(paths.length >= 20);
  for (const settingPath of paths) {
    const value = settingPath.split(".").reduce((current, key) => current?.[key], settings);
    assert.notEqual(value, undefined, `${settingPath} must exist in settings.config`);
  }
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

test("all Scope files use the visual JSON editor and Custom actions are hover-revealed", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "styles", "base.css"), "utf8");
  assert.ok(html.includes('id="scope-ui-view"'));
  assert.ok(html.includes('id="scope-ui-form"'));
  assert.ok(html.includes('class="bounty-subsection-label bounty-custom-label"'));
  assert.ok(html.includes('class="bounty-subsection-label bounty-config-label"><span>Config</span>'));
  assert.ok(html.indexOf(">Custom<") < html.indexOf(">Config<"));
  assert.ok(html.indexOf(">Config<") < html.indexOf('data-bounty-file="settings.config"'));
  assert.match(renderer, /showScopeResource/);
  assert.match(renderer, /scope\/in-scope\.json/);
  assert.match(renderer, /scope\/out-of-scope\.json/);
  assert.match(renderer, /scope\/configurations\.json/);
  assert.match(renderer, /setResourceScopeMode/);
  assert.match(renderer, /beginCustomEntry/);
  assert.match(renderer, /custom-create-row/);
  assert.match(renderer, /custom-folder-actions/);
  assert.match(renderer, /selectedCustomFolder/);
  assert.match(renderer, /selectedCustomEntries/);
  assert.match(renderer, /openCustomContextMenu/);
  assert.match(renderer, /deleteSelectedCustomEntries/);
  assert.match(renderer, /parent \? `\$\{parent\}\/\$\{name\}` : name/);
  assert.doesNotMatch(renderer, /prompt\(type === "directory"/);
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

test("WSTG and MITRE files expose distinct current framework checklists and UI mode", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "src", "ui", "bootstrap.js"), "utf8");
  const wstg = JSON_TEMPLATES["penetration-testing/wstg-checklist.json"];
  const mitre = JSON_TEMPLATES["penetration-testing/mitre-checklist.json"];

  assert.equal(wstg.framework.stableVersion, "4.2");
  assert.equal(wstg.framework.top10Version, "2025");
  assert.ok(wstg.checks.some((check) => check.id === "WSTG-ATHN-04"));
  assert.ok(wstg.checks.some((check) => check.id === "WSTG-INPV-05"));
  assert.equal(wstg.checks.filter((check) => check.category === "OWASP Top 10:2025").length, 10);
  assert.equal(mitre.framework.version, "19.1");
  assert.ok(mitre.tactics.includes("Stealth"));
  assert.ok(mitre.tactics.includes("Defense Impairment"));
  assert.ok(mitre.checks.some((check) => check.techniqueId === "T1190"));
  assert.ok(mitre.checks.some((check) => check.techniqueId === "T1505.003"));
  assert.ok(html.includes('id="checklist-ui-view"'));
  assert.ok(html.includes('id="checklist-status-filter"'));
  assert.match(renderer, /showChecklistResource/);
  assert.match(renderer, /resourceChecklistType === "mitre"/);
});

test("assessment repair merges new framework checks without losing checklist evidence", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "checklist-merge");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });
  const file = path.join(root, "penetration-testing", "wstg-checklist.json");
  const checklist = JSON.parse(fs.readFileSync(file, "utf8"));
  checklist.checks = [{ ...checklist.checks.find((check) => check.id === "WSTG-INPV-05"), status: "failed", result: "Evidence retained" }];
  checklist.categories = ["Input Validation"];
  delete checklist.framework.top10Version;
  fs.writeFileSync(file, `${JSON.stringify(checklist, null, 2)}\n`, "utf8");

  const repaired = workspace.repair(root);
  assert.equal(repaired.valid, true);
  const merged = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(merged.checks.find((check) => check.id === "WSTG-INPV-05").status, "failed");
  assert.equal(merged.checks.find((check) => check.id === "WSTG-INPV-05").result, "Evidence retained");
  assert.ok(merged.checks.some((check) => check.id === "WSTG-ATHN-04"));
  assert.ok(merged.checks.some((check) => check.id === "A01:2025"));
  fs.rmSync(parent, { recursive: true, force: true });
});

test("assessment repair creates the complete versioned workspace", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "example-target");
  const workspace = createAssessmentWorkspace({
    fs,
    path,
    now: () => new Date("2026-01-02T03:04:05.000Z"),
  });

  const initial = workspace.verify(root);
  assert.equal(initial.code, "NOT_FOUND");

  const repaired = workspace.repair(root, { createRoot: true });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.valid, true);
  assert.equal(repaired.missingCount, 0);
  assert.ok(repaired.created.includes(".pointer-assessment.json"));
  assert.ok(repaired.created.includes("penetration-testing/wstg-checklist.json"));
  assert.ok(repaired.created.includes("report/report.md"));
  assert.ok(repaired.created.includes("pen_context.md"));
  assert.ok(repaired.created.includes("context/sources"));
  assert.ok(repaired.created.includes("custom"));
  assert.ok(repaired.created.includes("custom_scripts"));
  assert.ok(repaired.created.includes("tools"));
  assert.ok(repaired.created.includes("evidence"));
  assert.ok(repaired.created.includes("findings"));
  assert.ok(repaired.created.includes("runs"));
  assert.ok(repaired.created.includes("scope/engagement.json"));
  assert.ok(repaired.created.includes("runs/runs.json"));
  assert.ok(repaired.created.includes("penetration-testing/coverage.json"));
  assert.ok(repaired.created.includes("Map"));
  assert.ok(repaired.created.includes("WebClone"));

  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".pointer-assessment.json"), "utf8"));
  assert.equal(manifest.schemaVersion, 4);
  assert.equal(manifest.name, "example-target");
  assert.equal(manifest.createdAt, "2026-01-02T03:04:05.000Z");

  fs.rmSync(parent, { recursive: true, force: true });
});

test("professional assessment records preserve evidence hashes, findings, assets, and run snapshots", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "professional-records");
  const workspace = createAssessmentWorkspace({ fs, path, now: () => new Date("2026-01-02T03:04:05.000Z") });
  workspace.repair(root, { createRoot: true });

  const evidence = workspace.appendEvidenceRecord(root, { id: "ev-1", request: "GET / HTTP/1.1", response: "HTTP/1.1 200 OK", source: "test" });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.record.sha256.length, 64);
  const evidenceLines = workspace.readJsonl(root, "evidence/index.jsonl");
  assert.ok(evidenceLines.records.some((entry) => entry.id === "ev-1"));

  const finding = workspace.appendFinding(root, { id: "finding-1", title: "Example finding", severity: "medium", status: "suspected", evidence: ["ev-1"] });
  assert.equal(finding.ok, true);
  assert.equal(finding.finding.evidence[0], "ev-1");
  assert.equal(workspace.appendFinding(root, { id: "finding-confirmed", title: "Needs evidence", status: "confirmed" }).code, "EVIDENCE_REQUIRED");

  const run = workspace.createRun(root, { profile: "agent", status: "running" });
  assert.equal(run.ok, true);
  assert.equal(run.run.scopeSnapshotSha256.length, 64);
  const stopped = workspace.updateRun(root, run.run.id, { status: "stopped", stopReason: "operator stop" });
  assert.equal(stopped.ok, true);
  assert.equal(stopped.run.stopReason, "operator stop");
  const report = workspace.generateReport(root);
  assert.equal(report.ok, true);
  assert.match(report.path, /^report\/exports\/report-/);
  assert.ok(fs.existsSync(path.join(root, report.path.replace(/\//g, path.sep))));
  fs.rmSync(parent, { recursive: true, force: true });
});

test("assessment migration adds missing fields without losing existing evidence", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pointer-assessment-"));
  const root = path.join(parent, "preserve-data");
  const workspace = createAssessmentWorkspace({ fs, path });
  workspace.repair(root, { createRoot: true });

  const evidencePath = path.join(root, "scope", "in-scope.json");
  const missingPath = path.join(root, "enumeration", "endpoints.json");
  const evidence = '{"targets":["https://authorized.example"]}\n';
  fs.writeFileSync(evidencePath, evidence, "utf8");
  fs.rmSync(missingPath);

  const invalid = workspace.verify(root);
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.missing.map((entry) => entry.path).sort(), [
    "enumeration/endpoints.json",
    "scope/in-scope.json",
  ]);

  const repaired = workspace.repair(root);
  assert.equal(repaired.valid, true);
  assert.deepEqual(repaired.created, ["enumeration/endpoints.json"]);
  assert.ok(repaired.updated.includes("scope/in-scope.json"));
  const migrated = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.deepEqual(migrated.targets, ["https://authorized.example"]);
  assert.equal(migrated.schemaVersion, 4);
  assert.ok("engagement" in migrated);
  assert.ok("authorization" in migrated);
  assert.ok("targetTemplate" in migrated);

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

test("traffic capture and evidence indexing remain available after assessment files change", () => {
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
  assert.equal(logged.evidence.ok, true);
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
