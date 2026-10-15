"use strict";
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../../src/ui/bootstrap.js"), "utf8");
const shell = fs.readFileSync(path.join(__dirname, "../../src/ui/index.legacy.html"), "utf8");
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const markup = '<button id="model-picker"><span id="model-label">reasoner</span></button><button id="outside">Outside</button>'
  + shell.slice(shell.indexOf('  <div id="model-controls-menu"'), shell.indexOf('  <div id="app-dialog-overlay"'));
const script = `
var $=id=>document.getElementById(id);
${slice('const modelPicker      =', 'const sidebar          =')}
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
${slice('function getModelSettings(', 'async function fetchOpenRouterModelMetadata(')}
${slice('function modelDisplayName(', 'const CHAT_INPUT_MAX_LINES')}
${slice('function syncModelControlsSummary()', 'function reasoningEffortLabel(')}
${slice('function reasoningEffortLabel(', 'async function updateModelRuntimeNote(')}
${slice('thinkingToggle?.addEventListener(', 'function showModelListLoading(')}
${slice('function renderModelList()', 'authorityPicker?.addEventListener(')}
${slice('modelMenu?.addEventListener("mousedown"', 'window.api.onWorkspaceChanged')}
syncModelControlsSummary();
`;
module.exports = { markup, script };
