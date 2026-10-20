"use strict";
const { rendererDefinitions, rendererStatements } = require("./renderer-source.js");
const fs = require("node:fs");
const path = require("node:path");
const shell = fs.readFileSync(path.join(__dirname, "../../src/ui/index.legacy.html"), "utf8");
const markup = '<button id="model-picker"><span id="model-label">reasoner</span></button><button id="outside">Outside</button>'
  + shell.slice(shell.indexOf('  <div id="model-controls-menu"'), shell.indexOf('  <div id="app-dialog-overlay"'));
const script = `
var $=id=>document.getElementById(id),appState=globalThis;
${rendererDefinitions("modelPicker", "modelLabel", "authorityPicker", "authorityLabel", "authorityMenu", "modelMenu", "modelControlsMenu", "modelContextTrigger", "modelEffortTrigger", "modelBrowseTrigger", "modelContextValue", "modelEffortValue", "modelCurrentName", "modelSearch", "modelList", "modelAddBtn", "modelAddForm", "modelCustom", "modelCustomAdd", "modelEditMenu", "thinkingToggle", "ollamaThinkingRow", "ollamaThinkingSection", "openRouterReasoningRow", "reasoningOptions", "contextOptions")}
var selectedModel='acme/reasoner',activeLlmProvider='openrouter',editingModel=null,modelEditRequest=0;
var allModels=['acme/reasoner','acme/fast','local-model'],modelSettings={},ollamaRuntimeContext={},AUTO_CONTEXT='Auto',MODEL_SETTINGS_KEY='models';
var resolvedContextCapacity={tokens:262144,plan:{model:selectedModel}},settingsOpened=null;
var openRouterModelMeta={
 'acme/reasoner':{contextWindowTokens:1048576,reasoning:{supportedEfforts:['low','high','max'],defaultEffort:'high'}},
 'acme/fast':{contextWindowTokens:131072}
};
var initialKey=ContextBudget.contextKey('openrouter',selectedModel);
modelSettings[initialKey]={context:'262144',contextMode:'custom',contextLimitTokens:262144,reasoningEffort:'high',thinkingConfigured:false};
var chatModeMenu=document.createElement('div'),chatModeToggle=null,modelsSettingsSearch=null;chatModeMenu.hidden=true;
var isOpenRouterProvider=()=>activeLlmProvider==='openrouter',selectedLlmProvider=()=>activeLlmProvider;
var closeContextPopover=()=>{},closeChatModeMenu=()=>{},closeAuthorityMenu=()=>{},updateContextUsage=()=>{},refreshStoredContextCapacity=async()=>{};
var ensureOpenRouterModelContext=async name=>openRouterModelMeta[name]||{};
var refreshModelContextCapacity=async()=>{},modelsVisibleInPicker=()=>allModels,loadModels=async()=>renderModelList();
var applyOpenRouterModelDefaults=async()=>syncModelControlsSummary();
var openAppSettings=section=>{settingsOpened=section},showModelListLoading=()=>{},renderModelsSettingsList=()=>{},renderExploreSubagentSelect=()=>{};
var addCustomModelName=name=>name,escapeHtml=text=>text;
var formatContextWindowLabel=tokens=>ContextBudget.formatContextWindowLabel(tokens);
${rendererDefinitions("getModelSettings", "modelThinkingEnabled", "saveModelSettings", "setModelSetting", "contextLabelToTokens", "tokensToContextLabel")}
${rendererDefinitions("modelDisplayName", "syncModelLabel")}
${rendererDefinitions("syncModelControlsSummary", "openModelControlsMenu", "positionModelPanel", "positionModelMenu", "closeModelEditMenu", "closeModelMenu", "positionModelEditMenu", "openModelEditMenu")}
${rendererDefinitions("reasoningEffortLabel", "openRouterReasoningState", "renderModelPrimaryLabel", "renderReasoningOptions", "formatOpenRouterContextLabel", "nearestContextChoice", "pickerContextMaximum", "renderContextOptions")}
${rendererStatements("thinkingToggle?.addEventListener(\"click\"")}
${rendererDefinitions("renderModelList", "openModelMenu")}
${rendererStatements("modelPicker.addEventListener(\"click\"", "modelContextTrigger.addEventListener(\"click\"", "modelEffortTrigger.addEventListener(\"click\"", "modelBrowseTrigger.addEventListener(\"click\"", "modelControlsMenu.addEventListener(\"keydown\"")}
${rendererStatements("modelMenu?.addEventListener(\"mousedown\"", "modelSearch.addEventListener(\"input\"", "modelSearch.addEventListener(\"keydown\"", "modelAddBtn.addEventListener(\"click\"", "modelCustomAdd.addEventListener(\"click\"", "modelCustom.addEventListener(\"keydown\"", "document.addEventListener(\"click\", (e) => {\n  if (!modelControlsMenu", "document.addEventListener(\"keydown\", (event) => {\n  if (modelControlsM")}
${rendererDefinitions("addCustomModel")}
syncModelControlsSummary();
`;
module.exports = { markup, script };
